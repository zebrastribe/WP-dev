import { copyFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "wpflow.config.json");
const example = join(root, "wpflow.config.example.json");
if (!existsSync(target) && existsSync(example)) {
  copyFileSync(example, target);
  console.warn("wpflow: created wpflow.config.json from wpflow.config.example.json (edit hosts and paths).");
}
