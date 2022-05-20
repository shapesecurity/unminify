'use strict';

// Give a map from a node to its parents.

const reducer = require('shift-reducer');
const spec = require('shift-spec');


class ParentFinder {
  constructor() {
    this.parents = new WeakMap;
  }
}

// eslint-disable-next-line guard-for-in
for (const typeName in spec) {
  const type = spec[typeName];
  const fields = type.fields.filter(f => f.name !== 'type');
  ParentFinder.prototype['reduce' + typeName] = function (node) {
    for (const field of fields) {
      if (node[field.name] === null || typeof node[field.name] !== 'object') continue;
      if (Array.isArray(node[field.name])) {
        node[field.name].filter(c => c !== null).forEach(c => {
          this.parents.set(c, node);
        });
      } else {
        this.parents.set(node[field.name], node);
      }
    }
  };
}

ParentFinder.prototype.originalReduceScript = ParentFinder.prototype.reduceScript;
ParentFinder.prototype.originalReduceModule = ParentFinder.prototype.reduceModule;
ParentFinder.prototype.reduceScript = function (node) {
  this.originalReduceScript(node);
  this.parents.set(node, null);
  return this.parents;
};
ParentFinder.prototype.reduceModule = function (node) {
  this.originalReduceModule(node);
  this.parents.set(node, null);
  return this.parents;
};

module.exports = ast => reducer.default(new ParentFinder, ast);
