// `output: "standalone"` emits a self-contained server in .next/standalone but leaves the
// static assets out. Copy them in so `node .next/standalone/server.js` serves a complete app
// (local runs and e2e; the Dockerfile copies the same folders explicitly).
import { cpSync, existsSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");
if (!existsSync(standalone)) {
  console.log("prepare-standalone: no .next/standalone (non-standalone build); nothing to do");
  process.exit(0);
}
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
if (existsSync(join(root, "public"))) cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
console.log("prepare-standalone: copied .next/static and public into .next/standalone");
