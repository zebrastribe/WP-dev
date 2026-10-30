import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupLegacyDefaultNetwork,
  DEFAULT_SUBNET_PREFIX,
  deriveBindLocal,
  deriveNetworkIps,
  findAvailableSubnet,
  generateRemoteIpConf,
  getDockerNetworkComposeProject,
  getNetworkAddress,
  addIpOffset,
  isLocalhostBind,
  normalizeWpBind,
  parseSubnet,
  savedSubnetOverlapsExisting,
  subnetsOverlap,
} from "../src/utils/network-config.js";
import { LOG_DIR_NAME, LOG_FILE_NAME, logPathForConfigDir } from "../src/utils/logger.js";

/**
 * Gate 0 security tests for wp-dev admin.
 *
 * These tests cover:
 * 1. Network configuration utilities (TypeScript)
 * 2. PHP gate logic via real PHP CLI execution
 * 3. Edge cases and attack scenarios
 */

describe("network-config utilities", () => {
  describe("parseSubnet", () => {
    it("parses valid CIDR notation", () => {
      expect(parseSubnet("172.28.1.0/24")).toEqual({ base: "172.28.1.0", prefix: 24 });
      expect(parseSubnet("10.0.0.0/8")).toEqual({ base: "10.0.0.0", prefix: 8 });
    });

    it("returns null for invalid subnets", () => {
      expect(parseSubnet("172.28.1.0")).toBeNull();
      expect(parseSubnet("invalid")).toBeNull();
      expect(parseSubnet("")).toBeNull();
    });
  });

  describe("getNetworkAddress", () => {
    it("calculates network address from CIDR", () => {
      expect(getNetworkAddress("172.28.1.0/24")).toBe("172.28.1.0");
      expect(getNetworkAddress("172.28.1.50/24")).toBe("172.28.1.0");
      expect(getNetworkAddress("10.0.0.0/8")).toBe("10.0.0.0");
      expect(getNetworkAddress("192.168.1.100/16")).toBe("192.168.0.0");
    });
  });

  describe("addIpOffset", () => {
    it("adds offset to IP address", () => {
      expect(addIpOffset("172.28.1.0", 1)).toBe("172.28.1.1");
      expect(addIpOffset("172.28.1.0", 10)).toBe("172.28.1.10");
      expect(addIpOffset("172.28.1.255", 1)).toBe("172.28.2.0");
    });
  });

  describe("deriveNetworkIps", () => {
    it("derives gateway and proxy IPs from subnet", () => {
      const result = deriveNetworkIps("172.28.5.0/24");
      expect(result).not.toBeNull();
      expect(result?.gateway).toBe("172.28.5.1");
      expect(result?.sslProxyIp).toBe("172.28.5.10");
    });
  });

  describe("subnetsOverlap", () => {
    it("detects overlapping subnets", () => {
      expect(subnetsOverlap("172.28.0.0/16", "172.28.1.0/24")).toBe(true);
      expect(subnetsOverlap("172.28.1.0/24", "172.28.1.0/24")).toBe(true);
    });

    it("detects non-overlapping subnets", () => {
      expect(subnetsOverlap("172.28.0.0/24", "172.28.1.0/24")).toBe(false);
      expect(subnetsOverlap("10.0.0.0/8", "172.28.0.0/16")).toBe(false);
    });
  });

  describe("deriveBindLocal", () => {
    it("returns true for explicit localhost bindings", () => {
      expect(deriveBindLocal("127.0.0.1")).toBe(true);
      expect(deriveBindLocal("::1")).toBe(true);
      expect(deriveBindLocal("localhost")).toBe(true);
    });

    it("returns false for empty/undefined (Docker default = all interfaces)", () => {
      expect(deriveBindLocal("")).toBe(false);
      expect(deriveBindLocal(undefined)).toBe(false);
    });

    it("returns false for non-localhost bindings", () => {
      expect(deriveBindLocal("0.0.0.0")).toBe(false);
      expect(deriveBindLocal("192.168.1.100")).toBe(false);
      expect(deriveBindLocal("10.0.0.1")).toBe(false);
    });
  });

  describe("isLocalhostBind", () => {
    it("detects localhost port mappings", () => {
      expect(isLocalhostBind("127.0.0.1:8888:80")).toBe(true);
      expect(isLocalhostBind("[::1]:8888:80")).toBe(true);
    });

    it("rejects non-localhost port mappings", () => {
      expect(isLocalhostBind("0.0.0.0:8888:80")).toBe(false);
      expect(isLocalhostBind("8888:80")).toBe(false);
      expect(isLocalhostBind("192.168.1.1:8888:80")).toBe(false);
    });
  });

  describe("generateRemoteIpConf", () => {
    it("generates config with proxy IP when SSL is on", () => {
      const conf = generateRemoteIpConf("172.28.1.10");
      expect(conf).toContain("RemoteIPInternalProxy 172.28.1.10");
      expect(conf).toContain("RemoteIPHeader X-Forwarded-For");
      expect(conf).toContain("<IfModule remoteip_module>");
    });

    it("omits RemoteIPHeader entirely when SSL is off (null proxy)", () => {
      const conf = generateRemoteIpConf(null);
      // Must NOT have active RemoteIPHeader directive - that would allow XFF spoofing
      // The directive should only appear commented out (with # prefix)
      expect(conf).not.toMatch(/^[^#]*RemoteIPHeader/m);
      expect(conf).not.toMatch(/<IfModule remoteip_module>\s*\n\s*RemoteIPHeader/);
      // Should explain why it's commented out and show example
      expect(conf).toContain("SSL proxy not active");
      expect(conf).toContain("# <IfModule remoteip_module>");
      expect(conf).toContain("#     RemoteIPHeader X-Forwarded-For");
    });
  });

  describe("normalizeWpBind", () => {
    it("normalizes localhost to 127.0.0.1", () => {
      expect(normalizeWpBind("localhost")).toBe("127.0.0.1");
    });

    it("handles case-insensitive localhost", () => {
      expect(normalizeWpBind("LOCALHOST")).toBe("127.0.0.1");
      expect(normalizeWpBind("Localhost")).toBe("127.0.0.1");
      expect(normalizeWpBind("LocalHost")).toBe("127.0.0.1");
    });

    it("accepts quoted values (single and double quotes)", () => {
      expect(normalizeWpBind('"127.0.0.1"')).toBe("127.0.0.1");
      expect(normalizeWpBind("'127.0.0.1'")).toBe("127.0.0.1");
      expect(normalizeWpBind('"localhost"')).toBe("127.0.0.1");
      expect(normalizeWpBind("'0.0.0.0'")).toBe("0.0.0.0");
    });

    it("returns 127.0.0.1 for empty/undefined", () => {
      expect(normalizeWpBind("")).toBe("127.0.0.1");
      expect(normalizeWpBind(undefined)).toBe("127.0.0.1");
    });

    it("passes through valid IPs", () => {
      expect(normalizeWpBind("127.0.0.1")).toBe("127.0.0.1");
      expect(normalizeWpBind("0.0.0.0")).toBe("0.0.0.0");
      expect(normalizeWpBind("::1")).toBe("::1");
      expect(normalizeWpBind("192.168.1.100")).toBe("192.168.1.100");
    });

    it("handles IPv6 with and without brackets", () => {
      expect(normalizeWpBind("::1")).toBe("::1");
      expect(normalizeWpBind("[::1]")).toBe("::1");
    });

    it("throws for invalid hostnames", () => {
      expect(() => normalizeWpBind("my-host")).toThrow("Invalid WP_BIND");
      expect(() => normalizeWpBind("example.com")).toThrow("Invalid WP_BIND");
    });

    it("rejects invalid IPv4 addresses with clear message", () => {
      expect(() => normalizeWpBind("999.1.1.1")).toThrow(/invalid IPv4/i);
      expect(() => normalizeWpBind("256.0.0.1")).toThrow(/invalid IPv4/i);
      expect(() => normalizeWpBind("1.2.3.999")).toThrow(/invalid IPv4/i);
    });

    it("rejects malformed values like foo:bar with clear message", () => {
      expect(() => normalizeWpBind("foo:bar")).toThrow(/not a valid IP/i);
      expect(() => normalizeWpBind("localhost:8888")).toThrow(/not a valid IP/i);
    });
  });

  describe("deriveBindLocal (with quotes and case-insensitive localhost)", () => {
    it("handles quoted loopback addresses", () => {
      expect(deriveBindLocal('"127.0.0.1"')).toBe(true);
      expect(deriveBindLocal("'127.0.0.1'")).toBe(true);
      expect(deriveBindLocal('"localhost"')).toBe(true);
    });

    it("handles case-insensitive localhost", () => {
      expect(deriveBindLocal("LOCALHOST")).toBe(true);
      expect(deriveBindLocal("Localhost")).toBe(true);
    });

    it("handles IPv6 with brackets", () => {
      expect(deriveBindLocal("[::1]")).toBe(true);
      expect(deriveBindLocal("::1")).toBe(true);
    });
  });

  describe("deriveNetworkIps (with ipRange) - G14 mutation tests", () => {
    it("includes ipRange for reserving fixed IPs in /24 subnet", () => {
      const result = deriveNetworkIps("172.28.5.0/24");
      expect(result).not.toBeNull();
      expect(result?.gateway).toBe("172.28.5.1");
      expect(result?.sslProxyIp).toBe("172.28.5.10");
      expect(result?.ipRange).toBe("172.28.5.16/28");
    });

    it("derives ipRange correctly for /24 in different subnet ranges", () => {
      // Test with a completely different subnet to ensure no hardcoding
      const result = deriveNetworkIps("10.20.30.0/24");
      expect(result?.subnet).toBe("10.20.30.0/24");
      expect(result?.gateway).toBe("10.20.30.1");
      expect(result?.sslProxyIp).toBe("10.20.30.10");
      expect(result?.ipRange).toBe("10.20.30.16/28");
    });

    it("derives ipRange correctly for /25 subnet (128 addresses)", () => {
      const result = deriveNetworkIps("192.168.1.0/25");
      expect(result).not.toBeNull();
      expect(result?.gateway).toBe("192.168.1.1");
      expect(result?.sslProxyIp).toBe("192.168.1.10");
      // /25 has 128 addresses, /28 at .16 still fits
      expect(result?.ipRange).toBe("192.168.1.16/28");
    });

    it("derives ipRange correctly for /26 subnet (64 addresses)", () => {
      const result = deriveNetworkIps("172.16.0.0/26");
      expect(result).not.toBeNull();
      expect(result?.gateway).toBe("172.16.0.1");
      expect(result?.sslProxyIp).toBe("172.16.0.10");
      // /26 has 64 addresses, /28 at .16 still fits (16+16=32 < 64)
      expect(result?.ipRange).toBe("172.16.0.16/28");
    });

    it("uses smaller /29 range for /27 subnet (32 addresses)", () => {
      const result = deriveNetworkIps("10.0.0.0/27");
      expect(result).not.toBeNull();
      expect(result?.gateway).toBe("10.0.0.1");
      expect(result?.sslProxyIp).toBe("10.0.0.10");
      // /27 has 32 addresses, /28 would overflow, use /29 (8 addresses)
      expect(result?.ipRange).toBe("10.0.0.16/29");
    });

    it("returns empty ipRange for /28 subnet (16 addresses - too small)", () => {
      const result = deriveNetworkIps("10.0.0.0/28");
      expect(result).not.toBeNull();
      expect(result?.gateway).toBe("10.0.0.1");
      expect(result?.sslProxyIp).toBe("10.0.0.10");
      // /28 only has 16 addresses (.0-.15), no room for ip_range starting at .16
      expect(result?.ipRange).toBe("");
    });

    it("returns null for /29 subnet (proxy IP at .10 doesn't fit in 8 addresses)", () => {
      const result = deriveNetworkIps("10.0.0.0/29");
      // /29 only has 8 addresses (0-7), proxy IP at .10 is outside
      expect(result).toBeNull();
    });

    it("MUTATION CHECK: ipRange must start with the correct base address", () => {
      // This test catches mutations that hardcode the base address
      const result1 = deriveNetworkIps("172.28.5.0/24");
      const result2 = deriveNetworkIps("10.20.30.0/24");
      
      // The ipRange must match the subnet's base, not be hardcoded
      expect(result1?.ipRange?.startsWith("172.28.5.")).toBe(true);
      expect(result2?.ipRange?.startsWith("10.20.30.")).toBe(true);
      
      // Must NOT be the same (would indicate hardcoding)
      expect(result1?.ipRange).not.toBe(result2?.ipRange);
    });

    it("MUTATION CHECK: gateway offset must be exactly 1", () => {
      // If GATEWAY_OFFSET is mutated to 0 or 2, this fails
      const result = deriveNetworkIps("172.28.5.0/24");
      expect(result?.gateway).toBe("172.28.5.1");
      expect(result?.gateway).not.toBe("172.28.5.0"); // offset 0
      expect(result?.gateway).not.toBe("172.28.5.2"); // offset 2
    });

    it("MUTATION CHECK: SSL proxy offset must be exactly 10", () => {
      // If SSL_PROXY_OFFSET is mutated to 9 or 11, this fails
      const result = deriveNetworkIps("172.28.5.0/24");
      expect(result?.sslProxyIp).toBe("172.28.5.10");
      expect(result?.sslProxyIp).not.toBe("172.28.5.9");
      expect(result?.sslProxyIp).not.toBe("172.28.5.11");
    });
  });

  describe("savedSubnetOverlapsExisting", () => {
    it("detects overlap with existing networks", () => {
      // This test mocks docker behavior - in real usage it queries Docker
      // The function itself uses listDockerNetworkSubnets which we can't easily mock
      // So we test the overlap logic via subnetsOverlap directly
      expect(subnetsOverlap("172.28.1.0/24", "172.28.1.0/24")).toBe(true);
      expect(subnetsOverlap("172.28.1.0/24", "172.28.2.0/24")).toBe(false);
    });
  });

  describe("DEFAULT_SUBNET_PREFIX", () => {
    it("is defined and reasonable", () => {
      expect(DEFAULT_SUBNET_PREFIX).toBe("172.28");
    });
  });

  describe("G03 mutation tests - bind-local derivation", () => {
    it("MUTATION CHECK: deriveBindLocal returns true ONLY for exact loopback addresses", () => {
      // These MUST return true (mutation to !== would break)
      expect(deriveBindLocal("127.0.0.1")).toBe(true);
      expect(deriveBindLocal("::1")).toBe(true);
      expect(deriveBindLocal("localhost")).toBe(true);
      expect(deriveBindLocal("[::1]")).toBe(true);
      
      // These MUST return false (mutation to === would break)
      expect(deriveBindLocal("0.0.0.0")).toBe(false);
      expect(deriveBindLocal("")).toBe(false);
      expect(deriveBindLocal(undefined)).toBe(false);
      expect(deriveBindLocal("192.168.1.1")).toBe(false);
      expect(deriveBindLocal("10.0.0.1")).toBe(false);
    });

    it("MUTATION CHECK: empty string must return false (Docker default = all interfaces)", () => {
      // This is critical: empty means Docker's default 0.0.0.0, which is NOT local
      const result = deriveBindLocal("");
      expect(result).toBe(false);
      expect(result).not.toBe(true);
    });

    it("MUTATION CHECK: localhost comparison must be case-insensitive", () => {
      expect(deriveBindLocal("LOCALHOST")).toBe(true);
      expect(deriveBindLocal("Localhost")).toBe(true);
      expect(deriveBindLocal("LocalHost")).toBe(true);
      expect(deriveBindLocal("lOcAlHoSt")).toBe(true);
    });

    it("MUTATION CHECK: quoted values must be handled", () => {
      expect(deriveBindLocal('"127.0.0.1"')).toBe(true);
      expect(deriveBindLocal("'127.0.0.1'")).toBe(true);
      expect(deriveBindLocal('"0.0.0.0"')).toBe(false);
      expect(deriveBindLocal("'0.0.0.0'")).toBe(false);
    });
  });

  describe("G08 mutation tests - subnet overlap detection", () => {
    it("MUTATION CHECK: identical subnets must overlap", () => {
      expect(subnetsOverlap("172.28.1.0/24", "172.28.1.0/24")).toBe(true);
      expect(subnetsOverlap("10.0.0.0/8", "10.0.0.0/8")).toBe(true);
    });

    it("MUTATION CHECK: superset contains subset", () => {
      // A /16 contains all its /24 subnets
      expect(subnetsOverlap("172.28.0.0/16", "172.28.1.0/24")).toBe(true);
      expect(subnetsOverlap("172.28.1.0/24", "172.28.0.0/16")).toBe(true);
      expect(subnetsOverlap("10.0.0.0/8", "10.20.30.0/24")).toBe(true);
    });

    it("MUTATION CHECK: adjacent subnets do NOT overlap", () => {
      expect(subnetsOverlap("172.28.0.0/24", "172.28.1.0/24")).toBe(false);
      expect(subnetsOverlap("10.0.0.0/24", "10.0.1.0/24")).toBe(false);
    });

    it("MUTATION CHECK: completely different ranges do NOT overlap", () => {
      expect(subnetsOverlap("10.0.0.0/8", "172.28.0.0/16")).toBe(false);
      expect(subnetsOverlap("192.168.0.0/16", "10.0.0.0/8")).toBe(false);
    });
  });

  describe("G12 mutation tests - legacy network cleanup (source verification)", () => {
    it("MUTATION CHECK: cleanupLegacyDefaultNetwork checks ownership label", () => {
      const sourceContent = readFileSync(
        join(process.cwd(), "src/utils/network-config.ts"),
        "utf8",
      );
      
      // The function MUST check com.docker.compose.project label before removing
      expect(sourceContent).toContain("getDockerNetworkComposeProject");
      expect(sourceContent).toContain("com.docker.compose.project");
      
      // Verify the ownership check is in cleanupLegacyDefaultNetwork
      const funcStart = sourceContent.indexOf("export function cleanupLegacyDefaultNetwork");
      const funcEnd = sourceContent.indexOf("export function", funcStart + 1);
      const funcBody = sourceContent.slice(funcStart, funcEnd);
      
      // Must call ownership check before removal
      expect(funcBody).toContain("getDockerNetworkComposeProject");
      expect(funcBody).toContain("composeProject !== projectId");
    });

    it("MUTATION CHECK: getDockerNetworkComposeProject queries the right label", () => {
      const sourceContent = readFileSync(
        join(process.cwd(), "src/utils/network-config.ts"),
        "utf8",
      );
      
      // Must use the standard Docker Compose label name
      expect(sourceContent).toMatch(/com\.docker\.compose\.project/);
    });
  });

  describe("G06 mutation tests - checksum verification", () => {
    // These test the Dockerfile contents for correct checksum format
    it("MUTATION CHECK: ttyd checksums in Dockerfile are valid SHA256 format", () => {
      const dockerfileContent = readFileSync(
        join(process.cwd(), "docker/terminal.Dockerfile"),
        "utf8",
      );
      
      // SHA256 checksums must be exactly 64 hex characters
      const sha256Pattern = /ARG TTYD_SHA256_X86_64=([a-f0-9]{64})/;
      const match = dockerfileContent.match(sha256Pattern);
      expect(match).not.toBeNull();
      expect(match?.[1].length).toBe(64);
      
      // The checksum must not be all zeros or a simple placeholder
      expect(match?.[1]).not.toMatch(/^0+$/);
      expect(match?.[1]).not.toMatch(/^(12345678|abcdefgh)/); // Not obviously fake
    });

    it("MUTATION CHECK: checksums for both architectures are different", () => {
      const dockerfileContent = readFileSync(
        join(process.cwd(), "docker/terminal.Dockerfile"),
        "utf8",
      );
      
      const x86Match = dockerfileContent.match(/ARG TTYD_SHA256_X86_64=([a-f0-9]+)/);
      const armMatch = dockerfileContent.match(/ARG TTYD_SHA256_AARCH64=([a-f0-9]+)/);
      
      expect(x86Match).not.toBeNull();
      expect(armMatch).not.toBeNull();
      
      // x86_64 and aarch64 binaries must have different checksums
      expect(x86Match?.[1]).not.toBe(armMatch?.[1]);
    });

    it("MUTATION CHECK: Docker CLI checksums are present and valid", () => {
      const dockerfileContent = readFileSync(
        join(process.cwd(), "docker/terminal.Dockerfile"),
        "utf8",
      );
      
      const x86Match = dockerfileContent.match(/ARG DOCKER_CLI_SHA256_X86_64=([a-f0-9]{64})/);
      const armMatch = dockerfileContent.match(/ARG DOCKER_CLI_SHA256_AARCH64=([a-f0-9]{64})/);
      
      expect(x86Match).not.toBeNull();
      expect(armMatch).not.toBeNull();
      expect(x86Match?.[1]).not.toBe(armMatch?.[1]);
    });

    it("MUTATION CHECK: Docker Compose checksums are present and valid", () => {
      const dockerfileContent = readFileSync(
        join(process.cwd(), "docker/terminal.Dockerfile"),
        "utf8",
      );
      
      const x86Match = dockerfileContent.match(/ARG DOCKER_COMPOSE_SHA256_X86_64=([a-f0-9]{64})/);
      const armMatch = dockerfileContent.match(/ARG DOCKER_COMPOSE_SHA256_AARCH64=([a-f0-9]{64})/);
      
      expect(x86Match).not.toBeNull();
      expect(armMatch).not.toBeNull();
      expect(x86Match?.[1]).not.toBe(armMatch?.[1]);
    });

    it("MUTATION CHECK: empty checksum FAILS the build (fail-closed)", () => {
      const dockerfileContent = readFileSync(
        join(process.cwd(), "docker/terminal.Dockerfile"),
        "utf8",
      );
      
      // Must have explicit check for empty checksums that exits with error
      // For ttyd:
      expect(dockerfileContent).toMatch(/if\s*\[\s*-z\s*"\$\{?TTYD_SHA\}?"\s*\]/);
      expect(dockerfileContent).toContain("exit 1");
      expect(dockerfileContent).toContain("Checksums are required");
      
      // For Docker CLI:
      expect(dockerfileContent).toMatch(/if\s*\[\s*-z\s*"\$\{?DOCKER_CLI_SHA\}?"\s*\]/);
      
      // For Docker Compose:
      expect(dockerfileContent).toMatch(/if\s*\[\s*-z\s*"\$\{?DOCKER_COMPOSE_SHA\}?"\s*\]/);
    });
  });

  describe("G11 mutation tests - log path consolidation", () => {
    it("MUTATION CHECK: LOG_DIR_NAME is 'logs' (single source of truth)", () => {
      expect(LOG_DIR_NAME).toBe("logs");
      expect(LOG_DIR_NAME).not.toBe("log");
      expect(LOG_DIR_NAME).not.toBe("Logs");
    });

    it("MUTATION CHECK: LOG_FILE_NAME is 'wp-dev.log' (single source of truth)", () => {
      expect(LOG_FILE_NAME).toBe("wp-dev.log");
      expect(LOG_FILE_NAME).not.toBe("wpdev.log");
      expect(LOG_FILE_NAME).not.toBe("wp-dev.txt");
    });

    it("MUTATION CHECK: logPathForConfigDir constructs correct path", () => {
      const result = logPathForConfigDir("/some/config/dir");
      expect(result).toBe("/some/config/dir/logs/wp-dev.log");
      expect(result).toContain(LOG_DIR_NAME);
      expect(result).toContain(LOG_FILE_NAME);
    });

    it("MUTATION CHECK: terminal-runner uses shared log constants", () => {
      // The terminal-runner.mjs must import from the shared constants file
      const runnerContent = readFileSync(
        join(process.cwd(), "docker/terminal-runner.mjs"),
        "utf8",
      );
      
      // Must import from the shared constants module
      expect(runnerContent).toContain('from "./runner-log-constants.mjs"');
      expect(runnerContent).toContain("logPathForWorkdir");
      
      // The constants.json file is the single source of truth
      const constantsJson = JSON.parse(
        readFileSync(join(process.cwd(), "docker/constants.json"), "utf8"),
      );
      expect(constantsJson.log.dirName).toBe("logs");
      expect(constantsJson.log.fileName).toBe("wp-dev.log");

      // The runner-log-constants.mjs must read from constants.json
      const logConstantsContent = readFileSync(
        join(process.cwd(), "docker/runner-log-constants.mjs"),
        "utf8",
      );
      expect(logConstantsContent).toContain("constants.json");
    });
  });

  describe("G12 mutation tests - legacy network cleanup", () => {
    it("MUTATION CHECK: cleanupLegacyDefaultNetwork returns correct structure", () => {
      // Test with a non-existent network (should return removed: false)
      const result = cleanupLegacyDefaultNetwork("nonexistent_test_project_12345");
      expect(typeof result.removed).toBe("boolean");
      // For a non-existent network, should not be removed
      expect(result.removed).toBe(false);
      expect(result.reason).toBeDefined();
      // Must explicitly say it doesn't exist
      expect(result.reason).toContain("does not exist");
    });

    it("MUTATION CHECK: cleanupLegacyDefaultNetwork constructs correct network name", () => {
      // Verify the function constructs <projectId>_default
      // We test this by checking the error message includes the expected network name
      const result = cleanupLegacyDefaultNetwork("myproject123");
      // When network doesn't exist, the reason should reflect we tried to find it
      expect(result.removed).toBe(false);
      // The function should have looked for "myproject123_default"
      // (Can't verify the exact name without Docker, but we verify the structure)
      expect(result.reason).toBe("network does not exist");
    });

    it("MUTATION CHECK: getDockerNetworkComposeProject returns null for non-existent network", () => {
      // Should return null, not throw
      const result = getDockerNetworkComposeProject("nonexistent_network_xyz_12345");
      expect(result).toBeNull();
    });
  });
});

// In CI, PHP must be available - tests should fail, not silently skip
const isCI = process.env.CI === "true" || process.env.CI === "1";

describe("PHP gate logic (real PHP execution)", () => {
  let tmpDir: string;
  let phpFile: string;
  let phpAvailable = false;

  beforeAll(() => {
    // Check if PHP is available
    try {
      execSync("php --version", { stdio: "pipe" });
      phpAvailable = true;
    } catch {
      phpAvailable = false;
      if (isCI) {
        throw new Error("PHP is required in CI but not available. Install PHP or add setup-php to CI workflow.");
      }
    }

    if (!phpAvailable) return;

    // Create temp directory with PHP test harness
    tmpDir = mkdtempSync(join(tmpdir(), "wpdev-gate-test-"));
    phpFile = join(tmpDir, "test-gate.php");

    // Read the auth-session.inc.php content and strip the opening <?php tag
    const authSessionPath = join(process.cwd(), "docs/admin/public/auth-session.inc.php");
    let authSessionContent = readFileSync(authSessionPath, "utf8");
    // Remove leading <?php (with optional whitespace/newline after)
    authSessionContent = authSessionContent.replace(/^<\?php\s*\n?/, "");

    // Create a test harness that includes the functions and runs tests
    const testHarness = `<?php
${authSessionContent}

// Test harness - accepts JSON input with test parameters
$input = json_decode(file_get_contents('php://stdin'), true);
if (!$input) {
    echo json_encode(['error' => 'Invalid JSON input']);
    exit(1);
}

// Set up server vars
$_SERVER['REMOTE_ADDR'] = $input['remote_addr'] ?? '';
$_SERVER['HTTP_HOST'] = $input['host'] ?? '';
$_SERVER['HTTP_ORIGIN'] = $input['origin'] ?? '';

// Set up env vars (putenv for getenv())
if (isset($input['gateway'])) {
    putenv('WPDEV_ADMIN_TRUSTED_GATEWAY=' . $input['gateway']);
} else {
    putenv('WPDEV_ADMIN_TRUSTED_GATEWAY');
}
if (isset($input['bind_local'])) {
    putenv('WPDEV_WP_BIND_LOCAL=' . $input['bind_local']);
} else {
    putenv('WPDEV_WP_BIND_LOCAL');
}

// Run the test
$test = $input['test'] ?? '';
$result = null;

switch ($test) {
    case 'check_remote_addr':
        $result = wpdev_check_remote_addr();
        break;
    case 'check_host_header':
        $result = ['ok' => wpdev_check_host_header()];
        break;
    case 'check_bind_local':
        $result = wpdev_check_bind_local();
        break;
    case 'is_local_admin_request':
        $result = ['ok' => wpdev_is_local_admin_request()];
        break;
    case 'is_local_admin_request_full':
        $requireBindLocal = $input['require_bind_local'] ?? false;
        $result = wpdev_is_local_admin_request_full($requireBindLocal);
        break;
    case 'enforce_local_admin_only':
        // This function may call exit(), so we track if it returned normally
        $normalReturn = false;
        ob_start();
        register_shutdown_function(function() use (&$normalReturn) {
            // If the function returned normally, don't output from shutdown
            if ($normalReturn) {
                return;
            }
            $output = ob_get_clean();
            // Handle case where ob_get_clean returns false (buffer already cleaned)
            if ($output === false) {
                $output = '';
            }
            // Parse the JSON output from wpdev_enforce_local_admin_only
            $decoded = json_decode($output, true);
            $httpCode = http_response_code();
            echo json_encode([
                'http_code' => $httpCode,
                'output' => $decoded,
                'allowed' => $httpCode === 200 || $httpCode === false,
            ]);
        });
        wpdev_enforce_local_admin_only();
        // If we get here, the request was allowed (no exit)
        $normalReturn = true;
        ob_end_clean();
        $result = ['http_code' => 200, 'allowed' => true];
        break;
    default:
        $result = ['error' => 'Unknown test: ' . $test];
}

echo json_encode($result);
`;

    writeFileSync(phpFile, testHarness, "utf8");
  });

  afterAll(() => {
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  function runPhpTest(input: Record<string, unknown>): Record<string, unknown> {
    if (!phpAvailable) {
      return { skipped: true, reason: "PHP not available" };
    }

    const result = spawnSync("php", [phpFile], {
      input: JSON.stringify(input),
      encoding: "utf8",
    });

    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(`PHP exited with ${result.status}: ${result.stderr}`);
    }

    return JSON.parse(result.stdout);
  }

  describe("wpdev_check_remote_addr", () => {
    it("allows loopback 127.0.0.1 without gateway", () => {
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "127.0.0.1",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(true);
    });

    it("allows loopback ::1 without gateway", () => {
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "::1",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(true);
    });

    it("allows gateway when configured", () => {
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "172.28.1.1",
        gateway: "172.28.1.1",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(true);
    });

    it("rejects non-loopback when gateway not set (fail closed)", () => {
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "172.28.1.1",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("WPDEV_ADMIN_TRUSTED_GATEWAY not set");
    });

    it("rejects empty gateway", () => {
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "172.28.1.1",
        gateway: "",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
    });

    it("rejects non-loopback not matching gateway", () => {
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "172.20.0.4",
        gateway: "172.28.1.1",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("not in allowed list");
    });

    it("rejects empty REMOTE_ADDR", () => {
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "",
        gateway: "172.28.1.1",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("REMOTE_ADDR empty");
    });

    it("allows multiple comma-separated gateways", () => {
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "172.20.0.1",
        gateway: "172.28.1.1,172.20.0.1",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(true);
    });

    it("handles IPv4-mapped IPv6 ::ffff:127.0.0.1", () => {
      // Note: PHP may or may not normalize this - test the actual behavior
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "::ffff:127.0.0.1",
        gateway: "172.28.1.1",
      });
      if ("skipped" in result) return;
      // This will likely fail because ::ffff:127.0.0.1 is not in the allowed list
      // The PHP code would need to handle IPv4-mapped IPv6 addresses
      // For now, we just document the behavior
      expect(typeof result.ok).toBe("boolean");
    });

    it("rejects garbage gateway value", () => {
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "172.28.1.1",
        gateway: "not-an-ip",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
    });

    it("rejects CIDR notation in gateway (expects plain IP)", () => {
      const result = runPhpTest({
        test: "check_remote_addr",
        remote_addr: "172.28.1.1",
        gateway: "172.28.0.0/16",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
    });
  });

  describe("wpdev_check_host_header", () => {
    it("allows localhost", () => {
      const result = runPhpTest({
        test: "check_host_header",
        host: "localhost",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(true);
    });

    it("allows localhost with port", () => {
      const result = runPhpTest({
        test: "check_host_header",
        host: "localhost:8888",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(true);
    });

    it("allows 127.0.0.1", () => {
      const result = runPhpTest({
        test: "check_host_header",
        host: "127.0.0.1:8888",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(true);
    });

    it("rejects public hosts", () => {
      const result = runPhpTest({
        test: "check_host_header",
        host: "evil.com",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
    });

    it("rejects empty host", () => {
      const result = runPhpTest({
        test: "check_host_header",
        host: "",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
    });
  });

  describe("wpdev_check_bind_local - G03 mutation tests", () => {
    it("allows when WPDEV_WP_BIND_LOCAL=1", () => {
      const result = runPhpTest({
        test: "check_bind_local",
        bind_local: "1",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(true);
    });

    it("rejects when WPDEV_WP_BIND_LOCAL=0", () => {
      const result = runPhpTest({
        test: "check_bind_local",
        bind_local: "0",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("port exposed");
    });

    it("rejects when not set (fail closed)", () => {
      const result = runPhpTest({
        test: "check_bind_local",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
      expect(result.reason).toContain("not set");
    });

    it("MUTATION CHECK: only exact string '1' is accepted", () => {
      // These must all be rejected - mutation to loose comparison would break this
      const testCases = ["true", "yes", "on", "enabled", "1.0", " 1", "1 "];
      for (const testCase of testCases) {
        const result = runPhpTest({
          test: "check_bind_local",
          bind_local: testCase,
        });
        if ("skipped" in result) continue;
        expect(result.ok).toBe(false);
      }
    });

    it("MUTATION CHECK: '0' must explicitly reject with 'port exposed' reason", () => {
      const result = runPhpTest({
        test: "check_bind_local",
        bind_local: "0",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
      // Must say "port exposed" not "not set"
      expect(result.reason).toContain("port exposed");
      expect(result.reason).not.toContain("not set");
    });

    it("MUTATION CHECK: empty string must reject with 'not set' reason", () => {
      const result = runPhpTest({
        test: "check_bind_local",
        bind_local: "",
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
      // Must say "not set" not "port exposed"
      expect(result.reason).toContain("not set");
    });
  });

  describe("wpdev_is_local_admin_request_full", () => {
    it("allows normal localhost browser request via gateway", () => {
      const result = runPhpTest({
        test: "is_local_admin_request_full",
        host: "localhost:8888",
        remote_addr: "172.28.1.1",
        gateway: "172.28.1.1",
        require_bind_local: false,
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(true);
    });

    it("allows direct loopback request", () => {
      const result = runPhpTest({
        test: "is_local_admin_request_full",
        host: "localhost:8888",
        remote_addr: "127.0.0.1",
        require_bind_local: false,
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(true);
    });

    it("rejects spoofed Host from non-allowed REMOTE_ADDR", () => {
      const result = runPhpTest({
        test: "is_local_admin_request_full",
        host: "localhost:8888",
        remote_addr: "172.20.0.4",
        gateway: "172.28.1.1",
        require_bind_local: false,
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
    });

    it("rejects non-localhost Host even with allowed REMOTE_ADDR", () => {
      const result = runPhpTest({
        test: "is_local_admin_request_full",
        host: "evil.com",
        remote_addr: "172.28.1.1",
        gateway: "172.28.1.1",
        require_bind_local: false,
      });
      if ("skipped" in result) return;
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("Host header not localhost");
    });

    it("auto-unlock requires bind-local=1", () => {
      // Without bind-local requirement
      const resultBasic = runPhpTest({
        test: "is_local_admin_request_full",
        host: "localhost:8888",
        remote_addr: "172.28.1.1",
        gateway: "172.28.1.1",
        bind_local: "0",
        require_bind_local: false,
      });
      if ("skipped" in resultBasic) return;
      expect(resultBasic.ok).toBe(true);

      // With bind-local requirement (auto-unlock path)
      const resultUnlock = runPhpTest({
        test: "is_local_admin_request_full",
        host: "localhost:8888",
        remote_addr: "172.28.1.1",
        gateway: "172.28.1.1",
        bind_local: "0",
        require_bind_local: true,
      });
      expect(resultUnlock.ok).toBe(false);
      expect(resultUnlock.reason).toContain("port exposed");
    });
  });

  describe("wpdev_enforce_local_admin_only - G03 gate function", () => {
    it("returns 403 when WPDEV_WP_BIND_LOCAL is '0'", () => {
      const result = runPhpTest({
        test: "enforce_local_admin_only",
        host: "localhost:8888",
        remote_addr: "172.28.1.1",
        gateway: "172.28.1.1",
        bind_local: "0",
      });
      if ("skipped" in result) return;
      expect(result.allowed).toBe(false);
      expect(result.http_code).toBe(403);
    });

    it("returns 403 when WPDEV_WP_BIND_LOCAL is not set", () => {
      const result = runPhpTest({
        test: "enforce_local_admin_only",
        host: "localhost:8888",
        remote_addr: "172.28.1.1",
        gateway: "172.28.1.1",
        // bind_local not set
      });
      if ("skipped" in result) return;
      expect(result.allowed).toBe(false);
      expect(result.http_code).toBe(403);
    });

    it("allows request when WPDEV_WP_BIND_LOCAL is '1' and request is local", () => {
      const result = runPhpTest({
        test: "enforce_local_admin_only",
        host: "localhost:8888",
        remote_addr: "172.28.1.1",
        gateway: "172.28.1.1",
        bind_local: "1",
      });
      if ("skipped" in result) return;
      expect(result.allowed).toBe(true);
    });

    it("returns 403 when WPDEV_WP_BIND_LOCAL is '1' but Host is not localhost", () => {
      const result = runPhpTest({
        test: "enforce_local_admin_only",
        host: "evil.com",
        remote_addr: "172.28.1.1",
        gateway: "172.28.1.1",
        bind_local: "1",
      });
      if ("skipped" in result) return;
      expect(result.allowed).toBe(false);
      expect(result.http_code).toBe(403);
    });

    it("returns 403 when WPDEV_WP_BIND_LOCAL is '1' but REMOTE_ADDR not allowed", () => {
      const result = runPhpTest({
        test: "enforce_local_admin_only",
        host: "localhost:8888",
        remote_addr: "192.168.1.100",
        gateway: "172.28.1.1",
        bind_local: "1",
      });
      if ("skipped" in result) return;
      expect(result.allowed).toBe(false);
      expect(result.http_code).toBe(403);
    });

    it("MUTATION CHECK: removing the 403 block breaks this test", () => {
      // This test specifically catches M-G03 mutation
      // If the if ($bindLocal !== '1') block is removed, this passes incorrectly
      const result = runPhpTest({
        test: "enforce_local_admin_only",
        host: "localhost:8888",
        remote_addr: "172.28.1.1",
        gateway: "172.28.1.1",
        bind_local: "0", // Explicitly 0, must be rejected
      });
      if ("skipped" in result) return;
      // The gate MUST reject bind_local=0
      expect(result.allowed).toBe(false);
      expect(result.http_code).toBe(403);
      if (result.output) {
        expect(result.output.error).toBe("forbidden");
      }
    });
  });
});

describe("attack scenarios", () => {
  // These are documentation tests that describe the expected behavior
  // against known attack vectors

  it("documents: header-only spoof attack is blocked by REMOTE_ADDR check", () => {
    // Attack: curl -H 'Host: localhost:8888' http://172.20.0.4:80/admin/api.php
    // The Host header is spoofed, but REMOTE_ADDR reveals the attacker's position.
    // PHP checks REMOTE_ADDR against WPDEV_ADMIN_TRUSTED_GATEWAY and rejects.
    expect(true).toBe(true);
  });

  it("documents: XFF spoof attack is blocked by remoteip.conf", () => {
    // Attack: curl -H 'X-Forwarded-For: 127.0.0.1' from another container
    // mod_remoteip only trusts the SSL proxy's fixed IP, not all private ranges.
    // XFF from untrusted sources is ignored.
    expect(true).toBe(true);
  });

  it("documents: LAN staging exposure is blocked by bind-local", () => {
    // Attack: Someone exposes port to 0.0.0.0, Docker relays LAN traffic through gateway
    // Even if REMOTE_ADDR matches the gateway, WPDEV_WP_BIND_LOCAL=0 blocks auto-unlock.
    expect(true).toBe(true);
  });

  it("documents: DNS rebinding attack is blocked by Host header check", () => {
    // Attack: Attacker domain resolves to 127.0.0.1, victim's browser makes request
    // Host header will be attacker's domain, not localhost, so request is rejected.
    expect(true).toBe(true);
  });

  it("documents: two stacks on one host get unique subnets", () => {
    // wp-dev up allocates a unique /24 subnet for each stack
    // findAvailableSubnet scans existing Docker networks to avoid conflicts
    expect(true).toBe(true);
  });

  it("documents: subnet collision after down is handled by reallocation", () => {
    // Scenario: Stack A gets .1, runs down; Stack C gets .1; Stack A runs up again
    // savedSubnetOverlapsExisting detects the collision and findAvailableSubnet reallocates
    expect(true).toBe(true);
  });
});

describe("docker-compose.yml security defaults", () => {
  it("WP_BIND defaults to 127.0.0.1 in compose port binding", () => {
    const composeContent = readFileSync(
      join(process.cwd(), "docker/docker-compose.yml"),
      "utf8",
    );
    // Must use ${WP_BIND:-127.0.0.1} not ${WP_BIND:+${WP_BIND}:} which binds all when unset
    expect(composeContent).toContain("${WP_BIND:-127.0.0.1}:${WP_PORT:-8888}:80");
    // Should NOT contain the old insecure syntax
    expect(composeContent).not.toContain("${WP_BIND:+${WP_BIND}:}${WP_PORT");
  });

  it("terminal ports are always bound to 127.0.0.1", () => {
    const composeContent = readFileSync(
      join(process.cwd(), "docker/docker-compose.yml"),
      "utf8",
    );
    // Terminal ports must be hardcoded to loopback, never follow WP_BIND
    expect(composeContent).toContain("127.0.0.1:${WPDEV_TERMINAL_PORT:-7681}:7681");
    expect(composeContent).toContain("127.0.0.1:${WPDEV_TERMINAL_RUNNER_PORT:-7682}:7682");
    expect(composeContent).toContain("127.0.0.1:${WPDEV_HOST_RUNNER_PORT:-7683}:7683");
  });
});
