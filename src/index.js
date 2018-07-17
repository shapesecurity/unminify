'use strict';

const parser = require('shift-parser');
const codegen = require('./helpers/codegen');
const safetyLevels = require('./safety-levels');

const TRANSFORMATIONS = {
  [safetyLevels.USELESS]: [],
  [safetyLevels.SAFE]: [
    require('./transforms/safe/cleanup'),
    require('./transforms/safe/cleanup-with-state'),
    require('./transforms/safe/remove-trivially-dead.js'),
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

module.exports = function (src, { safety = safetyLevels.SAFE, additionalTransforms = [] } = {}) {
  let tree = parser.parseScript(src);

  let transformations = [];
  for (let i = 0; i <= safety; ++i) {
    transformations.push(...TRANSFORMATIONS[i]);
  }
  transformations.push(...additionalTransforms);

  // cap at 100 on general principles, but theoretically `while (true)` should be ok
  for (let i = 0; i < 100; ++i) {
    let newTree = tree;
    for (let transformation of transformations) {
      newTree = transformation(newTree);
    }
    if (newTree === tree) break;
    tree = newTree;
  }

  return codegen(tree);
};

module.exports.safetyLevels = safetyLevels;
