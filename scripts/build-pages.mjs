#!/usr/bin/env node
/**
 * Turn the SPA build in `dist/client` into something GitHub Pages can serve.
 *
 * Three things Pages needs that the Vite/Start build does not produce:
 *
 * 1. `index.html` — Start writes the shell as `_shell.html`; Pages serves
 *    `index.html` for a directory and `404.html` for anything else, so the
 *    shell becomes both and the client router takes it from there.
 * 2. `.nojekyll` — without it Pages runs the output through Jekyll, which drops
 *    every path starting with `_` (`_shell.html`) or `__` (`__grok/`).
 * 3. Root-relative hrefs made relative — the platform head injector emits
 *    `/favicon.svg` and `/__grok/…`, which resolve outside the `/<repo>/`
 *    subpath the site is served from. The hashed asset URLs already carry the
 *    base and are left alone.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isMainModule } from "./with-app-env.mjs";

const CLIENT_DIR = process.argv[2] ?? "dist/client";
const BASE = process.env.PAGES_BASE ?? "/";

/**
 * Root-absolute `href`/`src` values rewritten to sit under the deploy base.
 * Anything already prefixed with the base is left alone — rewriting those would
 * double the prefix — as are absolute and protocol-relative URLs.
 */
export function relativizeRootPaths(html, base = "/") {
  const prefix = base.endsWith("/") ? base : `${base}/`;
  return html.replace(/((?:href|src)=")(\/(?!\/)[^"]*)"/g, (match, attr, path) =>
    path.startsWith(prefix) ? match : `${attr}.${path}"`,
  );
}

function main() {
  const html = relativizeRootPaths(readFileSync(join(CLIENT_DIR, "_shell.html"), "utf8"), BASE);
  for (const name of ["index.html", "404.html"]) {
    writeFileSync(join(CLIENT_DIR, name), html);
  }
  writeFileSync(join(CLIENT_DIR, ".nojekyll"), "");
  console.log(`[pages] ${CLIENT_DIR}: index.html + 404.html + .nojekyll`);
}

if (isMainModule(import.meta.url)) {
  main();
}
