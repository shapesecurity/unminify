'use strict';

/* eslint-disable no-param-reassign */
// Basically de-uglify-js

const reducer = require('shift-reducer');
const Shift = require('shift-ast/checked');

const inlinable = require('../../helpers/inlinable');
const { functionContainsWeirdness } = require('../../helpers/fn-contains-weirdness');

const esutils = require('esutils');


// TODO convert switches to if/else

function makeBlock(statement) {
  return new Shift.BlockStatement({ block: new Shift.Block({ statements: [statement] }) });
}

function negate(expr, isBooleanContext, requireResult = true) {
  if (expr.type === 'LiteralBooleanExpression') {
    return new Shift.LiteralBooleanExpression({ value: !expr.value });
  } else if (expr.type === 'LiteralNumericExpression') {
    return new Shift.LiteralBooleanExpression({ value: !expr.value });
  } else if (expr.type === 'ArrayExpression' && expr.elements.length === 0) {
    return new Shift.LiteralBooleanExpression({ value: false });
  } else if (expr.type === 'ObjectExpression' && expr.properties.length === 0) {
    return new Shift.LiteralBooleanExpression({ value: false });
  } else if (expr.type === 'BinaryExpression') {
    if (expr.operator === '&&') {
      return new Shift.BinaryExpression({ left: negate(expr.left, isBooleanContext), operator: '||', right: negate(expr.right, isBooleanContext) });
    } else if (expr.operator === '||') {
      return new Shift.BinaryExpression({ left: negate(expr.left, isBooleanContext), operator: '&&', right: negate(expr.right, isBooleanContext) });
    } else if (expr.operator === '==') {
      return new Shift.BinaryExpression({ left: expr.left, operator: '!=', right: expr.right });
    } else if (expr.operator === '===') {
      return new Shift.BinaryExpression({ left: expr.left, operator: '!==', right: expr.right });
    } else if (expr.operator === '!=') {
      return new Shift.BinaryExpression({ left: expr.left, operator: '==', right: expr.right });
    } else if (expr.operator === '!==') {
      return new Shift.BinaryExpression({ left: expr.left, operator: '===', right: expr.right });
    }
  } else if (expr.type === 'UnaryExpression' && expr.operator === '!' && isBooleanContext) {
    return new Shift[expr.operand.type](expr.operand);
  }
  if (!requireResult) {
    return null;
  }
  return new Shift.UnaryExpression({ operator: '!', operand: expr });
}

function isConstant(node) {
  return inlinable.includes(node.type)
    || node.type === 'UnaryExpression' && inlinable.includes(node.operand.type);
}

function isSequence(expr) {
  return expr != null && expr.type === 'BinaryExpression' && expr.operator === ',';
}

function seqToExprs(expr) {
  const exprs = [expr.right];
  let left = expr.left;
  while (isSequence(left)) {
    exprs.unshift(left.right);
    left = left.left;
  }
  exprs.unshift(left);
  return exprs;
}

function declaratorsToDeclarationStatements(kind, declarators) {
  return declarators.map(d => new Shift.VariableDeclarationStatement({ declaration: new Shift.VariableDeclaration({ kind, declarators: [d] }) }));
}


class OnlyReturnUndefined extends reducer.LazyCloneReducer { // TODO this would be better thunked.
  reduceFunctionBody(node) {
    return node;
  }

  reduceReturnStatement(node, { expression }) {
    if (expression === null || expression.type === 'UnaryExpression' && expression.operator === 'void') {
      return node;
    }
    if (expression.type === 'UnaryExpression' && expression.operator === 'void') {
      return node;
    }
    const undef = new Shift.UnaryExpression({ operator: 'void', operand: expression });
    return new Shift.ReturnStatement({ expression: undef });
  }
}
const onlyReturnUndefined = new OnlyReturnUndefined;

function makeReturnsUndefined(fnBody) {
  const fixed = fnBody.statements.map(s => reducer.default(onlyReturnUndefined, s));
  if (arrayEquals(fixed, fnBody.statements)) {
    return fnBody;
  }
  return new Shift.FunctionBody({ directives: fnBody.directives, statements: fixed });
}

function fixStatementList(statements) {
  // strip empty statements
  // turn sequence expressions in statement position into multiple statements
  // turn variable declarations with multiple declarators into multiple statements
  // for (var a, b, c;;); -> var a; var b; for (var c;;);
  const o = [];
  for (const s of statements) {
    switch (s.type) {
      case 'EmptyStatement':
        break;
      case 'TryCatchStatement':
        if (s.body.statements.length === 0) {
          o.push(new Shift.IfStatement({ test: new Shift.LiteralBooleanExpression({ value: false }), consequent: new Shift.BlockStatement({ block: s.catchClause.body }), alternate: null }));
        } else {
          o.push(s);
        }
        break;
      case 'ExpressionStatement':
        if (isSequence(s.expression)) {
          o.push(...seqToExprs(s.expression).map(e => new Shift.ExpressionStatement({ expression: e })));
        } else if (inlinable.includes(s.expression.type) || s.expression.type === 'ThisExpression' || s.expression.type === 'FunctionExpression') { // TODO local IdentifierExpressions
          continue;
        } else if (s.expression.type === 'UnaryExpression' && s.expression.operator === 'void') {
          if (inlinable.includes(s.expression.operand.type)) {
            continue;
          }
          o.push(new Shift.ExpressionStatement({ expression: s.expression.operand }));
        } else {
          o.push(s);
        }
        break;
      case 'ThrowStatement':
        if (isSequence(s.expression)) {
          const exprs = seqToExprs(s.expression);
          const last = exprs.pop();
          o.push(...exprs.map(e => new Shift.ExpressionStatement({ expression: e })));
          o.push(new Shift.ThrowStatement({ expression: last }));
        } else {
          o.push(s);
        }
        break;
      case 'ReturnStatement':
        if (s.expression === null) {
          o.push(s);
        } else if (isSequence(s.expression)) {
          const exprs = seqToExprs(s.expression);
          const last = exprs.pop();
          o.push(...exprs.map(e => new Shift.ExpressionStatement({ expression: e })));
          o.push(new Shift.ReturnStatement({ expression: last }));
        } else if (s.expression.type === 'ConditionalExpression') {
          const consequent = new Shift.ReturnStatement({ expression: s.expression.consequent });
          const alternate = new Shift.ReturnStatement({ expression: s.expression.alternate });
          o.push(new Shift.IfStatement({ test: s.expression.test, consequent, alternate }));
        } else if (s.expression.type === 'UnaryExpression' && s.expression.operator === 'void') {
          o.push(new Shift.ExpressionStatement({ expression: s.expression.operand }));
          o.push(new Shift.ReturnStatement({ expression: null }));
        } else {
          o.push(s);
        }
        // TODO: elsewhere, remove statements after returns (while preserving hoisted declarations)
        break;
      case 'BlockStatement':
        if (s.block.statements.every(x => x.type !== 'FunctionDeclaration' && (x.type !== 'VariableDeclarationStatement' || x.declaration.kind === 'var'))) {
          o.push(...s.block.statements);
        } else {
          o.push(s);
        }
        break;
      case 'IfStatement':
        if (isSequence(s.test)) {
          const exprs = seqToExprs(s.test);
          const last = exprs.pop();
          o.push(...exprs.map(e => new Shift.ExpressionStatement({ expression: e })));
          o.push(new Shift.IfStatement({ test: last, consequent: s.consequent, alternate: s.alternate }));
        } else {
          o.push(s);
        }
        break;
      case 'VariableDeclarationStatement':
        if (s.declaration.declarators.length > 1) {
          o.push(...declaratorsToDeclarationStatements(s.declaration.kind, s.declaration.declarators));
        } else if (isSequence(s.declaration.declarators[0].init)) {
          let originalDeclarator = s.declaration.declarators[0];
          // Yes, these steps could be combined, but /shrug
          const exprs = seqToExprs(originalDeclarator.init);
          const last = exprs.pop();
          o.push(...exprs.map(e => new Shift.ExpressionStatement({ expression: e })));
          const declarator = new Shift.VariableDeclarator({ binding: originalDeclarator.binding, init: last });
          const declaration = new Shift.VariableDeclaration({ kind: s.declaration.kind, declarators: [declarator] });
          o.push(new Shift.VariableDeclarationStatement({ declaration }));
        } else {
          o.push(s);
        }
        break;
      case 'ForStatement':
        if (s.init != null) {
          if (s.init.type === 'VariableDeclaration' && s.init.declarators.length > 1) {
            const declarators = [...s.init.declarators];
            const finalDeclarator = declarators.pop();
            const newDeclaration = new Shift.VariableDeclaration({ kind: s.init.kind, declarators: [finalDeclarator] });
            o.push(...declaratorsToDeclarationStatements(s.init.kind, declarators));
            o.push(new Shift.ForStatement({ init: newDeclaration, test: s.test, update: s.update, body: s.body }));
          } else if (isSequence(s.init)) {
            const exprs = seqToExprs(s.init);
            const last = exprs.pop();
            o.push(...exprs.map(e => new Shift.ExpressionStatement({ expression: e })));
            o.push(new Shift.ForStatement({ init: last, test: s.test, update: s.update, body: s.body }));
          } else {
            o.push(s);
          }
        }
        break;
      default:
        o.push(s);
    }
  }

  if (arrayEquals(o, statements)) {
    return statements;
  }
  return o;
}


function arrayEquals(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

function hoistFunctionDeclarations(statements) {
  const decls = [];
  const nonDecls = [];
  for (const statement of statements) {
    if (statement.type === 'FunctionDeclaration') {
      decls.push(statement);
    } else {
      nonDecls.push(statement);
    }
  }
  const o = decls.concat(nonDecls);
  if (arrayEquals(o, statements)) {
    return statements;
  }
  return o;
}

class Cleanup extends reducer.LazyCloneReducer {
  reduceBlock(node, { statements }) {
    return super.reduceBlock(node, { statements: fixStatementList(statements) });
  }

  reduceSwitchCase(node, { test, consequent }) {
    return super.reduceSwitchCase(node, { test, consequent: fixStatementList(consequent) });
  }

  reduceSwitchDefault(node, { consequent }) {
    return super.reduceSwitchDefault(node, { consequent: fixStatementList(consequent) });
  }

  reduceFunctionBody(node, { directives, statements }) {
    statements = hoistFunctionDeclarations(fixStatementList(statements));
    if (directives.length === 0 && statements.length === 1 && (statements[0].type === 'ExpressionStatement' || statements[0].type === 'ReturnStatement') && statements[0].expression.type === 'CallExpression' && statements[0].expression.arguments.length === 0) {
      const callee = statements[0].expression.callee;
      if (callee.type === 'FunctionExpression' && callee.name === null && callee.params.items.length === 0 && callee.params.rest === null && !functionContainsWeirdness(callee)) {
        return statements[0].type === 'ExpressionStatement' ? makeReturnsUndefined(callee.body) : callee.body;
      }
    }
    if (statements.length > 0 && statements[statements.length - 1].type === 'ReturnStatement' && statements[statements.length - 1].expression == null) {
      statements = statements.slice(0, -1);
    }
    return super.reduceFunctionBody(node, { directives, statements });
  }

  reduceScript(node, { directives, statements }) {
    return super.reduceScript(node, { directives, statements: fixStatementList(statements) });
  }

  reduceUnaryExpression(node, { operand }) {
    if (node.operator === '!') {
      const negated = negate(operand, false, false);
      if (negated) {
        return negated;
      }
    }
    return super.reduceUnaryExpression(node, { operand });
  }

  reduceBinaryExpression(node, { left, right }) {
    // 1 == a -> a == 1
    if (['==', '===', '!=', '!=='].includes(node.operator) && isConstant(left) && !isConstant(right)) {
      return new Shift.BinaryExpression({ left: right, operator: node.operator, right: left });
    }
    if (node.operator === ',' && inlinable.includes(left.type)) {
      return right;
    }
    return super.reduceBinaryExpression(node, { left, right });
  }

  reduceExpressionStatement(node, { expression }) {
    if (expression.type === 'ConditionalExpression') {
      return new Shift.IfStatement({ test: expression.test, consequent: new Shift.ExpressionStatement({ expression: expression.consequent }), alternate: new Shift.ExpressionStatement({ expression: expression.alternate }) });
    } else if (expression.type === 'BinaryExpression' && expression.operator === '&&') {
      return new Shift.IfStatement({ test: expression.left, consequent: new Shift.ExpressionStatement({ expression: expression.right }), alternate: null });
    } else if (expression.type === 'BinaryExpression' && expression.operator === '||') {
      return new Shift.IfStatement({ test: new Shift.UnaryExpression({ operator: '!', operand: expression.left }), consequent: new Shift.ExpressionStatement({ expression: expression.right }), alternate: null });
    } else if (expression.type === 'UnaryExpression' && expression.operator === '!') {
      return new Shift.ExpressionStatement({ expression: expression.operand });
    }
    return super.reduceExpressionStatement(node, { expression });
  }

  reduceIfStatement(node, { test, consequent, alternate }) {
    if (test.type === 'UnaryExpression' && test.operator === '!') {
      test = negate(test.operand, true, false) || test;
    }
    if (test.type === 'BinaryExpression' && (test.operator === '!=' || test.operator === '!==') && alternate != null) {
      test = negate(test, true);
      [consequent, alternate] = [alternate, consequent];
    }
    if (consequent.type !== 'BlockStatement') {
      consequent = makeBlock(consequent);
    }
    if (alternate != null) {
      if (alternate.type !== 'BlockStatement' && alternate.type !== 'IfStatement') {
        alternate = makeBlock(alternate);
      } else if (alternate.type === 'BlockStatement' && alternate.block.statements.length === 1 && alternate.block.statements[0].type === 'IfStatement') {
        alternate = alternate.block.statements[0];
      }
      if (alternate.type === 'BlockStatement' && alternate.block.statements.length === 0) {
        alternate = null;
      }
    }
    return super.reduceIfStatement(node, { test, consequent, alternate });
  }

  reduceConditionalExpression(node, { test, consequent, alternate }) {
    if (test.type === 'UnaryExpression' && test.operator === '!') {
      test = negate(test.operand, true, false) || test;
    }
    return super.reduceConditionalExpression(node, { test, consequent, alternate });
  }

  reduceForStatement(node, { init, test, update, body }) {
    if (body.type !== 'BlockStatement') {
      body = makeBlock(body);
    }
    if (init == null && test != null && update == null) {
      return new Shift.WhileStatement({ test, body });
    }
    return super.reduceForStatement(node, { init, test, update, body });
  }

  reduceForInStatement(node, { left, right, body }) {
    if (body.type !== 'BlockStatement') {
      body = makeBlock(body);
    }
    return super.reduceForInStatement(node, { left, right, body });
  }

  reduceForOfStatement(node, { left, right, body }) {
    if (body.type !== 'BlockStatement') {
      body = makeBlock(body);
    }
    return super.reduceForOfStatement(node, { left, right, body });
  }

  reduceWhileStatement(node, { test, body }) {
    if (body.type !== 'BlockStatement') {
      body = makeBlock(body);
    }
    return super.reduceWhileStatement(node, { test, body });
  }

  reduceDoWhileStatement(node, { body, test }) {
    if (body.type !== 'BlockStatement') {
      body = makeBlock(body);
    }
    return super.reduceDoWhileStatement(node, { body, test });
  }

  reduceComputedMemberAssignmentTarget(node, { object, expression }) {
    if (expression.type === 'LiteralStringExpression' && esutils.keyword.isIdentifierNameES6(expression.value)) {
      return new Shift.StaticMemberAssignmentTarget({ object, property: expression.value });
    }
    return super.reduceComputedMemberAssignmentTarget(node, { object, expression });
  }

  reduceComputedMemberExpression(node, { object, expression }) {
    if (expression.type === 'LiteralStringExpression' && esutils.keyword.isIdentifierNameES6(expression.value)) {
      return new Shift.StaticMemberExpression({ object, property: expression.value });
    }
    return super.reduceComputedMemberExpression(node, { object, expression });
  }

  reduceCallExpression(node, { callee, arguments: _arguments }) {
    if (callee.type === 'FunctionExpression' && !callee.isGenerator && !functionContainsWeirdness(callee)) {
      if (_arguments.length === 0 && callee.params.rest === null && callee.params.items.length === 0 && callee.body.directives.length === 0 && callee.body.statements.length <= 1) {
        // turn iifes with very simple bodies into expressions with no calls
        if (callee.body.statements.length === 0) {
          return new Shift.UnaryExpression({ operator: 'void', operand: new Shift.LiteralNullExpression });
        }
        const statement = callee.body.statements[0];
        if (statement.type === 'ReturnStatement') {
          return statement.expression;
        }
        if (statement.type === 'ExpressionStatement') {
          return new Shift.BinaryExpression({ left: statement.expression, operator: ',', right: new Shift.UnaryExpression({ operator: 'void', operand: new Shift.LiteralNullExpression }) }); // `(expr, void 0)`
        }
      }
    }
    return super.reduceCallExpression(node, { callee, arguments: _arguments });
  }
}


const cleaner = new Cleanup;

module.exports = function cleanup(ast) {
  return reducer.default(cleaner, ast);
};
