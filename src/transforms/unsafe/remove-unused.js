'use strict';

// Remove unused variables and object properties which are initialized to constants.

const scope = require('shift-scope');
const reducer = require('shift-reducer');
const Shift = require('shift-ast/checked');

const getParents = require('../../helpers/parents');
const inlinable = require('../../helpers/inlinable');


function isOnlyWritten(node, parents, lookup) {
  if (node.type !== 'AssignmentTargetIdentifier') {
    return false;
  }
  const vs = lookup.lookup(node);
  if (vs.length === 1 && lookup.scope.variableList.indexOf(vs[0]) === -1) {
    const reads = vs[0].references.filter(r => r.accessibility.isRead);

    return reads.length === 0 || reads.every(r => {
      if (!r.accessibility.isWrite) {
        return false;
      }
      const parent = parents.get(r.node);
      if (parent == null || !(parent.type === 'CompoundAssignmentExpression' || parent.type === 'UpdateExpression')) {
        return false;
      }

      const gp = parents.get(parent);
      return gp.type === 'ExpressionStatement';
    });
  }
  return false;
}

module.exports = function removeUnused(ast) {
  const globalScope = scope.default(ast);
  const lookup = new scope.ScopeLookup(globalScope);
  const parents = getParents(ast);

  class RemoveUnused extends reducer.LazyCloneReducer {
    reduceVariableDeclarationStatement(node, { declaration }) {
      // This strips declarations of variables initialized to constants if those variables are never referred to.
      const declarators = declaration.declarators.filter((d, i) => {
        const oldD = node.declaration.declarators[i];
        if (d.binding.type !== 'BindingIdentifier' || d.init == null || !(
          inlinable.includes(d.init.type)
          || d.init.type === 'FunctionExpression'
          || d.init.type === 'ObjectExpression' && d.init.properties.length === 0
          || d.init.type === 'ArrayExpression' && d.init.elements.every(e => inlinable.includes(e.type))
        )) return true;
        const v = lookup.lookup(oldD.binding)[0];
        if (v.declarations.length !== 1 || lookup.scope.variableList.includes(v)) return true;
        return v.references.length !== 1;
      });
      if (declarators.length === 0) {
        return new Shift.EmptyStatement;
      } else if (declarators.length === 1) {
        const binding = declarators[0].binding;
        if (binding.type === 'BindingIdentifier') {
          const v = lookup.lookup(binding)[0];
          if (v.references.every(ref => ref.node === binding) && !lookup.scope.variableList.includes(v)) {
            if (declarators[0].init === null) {
              return new Shift.EmptyStatement;
            }
            return new Shift.ExpressionStatement({ expression: declarators[0].init });
          }
        }
      }

      if (declarators.length === declaration.declarators.length) {
        return super.reduceVariableDeclarationStatement(node, { declaration });
      }

      return new Shift.VariableDeclarationStatement({ declaration: new Shift.VariableDeclaration({ kind: declaration.kind, declarators }) });
    }

    reduceVariableDeclarator(node, { binding, init }) {
      // This strips properties from object literals used to initialize variables provided that
      // a.) no one ever refers to that variable except to read a static property of it,
      // b.) no one ever tries to read that property, and
      // c.) the object contains only data properties.
      // TODO make this safe by asserting that all properties ever referred to are present on the object (so they never go up to Object.prototype)
      if (init !== null && init.type === 'ObjectExpression' && init.properties.every(p => p.type === 'DataProperty')) {
        const v = lookup.lookup(node.binding)[0];
        const referencedNames = new Set;
        if (v.references.every(r => {
          if (r.node === node.binding) return true; // We don't care about the declaration itself.
          const parent = parents.get(r.node);
          if (parent.type !== 'StaticMemberExpression') return false;
          referencedNames.add(parent.property);
          return true;
        })) {
          const properties = init.properties.filter(p => {
            return !(inlinable.includes(p.expression.type) || p.expression.type === 'FunctionExpression') || p.name.type !== 'StaticPropertyName' || referencedNames.has(p.name.value);
          });
          if (properties.length === init.properties.length) {
            return super.reduceVariableDeclarator(node, { binding, init });
          }
          const obj = new Shift.ObjectExpression({ properties });
          return new Shift.VariableDeclarator({ binding, init: obj });
        }
      }
      return super.reduceVariableDeclarator(node, { binding, init });
    }

    reduceAssignmentExpression(node, { binding, expression }) {
      if (isOnlyWritten(node.binding, parents, lookup)) {
        return expression;
      }
      return super.reduceAssignmentExpression(node, { binding, expression });
    }

    reduceCompoundAssignmentExpression(node, { binding, expression }) {
      if (isOnlyWritten(node.binding, parents, lookup)) {
        return expression;
      }
      return super.reduceCompoundAssignmentExpression(node, { binding, expression });
    }
  }

  return reducer.default(new RemoveUnused, ast);
};
