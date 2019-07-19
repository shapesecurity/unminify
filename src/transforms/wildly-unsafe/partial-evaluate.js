'use strict';

const reducer = require('shift-reducer');
const Shift = require('shift-ast/checked');
const shiftScope = require('shift-scope');

const getParents = require('../../helpers/parents');

const none = {};

function constantToNode(c) {
  switch (typeof c) {
    case 'undefined':
      return new Shift.UnaryExpression({ operator: 'void', operand: new Shift.LiteralNumericExpression({ value: 0 }) });
    case 'number':
      return new Shift.LiteralNumericExpression({ value: c });
    case 'string':
      return new Shift.LiteralStringExpression({ value: c });
    case 'boolean':
      return new Shift.LiteralBooleanExpression({ value: c });
    case 'object':
      if (Array.isArray(c)) {
        const elements = c.map(constantToNode);
        return new Shift.ArrayExpression({ elements });
      }
      // falls through
    default:
      throw new Error('cannot handle ' + typeof c);
  }
}

const globalFunctions = {
  decodeURI,
  decodeURIComponent,
  unescape,
  parseInt,
  parseFloat,
};

const isNonMutatingArrayMethod = p => ['slice', 'forEach', 'map', 'filter', 'reduce', 'indexOf'].includes(p);

module.exports = function partialEvaluate(ast) {

  const parents = getParents(ast);
  const globalScope = shiftScope.default(ast);
  const lookup = new shiftScope.ScopeLookup(globalScope);

  function getStaticInit(node) {
    // This is unsafe in that it assumes no use-before-def
    const vs = lookup.lookup(node);
    if (vs && vs.length === 1) {
      const v = vs[0];
      if (v.declarations.length === 1) {
        const binding = v.declarations[0].node;
        const parent = parents.get(binding);
        if (parent.type === 'VariableDeclarator' && parent.init !== null && v.references.every(r => !(r.accessibility.isWrite && r.node !== binding))) {
          return { initNode: parent.init, variable: v };
        }
      }
    }
    return { initNode: null };
  }

  function evaluateToNode(node) {
    const value = evaluate(node);
    if (value !== none && (typeof value !== 'object' || value === null) && typeof value !== 'function') {
      const rv = constantToNode(value);
      if (rv.type === 'UnaryExpression' && rv.type === node.type && rv.operator === 'void' && rv.operator === node.operator && rv.operand.type === 'LiteralNumericExpression' && rv.operand.type === node.operand.type && rv.operand.value === node.operand.value) {
        return node;
      }
      return rv;
    }
    return node;
  }


  const seen = new WeakMap;
  function evaluate(node) {
    if (seen.has(node)) {
      return seen.get(node);
    }
    seen.set(node, none);
    const out = evaluateCore(node);
    if (out !== none) {
      seen.set(node, out);
    }
    return out;
  }
  function evaluateCore(node) {
    switch (node.type) {
      case 'ArrayExpression': {
        const evaluated = node.elements.map(e => e === null ? void 0 : evaluate(e));
        if (evaluated.every(v => v !== none)) {
          return evaluated;
        }
        break;
      }
      case 'LiteralNumericExpression':
      case 'LiteralStringExpression':
      case 'LiteralBooleanExpression':
        return node.value;
      case 'LiteralRegExpExpression':
        // Not actually safe, since regexps have identity
        if (!node.global && !node.ignoreCase && !node.multiLine && !node.sticky && !node.unicode) {
          return new RegExp(node.pattern);
        }
        break;
      case 'UnaryExpression': {
        const operand = evaluate(node.operand);
        if (operand !== none) {
          switch (node.operator) {
            case '+':
              return +operand;
            case 'void':
              return void 0;
            case '-':
              return -operand;
            case '!':
              return !operand;
            case '~':
              return ~operand;
            case 'typeof':
              return typeof operand;
            default:
              throw new Error('useful unary operator: ' + node.operator + ' ' + operand);
          }
        }
        break;
      }
      case 'BinaryExpression': {
        const left = evaluate(node.left);
        const right = evaluate(node.right);
        if (left !== none && right !== none) {
          switch (node.operator) {
            case '===':
              return left === right;
            case '!==':
              return left !== right;
            case '==':
              // eslint-disable-next-line eqeqeq
              return left == right;
            case '!=':
              // eslint-disable-next-line eqeqeq
              return left != right;
            case '>':
              return left > right;
            case '<':
              return left < right;
            case '>=':
              return left >= right;
            case '<=':
              return left <= right;
            case '+':
              return left + right;
            case '-':
              return left - right;
            case '*':
              return left * right;
            case '/':
              return left / right;
            case '%':
              return left % right;
            case '||':
              return left || right;
            case '&&':
              return left && right;
            case '<<':
              return left << right;
            case '>>':
              return left >> right;
            case '>>>':
              return left >>> right;
            case '|':
              return left | right;
            case '&':
              return left & right;
            case '^':
              return left ^ right;
            case 'in':
              // If this happens, something may have gone wrong.
              break;
            default:
              throw new Error('useful binary operator: ' + node.operator + ' ' + left + ' ' + right);
          }
        }
        break;
      }
      case 'IdentifierExpression': {
        if (node.name in globalFunctions) {
          const vs = lookup.lookup(node);
          if (vs.length === 1) {
            const refs = vs[0].references;
            if (vs[0].declarations.length === 0 && !refs.some(r => r.accessibility.isWrite)) {
              return globalFunctions[node.name];
            }
          }
        }

        // TODO this isn't actually safe, for several reasons
        const { initNode, variable } = getStaticInit(node);
        if (initNode !== null) {
          const val = evaluate(initNode);
          if (val !== none) {
            if (Array.isArray(val)) {
              for (let r of variable.references) {
                let p = parents.get(r.node);
                if (p.type === 'StaticMemberExpression') {
                  if (!(isNonMutatingArrayMethod(p.property) || p.property === 'length')) {
                    return none;
                  }
                } else if (p.type === 'StaticMemberAssignmentTarget' || p.type === 'ComputedMemberAssignmentTarget') {
                  return none;
                } else if (p.type === 'ComputedMemberExpression') {
                  const gp = parents.get(p);
                  if (gp.type === 'CallExpression' && gp.callee === p) {
                    return none;
                  }
                }
              }
            }
            return val;
          }
        }
        break;
      }
      case 'CallExpression': {
        // TODO factor these cases better
        const argVals = node.arguments.map(evaluate);
        if (argVals.every(v => v !== none)) {
          if (node.callee.type === 'StaticMemberExpression') {

            // TODO factor this and similar cases out to something else
            if (node.callee.object.type === 'IdentifierExpression' && node.callee.object.name === 'String' && node.callee.property === 'fromCharCode' && node.arguments.length === 1 && node.arguments[0].type === 'LiteralNumericExpression') {
              return String.fromCharCode(node.arguments[0].value);
            }


            const objVal = evaluate(node.callee.object);
            if (objVal !== none) {
              if (typeof objVal !== 'object') {
                if (typeof objVal !== 'function') {
                  return objVal[node.callee.property](...argVals);
                }
              } else if (Array.isArray(objVal) && isNonMutatingArrayMethod(node.callee.property)) {
                return objVal[node.callee.property](...argVals);
              }
            }
          }

          const calleeVal = evaluate(node.callee);
          if (typeof calleeVal === 'function') {
            let c = calleeVal(...argVals);
            return c;
          }
        }
        break;
      }
      case 'StaticMemberExpression': {
        if (node.property === 'length' && node.object.type === 'ArrayExpression') {
          return node.object.elements.length;
        }
        return evaluateStaticProperty(node.object, node.property);
      }
    }
    return none;
  }

  function evaluateStaticProperty(object, property) {
    // TODO this has a lot of overlap with inline.js
    // this interacts poorly with getters
    const objVal = evaluate(object);
    if (objVal !== none && typeof objVal !== 'object' && typeof objVal !== 'function') {
      if (property in Object(objVal)) {
        return objVal[property];
      }
      return none;
    }
    if (object.type === 'IdentifierExpression') {
      const { initNode, variable } = getStaticInit(object); // TODO this is not sufficient; we also need to check it doesn't leak
      if (initNode !== null) {
        const leaks = variable.references.some(r => {
          if (r.accessibility.isRead) {
            const parent = parents.get(r.node);
            return parent.type !== 'StaticMemberExpression' && parent.type !== 'ComputedMemberAssignmentTarget' && parent.type !== 'StaticMemberAssignmentTarget' && parent.type !== 'ComputedMemberAssignmentTarget';
          }
          return false;
        });
        if (!leaks && (initNode.type === 'FunctionExpression' || initNode.type === 'ObjectExpression' && initNode.properties.every(p => p.type === 'DataProperty' && p.name.type === 'StaticPropertyName'))) {
          const hasComputedWrite = variable.references.some(r => {
            const parent = parents.get(r.node);
            return parent.type === 'ComputedMemberAssignmentTarget' && parent.object === r.node;
          });
          if (!hasComputedWrite) {
            const hasProperty = initNode.type === 'ObjectExpression' && initNode.properties.filter(p => p.name.value === property).length === 1;
            const propertyWrites = variable.references.filter(r => {
              const parent = parents.get(r.node);
              return parent.type === 'StaticMemberAssignmentTarget' && parent.property === property;
            });
            if (!hasProperty && propertyWrites.length === 1) {
              const gp = parents.get(parents.get(propertyWrites[0].node));
              if (gp.type === 'AssignmentExpression') {
                return evaluate(gp.expression);
              }
            } else if (hasProperty && propertyWrites.length === 0) {
              for (let p of initNode.properties) {
                if (p.name.value === property) {
                  return evaluate(p.expression);
                }
              }
            }
          }
        }
      }
    }
    return none;
  }

  class Evaluate extends reducer.LazyCloneReducer {
    reduceUnaryExpression(node, { operand }) {
      return evaluateToNode(super.reduceUnaryExpression(node, { operand }));
    }

    reduceBinaryExpression(node, { left, right }) {
      return evaluateToNode(super.reduceBinaryExpression(node, { left, right }));
    }

    reduceCallExpression(node, { callee, arguments: _arguments }) {
      return evaluateToNode(super.reduceCallExpression(node, { callee, arguments: _arguments }));
    }

    reduceStaticMemberExpression(node, { object }) {
      return evaluateToNode(super.reduceStaticMemberExpression(node, { object }));
    }

    reduceIdentifierExpression(node) {
      return evaluateToNode(node);
    }

    reduceComputedMemberExpression(node, { object, expression }) {
      const clone = super.reduceComputedMemberExpression(node, { object, expression });
      const parent = parents.get(node);
      if (parent.type !== 'CallExpression' || parent.callee !== node) {
        if (object.type === 'ArrayExpression' || object.type === 'LiteralStringExpression') {
          const isArray = object.type === 'ArrayExpression';
          const index = evaluate(expression);
          if (index !== none) {
            if (index === 'length') {
              return constantToNode((isArray ? object.elements : object.value).length);
            }
            const coerced = +('' + index);
            if (!Number.isNaN(coerced) && Math.floor(coerced) === coerced && coerced.toString() === '' + index) {
              if (coerced >= (isArray ? object.elements : object.value).length) {
                return constantToNode(void 0);
              }
              return isArray ? object.elements[index] : constantToNode(object.value[index]);
            }
          }
        }
      }
      return clone;
    }

    reduceConditionalExpression(node, { test, consequent, alternate }) {
      const clone = super.reduceConditionalExpression(node, { test, consequent, alternate });
      const testValue = evaluate(clone.test);
      if (testValue !== none) {
        return testValue ? consequent : alternate;
      }
      return clone;
    }

    reduceIfStatement(node, { test, consequent, alternate }) {
      // Note: this needs to pull var declarations out of the untaken branch
      const clone = super.reduceIfStatement(node, { test, consequent, alternate });
      const testValue = evaluate(clone.test);
      if (testValue !== none) {
        if (testValue) {
          return consequent;
        }
        if (alternate === null) {
          return new Shift.EmptyStatement;
        }
        return alternate;


      }
      return clone;
    }
  }

  return reducer.default(new Evaluate, ast);
};
