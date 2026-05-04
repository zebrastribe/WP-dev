import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { describe, expect, it } from "vitest";
import { wpDevConfigSchema } from "../src/config/schema.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("generated JSON Schema ↔ example config", () => {
  it("wp-dev.config.example.json validates against wp-dev.config.schema.json", () => {
    const schema = JSON.parse(
      readFileSync(join(root, "src/config/wp-dev.config.schema.json"), "utf8"),
    ) as object;
    const example = JSON.parse(
      readFileSync(join(root, "wp-dev.config.example.json"), "utf8"),
    );
    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    expect(validate(example)).toBe(true);
  });

  it("Zod accepts the same example file", () => {
    const example = JSON.parse(
      readFileSync(join(root, "wp-dev.config.example.json"), "utf8"),
    );
    expect(() => wpDevConfigSchema.parse(example)).not.toThrow();
  });
});
