'use strict';

/* eslint-disable no-param-reassign */
// Basically de-uglify-js

const reducer = require('shift-reducer');
const Shift = require('shift-ast/checked');

const inlinable = require('../../helpers/inlinable');
const { functionContainsWeirdness } = require('../../helpers/fn-contains-weirdness');

const esutils = require('esutils');


const abnormal = [
  'ReturnStatement',
  'ThrowStatement',
  'ContinueStatement',
  'BreakStatement',
];

function fixStatementList(statements) {
  const o = [];
  for (let i = 0; i < statements.length; ++i) {
    const s = statements[i];
    o.push(s);
    if (abnormal.includes(s.type)) {
      o.unshift(...hoist(statements.slice(i + 1)));
      break;
    }
  }
  return o;
}


function hoist(statements) {
  // this assumes block-level hoisting, i.e., treats lexical and var declarations as both hoisted
  return statements
    .filter(s => s.type === 'FunctionDeclaration' || s.type === 'VariableDeclarationStatement')
    .map(s => {
      if (s.type === 'FunctionDeclaration') {
        return s;
      }
      const stripped = s.declaration.declarators.map(d => {
        if (d.binding.type !== 'BindingIdentifier') {
          throw new RuntimeException('Can\'t yet handle destructuring');
          // TODO Fix this: just pull the names being declared, without any expressions.
        }
        return new Shift.VariableDeclarator({ binding: new Shift.BindingIdentifier({ name: d.binding.name }), init: null });
      });
      return new Shift.VariableDeclarationStatement({ declaration: new Shift.VariableDeclaration({ kind: s.declaration.kind, declarators: stripped }) });
    });
}


class HasBreak extends reducer.ThunkedOrReducer {
  reduceBreakStatement(node) {
    return node.label === null;
  }

  reduceFunctionBody() {
    return false;
  }

  reduceSwitchStatement() {
    return false;
  }

  reduceWhileStatement() {
    return false;
  }

  reduceForStatement() {
    return false;
  }

  reduceForInStatement() {
    return false;
  }

  reduceDoWhileStatement() {
    return false;
  }
}
class HasBreakOrContinue extends reducer.ThunkedOrReducer {
  reduceContinueStatement(node) {
    return node.label === null;
  }
}



const hasBreakReducer = reducer.memoize(new HasBreak);
function hasBreak(statement) {
  // true iff its argument has an unlabelled `break` which breaks something outside of it
  return reducer.thunkedReduce(hasBreakReducer, statement);
}

const hasBreakOrContinueReducer = reducer.memoize(new HasBreak);
function hasBreakOrContinue(statement) {
  // true iff its argument in question has an unlabelled `break` or `continue` which breaks something outside of it
  return reducer.thunkedReduce(hasBreakOrContinueReducer, statement);
}


class RemoveTriviallyDead extends reducer.LazyCloneReducer {
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
    return super.reduceFunctionBody(node, { directives, statements: fixStatementList(statements) });
  }

  reduceScript(node, { directives, statements }) {
    return super.reduceScript(node, { directives, statements: fixStatementList(statements) });
  }

  reduceSwitchStatement(node, { discriminant, cases }) {
    if (discriminant.type === 'LiteralNumericExpression' && cases.every(c => inlinable.includes(c.test.type))) { // the latter is to avoid effectful case tests
      const matched = cases.find(c => c.test.type === 'LiteralNumericExpression' && discriminant.value === c.test.value);
      if (matched != null && matched.consequent.length > 0) {
        const final = matched.consequent[matched.consequent.length - 1];
        const isNotFallthrough = abnormal.includes(final.type);
        if (isNotFallthrough) {
          const toInclude = (final.type === 'BreakStatement' && final.label === null) ? matched.consequent.slice(0, matched.consequent.length - 1) : matched.consequent;
          if (!toInclude.some(hasBreak)) {
            // There's more we can do here, but it doesn't seem worth it since this case seems unlikely
            const hoisted = [].concat(...cases.filter(c => c !== matched).map(c => hoist(c.consequent))); // TODO flatMap
            return new Shift.BlockStatement({ block: new Shift.Block({ statements: hoisted.concat(toInclude) }) });
          }
        }
      }
    }
    return super.reduceSwitchStatement(node, { discriminant, cases });
  }
  // TODO ditto for reduceSwitchStatementWithDefault

  reduceWhileStatement(node, { test, body }) {
    if (test.type === 'LiteralBooleanExpression' && test.value === true) {
      if (body.type === 'BlockStatement' && body.block.statements.length > 0) {
        const final = body.block.statements[body.block.statements.length - 1];
        if (final.type === 'ThrowStatement' || final.type === 'ReturnStatement' || final.type === 'BreakStatement' && final.label === null) {
          const toInclude = final.type === 'BreakStatement' ? body.block.statements.slice(0, body.block.statements.length - 1) : body.block.statements;
          if (!toInclude.some(hasBreakOrContinue)) {
            return new Shift.BlockStatement({ block: new Shift.Block({ statements: toInclude }) });
          }
        } 
      }
    }
    return super.reduceWhileStatement(node, { test, body });
  }
  // TODO ditto for other loops
}


const cleaner = new RemoveTriviallyDead;

module.exports = function removeTriviallyDead(ast) {
  return reducer.default(cleaner, ast);
};
