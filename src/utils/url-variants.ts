function normalizeHost(hostname: string): string {
  return hostname.toLowerCase();
}

function toggleWww(hostname: string): string[] {
  const host = normalizeHost(hostname);
  if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    return [host];
  }
  if (host.startsWith("www.")) return [host, host.slice(4)];
  return [host, `www.${host}`];
}

export function getUrlVariants(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }
  const hosts = toggleWww(parsed.hostname);
  const protocols = parsed.protocol === "https:" ? ["https:", "http:"] : ["http:", "https:"];
  const out: string[] = [];
  for (const protocol of protocols) {
    for (const host of hosts) {
      const u = new URL(parsed.toString());
      u.protocol = protocol;
      u.hostname = host;
      out.push(u.toString().replace(/\/$/, ""));
    }
  }
  return Array.from(new Set(out));
}
