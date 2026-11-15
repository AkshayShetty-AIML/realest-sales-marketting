/**
 * Preload for Node CLI scripts (verify:*, db:seed): resolves `server-only` to
 * its no-op build, exactly as Next.js does for server code. A plain Node
 * process IS the server, so the marker has nothing to guard there — while in a
 * Next client bundle it still fails the build. Used as `tsx --require …`.
 */
// A CommonJS preload (tsx --require) has no import syntax available.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Module = require("node:module");

// The package's `exports` hide empty.js, so point at this (already-loaded,
// export-less) file instead — same effect: an import that does nothing.
const resolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  return request === "server-only" ? __filename : resolve.call(this, request, ...rest);
};
