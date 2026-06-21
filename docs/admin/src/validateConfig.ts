import Ajv from "ajv";
import addFormats from "ajv-formats";
import schema from "./generated/wp-dev.config.schema.json";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema as object);

function stripEmptyStringField(obj: Record<string, unknown>, key: string): void {
  if (key in obj && obj[key] === "") {
    delete obj[key];
  }
}

/** Drop empty optional strings so optional minLength:1 fields still validate. */
export function normalizeWpDevConfigForSave(
  body: Record<string, unknown>,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(body)) as Record<string, unknown>;

  if (out.local && typeof out.local === "object" && !Array.isArray(out.local)) {
    const local = { ...(out.local as Record<string, unknown>) };
    for (const key of ["composeProjectName", "themePath", "themeSlug"]) {
      stripEmptyStringField(local, key);
    }
    out.local = local;
  }

  for (const env of ["staging", "production"] as const) {
    const raw = out[env];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const remote = { ...(raw as Record<string, unknown>) };
    stripEmptyStringField(remote, "identityFile");
    delete remote.db;
    out[env] = remote;
  }

  if (
    out.simply &&
    typeof out.simply === "object" &&
    !Array.isArray(out.simply) &&
    typeof (out.simply as Record<string, unknown>).account === "string" &&
    (out.simply as Record<string, unknown>).account === ""
  ) {
    delete out.simply;
  }

  return out;
}

/** Validates payload against JSON Schema generated from Zod (same rules as CLI / PHP). */
export function validateWpDevConfigJson(data: unknown): { ok: true } | { ok: false; errors: string } {
  if (validate(data)) return { ok: true };
  const errs = validate.errors?.map((e) => `${e.instancePath || "/"} ${e.message}`.trim()) ?? [];
  return { ok: false, errors: errs.length ? errs.join("; ") : "invalid config" };
}
