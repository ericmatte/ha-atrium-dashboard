import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Mirrors esbuild's `text` loader for `.css` so `node --test` (which runs
// directly against src/, never through esbuild) can resolve the same
// `import STYLE from "./x.css"` statements the production bundle uses.
export async function load(url, context, nextLoad) {
  if (url.endsWith(".css")) {
    const source = await readFile(fileURLToPath(url), "utf8");
    return { format: "module", shortCircuit: true, source: `export default ${JSON.stringify(source)};` };
  }
  return nextLoad(url, context);
}
