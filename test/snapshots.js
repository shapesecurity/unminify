const fs = require('fs');
const test = require('ava');
const prettier = require('prettier');
const unminify = require('../');

const SNAPSHOTS_DIR = `${__dirname}/snapshots-in`;
const files = fs.readdirSync(SNAPSHOTS_DIR)

function format(src) {
  return prettier.format(src, { parser: 'babel', singleQuote: true, trailingComma: 'all' });
}

files.forEach(file => {
  let sourceText = fs.readFileSync(`${SNAPSHOTS_DIR}/${file}`, 'utf-8');

  Object.keys(unminify.safetyLevels).forEach(safetyLevel => {
    test(`${safetyLevel} snapshot: ${file}`, async t => {
      t.snapshot(format(unminify(sourceText, { safety: unminify.safetyLevels[safetyLevel] })));
    });
  });
});
