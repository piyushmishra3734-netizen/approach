import assert from "node:assert/strict";
import test from "node:test";
import { relativizeRootPaths } from "./build-pages.mjs";

const SHELL =
  '<link rel="icon" href="/favicon.svg"/>' +
  '<link rel="manifest" href="/__grok/manifest.webmanifest"/>' +
  '<link rel="stylesheet" href="/approach/assets/styles-abc.css"/>' +
  '<script src="https://fonts.example/x.js"></script>' +
  '<link href="//cdn.example/y.css"/>';

test("only the refs that miss the deploy base are made relative", () => {
  const html = relativizeRootPaths(SHELL, "/approach/");
  assert.match(html, /href="\.\/favicon\.svg"/);
  assert.match(html, /href="\.\/__grok\/manifest\.webmanifest"/);
  // Already carries the base — rewriting it would resolve to /approach/approach/.
  assert.match(html, /href="\/approach\/assets\/styles-abc\.css"/);
  // Absolute and protocol-relative URLs stay untouched.
  assert.match(html, /src="https:\/\/fonts\.example\/x\.js"/);
  assert.match(html, /href="\/\/cdn\.example\/y\.css"/);
});

test("a site served from the root is left exactly as built", () => {
  assert.equal(relativizeRootPaths(SHELL, "/"), SHELL);
});
