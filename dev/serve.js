// Dev server for dev/index.html. Bundles dev/main.js (which pulls in the
// real src/components unmodified) the same way build.js does — including the
// `.css` → text loader those components rely on — but unminified and served
// straight from esbuild's dev server, which rebuilds on every request. Save
// a file under src/ and refresh the browser to see the change.
import { context } from "esbuild";

const ctx = await context({
  entryPoints: ["dev/main.js"],
  outfile: "dev/out/main.js",
  bundle: true,
  format: "esm",
  loader: { ".css": "text" },
  sourcemap: true,
  logLevel: "info",
});

const { host, port } = await ctx.serve({ servedir: "dev", port: 8791 });
const displayHost = host === "0.0.0.0" ? "localhost" : host;
console.log(`\nAtrium dev dashboard → http://${displayHost}:${port}/\n`);
