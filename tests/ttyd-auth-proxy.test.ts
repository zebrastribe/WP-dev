import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { spawn, ChildProcess, execSync } from "node:child_process";
import http from "node:http";
import { join } from "node:path";
import { readFileSync } from "node:fs";

/**
 * Behavioral tests for ttyd-auth-proxy.mjs.
 * These tests actually start the proxy and test HTTP/WS behavior.
 */

const PROXY_SCRIPT = join(process.cwd(), "docker/ttyd-auth-proxy.mjs");
const TEST_USER = "testuser";
const TEST_PASS = "testpass:with:colons";
const TEST_AUTH = `${TEST_USER}:${TEST_PASS}`;
const TEST_PORT = 17691;
const INTERNAL_PORT = 17692;
const ALLOWED_ORIGIN = "http://localhost:8888";

function basicAuth(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function httpRequest(options: http.RequestOptions): Promise<{
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode!, headers: res.headers, body }));
    });
    req.on("error", reject);
    req.setTimeout(2000, () => {
      req.destroy(new Error("Request timeout"));
    });
    req.end();
  });
}

describe("ttyd-auth-proxy behavioral tests", () => {
  let proxyProcess: ChildProcess | null = null;
  let stubServer: http.Server | null = null;
  let proxyReady = false;
  let receivedHeaders: http.IncomingHttpHeaders | null = null;

  beforeAll(async () => {
    // Start a stub server that acts as ttyd
    stubServer = http.createServer((req, res) => {
      receivedHeaders = { ...req.headers };
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("OK from stub ttyd");
    });

    await new Promise<void>((resolve) => {
      stubServer!.listen(INTERNAL_PORT, "127.0.0.1", () => resolve());
    });

    // Start the proxy
    proxyProcess = spawn("node", [PROXY_SCRIPT], {
      env: {
        ...process.env,
        WPDEV_TERMINAL_PORT: String(TEST_PORT),
        WPDEV_TTYD_INTERNAL_PORT: String(INTERNAL_PORT),
        WPDEV_TERMINAL_AUTH: TEST_AUTH,
        WPDEV_TERMINAL_RUNNER_ORIGIN: ALLOWED_ORIGIN,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Wait for proxy to start
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Proxy failed to start")), 3000);
      
      proxyProcess!.stdout?.on("data", (data) => {
        if (data.toString().includes("Listening")) {
          proxyReady = true;
          clearTimeout(timeout);
          resolve();
        }
      });
      
      proxyProcess!.stderr?.on("data", (data) => {
        const msg = data.toString();
        if (msg.includes("ERROR") || msg.includes("must be set")) {
          clearTimeout(timeout);
          reject(new Error(`Proxy error: ${msg}`));
        }
      });

      proxyProcess!.on("exit", (code) => {
        if (!proxyReady && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`Proxy exited with code ${code}`));
        }
      });
    });
  }, 10000);

  afterAll(() => {
    if (proxyProcess) {
      proxyProcess.kill("SIGTERM");
      proxyProcess = null;
    }
    if (stubServer) {
      stubServer.close();
      stubServer = null;
    }
  });

  it("returns 401 with no credentials", async () => {
    const res = await httpRequest({
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path: "/",
      method: "GET",
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("Basic");
  });

  it("returns 401 with wrong credentials", async () => {
    const res = await httpRequest({
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path: "/",
      method: "GET",
      headers: { Authorization: basicAuth("wrong", "creds") },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 401 with wrong password", async () => {
    const res = await httpRequest({
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path: "/",
      method: "GET",
      headers: { Authorization: basicAuth(TEST_USER, "wrongpass") },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts correct credentials with password containing colons", async () => {
    receivedHeaders = null;
    const res = await httpRequest({
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path: "/",
      method: "GET",
      headers: { Authorization: basicAuth(TEST_USER, TEST_PASS) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe("OK from stub ttyd");
  });

  it("strips client-supplied auth header before forwarding", async () => {
    receivedHeaders = null;
    await httpRequest({
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path: "/",
      method: "GET",
      headers: {
        Authorization: basicAuth(TEST_USER, TEST_PASS),
        "X-WPDEV-Auth": "attacker-value",
      },
    });
    
    expect(receivedHeaders).not.toBeNull();
    // The forwarded request should have the proxy's auth header, not the attacker's
    expect(receivedHeaders!["x-wpdev-auth"]).toBe("authenticated");
  });

  it("rejects bad Origin on HTTP request", async () => {
    const res = await httpRequest({
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path: "/",
      method: "GET",
      headers: {
        Authorization: basicAuth(TEST_USER, TEST_PASS),
        Origin: "http://evil.com",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("Origin not allowed");
  });

  it("rejects localhost on different port (exact origin matching)", async () => {
    const res = await httpRequest({
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path: "/",
      method: "GET",
      headers: {
        Authorization: basicAuth(TEST_USER, TEST_PASS),
        Origin: "http://localhost:3000",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.body).toContain("Origin not allowed");
  });

  it("accepts the exact allowed origin", async () => {
    const res = await httpRequest({
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path: "/",
      method: "GET",
      headers: {
        Authorization: basicAuth(TEST_USER, TEST_PASS),
        Origin: ALLOWED_ORIGIN,
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("allows request with no Origin header (curl/non-browser)", async () => {
    const res = await httpRequest({
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path: "/",
      method: "GET",
      headers: { Authorization: basicAuth(TEST_USER, TEST_PASS) },
    });
    expect(res.statusCode).toBe(200);
  });

  it("forwards request with trusted auth header set", async () => {
    receivedHeaders = null;
    await httpRequest({
      hostname: "127.0.0.1",
      port: TEST_PORT,
      path: "/",
      method: "GET",
      headers: { Authorization: basicAuth(TEST_USER, TEST_PASS) },
    });
    
    expect(receivedHeaders).not.toBeNull();
    expect(receivedHeaders!["x-wpdev-auth"]).toBe("authenticated");
  });
});

describe("ttyd-auth-proxy source verification", () => {
  const proxySource = readFileSync(PROXY_SCRIPT, "utf8");

  it("uses timingSafeEqual for credential comparison", () => {
    expect(proxySource).toContain("timingSafeEqual");
  });

  it("validates Origin header", () => {
    expect(proxySource).toContain("validateOrigin");
  });

  it("does not accept arbitrary localhost ports", () => {
    // Should NOT have unconditional localhost acceptance
    expect(proxySource).not.toMatch(/if\s*\([^)]*localhost[^)]*\)\s*\{?\s*return\s+true/);
  });

  it("strips client auth header before forwarding", () => {
    expect(proxySource).toMatch(/delete.*headers.*TTYD_AUTH_HEADER/i);
  });

  it("credential not exposed in argv", () => {
    expect(proxySource).toContain("process.env.WPDEV_TERMINAL_AUTH");
    expect(proxySource).not.toContain("process.argv");
  });
});

describe("start-terminal-services.sh verification", () => {
  const scriptSource = readFileSync(join(process.cwd(), "docker/start-terminal-services.sh"), "utf8");

  it("ttyd is launched with -H/--auth-header", () => {
    expect(scriptSource).toMatch(/ttyd.*-H\s+X-WPDEV-Auth/);
  });

  it("ttyd is NOT launched with -c/--credential", () => {
    // Find the exec line with ttyd
    const execLine = scriptSource.split("\n").find((l) => l.trimStart().startsWith("exec"));
    expect(execLine).toBeDefined();
    // Must not have -c with credential
    expect(execLine).not.toMatch(/ttyd[^#]*\s-c\s/);
    expect(execLine).not.toMatch(/ttyd[^#]*--credential\s/);
  });

  it("ttyd binds to internal loopback only", () => {
    expect(scriptSource).toMatch(/ttyd.*-i\s+127\.0\.0\.1/);
  });

  it("auth proxy is started before ttyd", () => {
    const proxyLine = scriptSource.indexOf("ttyd-auth-proxy.mjs");
    const ttydLine = scriptSource.indexOf("exec runuser");
    expect(proxyLine).toBeLessThan(ttydLine);
  });

  it("proxy failure causes container exit", () => {
    expect(scriptSource).toContain('kill -0 "$PROXY_PID"');
    expect(scriptSource).toContain("exit 1");
  });
});
