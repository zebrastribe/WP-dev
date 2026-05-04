import { copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "wp-dev.config.json");
const example = join(root, "wp-dev.config.example.json");
if (!existsSync(target) && existsSync(example)) {
  copyFileSync(example, target);
  console.warn(
    "wp-dev: created wp-dev.config.json from wp-dev.config.example.json (edit hosts/paths; staging uses .invalid placeholders until you add a real staging server — see README).",
  );
}
