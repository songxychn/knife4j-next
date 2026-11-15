// Evaluate the real dependency before the test file to catch late Undici mocks.
// The npm Undici adapter must already have run in an earlier --preload.
require('jsdom');
