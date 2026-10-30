/**
 * wp-dev Docker network configuration utilities.
 *
 * Single source of truth for network defaults. All other code derives values from here
 * or from the actual Docker network state.
 */

import { execFileSync, spawnSync } from "node:child_process";

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
 * List existing Docker networks and their IPv4 subnets.
 * Returns a map of network name -> array of IPv4 subnets (handles dual-stack).
 */
export function listDockerNetworkSubnets(): Map<string, string[]> {
  const result = new Map<string, string[]>();
  try {
    const output = execFileSync(
      "docker",
      ["network", "ls", "--format", "{{.Name}}"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const names = output.trim().split("\n").filter(Boolean);
    for (const name of names) {
      try {
        // Use JSON output for reliable parsing of multiple subnets
        const inspect = execFileSync(
          "docker",
          ["network", "inspect", name, "--format", "{{json .IPAM.Config}}"],
          { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
        );
        const configs = JSON.parse(inspect.trim()) as Array<{ Subnet?: string }>;
        const ipv4Subnets: string[] = [];
        for (const cfg of configs) {
          if (cfg.Subnet && !cfg.Subnet.includes(":")) {
            // IPv4 only (no colons)
            ipv4Subnets.push(cfg.Subnet);
          }
        }
        if (ipv4Subnets.length > 0) {
          result.set(name, ipv4Subnets);
        }
      } catch {
        // Network may have been removed or inspect failed
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
 * Get the subnet pool prefix from environment or use default.
 * Override via WPDEV_SUBNET_POOL env var.
 */
export function getSubnetPoolPrefix(): string {
  const fromEnv = process.env.WPDEV_SUBNET_POOL?.trim();
  if (fromEnv && /^\d+\.\d+$/.test(fromEnv)) {
    return fromEnv;
  }
  return DEFAULT_SUBNET_PREFIX;
}

/**
 * Find an available /24 subnet that doesn't overlap with existing Docker networks.
 * Returns a subnet in the form "{prefix}.X.0/24" or null if none available.
 *
 * The prefix can be overridden via WPDEV_SUBNET_POOL env var.
 */
export function findAvailableSubnet(prefix?: string): string | null {
  const poolPrefix = prefix ?? getSubnetPoolPrefix();
  const existing = listDockerNetworkSubnets();

  // Flatten all subnets from all networks
  const existingSubnets: string[] = [];
  for (const subnets of existing.values()) {
    existingSubnets.push(...subnets);
  }

  // Check if the entire pool /16 is already taken by another network
  const poolRange = `${poolPrefix}.0.0/16`;
  for (const subnet of existingSubnets) {
    // If someone has the exact /16 or a larger block containing our pool
    if (subnet === poolRange || subnetsOverlap(poolRange, subnet)) {
      const parsed = parseSubnet(subnet);
      if (parsed && parsed.prefix <= 16) {
        // A /16 or larger block covers our entire pool
        return null;
      }
    }
  }

  // Try third octets 1-254 (skip 0 and 255)
  for (let third = 1; third < 255; third++) {
    const candidate = `${poolPrefix}.${third}.0/24`;
    const hasOverlap = existingSubnets.some((s) => subnetsOverlap(candidate, s));
    if (!hasOverlap) {
      return candidate;
    }
  }
  return null;
}

/**
 * Get the actual gateway IP of an existing Docker network (IPv4 only).
 */
export function getDockerNetworkGateway(networkName: string): string | null {
  try {
    const output = execFileSync(
      "docker",
      ["network", "inspect", networkName, "--format", "{{json .IPAM.Config}}"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const configs = JSON.parse(output.trim()) as Array<{ Gateway?: string; Subnet?: string }>;
    // Find the first IPv4 config with a gateway
    for (const cfg of configs) {
      if (cfg.Gateway && !cfg.Gateway.includes(":")) {
        return cfg.Gateway;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the IPv4 subnet of an existing Docker network.
 */
export function getDockerNetworkSubnet(networkName: string): string | null {
  try {
    const output = execFileSync(
      "docker",
      ["network", "inspect", networkName, "--format", "{{json .IPAM.Config}}"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const configs = JSON.parse(output.trim()) as Array<{ Subnet?: string }>;
    // Find the first IPv4 subnet
    for (const cfg of configs) {
      if (cfg.Subnet && !cfg.Subnet.includes(":")) {
        return cfg.Subnet;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a Docker network exists.
 */
export function dockerNetworkExists(networkName: string): boolean {
  try {
    execFileSync("docker", ["network", "inspect", networkName], {
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
 * Returns true ONLY for explicit loopback addresses.
 * Empty/unset means Docker's default (all interfaces) = NOT local.
 */
export function deriveBindLocal(wpBind: string | undefined): boolean {
  const bind = (wpBind || "").trim();
  // Empty means all interfaces (Docker default) - NOT localhost
  if (bind === "") {
    return false;
  }
  // Explicit loopback addresses
  if (bind === "127.0.0.1" || bind === "::1" || bind === "localhost") {
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
