import { describe, expect, it } from "vitest";

/**
 * Gate 0 security tests for wp-dev admin.
 *
 * These tests verify the expected behavior of the admin API's network security gates.
 * The actual PHP implementation is in docs/admin/public/auth-session.inc.php.
 * Tests mirror the logic to document expected behavior and catch regressions.
 */

/** Mirrors wpdev_check_host_header() in PHP */
function checkHostHeader(host: string): boolean {
  if (!host || host.trim() === "") return false;
  const hostOnly = host.toLowerCase().trim().replace(/:\d+$/, "");
  return ["localhost", "127.0.0.1", "[::1]"].includes(hostOnly);
}

/** Mirrors wpdev_check_remote_addr() in PHP */
function checkRemoteAddr(
  remoteAddr: string,
  trustedGateway: string | undefined,
): { ok: boolean; reason?: string } {
  const addr = (remoteAddr || "").trim();
  if (addr === "") {
    return { ok: false, reason: "REMOTE_ADDR empty" };
  }

  if (addr === "127.0.0.1" || addr === "::1") {
    return { ok: true };
  }

  const gateway = (trustedGateway || "").trim();
  if (gateway === "") {
    return {
      ok: false,
      reason: `REMOTE_ADDR=${addr} not loopback and WPDEV_ADMIN_TRUSTED_GATEWAY not set`,
    };
  }

  const gateways = gateway
    .split(",")
    .map((g) => g.trim())
    .filter((g) => g !== "");
  if (gateways.includes(addr)) {
    return { ok: true };
  }

  return {
    ok: false,
    reason: `REMOTE_ADDR=${addr} not in allowed list (127.0.0.1, ::1, ${gateway})`,
  };
}

/** Mirrors wpdev_check_bind_local() in PHP */
function checkBindLocal(bindLocal: string | undefined): {
  ok: boolean;
  reason?: string;
} {
  const value = (bindLocal || "").trim();
  if (value === "1") {
    return { ok: true };
  }
  if (value === "0") {
    return { ok: false, reason: "WPDEV_WP_BIND_LOCAL=0 (port exposed beyond localhost)" };
  }
  return { ok: false, reason: "WPDEV_WP_BIND_LOCAL not set (run wp-dev up to set it)" };
}

/** Mirrors wpdev_is_local_admin_request_full() in PHP */
function isLocalAdminRequestFull(
  host: string,
  remoteAddr: string,
  trustedGateway: string | undefined,
  requireBindLocal: boolean,
  bindLocal: string | undefined,
): { ok: boolean; reason?: string } {
  if (!checkHostHeader(host)) {
    return { ok: false, reason: "Host header not localhost" };
  }

  const addrCheck = checkRemoteAddr(remoteAddr, trustedGateway);
  if (!addrCheck.ok) {
    return addrCheck;
  }

  if (requireBindLocal) {
    const bindCheck = checkBindLocal(bindLocal);
    if (!bindCheck.ok) {
      return bindCheck;
    }
  }

  return { ok: true };
}

describe("admin-gate-security: Host header check", () => {
  it("allows localhost with or without port", () => {
    expect(checkHostHeader("localhost")).toBe(true);
    expect(checkHostHeader("localhost:8888")).toBe(true);
    expect(checkHostHeader("localhost:8894")).toBe(true);
  });

  it("allows 127.0.0.1 with or without port", () => {
    expect(checkHostHeader("127.0.0.1")).toBe(true);
    expect(checkHostHeader("127.0.0.1:8888")).toBe(true);
  });

  it("allows IPv6 loopback [::1]", () => {
    expect(checkHostHeader("[::1]")).toBe(true);
    expect(checkHostHeader("[::1]:8888")).toBe(true);
  });

  it("rejects public hosts (DNS rebinding protection)", () => {
    expect(checkHostHeader("evil.com")).toBe(false);
    expect(checkHostHeader("staging.example.com")).toBe(false);
    expect(checkHostHeader("192.168.1.1")).toBe(false);
    expect(checkHostHeader("172.20.0.4")).toBe(false);
  });

  it("rejects empty or missing host", () => {
    expect(checkHostHeader("")).toBe(false);
    expect(checkHostHeader("   ")).toBe(false);
  });
});

describe("admin-gate-security: REMOTE_ADDR check", () => {
  const FIXED_GATEWAY = "172.28.0.1";

  it("allows loopback addresses without gateway config", () => {
    expect(checkRemoteAddr("127.0.0.1", undefined)).toEqual({ ok: true });
    expect(checkRemoteAddr("::1", undefined)).toEqual({ ok: true });
  });

  it("allows gateway when configured", () => {
    expect(checkRemoteAddr(FIXED_GATEWAY, FIXED_GATEWAY)).toEqual({ ok: true });
  });

  it("allows multiple gateways (comma-separated)", () => {
    expect(checkRemoteAddr("172.28.0.1", "172.28.0.1,172.20.0.1")).toEqual({ ok: true });
    expect(checkRemoteAddr("172.20.0.1", "172.28.0.1,172.20.0.1")).toEqual({ ok: true });
  });

  it("rejects non-loopback when gateway not configured (fail closed)", () => {
    const result = checkRemoteAddr("172.20.0.4", undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("WPDEV_ADMIN_TRUSTED_GATEWAY not set");
  });

  it("rejects non-loopback not matching gateway", () => {
    const result = checkRemoteAddr("172.20.0.4", FIXED_GATEWAY);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not in allowed list");
  });

  it("rejects spoofed requests from container network (key security fix)", () => {
    // This is the main attack vector: curl from the host to the container bridge IP
    // with spoofed Host: localhost headers. REMOTE_ADDR will be the attacker's IP.
    const result = checkRemoteAddr("172.20.0.4", FIXED_GATEWAY);
    expect(result.ok).toBe(false);
  });

  it("rejects empty REMOTE_ADDR", () => {
    const result = checkRemoteAddr("", FIXED_GATEWAY);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("REMOTE_ADDR empty");
  });
});

describe("admin-gate-security: bind-local defense-in-depth", () => {
  it("allows when WPDEV_WP_BIND_LOCAL=1", () => {
    expect(checkBindLocal("1")).toEqual({ ok: true });
  });

  it("rejects when WPDEV_WP_BIND_LOCAL=0 (port exposed)", () => {
    const result = checkBindLocal("0");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("port exposed beyond localhost");
  });

  it("rejects when WPDEV_WP_BIND_LOCAL not set (fail closed)", () => {
    const result = checkBindLocal(undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not set");
  });

  it("rejects empty value (fail closed)", () => {
    const result = checkBindLocal("");
    expect(result.ok).toBe(false);
  });
});

describe("admin-gate-security: combined gate (isLocalAdminRequestFull)", () => {
  const GATEWAY = "172.28.0.1";

  it("allows normal localhost browser request via docker-proxy", () => {
    // Browser at localhost:8894 → docker-proxy → container as REMOTE_ADDR=172.28.0.1
    const result = isLocalAdminRequestFull("localhost:8894", GATEWAY, GATEWAY, false, "1");
    expect(result.ok).toBe(true);
  });

  it("allows direct loopback request", () => {
    const result = isLocalAdminRequestFull("localhost:8894", "127.0.0.1", undefined, false, "1");
    expect(result.ok).toBe(true);
  });

  it("rejects spoofed Host from non-allowed REMOTE_ADDR", () => {
    // Attacker sends Host: localhost from a different network position
    const result = isLocalAdminRequestFull("localhost:8894", "172.20.0.4", GATEWAY, false, "1");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not in allowed list");
  });

  it("rejects non-localhost Host even with allowed REMOTE_ADDR", () => {
    const result = isLocalAdminRequestFull("evil.com", GATEWAY, GATEWAY, false, "1");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Host header not localhost");
  });

  it("auto-unlock requires WPDEV_WP_BIND_LOCAL=1", () => {
    // Basic check passes
    const basicResult = isLocalAdminRequestFull("localhost:8894", GATEWAY, GATEWAY, false, "0");
    expect(basicResult.ok).toBe(true);

    // Auto-unlock check fails (requireBindLocal=true)
    const unlockResult = isLocalAdminRequestFull("localhost:8894", GATEWAY, GATEWAY, true, "0");
    expect(unlockResult.ok).toBe(false);
    expect(unlockResult.reason).toContain("port exposed beyond localhost");
  });

  it("auto-unlock requires bind-local to be explicitly set", () => {
    const result = isLocalAdminRequestFull("localhost:8894", GATEWAY, GATEWAY, true, undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not set");
  });
});

describe("admin-gate-security: attack scenarios", () => {
  const GATEWAY = "172.28.0.1";

  it("blocks header-only spoof attack (CVE scenario)", () => {
    // Attack: curl -H 'Host: localhost:8894' http://172.20.0.4:80/admin/api.php
    // Headers are all spoofed but REMOTE_ADDR reveals the attacker
    const result = isLocalAdminRequestFull(
      "localhost:8894",
      "172.20.0.4", // Attacker's actual network address
      GATEWAY,
      false,
      "1",
    );
    expect(result.ok).toBe(false);
  });

  it("blocks spoof with matching Sec-Fetch headers (covered by REMOTE_ADDR)", () => {
    // Even if attacker spoofs Sec-Fetch-Site: same-origin, Origin, etc.,
    // the REMOTE_ADDR check catches them
    const result = isLocalAdminRequestFull("localhost:8894", "10.0.0.50", GATEWAY, false, "1");
    expect(result.ok).toBe(false);
  });

  it("blocks LAN staging exposure via defense-in-depth", () => {
    // If someone exposes the port to 0.0.0.0 and Docker relays LAN traffic
    // through the gateway (rootless Docker, Docker Desktop, hairpin NAT),
    // the bind-local check catches it for auto-unlock
    const result = isLocalAdminRequestFull(
      "localhost:8894",
      GATEWAY, // Traffic comes from gateway due to NAT
      GATEWAY,
      true, // Auto-unlock path
      "0", // Port exposed to 0.0.0.0
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("port exposed beyond localhost");
  });
});
