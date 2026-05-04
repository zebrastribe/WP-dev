import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") process.exit(0);
const root = dirname(fileURLToPath(import.meta.url));
const file = join(root, "..", "dist", "cli.js");
if (existsSync(file)) chmodSync(file, 0o755);
