'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const args = require('command-line-args')([
  { name: 'file', type: String, defaultOption: true },
  { name: 'safety', type: String, defaultValue: 'safe' },
  { name: 'additional-transform', type: String, multiple: true, defaultValue: [] },
]);
const prettier = require('prettier');
const deobfuscate = require('../');
const safetyLevels = require('./safety-levels');
const safetyLevelMap = {
  __proto__: null,
  useless: safetyLevels.USELESS,
  safe: safetyLevels.SAFE,
  'mostly-safe': safetyLevels.MOSTLY_SAFE,
  unsafe: safetyLevels.UNSAFE,
  'wildly-unsafe': safetyLevels.WILDLY_UNSAFE,
};

function format(src) {
  return prettier.format(src, { singleQuote: true, trailingComma: 'es5' });
}

if (!args.file) {
  throw new Error('Missing required input file parameter');
}
if (!(args.safety in safetyLevelMap)) {
  throw new Error(`Safety level must be one of ${JSON.stringify(Object.keys(safetyLevelMap))}`);
}

const src = fs.readFileSync(args.file, 'utf-8');
const safety = safetyLevelMap[args.safety];
const additionalTransforms = args['additional-transform'].map(a => require(a));

console.log(format(deobfuscate(src, { additionalTransforms, safety })).trim());
