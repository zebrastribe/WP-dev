import type { WpDevConfig } from "../config/schema.js";
import {
  domainPathSlug,
  parseMainDomain,
} from "../utils/domain-defaults.js";
import { normalizeSiteUrl } from "../utils/remote-config-helpers.js";
import {
  isPlaceholderRemoteHost,
  STAGING_PLACEHOLDER_SSH_PATH,
} from "../utils/remote-placeholder.js";
import { simplyGetJson, simplyPostJson } from "./simply.js";

type SimplyProduct = {
  object: string;
  cancelled?: boolean;
  domain?: { name?: string };
  servers?: {
    webserver?: { ip?: string; hostname?: string };
    sshserver?: { ip?: string; hostname?: string; username?: string };
  };
  usernames?: { ssh?: string };
};

type DnsRecordRow = {
  record_id?: number;
  name?: string;
  type?: string;
  data?: string;
};

function normalizeDnsName(name: string): string {
  return name.trim().toLowerCase().replace(/\.$/, "");
}

export function dnsNameMatchesFqdn(name: string, fqdn: string, apex: string): boolean {
  const n = normalizeDnsName(name);
  const f = normalizeDnsName(fqdn);
  const a = normalizeDnsName(apex);
  if (n === f) return true;
  // Some providers return relative labels (e.g. "staging" instead of "staging.example.com").
  if (n !== "" && !n.includes(".")) {
    return `${n}.${a}` === f;
  }
  return false;
}

/** IPv4 dotted quad, each octet 0–255. */
export function isPlausibleIpv4(s: string): boolean {
  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(s.trim())) return false;
  const parts = s.trim().split(".").map((x) => Number(x));
  return parts.length === 4 && parts.every((n) => n >= 0 && n <= 255);
}

function parseProducts(json: unknown): SimplyProduct[] {
  if (!json || typeof json !== "object") return [];
  const products = (json as { products?: unknown }).products;
  if (!Array.isArray(products)) return [];
  return products as SimplyProduct[];
}

export function findSimplyProductForApex(
  products: SimplyProduct[],
  apex: string,
): SimplyProduct | undefined {
  const a = apex.toLowerCase();
  return products.find((p) => {
    if (p.cancelled) return false;
    const d = p.domain?.name?.toLowerCase();
    if (d === a) return true;
    return (p.object || "").toLowerCase() === a;
  });
}

export function pickStagingTargetIpv4(
  product: SimplyProduct,
  records: DnsRecordRow[],
  apex: string,
): string | undefined {
  const w = product.servers?.webserver?.ip?.trim();
  if (w && isPlausibleIpv4(w)) return w;
  const s = product.servers?.sshserver?.ip?.trim();
  if (s && isPlausibleIpv4(s)) return s;

  const apexNorm = normalizeDnsName(apex);
  const wantWww = normalizeDnsName(`www.${apex}`);

  const aRecords = records.filter(
    (r) => (r.type || "").toUpperCase() === "A" && r.data && isPlausibleIpv4(r.data),
  );

  const byName = (want: string) =>
    aRecords.find((r) => normalizeDnsName(r.name || "") === want);

  return byName(apexNorm)?.data?.trim() || byName(wantWww)?.data?.trim();
}

function findRecordAtName(records: DnsRecordRow[], fqdn: string, apex: string): DnsRecordRow | undefined {
  return records.find((r) => dnsNameMatchesFqdn(r.name || "", fqdn, apex));
}

function findStagingARecord(records: DnsRecordRow[], stagingFqdn: string, apex: string): DnsRecordRow | undefined {
  const r = findRecordAtName(records, stagingFqdn, apex);
  if (!r || (r.type || "").toUpperCase() !== "A") return undefined;
  return r;
}

/** One DNS label (e.g. staging, dev). Lowercase LDH, 1–63 chars. */
export function sanitizeStagingDnsLabel(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s.length < 1 || s.length > 63) {
    throw new Error("Staging DNS label must be 1–63 characters.");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(s)) {
    throw new Error(
      `Invalid staging DNS label "${raw}": use letters, digits, and hyphens (not at start/end).`,
    );
  }
  return s;
}

export class SimplyStagingDnsConflictError extends Error {
  readonly stagingFqdn: string;
  readonly proposedIp: string;
  /** Human-readable, e.g. `A → 1.2.3.4` or `CNAME → other.example.com` */
  readonly existingSummary: string;

  constructor(stagingFqdn: string, proposedIp: string, existingSummary: string) {
    super(
      `Simply: ${stagingFqdn} already has ${existingSummary}; wp-dev would add A → ${proposedIp}. Use --keep-existing-dns (update config only) or --staging-label <other> (e.g. dev) for a new name under the same apex.`,
    );
    this.name = "SimplyStagingDnsConflictError";
    this.stagingFqdn = stagingFqdn;
    this.proposedIp = proposedIp;
    this.existingSummary = existingSummary;
  }
}

export type ApplySimplyStagingDnsOptions = {
  /** Single label before apex (default `staging` → staging.example.com). */
  stagingLabel?: string;
  /** When something already exists at that name with a different shape than our new A → proposedIp */
  onDifferentExistingA?: "error" | "config-only";
};

function productDnsRecordsPath(object: string): string {
  const enc = encodeURIComponent(object);
  return `/my/products/${enc}/dns/records/`;
}

/**
 * Creates `<stagingLabel>.<apex>` A record at Simply when possible, and patches draft.staging
 * when it still uses placeholders (URL / SSH host / path hints from product).
 */
export async function applySimplyStagingDnsToDraft(
  draft: WpDevConfig,
  apex: string,
  opts?: ApplySimplyStagingDnsOptions,
): Promise<string[]> {
  const lines: string[] = [];

  const label = opts?.stagingLabel?.trim()
    ? sanitizeStagingDnsLabel(opts.stagingLabel)
    : "staging";
  const stagingFqdn = `${label}.${apex.toLowerCase()}`;
  const productsJson = await simplyGetJson(draft, "/my/products/");
  const products = parseProducts(productsJson);
  const product = findSimplyProductForApex(products, apex);

  if (!product) {
    const names = products
      .map((p) => p.domain?.name || p.object)
      .filter(Boolean)
      .slice(0, 25);
    throw new Error(
      `No Simply product matched apex "${apex}". Products (sample): ${names.join(", ") || "(none)"}`,
    );
  }

  const object = product.object;
  lines.push(`Simply: using DNS zone product "${object}"`);

  const recordsJson = await simplyGetJson(draft, productDnsRecordsPath(object));
  const recordsRaw = (recordsJson as { records?: unknown }).records;
  const records: DnsRecordRow[] = Array.isArray(recordsRaw) ? (recordsRaw as DnsRecordRow[]) : [];

  const ip = pickStagingTargetIpv4(product, records, apex);
  if (!ip) {
    throw new Error(
      `Could not determine an IPv4 for staging DNS (no webserver/sshserver IP and no apex/www A record in zone). Add an A record for ${apex} or www.${apex} first, or set Simply hosting on this domain.`,
    );
  }

  const atName = findRecordAtName(records, stagingFqdn, apex);
  const existingA = findStagingARecord(records, stagingFqdn, apex);

  if (existingA?.data?.trim() === ip) {
    lines.push(
      `Simply: A record ${stagingFqdn} → ${ip} already present — nothing to add.`,
    );
  } else if (existingA && existingA.data?.trim() !== ip) {
    const summary = `A → ${(existingA.data ?? "").trim() || "(empty)"}`;
    if (opts?.onDifferentExistingA === "config-only") {
      lines.push(
        `Simply: ${stagingFqdn} already has ${summary} — keeping existing DNS (no API change).`,
      );
    } else {
      throw new SimplyStagingDnsConflictError(stagingFqdn, ip, summary);
    }
  } else if (atName && !existingA) {
    const typ = (atName.type || "").toUpperCase();
    const summary = `${typ} → ${(atName.data || "").trim() || "(empty)"}`;
    if (opts?.onDifferentExistingA === "config-only") {
      lines.push(
        `Simply: ${stagingFqdn} already has ${summary} — keeping existing DNS (no API change).`,
      );
    } else {
      throw new SimplyStagingDnsConflictError(stagingFqdn, ip, summary);
    }
  } else {
    await simplyPostJson(draft, productDnsRecordsPath(object), {
      type: "A",
      name: stagingFqdn,
      data: ip,
    });
    lines.push(`Simply: created A record ${stagingFqdn} → ${ip}`);
  }

  if (isPlaceholderRemoteHost(draft.staging.host)) {
    const sshHost = product.servers?.sshserver?.hostname?.trim();
    if (sshHost) {
      draft.staging.host = sshHost;
      lines.push(`Config: staging SSH host set to ${sshHost} (from Simply product).`);
    }
  }
  if (draft.staging.path === STAGING_PLACEHOLDER_SSH_PATH) {
    const subdomainPath = `/${label}`;
    draft.staging.path = subdomainPath;
    lines.push(
      `Config: staging path set to ${subdomainPath} (Simply subdomain folder; verify in Simply panel).`,
    );
  } else {
    // Backward compatibility: older versions guessed /var/www/<apex-slug>/public_html.
    const legacyGuess = `/var/www/${domainPathSlug(apex)}/public_html`;
    if (draft.staging.path === legacyGuess) {
      const subdomainPath = `/${label}`;
      draft.staging.path = subdomainPath;
      lines.push(
        `Config: staging path migrated from legacy ${legacyGuess} to ${subdomainPath} (Simply subdomain folder).`,
      );
    }
  }

  draft.staging.url = normalizeSiteUrl(`https://${stagingFqdn}`, "https");
  lines.push(`Config: staging.url set to ${draft.staging.url}`);

  const sshUser = product.usernames?.ssh?.trim() || product.servers?.sshserver?.username?.trim();
  if (sshUser && !draft.staging.user?.trim()) {
    draft.staging.user = sshUser;
    lines.push(`Config: staging SSH user set to ${sshUser} (from Simply product).`);
  }

  lines.push(
    "DNS propagation can take minutes. Install WordPress (or vhost) for staging on the host if it is not already there — wp-dev only manages DNS + config hints.",
  );
  lines.push(
    "Simply subdomain folder mapping is separate from DNS. Ensure the subdomain exists in Simply Subdomains and points to the same folder as staging.path.",
  );

  return lines;
}

/** Apex domain for Simply DNS: init `domain` prompt, else hostname from `production.url`. */
export function inferApexFromConfig(config: WpDevConfig, domainRaw: string): string | undefined {
  if (domainRaw.trim()) {
    try {
      return parseMainDomain(domainRaw);
    } catch {
      return undefined;
    }
  }
  try {
    const host = new URL(config.production.url).hostname;
    return parseMainDomain(host);
  } catch {
    return undefined;
  }
}
