/**
 * OpenSSH rejects an OPENSSH private key that does not end with a newline
 * (`Load key: error in libcrypto`). Storage trims the PEM; the file must not.
 */
export function normalizeSshPrivateKey(raw: string | Buffer): string {
  const text = (typeof raw === "string" ? raw : raw.toString("utf8"))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (!text.includes("PRIVATE KEY")) {
    throw new Error("Expected a private key");
  }
  return `${text}\n`;
}
