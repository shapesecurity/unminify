'use strict';

// Inline constant primitive variables, constant primitive object properties, and constant object properties which are particularly trivial functions.

const shiftScope = require('shift-scope');
const reducer = require('shift-reducer');
const Shift = require('shift-ast/checked');

const getParents = require('../../helpers/parents');
const inlinable = require('../../helpers/inlinable');


module.exports = function inline(ast) {

  const globalScope = shiftScope.default(ast);
  const lookup = new shiftScope.ScopeLookup(globalScope);
  const parents = getParents(ast);

  function findScopeForNode(node, scope = globalScope) {
    // TODO this should live elsewhere
    if (scope.astNode === node) return scope;
    for (let child of scope.children) {
      const r = findScopeForNode(node, child);
      if (r !== null) return r;
    }
    return null;
  }

  function isConstantInitializedVariable(v) {
    if (!isConstantVariable(v)) {
      return false;
    }
    const parent = parents.get(v.declarations[0].node);
    if (parent.type !== 'VariableDeclarator') {
      return false;
    }
    return parent.init !== null;
  }

  function isConstantVariable(v) {
    // TODO this also needs to check that use-before-def is impossible
    if (v.declarations.length !== 1) return false;
    const binding = v.declarations[0].node;
    const parent = parents.get(binding);
    if (parent.type !== 'VariableDeclarator' && parent.type !== 'FormalParameters') return false;
    if (v.references.some(r => r.accessibility.isWrite && r.node !== binding)) return false;
    return true;
  }

  function getConstantObjectVariableObject(_var) {
    // TODO for this to be actually correct we'd also need to check that none of the properties of the object are functions binding 'this'
    if (!isConstantInitializedVariable(_var)) return null;
    const binding = _var.declarations[0].node;
    const parent = parents.get(binding);
    if (parent.init == null) return null;
    if (parent.init.type === 'ObjectExpression' || parent.init.type === 'ArrayExpression') {
      if (_var.references.some(r => {
        const rparent = parents.get(r.node);
        return rparent.type === 'StaticMemberAssignmentTarget' || rparent.type === 'ComputedMemberAssignmentTarget' && rparent.object === r.node;
      })) return null;
      const obj = parent.init;

      if (obj.type === 'ObjectExpression') {
        return new Map(obj.properties.filter(p => p.type === 'DataProperty' && p.name.type === 'StaticPropertyName').map(p => [p.name.value, p.expression])); // TODO could include methods, in principle
      } else if (obj.type === 'ArrayExpression') {
        return new Map(obj.elements.map((v, i) => [i, v]));
      }
      throw 'not reached;';

    } else {
      return null;
    }
  }

  function findStatementParent(node) {
    while (!/Statement/.test(node.type) && node.type !== 'FunctionDeclaration') {
      // eslint-disable-next-line no-param-reassign
      node = parents.get(node);
    }
    return node;
  }


  function getInlining(node) {
    const vars = lookup.lookup(node);
    if (vars.length !== 1) return null;
    const v = vars[0];
    if (!isConstantInitializedVariable(v)) return null;
    const init = parents.get(v.declarations[0].node).init;
    if (init.type === 'IdentifierExpression') {
      const indirectVars = lookup.lookup(init);
      if (indirectVars.length === 1 && isConstantVariable(indirectVars[0])) {
        return new Shift.IdentifierExpression(init);
      }
    }
    if (!inlinable.includes(init.type)) return null;

    return new Shift[init.type](init);
  }


  function getTriviallyInlineableFunction(f, arglen) {
    if (f.type !== 'FunctionExpression') return null;
    if (f.params.items.length !== arglen) return null;
    if (f.body.directives.length > 0) return null;
    if (f.body.statements.length !== 1) return null;
    if (f.body.statements[0].type !== 'ReturnStatement') return null;
    if (f.body.statements[0].expression.type !== 'BinaryExpression') return null;
    const expr = f.body.statements[0].expression;

    if (arglen === 2) {
      if (expr.left.type !== 'IdentifierExpression' || lookup.lookup(expr.left)[0] !== lookup.lookup(f.params.items[0])[0]) return null;
      if (expr.right.type !== 'IdentifierExpression' || lookup.lookup(expr.right)[0] !== lookup.lookup(f.params.items[1])[0]) return null;
      return (left, right) => new Shift.BinaryExpression({ left, operator: expr.operator, right });
    } else if (arglen === 3) {
      if (expr.left.type !== 'BinaryExpression') return null;
      const expr2 = expr.left;
      if (expr2.left.type !== 'IdentifierExpression' || lookup.lookup(expr2.left)[0] !== lookup.lookup(f.params.items[0])[0]) return null;
      if (expr2.right.type !== 'IdentifierExpression' || lookup.lookup(expr2.right)[0] !== lookup.lookup(f.params.items[1])[0]) return null;
      if (expr.right.type !== 'IdentifierExpression' || lookup.lookup(expr.right)[0] !== lookup.lookup(f.params.items[2])[0]) return null;

      return (a, b, right) => new Shift.BinaryExpression({ left: new Shift.BinaryExpression({ left: a, operator: expr2.operator, right: b }), operator: expr.operator, right });
    }
    return null;
  }

  class InliningReducer extends reducer.LazyCloneReducer {
    reduceExpressionStatement(node, { expression }) {
      if (expression.type === 'IdentifierExpression') {
        return new Shift.EmptyStatement;
      }
      return super.reduceExpressionStatement(node, { expression });
    }

    reduceCallExpression(node, { callee, arguments: _arguments }) {
      if (callee.type === 'StaticMemberExpression' && callee.object.type === 'IdentifierExpression' && (_arguments.length === 2 || _arguments.length === 3)) {
        const vs = lookup.lookup(node.callee.object);
        if (vs.length === 1) {
          const obj = getConstantObjectVariableObject(vs[0]);
          if (obj !== null && obj.has(callee.property)) {
            const val = obj.get(callee.property);
            const replacer = getTriviallyInlineableFunction(val, _arguments.length);
            if (replacer !== null) {
              return replacer(..._arguments);
            }
          }
        }
      } else if (callee.type === 'IdentifierExpression') {
        const vs = lookup.lookup(node.callee);
        if (vs.length === 1 && isConstantInitializedVariable(vs[0]) && lookup.scope.variableList.indexOf(vs[0]) === -1) {
          const v = vs[0];
          const decl = parents.get(v.declarations[0].node);
          if (decl.init.type === 'FunctionExpression') {
            const f = decl.init;
            let scope = findScopeForNode(f);
            if (scope !== null && scope.through.size === 0) {

              // This is to handle specifically `var x = function (foo) { if (foo == 'bar') { return a; } else { return b; } }; y = x('bar'); z = x('baz'); w = x();`
              if (f.params.items.length === 1 && _arguments.length <= 1) {
                const pv = lookup.lookup(f.params.items[0])[0];
                if (pv.references.length === 1 && f.body.statements.length === 1 && f.body.statements[0].type === 'IfStatement') {
                  const consequent = f.body.statements[0].consequent;
                  const alternate = f.body.statements[0].alternate;
                  if (consequent.type === 'BlockStatement' && consequent.block.statements.length === 1 && consequent.block.statements[0].type === 'ReturnStatement' && alternate.type === 'BlockStatement' && alternate.block.statements.length === 1 && alternate.block.statements[0].type === 'ReturnStatement') {
                    const test = f.body.statements[0].test;
                    if (test.type === 'BinaryExpression' && test.operator.slice(0, 2) === '==' && test.left.type === 'IdentifierExpression' && lookup.lookup(test.left)[0] === pv && inlinable.includes(test.right.type)) {
                      const conditional = new Shift.ConditionalExpression({ test: new Shift.BinaryExpression(test), consequent: consequent.block.statements[0].expression, alternate: alternate.block.statements[0].expression });
                      if (_arguments.length === 1) {
                        conditional.test.left = _arguments[0];
                      } else {
                        conditional.test.left = new Shift.UnaryExpression({ operator: 'void', operand: new Shift.LiteralNumericExpression({ value: 0 }) });
                      }
                      return conditional;
                    }
                  }
                }
              }
            }

            if (v.references.length === 2) {
              // inline functions which are only called once
              const p1 = findStatementParent(v.references[0].node);
              const p2 = findStatementParent(v.references[0].node);
              if (scope.through.size === 0 || parents.get(p1) === parents.get(p2)) {
                // This ensures any through references get resolved the same after inlining
                return new Shift.CallExpression({ callee: reducer.default(new reducer.CloneReducer, f), arguments: _arguments });
              }
            }
          }
        }
      }
      return super.reduceCallExpression(node, { callee, arguments: _arguments });
    }

    reduceIdentifierExpression(node) {
      const inlining = getInlining(node);
      if (inlining !== null) return inlining;
      return super.reduceIdentifierExpression(node);
    }

    reduceComputedMemberExpression(node, { object, expression }) {
      if (node.object.type === 'IdentifierExpression' && expression.type === 'LiteralNumericExpression') {
        const vs = lookup.lookup(node.object);
        if (vs.length === 1) {
          const obj = getConstantObjectVariableObject(vs[0]);
          if (obj !== null && obj.has(expression.value)) {
            const val = obj.get(expression.value);
            if (inlinable.includes(val.type)) {
              return new Shift[val.type](val);
            }
          }
        }
      }
      return super.reduceComputedMemberExpression(node, { object, expression });// new Shift.ComputedMemberExpression({object, expression});
    }

    reduceStaticMemberExpression(node, { object }) {
      if (node.object.type === 'IdentifierExpression') {
        const vs = lookup.lookup(node.object);
        if (vs.length === 1) {
          const obj = getConstantObjectVariableObject(vs[0]);
          if (obj !== null && obj.has(node.property)) {
            const val = obj.get(node.property);
            if (inlinable.includes(val.type)) {
              return new Shift[val.type](val);
            }
          }
        }
      }
      return super.reduceStaticMemberExpression(node, { object });
    }
  }

  return reducer.default(new InliningReducer, ast);
};
