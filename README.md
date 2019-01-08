Unminify
========

A little project to undo several of the horrible things JavaScript build tools will do to JavaScript. In addition to undoing most minification, it reverses some of the stupider but surprisingly common "obfuscation" techniques used in the wild.

It may amuse you to try it on, say, [this random bit of JavaScript I found](https://secure2.homedepot.com/_bm/async.js).

## Installation

```
npm install -g unminify
```

or use it without installing via `npx` (available since `npm` 5.2.0)

```
npx unminify [...args]
```

## CLI Usage

```
unminify /path/to/file.js
```

* `--safety` may be given to enable/disable transformations based on the user's required safety guarantees. Refer to the [safety levels](#safety-levels) documentation for more details. The value of `--safety` may be one of
  * `useless`
  * `safe` (default)
  * `mostly-safe`
  * `unsafe`
  * `wildly-unsafe`
* `--additional-transform` may be given zero or more times, each followed by a path to a module providing an AST transform; the function signals that the transformation was not applied by returning its input

## API Usage

```js
let { unminifySource } = require('unminify');
let sourceText = '/* a minified/"obfuscated" JavaScript program */';
console.log(unminify(sourceText));

// or, with options
console.log(unminifySource(sourceText, {
  safety: unminify.safetyLevels.UNSAFE,
  additionalTransforms: [function(ast) { /* ... */ }],
}));
```

If you already have a Shift tree then you can use `unminifyTree` to avoid the codegen & reparse cost.

```js
let { parseScript } = require('shift-parser');
let { unminifyTree } = require('unminify');

let sourceText = '/* a minified/"obfuscated" JavaScript program */';

let tree = parseScript(sourceText);
let unminifiedTree = unminifyTree(tree);
```

## Safety Levels

* "safe to the point of uselessness":
  * safe for ALL programs ("programs" don't have early errors)
* "safe": "safe to the point of uselessness" except
  * Function.prototype.toString
  * function name/arity
  * Annex B
  * direct eval
* "mostly safe": "safe" except
  * side effecting getters/setters on the global object
  * sealed global object
  * non-writable/non-configurable properties on the global object
  * top-level var decls make global properties
* "unsafe": "mostly safe" except
  * non-spec built-in global properties or native proto properties
* "wildly unsafe":
  * no guarantees but it'll probably work most of the time

## License

    Copyright 2017 Shape Security, Inc.

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

        http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
