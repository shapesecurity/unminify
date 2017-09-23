'use strict';

// TODO short-curcuiting, memoization

const reducer = require('shift-reducer');

class ContainsWeirdness extends reducer.MonoidalReducer {
  constructor() {
    super({ empty: () => false, concat(b) {
      return this || b;
    } });
  }

  reduceThisExpression() {
    return true;
  }

  reduceFunctionExpression() {
    return false;
  }

  reduceFunctionDeclaration() {
    return false;
  }

  reduceIdentifierExpression(node) {
    return node.name === 'arguments';
  }

  // TODO many other cases
}
ContainsWeirdness.INSTANCE = new ContainsWeirdness;

module.exports.functionContainsWeirdness = function (fn) {
  return reducer.default(ContainsWeirdness.INSTANCE, fn.params) || reducer.default(ContainsWeirdness.INSTANCE, fn.body);
};

module.exports.expressionContainsWeirdness = function (expr) {
  return reducer.default(ContainsWeirdness.INSTANCE, expr);
};
