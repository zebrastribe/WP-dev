/** RFC 2606 `.invalid` and obvious template hosts — not real remotes for pull/push. */
export function isPlaceholderRemoteHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase();
  return h.endsWith(".invalid");
}
