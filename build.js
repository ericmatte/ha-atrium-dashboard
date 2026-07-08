import { build } from "esbuild";
import { readFile } from "node:fs/promises";

const pkg = JSON.parse(await readFile("package.json", "utf8"));

const result = await build({
  entryPoints: ["src/strategy.js"],
  outfile: "dist/strategy.js",
  bundle: true,
  format: "esm",
  minify: true,
  loader: { ".css": "text" },
  logLevel: "info",
  metafile: true,
  define: { __ATRIUM_VERSION__: JSON.stringify(pkg.version) },
});

// The whole point of this build is a single, self-contained file with
// nothing left to fetch from a sibling path at runtime — HACS only ever
// downloads this one file, so any surviving relative import()/fetch()
// would 404 in production.
const out = await readFile("dist/strategy.js", "utf8");
if (/\bimport\(/.test(out) || /fetch\(\s*(new URL\(`?\.|["'`]\.)/.test(out)) {
  throw new Error(
    "dist/strategy.js still contains a relative dynamic import()/fetch() — bundling did not fully inline the module graph."
  );
}

const inputCount = Object.keys(result.metafile.inputs).length;
console.log(`Bundled ${inputCount} input files into dist/strategy.js (${(out.length / 1024).toFixed(1)} KB minified).`);
