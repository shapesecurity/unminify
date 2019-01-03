'use strict';

const parser = require('shift-parser');
const codegen = require('./helpers/codegen');
const safetyLevels = require('./safety-levels');

const TRANSFORMATIONS = {
  [safetyLevels.USELESS]: [],
  [safetyLevels.SAFE]: [
    require('./transforms/safe/cleanup'),
    require('./transforms/safe/cleanup-with-state'),
  ],
  [safetyLevels.MOSTLY_SAFE]: [],
  [safetyLevels.UNSAFE]: [
    require('./transforms/unsafe/remove-unused'),
  ],
  [safetyLevels.WILDLY_UNSAFE]: [
    require('./transforms/wildly-unsafe/inline'),
    require('./transforms/wildly-unsafe/partial-evaluate'),
  ],
};

module.exports = function (src, options) {
  let tree = parser.parseScript(src);
  return codegen(unminifyTree(tree, options));
};

function unminifyTree(tree, { safety = safetyLevels.SAFE, additionalTransforms = [] } = {}) {
  let transformations = [];
  for (let i = 0; i <= safety; ++i) {
    transformations.push(...TRANSFORMATIONS[i]);
  }
  transformations.push(...additionalTransforms);

  let lastTree = tree;
  // cap at 100 on general principles, but theoretically `while (true)` should be ok
  for (let i = 0; i < 100; ++i) {
    let newTree = lastTree;
    for (let transformation of transformations) {
      newTree = transformation(newTree);
    }
    if (newTree === lastTree) break;
    lastTree = newTree;
  }

  return lastTree;
}

module.exports.unminifyTree = unminifyTree;

module.exports.safetyLevels = safetyLevels;
