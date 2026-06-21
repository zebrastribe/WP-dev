/** In-memory CSRF nonce from admin session (not persisted). */
let adminNonce: string | null = null;

export function setAdminNonce(value: string | null): void {
  adminNonce = value?.trim() ? value.trim() : null;
}

export function getAdminNonce(): string | null {
  return adminNonce;
}

export function buildAdminApiHeaders(
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const nonce = getAdminNonce();
  if (nonce) {
    headers["X-WP-DEV-Nonce"] = nonce;
  }
  return headers;
}
