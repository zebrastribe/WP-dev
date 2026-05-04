/**
 * Single source of truth for wp-dev.config.json:
 * - JSON Schema (from Zod) for admin + PHP validation
 * - Typed example snapshot for admin UI (from wp-dev.config.example.json)
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { wpDevConfigSchema } from "../src/config/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const jsonSchema = zodToJsonSchema(wpDevConfigSchema, {
  name: "WpDevConfig",
  target: "jsonSchema7",
  $refStrategy: "none",
});

const schemaBody = JSON.stringify(jsonSchema, null, 2) + "\n";
writeFileSync(join(root, "src/config/wp-dev.config.schema.json"), schemaBody, "utf8");

const adminPublic = join(root, "docs/admin/public");
mkdirSync(adminPublic, { recursive: true });
writeFileSync(join(adminPublic, "wp-dev.config.schema.json"), schemaBody, "utf8");

const adminGen = join(root, "docs/admin/src/generated");
mkdirSync(adminGen, { recursive: true });
writeFileSync(join(adminGen, "wp-dev.config.schema.json"), schemaBody, "utf8");

const examplePath = join(root, "wp-dev.config.example.json");
const example = JSON.parse(readFileSync(examplePath, "utf8")) as unknown;
const exampleTs =
  `/* eslint-disable */\n` +
  `/** Auto-generated from wp-dev.config.example.json — run \`npm run generate:config-artifacts\` */\n` +
  `export const EXAMPLE_WP_DEV_CONFIG = ${JSON.stringify(example, null, 2)} as const;\n`;
writeFileSync(join(adminGen, "exampleConfig.ts"), exampleTs, "utf8");

console.error(
  `Wrote schema → src/config/, docs/admin/public/, docs/admin/src/generated/; example → docs/admin/src/generated/exampleConfig.ts`,
);
