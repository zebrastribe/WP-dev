/**
 * wp-dev Docker network configuration utilities.
 *
 * Single source of truth for network defaults. All other code derives values from here
 * or from the actual Docker network state.
 */

import { execSync, spawnSync } from "node:child_process";

/**
 * Default subnet prefix for wp-dev networks. Each stack gets a unique /24 subnet
 * within this range (e.g., 172.28.1.0/24, 172.28.2.0/24).
 *
 * This is the ONLY place the default prefix is defined. Override via WPDEV_NETWORK_SUBNET.
 */
export const DEFAULT_SUBNET_PREFIX = "172.28";

/**
 * Offset from the network address to the gateway (typically .1).
 */
export const GATEWAY_OFFSET = 1;

/**
 * Offset from the network address to the SSL proxy IP (for remoteip.conf trust).
 */
export const SSL_PROXY_OFFSET = 10;

export interface NetworkInfo {
  subnet: string;
  gateway: string;
  sslProxyIp: string;
}

/**
 * Parse a subnet to extract base address and prefix length.
 */
export function parseSubnet(subnet: string): { base: string; prefix: number } | null {
  const match = subnet.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
  if (!match) return null;
  return { base: match[1], prefix: parseInt(match[2], 10) };
}

/**
 * Get the network address (first IP) from a subnet.
 */
export function getNetworkAddress(subnet: string): string | null {
  const parsed = parseSubnet(subnet);
  if (!parsed) return null;
  const parts = parsed.base.split(".").map(Number);
  const mask = ~((1 << (32 - parsed.prefix)) - 1) >>> 0;
  const ip = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const network = (ip & mask) >>> 0;
  return [
    (network >>> 24) & 255,
    (network >>> 16) & 255,
    (network >>> 8) & 255,
    network & 255,
  ].join(".");
}

/**
 * Add an offset to an IP address.
 */
export function addIpOffset(ip: string, offset: number): string {
  const parts = ip.split(".").map(Number);
  const ipNum = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const newIp = (ipNum + offset) >>> 0;
  return [
    (newIp >>> 24) & 255,
    (newIp >>> 16) & 255,
    (newIp >>> 8) & 255,
    newIp & 255,
  ].join(".");
}

/**
 * Derive gateway and proxy IPs from a subnet.
 */
export function deriveNetworkIps(subnet: string): NetworkInfo | null {
  const network = getNetworkAddress(subnet);
  if (!network) return null;
  return {
    subnet,
    gateway: addIpOffset(network, GATEWAY_OFFSET),
    sslProxyIp: addIpOffset(network, SSL_PROXY_OFFSET),
  };
}

/**
 * List existing Docker networks and their subnets.
 */
export function listDockerNetworkSubnets(): Map<string, string> {
  const result = new Map<string, string>();
  try {
    const output = execSync(
      'docker network ls --format "{{.Name}}" 2>/dev/null',
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const names = output.trim().split("\n").filter(Boolean);
    for (const name of names) {
      try {
        const inspect = execSync(
          `docker network inspect "${name}" --format "{{range .IPAM.Config}}{{.Subnet}}{{end}}" 2>/dev/null`,
          { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
        );
        const subnet = inspect.trim();
        if (subnet) {
          result.set(name, subnet);
        }
      } catch {
        // Network may have been removed
      }
    }
  } catch {
    // Docker not available
  }
  return result;
}

/**
 * Check if two subnets overlap.
 */
export function subnetsOverlap(a: string, b: string): boolean {
  const parsedA = parseSubnet(a);
  const parsedB = parseSubnet(b);
  if (!parsedA || !parsedB) return false;

  const toNum = (ip: string) => {
    const parts = ip.split(".").map(Number);
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };

  const aStart = toNum(getNetworkAddress(a) || "0.0.0.0");
  const bStart = toNum(getNetworkAddress(b) || "0.0.0.0");
  const aEnd = aStart + ((1 << (32 - parsedA.prefix)) >>> 0) - 1;
  const bEnd = bStart + ((1 << (32 - parsedB.prefix)) >>> 0) - 1;

  return aStart <= bEnd && bStart <= aEnd;
}

/**
 * Find an available /24 subnet that doesn't overlap with existing Docker networks.
 * Returns a subnet in the form "172.28.X.0/24".
 */
export function findAvailableSubnet(prefix: string = DEFAULT_SUBNET_PREFIX): string | null {
  const existing = listDockerNetworkSubnets();
  const existingSubnets = Array.from(existing.values());

  // Try third octets 1-254 (skip 0 and 255)
  for (let third = 1; third < 255; third++) {
    const candidate = `${prefix}.${third}.0/24`;
    const hasOverlap = existingSubnets.some((s) => subnetsOverlap(candidate, s));
    if (!hasOverlap) {
      return candidate;
    }
  }
  return null;
}

/**
 * Get the actual gateway IP of an existing Docker network.
 */
export function getDockerNetworkGateway(networkName: string): string | null {
  try {
    const output = execSync(
      `docker network inspect "${networkName}" --format "{{range .IPAM.Config}}{{.Gateway}}{{end}}" 2>/dev/null`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const gateway = output.trim();
    return gateway || null;
  } catch {
    return null;
  }
}

/**
 * Get the subnet of an existing Docker network.
 */
export function getDockerNetworkSubnet(networkName: string): string | null {
  try {
    const output = execSync(
      `docker network inspect "${networkName}" --format "{{range .IPAM.Config}}{{.Subnet}}{{end}}" 2>/dev/null`,
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const subnet = output.trim();
    return subnet || null;
  } catch {
    return null;
  }
}

/**
 * Check if a Docker network exists.
 */
export function dockerNetworkExists(networkName: string): boolean {
  try {
    execSync(`docker network inspect "${networkName}" 2>/dev/null`, {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Detect if a port binding is localhost-only by parsing the compose ports format.
 * Returns true if bound to 127.0.0.1 or ::1, false otherwise.
 */
export function isLocalhostBind(portMapping: string): boolean {
  // Formats: "127.0.0.1:8888:80", "8888:80", "0.0.0.0:8888:80"
  const trimmed = portMapping.trim();
  if (trimmed.startsWith("127.0.0.1:") || trimmed.startsWith("[::1]:")) {
    return true;
  }
  // No bind address specified or 0.0.0.0 means exposed to all interfaces
  if (trimmed.startsWith("0.0.0.0:") || !trimmed.includes(":") || /^\d+:\d+$/.test(trimmed)) {
    return false;
  }
  // Check for other non-localhost bind addresses
  const bindMatch = trimmed.match(/^([^:]+):/);
  if (bindMatch) {
    const bind = bindMatch[1];
    return bind === "127.0.0.1" || bind === "::1" || bind === "[::1]" || bind === "localhost";
  }
  return false;
}

/**
 * Derive bind-local flag from WP_BIND env value.
 */
export function deriveBindLocal(wpBind: string | undefined): boolean {
  const bind = (wpBind || "").trim();
  if (bind === "" || bind === "127.0.0.1" || bind === "::1" || bind === "localhost") {
    return true;
  }
  return false;
}

/**
 * Generate remoteip.conf content that trusts only the SSL proxy IP.
 */
export function generateRemoteIpConf(sslProxyIp: string | null): string {
  const lines = [
    "# wp-dev: Restrict X-Forwarded-For trust to prevent REMOTE_ADDR spoofing.",
    "#",
    "# The default wordpress:*-apache image trusts XFF from all private ranges,",
    "# which allows any container or LAN host to spoof REMOTE_ADDR. This config",
    "# trusts only the local SSL proxy (when the ssl profile is active).",
    "#",
    "# Generated by wp-dev up. Do not edit manually.",
    "",
    "<IfModule remoteip_module>",
    "    RemoteIPHeader X-Forwarded-For",
  ];

  if (sslProxyIp) {
    lines.push(`    # Trust only the local SSL proxy at ${sslProxyIp}`);
    lines.push(`    RemoteIPInternalProxy ${sslProxyIp}`);
  } else {
    lines.push("    # No proxy configured - do not trust any XFF headers");
    lines.push("    # RemoteIPInternalProxy <proxy-ip>");
  }

  lines.push("</IfModule>");
  lines.push("");

  return lines.join("\n");
}
