'use strict';
/**
 * Node.js worker_threads bridge for the webpack-compiled image_processor worker.
 *
 * The compiled bundle (image_processor.worker.compiled.js) was built for Electron's
 * renderer process and uses browser Web Worker globals (onmessage / postMessage).
 * When webpack processed the source, it removed the worker_threads require so the
 * runtime check `_workerThreads?.parentPort` is always falsy.
 *
 * This wrapper runs inside a worker_threads Worker and polyfills those browser
 * globals before requiring the compiled bundle so its browser-mode path works.
 */

const { parentPort } = require('worker_threads');

// Polyfill postMessage() → parentPort.postMessage()
globalThis.postMessage = (data) => parentPort.postMessage(data);

// Polyfill onmessage setter: when the bundle assigns `onmessage = handler`,
// register that handler on parentPort (wrapping raw data in a {data} envelope
// to match the browser MessageEvent shape the bundle expects).
let _onmessageHandler = null;
Object.defineProperty(globalThis, 'onmessage', {
  set(fn) {
    _onmessageHandler = fn;
    parentPort.on('message', (data) => fn({ data }));
  },
  get() {
    return _onmessageHandler;
  },
  configurable: true,
});

// Now load the compiled worker — its browser-mode setup will fire immediately.
require('./image_processor.worker.compiled.js');
