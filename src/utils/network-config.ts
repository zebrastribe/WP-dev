/**
 * wp-dev Docker network configuration utilities.
 *
 * Single source of truth for network defaults. All other code derives values from here
 * or from the actual Docker network state.
 */

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * Default subnet prefix for wp-dev networks. Each stack gets a unique /24 subnet
 * within this range (e.g., 172.28.1.0/24, 172.28.2.0/24).
 *
 * This is the ONLY place the default prefix is defined. Override via WPDEV_SUBNET_POOL
 * in docker/.env or shell environment.
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

/**
 * Offset where dynamic IP allocation begins (reserves .1-.15 for fixed IPs).
 * This leaves room for gateway (.1), SSL proxy (.10), and future fixed services.
 */
export const DYNAMIC_IP_START_OFFSET = 16;

export interface NetworkInfo {
  subnet: string;
  gateway: string;
  sslProxyIp: string;
  /** ip_range for dynamic allocation (excludes gateway and SSL proxy IPs) */
  ipRange: string;
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
 * Minimum subnet size that can support all fixed IPs (gateway, SSL proxy).
 * SSL_PROXY_OFFSET (10) requires at least 16 addresses (/28).
 */
export const MIN_SUBNET_SIZE_FOR_PROXY = 28;

/**
 * Derive gateway, proxy IPs, and dynamic ip_range from a subnet.
 * The ip_range starts after the reserved addresses to prevent dynamic containers
 * from taking the SSL proxy's fixed IP.
 *
 * The ip_range is computed dynamically based on subnet size:
 * - Subnets /28 and larger: ip_range reserves addresses for fixed IPs
 * - Subnets smaller than /28: no ip_range (proxy IP would be outside subnet)
 *
 * Returns null for subnets smaller than /28 (proxy IP at .10 requires at least 16 addresses).
 */
export function deriveNetworkIps(subnet: string): NetworkInfo | null {
  const network = getNetworkAddress(subnet);
  if (!network) return null;
  const parsed = parseSubnet(subnet);
  if (!parsed) return null;

  const subnetSize = 32 - parsed.prefix;
  const totalAddresses = 1 << subnetSize;

  // Validate subnet can hold all fixed IPs
  // Gateway at offset 1 and SSL proxy at offset 10 require at least 16 addresses (/28)
  if (parsed.prefix > MIN_SUBNET_SIZE_FOR_PROXY) {
    // /29 (8 addresses) and /30 (4 addresses) can't fit proxy at .10
    return null;
  }

  const gateway = addIpOffset(network, GATEWAY_OFFSET);
  const sslProxyIp = addIpOffset(network, SSL_PROXY_OFFSET);
  const dynamicStart = addIpOffset(network, DYNAMIC_IP_START_OFFSET);

  // Calculate ip_range based on subnet size
  // ip_range tells Docker "only allocate dynamic IPs from this range"
  // The range must fit within the subnet: (DYNAMIC_IP_START_OFFSET + range_size) <= totalAddresses
  let ipRange = "";

  // ip_range sizing: use the largest range that fits after the reserved addresses
  // Reserved: .0 (network), .1 (gateway), .10 (proxy) → dynamic starts at .16
  // Available for dynamic: totalAddresses - DYNAMIC_IP_START_OFFSET
  const availableForDynamic = totalAddresses - DYNAMIC_IP_START_OFFSET;

  if (totalAddresses >= 64) {
    // /24 (256), /25 (128), /26 (64): use /28 (16 addresses)
    ipRange = `${dynamicStart}/28`;
  } else if (totalAddresses >= 32) {
    // /27 (32 addresses): 32-16=16, /28 would fill exactly, use /29 for margin
    ipRange = `${dynamicStart}/29`;
  }
  // /28 (16 addresses): no ip_range - Docker allocates from whole subnet

  return { subnet, gateway, sslProxyIp, ipRange };
}

/**
 * List existing Docker networks and their IPv4 subnets.
 * Returns a map of network name -> array of IPv4 subnets (handles dual-stack).
 *
 * Returns null if Docker is unavailable. Use listDockerNetworkSubnetsOrThrow
 * at allocation points where Docker is required.
 */
export function listDockerNetworkSubnets(): Map<string, string[]> | null {
  const result = new Map<string, string[]>();

  let output: string;
  try {
    output = execFileSync(
      "docker",
      ["network", "ls", "--format", "{{.Name}}"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch {
    // Docker not available - return null instead of throwing
    // This allows pure helper functions to work without Docker
    return null;
  }

  const names = output.trim().split("\n").filter(Boolean);
  for (const name of names) {
    try {
      const inspect = execFileSync(
        "docker",
        ["network", "inspect", name, "--format", "{{json .IPAM.Config}}"],
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
      );
      const configs = JSON.parse(inspect.trim()) as Array<{ Subnet?: string }>;
      const ipv4Subnets: string[] = [];
      for (const cfg of configs) {
        if (cfg.Subnet && !cfg.Subnet.includes(":")) {
          ipv4Subnets.push(cfg.Subnet);
        }
      }
      if (ipv4Subnets.length > 0) {
        result.set(name, ipv4Subnets);
      }
    } catch {
      // Individual network inspect failure is not fatal - network may have been removed
    }
  }
  return result;
}

/**
 * List host routes that might conflict with Docker networks.
 * Parses `ip route` output to find subnets already in use on the host.
 * Returns an array of CIDR strings (e.g., ["10.0.0.0/8", "172.16.0.0/12"]).
 *
 * Host routes include: VPNs (Tailscale, WireGuard), cloud private networks (Hetzner vSwitch),
 * and any other routes that would conflict with Docker network allocation.
 */
export function listHostRouteSubnets(): string[] {
  const subnets: string[] = [];

  try {
    const output = execFileSync("ip", ["route"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    for (const line of output.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("default")) continue;

      // Parse lines like "10.0.0.0/8 dev eth0" or "172.16.0.0/12 via 192.168.1.1"
      // Also handle host routes like "10.1.2.3 dev eth0" (single IP, no CIDR)
      const match = trimmed.match(/^(\d+\.\d+\.\d+\.\d+(?:\/\d+)?)\s/);
      if (match) {
        let subnet = match[1];
        // If no CIDR notation, treat as /32 (single host route)
        if (!subnet.includes("/")) {
          subnet = `${subnet}/32`;
        }
        subnets.push(subnet);
      }
    }
  } catch {
    // `ip route` not available (non-Linux or missing iproute2) - skip host route check
  }

  // Also check for interface addresses that might indicate private networks
  try {
    const output = execFileSync("ip", ["addr"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });

    for (const line of output.split("\n")) {
      // Match "inet 10.0.0.5/24" style lines
      const match = line.match(/\s+inet\s+(\d+\.\d+\.\d+\.\d+\/\d+)/);
      if (match) {
        subnets.push(match[1]);
      }
    }
  } catch {
    // Non-fatal
  }

  return subnets;
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
 * Read a value from a .env file content.
 */
function readEnvValueFromContent(content: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = content.match(new RegExp(`^${escaped}=(.*)$`, "m"));
  if (!m) return "";
  return (m[1] || "").trim();
}

/**
 * Get the subnet pool prefix from environment or docker/.env or use default.
 * Order of precedence: shell env > docker/.env > default.
 * Override via WPDEV_SUBNET_POOL.
 *
 * @param dockerEnvPath Optional path to docker/.env file
 */
export function getSubnetPoolPrefix(dockerEnvPath?: string): string {
  // 1. Check shell environment first
  const fromEnv = process.env.WPDEV_SUBNET_POOL?.trim();
  if (fromEnv && /^\d+\.\d+$/.test(fromEnv)) {
    return fromEnv;
  }

  // 2. Check docker/.env file
  if (dockerEnvPath && existsSync(dockerEnvPath)) {
    try {
      const content = readFileSync(dockerEnvPath, "utf8");
      const fromFile = readEnvValueFromContent(content, "WPDEV_SUBNET_POOL")?.trim();
      if (fromFile && /^\d+\.\d+$/.test(fromFile)) {
        return fromFile;
      }
    } catch {
      // File read error - fall through to default
    }
  }

  return DEFAULT_SUBNET_PREFIX;
}

/**
 * Find an available /24 subnet that doesn't overlap with existing Docker networks
 * or host routes (VPNs, private networks, etc.).
 * Returns a subnet in the form "{prefix}.X.0/24" or null if none available.
 *
 * The prefix can be overridden via WPDEV_SUBNET_POOL env var or docker/.env.
 *
 * @param prefix Optional explicit prefix override
 * @param dockerEnvPath Optional path to docker/.env for reading WPDEV_SUBNET_POOL
 */
export function findAvailableSubnet(prefix?: string, dockerEnvPath?: string): string | null {
  const poolPrefix = prefix ?? getSubnetPoolPrefix(dockerEnvPath);

  // Get Docker network subnets - throw at allocation point where Docker is required
  const existing = listDockerNetworkSubnets();
  if (existing === null) {
    throw new Error(
      `Cannot list Docker networks. ` +
        `Ensure Docker is running and accessible. Subnet allocation requires Docker.`,
    );
  }

  // Flatten all Docker network subnets
  const existingSubnets: string[] = [];
  for (const subnets of existing.values()) {
    existingSubnets.push(...subnets);
  }

  // Also consider host routes (VPNs, cloud private networks, etc.)
  const hostRoutes = listHostRouteSubnets();
  const allSubnets = [...existingSubnets, ...hostRoutes];

  // Check if the entire pool /16 is already taken by another network
  const poolRange = `${poolPrefix}.0.0/16`;
  for (const subnet of allSubnets) {
    if (subnet === poolRange || subnetsOverlap(poolRange, subnet)) {
      const parsed = parseSubnet(subnet);
      if (parsed && parsed.prefix <= 16) {
        return null;
      }
    }
  }

  // Try third octets 1-254 (skip 0 and 255)
  for (let third = 1; third < 255; third++) {
    const candidate = `${poolPrefix}.${third}.0/24`;
    const hasOverlap = allSubnets.some((s) => subnetsOverlap(candidate, s));
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
 * Get the actual ip_range of an existing Docker network (IPv4 only).
 * Returns empty string if the network has no ip_range configured.
 */
export function getDockerNetworkIpRange(networkName: string): string {
  try {
    const output = execFileSync(
      "docker",
      ["network", "inspect", networkName, "--format", "{{json .IPAM.Config}}"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const configs = JSON.parse(output.trim()) as Array<{ IPRange?: string; Subnet?: string }>;
    // Find the first IPv4 config with an ip_range
    for (const cfg of configs) {
      if (cfg.IPRange && !cfg.IPRange.includes(":")) {
        return cfg.IPRange;
      }
    }
    return "";
  } catch {
    return "";
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
 * Check if a Docker network has any attached containers.
 * Returns true if containers are using the network, false otherwise.
 */
export function dockerNetworkHasContainers(networkName: string): boolean {
  try {
    const output = execFileSync(
      "docker",
      ["network", "inspect", networkName, "--format", "{{json .Containers}}"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const containers = JSON.parse(output.trim());
    return containers && Object.keys(containers).length > 0;
  } catch {
    return false;
  }
}

/**
 * Get the com.docker.compose.project label from a Docker network.
 * Returns the project name if the network was created by docker-compose, null otherwise.
 */
export function getDockerNetworkComposeProject(networkName: string): string | null {
  try {
    const output = execFileSync(
      "docker",
      ["network", "inspect", networkName, "--format", "{{index .Labels \"com.docker.compose.project\"}}"],
      { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] },
    );
    const project = output.trim();
    return project || null;
  } catch {
    return null;
  }
}

/**
 * Remove a Docker network if it exists and has no containers.
 * Returns true if removed, false if not removed (doesn't exist or has containers).
 */
export function removeDockerNetworkIfUnused(networkName: string): { removed: boolean; reason?: string } {
  if (!dockerNetworkExists(networkName)) {
    return { removed: false, reason: "network does not exist" };
  }

  if (dockerNetworkHasContainers(networkName)) {
    return { removed: false, reason: "network has attached containers" };
  }

  try {
    execFileSync("docker", ["network", "rm", networkName], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { removed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { removed: false, reason: `removal failed: ${msg}` };
  }
}

/**
 * Clean up the legacy _default network after migration to _wpdev network.
 * Only removes the network if:
 * 1. It exists
 * 2. It has no attached containers
 * 3. It was created by our compose project (verified by com.docker.compose.project label)
 *
 * @param projectId The compose project ID
 * @returns Result with removed status and optional reason
 */
export function cleanupLegacyDefaultNetwork(projectId: string): { removed: boolean; reason?: string } {
  const legacyNetworkName = `${projectId}_default`;

  if (!dockerNetworkExists(legacyNetworkName)) {
    return { removed: false, reason: "network does not exist" };
  }

  // G12: Verify ownership via com.docker.compose.project label before removing
  const composeProject = getDockerNetworkComposeProject(legacyNetworkName);
  if (composeProject !== projectId) {
    return {
      removed: false,
      reason: composeProject
        ? `network belongs to different project (${composeProject})`
        : "network has no compose project label (not owned by us)",
    };
  }

  if (dockerNetworkHasContainers(legacyNetworkName)) {
    return { removed: false, reason: "network has attached containers" };
  }

  try {
    execFileSync("docker", ["network", "rm", legacyNetworkName], {
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { removed: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { removed: false, reason: `removal failed: ${msg}` };
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
 *
 * Handles quoted values and case-insensitive localhost.
 */
export function deriveBindLocal(wpBind: string | undefined): boolean {
  let bind = (wpBind || "").trim();

  // Strip quotes (single or double)
  if (
    (bind.startsWith('"') && bind.endsWith('"')) ||
    (bind.startsWith("'") && bind.endsWith("'"))
  ) {
    bind = bind.slice(1, -1).trim();
  }

  // Empty means all interfaces (Docker default) - NOT localhost
  if (bind === "") {
    return false;
  }

  // Explicit loopback addresses (case-insensitive localhost)
  const lower = bind.toLowerCase();
  if (bind === "127.0.0.1" || bind === "::1" || bind === "[::1]" || lower === "localhost") {
    return true;
  }
  return false;
}

/**
 * Check if a saved subnet overlaps with any currently existing Docker networks.
 * Used to detect collision when a previously saved subnet has been taken by another stack.
 * Returns false if Docker is unavailable (can't check, assume no collision).
 */
export function savedSubnetOverlapsExisting(savedSubnet: string, ownNetworkName: string): boolean {
  const existing = listDockerNetworkSubnets();
  if (existing === null) {
    // Docker not available - can't check for collisions, assume none
    return false;
  }

  for (const [netName, subnets] of existing.entries()) {
    // Skip our own network (it's expected to match)
    if (netName === ownNetworkName) continue;

    for (const subnet of subnets) {
      if (subnetsOverlap(savedSubnet, subnet)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Validate an IPv4 address string.
 * Returns true if valid, false otherwise.
 */
function isValidIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    const n = Number.parseInt(part, 10);
    if (!Number.isInteger(n) || n < 0 || n > 255) return false;
    // Reject leading zeros (e.g., "01" should be "1")
    if (part.length > 1 && part.startsWith("0")) return false;
  }
  return true;
}

/**
 * Validate an IPv6 address string (basic check).
 * Returns true if it looks like a valid IPv6, false otherwise.
 */
function isValidIPv6(ip: string): boolean {
  // Remove brackets if present (e.g., [::1])
  let addr = ip;
  if (addr.startsWith("[") && addr.endsWith("]")) {
    addr = addr.slice(1, -1);
  }
  // Basic IPv6 pattern check
  if (addr === "::1" || addr === "::") return true;
  // Must contain at least one colon and only valid hex chars/colons
  if (!addr.includes(":")) return false;
  if (!/^[0-9a-fA-F:]+$/.test(addr)) return false;
  // Check for valid number of colons and groups
  const parts = addr.split(":");
  if (parts.length > 8) return false;
  return true;
}

/**
 * Normalize WP_BIND value for use in compose.
 * Docker Compose rejects "localhost" as a bind address - it must be an IP.
 * Returns the normalized IP or throws if invalid.
 *
 * Handles:
 * - Quoted values ("127.0.0.1" or '127.0.0.1')
 * - Case-insensitive localhost (LOCALHOST, Localhost)
 * - IPv6 with or without brackets
 * - Rejects invalid IPs (foo:bar, 999.1.1.1) with clear messages
 */
export function normalizeWpBind(bind: string | undefined): string {
  let trimmed = (bind || "").trim();

  // Strip quotes (single or double)
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    trimmed = trimmed.slice(1, -1).trim();
  }

  // Empty or default
  if (trimmed === "" || trimmed === "127.0.0.1") {
    return "127.0.0.1";
  }

  // Case-insensitive localhost
  if (trimmed.toLowerCase() === "localhost") {
    return "127.0.0.1";
  }

  // Common loopback/wildcard addresses
  if (trimmed === "0.0.0.0") {
    return "0.0.0.0";
  }

  // IPv6 loopback (with or without brackets)
  if (trimmed === "::1" || trimmed === "[::1]") {
    return "::1";
  }

  // Check for IPv4
  if (/^\d+\.\d+\.\d+\.\d+$/.test(trimmed)) {
    if (!isValidIPv4(trimmed)) {
      throw new Error(
        `Invalid WP_BIND value "${trimmed}": invalid IPv4 address. ` +
          `Each octet must be 0-255 (e.g., "192.168.1.1" not "999.1.1.1").`,
      );
    }
    return trimmed;
  }

  // Check for IPv6 (contains colons)
  if (trimmed.includes(":")) {
    // First check if it looks like a malformed value (e.g., "foo:bar")
    const withoutBrackets = trimmed.startsWith("[") ? trimmed.slice(1).replace(/]$/, "") : trimmed;
    if (!/^[0-9a-fA-F:]+$/.test(withoutBrackets)) {
      throw new Error(
        `Invalid WP_BIND value "${trimmed}": not a valid IP address. ` +
          `Use an IP address (127.0.0.1, 0.0.0.0, ::1) not a hostname or port.`,
      );
    }
    if (!isValidIPv6(trimmed)) {
      throw new Error(
        `Invalid WP_BIND value "${trimmed}": invalid IPv6 address format.`,
      );
    }
    // Return without brackets for compose (Docker handles the format)
    return withoutBrackets;
  }

  // If it doesn't look like an IP, reject it
  throw new Error(
    `Invalid WP_BIND value "${trimmed}". Use an IP address (127.0.0.1, 0.0.0.0, ::1) not a hostname.`,
  );
}

/**
 * Generate remoteip.conf content.
 *
 * When SSL proxy is configured, trusts only that proxy for X-Forwarded-For.
 * When SSL is off, completely disables RemoteIPHeader to prevent any XFF spoofing.
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
  ];

  if (sslProxyIp) {
    // SSL is on - trust only the specific proxy IP
    lines.push("<IfModule remoteip_module>");
    lines.push("    RemoteIPHeader X-Forwarded-For");
    lines.push(`    # Trust only the local SSL proxy at ${sslProxyIp}`);
    lines.push(`    RemoteIPInternalProxy ${sslProxyIp}`);
    lines.push("</IfModule>");
  } else {
    // SSL is off - do NOT set RemoteIPHeader at all.
    // Setting RemoteIPHeader without a trusted proxy list would allow any client
    // to spoof REMOTE_ADDR by sending X-Forwarded-For: 8.8.8.8
    lines.push("# SSL proxy not active - RemoteIPHeader is NOT set.");
    lines.push("# This prevents clients from spoofing REMOTE_ADDR via X-Forwarded-For.");
    lines.push("#");
    lines.push("# <IfModule remoteip_module>");
    lines.push("#     RemoteIPHeader X-Forwarded-For");
    lines.push("#     RemoteIPInternalProxy <proxy-ip>");
    lines.push("# </IfModule>");
  }

  lines.push("");
  return lines.join("\n");
}
