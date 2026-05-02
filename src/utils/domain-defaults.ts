/**
 * Guess SSH host, path, and site URL from a primary domain (e.g. stri.be → slug stri-be, path /var/www/stri-be).
 */

/** Hostname only, lowercase, no scheme/port/path; strips leading www. */
export function parseMainDomain(raw: string): string {
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  const host = s.split("/")[0].split(":")[0];
  if (!host || !/^[a-z0-9.-]+$/.test(host)) {
    throw new Error(`Invalid domain or host: "${raw}"`);
  }
  return host.replace(/^www\./, "");
}

/** Filesystem-friendly segment: stri.be → stri-be */
export function domainPathSlug(raw: string): string {
  return parseMainDomain(raw).replace(/\./g, "-");
}

export type RemoteGuess = {
  host: string;
  path: string;
  url: string;
};

export function suggestStaging(baseDomain: string): RemoteGuess {
  const slug = domainPathSlug(baseDomain);
  const host = `staging.${baseDomain}`;
  return {
    host,
    path: `/var/www/${slug}`,
    url: `https://${host}`,
  };
}

export function suggestProduction(baseDomain: string): RemoteGuess {
  const slug = domainPathSlug(baseDomain);
  return {
    host: baseDomain,
    path: `/var/www/${slug}`,
    url: `https://${baseDomain}`,
  };
}
