import type { WpDevConfig } from "../config/schema.js";
import type { SshSession } from "../services/ssh.js";
import {
  wpLocalRaw,
  wpRemoteExec,
} from "../services/wpcli.js";

export type SiteUrlCheck = {
  home: string | null;
  siteurl: string | null;
  ok: boolean;
  expected: string;
};

export async function wpLocalGetOption(
  configDir: string,
  config: WpDevConfig,
  key: "home" | "siteurl",
): Promise<string | null> {
  const r = await wpLocalRaw(configDir, config, ["option", "get", key]);
  if (r.exitCode !== 0) return null;
  const v = (r.stdout || "").trim();
  return v !== "" ? v : null;
}

export async function wpRemoteGetOption(
  ssh: SshSession,
  remotePath: string,
  key: "home" | "siteurl",
): Promise<string | null> {
  const r = await wpRemoteExec(ssh, remotePath, ["option", "get", key]);
  if (r.code !== 0) return null;
  const v = (r.stdout || "").trim();
  return v !== "" ? v : null;
}

export function siteUrlsMatchExpected(
  home: string | null,
  siteurl: string | null,
  expected: string,
): boolean {
  const norm = (u: string | null) => (u ?? "").replace(/\/$/, "");
  const exp = expected.replace(/\/$/, "");
  return norm(home) === exp && norm(siteurl) === exp;
}

export async function verifyLocalSiteUrls(
  configDir: string,
  config: WpDevConfig,
  expectedUrl: string,
): Promise<SiteUrlCheck> {
  const home = await wpLocalGetOption(configDir, config, "home");
  const siteurl = await wpLocalGetOption(configDir, config, "siteurl");
  return {
    home,
    siteurl,
    expected: expectedUrl,
    ok: siteUrlsMatchExpected(home, siteurl, expectedUrl),
  };
}

export async function verifyRemoteSiteUrls(
  ssh: SshSession,
  remotePath: string,
  expectedUrl: string,
): Promise<SiteUrlCheck> {
  const home = await wpRemoteGetOption(ssh, remotePath, "home");
  const siteurl = await wpRemoteGetOption(ssh, remotePath, "siteurl");
  return {
    home,
    siteurl,
    expected: expectedUrl,
    ok: siteUrlsMatchExpected(home, siteurl, expectedUrl),
  };
}
