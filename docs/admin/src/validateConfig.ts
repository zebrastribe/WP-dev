import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "./generated/wp-dev.config.schema.json";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema as object);

/** Validates payload against JSON Schema generated from Zod (same rules as CLI / PHP). */
export function validateWpDevConfigJson(data: unknown): { ok: true } | { ok: false; errors: string } {
  if (validate(data)) return { ok: true };
  const errs = validate.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`.trim()) ?? [];
  return { ok: false, errors: errs.length ? errs.join("; ") : "invalid config" };
}
