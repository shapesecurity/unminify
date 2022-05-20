'use strict';

const reducer = require('shift-reducer');
const shiftScope = require('shift-scope');
const Shift = require('shift-ast/checked');

const getParents = require('../../helpers/parents');
const { functionContainsWeirdness, expressionContainsWeirdness } = require('../../helpers/fn-contains-weirdness');

// TODO rename this to something better expressing "transform for simpler static analysis"
module.exports = function cleanupWithState(ast) {
  const parents = getParents(ast);
  const globalScope = shiftScope.default(ast);
  const lookup = new shiftScope.ScopeLookup(globalScope);

  function findScopeForNode(node, scope = globalScope) {
    // TODO this should live elsewhere
    if (scope.astNode === node) return scope;
    for (let child of scope.children) {
      const r = findScopeForNode(node, child);
      if (r !== null) return r;
    }
    return null;
  }

  function unhoistVarDeclarations(statements) {
    const out = [];
    const toRemove = new WeakSet;
    const toBecomeDecl = new WeakMap; // ExpressionStatement -> list of other expression statements to remove from this set
    let touched = false;
    for (let statement of statements) {
      if (statement.type === 'VariableDeclarationStatement' && statement.declaration.kind === 'var' && statement.declaration.declarators.length === 1 && statement.declaration.declarators[0].init === null) {
        const vs = lookup.lookup(statement.declaration.declarators[0].binding);
        if (vs != null && vs.length === 1) {
          const v = vs[0];
          const simpleWrites = v.references
            .filter(r => r.accessibility.isWrite && !r.accessibility.isRead)
            .map(r => parents.get(r.node))
            .filter(n => n.type === 'AssignmentExpression')
            .map(n => [n, parents.get(n)])
            .filter(([n, p]) => p.type === 'ExpressionStatement' || p.type === 'ForStatement' && p.init === n)
            .map(([, p]) => p);
          const declParent = parents.get(statement);
          const isSameParent = n => {
            const parent = parents.get(n);
            if (parent === declParent) {
              return true;
            }
            const gp = parents.get(parent);
            if (gp != null && gp.type === 'ForStatement' && gp.init === parent) {
              return true;
            }
            return false;
          };
          if (simpleWrites.length > 0 && simpleWrites.every(isSameParent)) {
            touched = true;
            toRemove.add(statement);
            simpleWrites.forEach(s => toBecomeDecl.set(s, simpleWrites));
          }
        }
      }
    }

    if (!touched) {
      return statements;
    }

    for (let statement of statements) {
      if (toRemove.has(statement)) continue;
      if (toBecomeDecl.has(statement)) {
        if (statement.type === 'ExpressionStatement') {
          const declaration = new Shift.VariableDeclaration({ kind: 'var', declarators: [new Shift.VariableDeclarator({
            binding: new Shift.BindingIdentifier({ name: statement.expression.binding.name }),
            init: statement.expression.expression,
          })] });
          out.push(new Shift.VariableDeclarationStatement({ declaration }));
        } else if (statement.type === 'ForStatement') {
          const declaration = new Shift.VariableDeclaration({ kind: 'var', declarators: [new Shift.VariableDeclarator({
            binding: new Shift.BindingIdentifier({ name: statement.init.binding.name }),
            init: statement.init.expression,
          })] });
          out.push(new Shift.ForStatement({ init: declaration, test: statement.test, update: statement.update, body: statement.body }));
        } else {
          throw new Error('unreachable');
        }
        toBecomeDecl.get(statement).forEach(s => toBecomeDecl.delete(s));
        continue;
      }
      out.push(statement);
    }

    return out;
  }

  class CleanupWithState extends reducer.LazyCloneReducer {
    reduceFunctionBody(node, { directives, statements }) {
      // move declarations to first initialization, as long as all writes are in the same statement list as the declaration
      return super.reduceFunctionBody(node, { directives, statements: unhoistVarDeclarations(statements) });
    }

    reduceCallExpression(node, { callee, arguments: _arguments }) {
      // Turn (function(a){ ... })(b) into (function(){ var a = b; ... })()
      // Note: not safe if the function contains a direct `eval` which references `arguments` or an argument contains a direct `eval` which references `arguments` or `this`.
      if (callee.type === 'FunctionExpression' && !callee.isGenerator && !functionContainsWeirdness(callee)) {
        if (_arguments.length > 0 && _arguments.every(a => a.type !== 'SpreadElement' && !expressionContainsWeirdness(a)) && callee.params.rest === null && callee.params.items.every(p => p.type === 'BindingIdentifier')) {
          const names = [].concat(...node.arguments.map(collectNames)); // TODO avoid
          const fnScope = findScopeForNode(node.callee);
          if (fnScope && !names.some(n => fnScope.variables.has(n))) {
            // the scope check is to avoid shadowing something in the arguments
            const newInit = [];
            let i = 0;
            for (; i < callee.params.items.length; ++i) {
              newInit.push(new Shift.VariableDeclarationStatement({ declaration: new Shift.VariableDeclaration({
                kind: 'var',
                declarators: [
                  new Shift.VariableDeclarator({ binding: callee.params.items[i], init: _arguments[i] || null }),
                ],
              }) }));
            }
            for (; i < _arguments.length; ++i) {
              newInit.push(new Shift.ExpressionStatement({ expression: _arguments[i] }));
            }
            const fn = new Shift.FunctionExpression({ name: callee.name, isGenerator: false, isAsync: false, params: new Shift.FormalParameters({ items: [], rest: null }), body: new Shift.FunctionBody({
              directives: [],
              statements: newInit.concat(callee.body.statements),
            }) });
            return new Shift.CallExpression({ callee: fn, arguments: [] });
          }
        }
      }
      return super.reduceCallExpression(node, { callee, arguments: _arguments });
    }
  }


  class NameCollector extends reducer.MonoidalReducer {
    constructor() {
      super({ empty: () => [], concat: (a, b) => a.concat(b) });
    }

    reduceIdentifierExpression(node) {
      return [node.name];
    }

    reduceAssignmentTargetIdentifier(node) {
      return [node.name];
    }

    reduceBindingIdentifier(node) {
      return [node.name];
    }

    reduceFunctionExpression(node, state) { // TODO it would be nice for this to be thunked
      const scope = findScopeForNode(node);
      if (scope !== null) {
        return [...scope.through.keys()];
      }
      return super.reduceFunctionExpression(node, state); // better than nothing
    }

    /*
      Maybe this is a thing which should be exposed by the scope analyzer? through references for individual nodes, not just scopes?
    */
  }

  function collectNames(node) {
    return reducer.default(new NameCollector, node);
  }


  return reducer.default(new CleanupWithState, ast);
};
