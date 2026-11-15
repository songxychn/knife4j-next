// Bun's built-in `undici` lacks Dispatcher.request(), required by jsdom 30.
// Load the actual locked npm package for this test process; no HTTP is mocked.
const { mock } = require('bun:test');
const undici = require('undici/index.js');
mock.module('undici', () => undici);
