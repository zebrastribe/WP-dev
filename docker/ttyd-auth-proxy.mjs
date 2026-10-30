/**
 * Authentication proxy for ttyd (G09: credential not visible in ps).
 *
 * This proxy sits between the published terminal port and ttyd, which runs
 * on container-internal loopback without -c. The proxy:
 * 1. Enforces Basic auth with constant-time comparison
 * 2. Validates Origin header (CSRF protection)
 * 3. Strips any client-supplied auth header before forwarding
 * 4. Sets the trusted auth header for ttyd after successful auth
 * 5. Forwards HTTP and WebSocket connections to ttyd
 *
 * The credential never appears in any process argv (ps output).
 */

import http from "node:http";
import { createHash, timingSafeEqual } from "node:crypto";

// Configuration from environment (single source of truth)
const LISTEN_PORT = Number(process.env.WPDEV_TERMINAL_PORT || 7681);
const TTYD_INTERNAL_PORT = Number(process.env.WPDEV_TTYD_INTERNAL_PORT || 17681);
const AUTH = process.env.WPDEV_TERMINAL_AUTH || "";
const ALLOWED_ORIGINS = (process.env.WPDEV_TERMINAL_RUNNER_ORIGIN || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

// Header name for ttyd's --auth-header (must match start-terminal-services.sh)
const TTYD_AUTH_HEADER = "X-WPDEV-Auth";
const TTYD_AUTH_VALUE = "authenticated";

if (!AUTH || AUTH === "wpdev:wpdev" || AUTH.includes("change-me")) {
  console.error("[ttyd-auth-proxy] WPDEV_TERMINAL_AUTH must be set to a non-default value");
  process.exit(1);
}

// Parse expected credential
const [expectedUser, expectedPass] = AUTH.split(":", 2);
if (!expectedUser || !expectedPass) {
  console.error("[ttyd-auth-proxy] WPDEV_TERMINAL_AUTH must be in user:password format");
  process.exit(1);
}

/**
 * Constant-time comparison for credentials.
 * Uses SHA-256 hashing to ensure equal length before comparison.
 */
function safeCredentialCompare(provided, expected) {
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

/**
 * Validate Basic auth header.
 * Returns true if credentials match, false otherwise.
 */
function validateBasicAuth(authHeader) {
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return false;
  }

  try {
    const encoded = authHeader.slice(6);
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const colonIdx = decoded.indexOf(":");
    if (colonIdx === -1) return false;

    const user = decoded.slice(0, colonIdx);
    const pass = decoded.slice(colonIdx + 1);

    return safeCredentialCompare(user, expectedUser) && safeCredentialCompare(pass, expectedPass);
  } catch {
    return false;
  }
}

/**
 * Check Origin header for CSRF protection.
 * Allows localhost origins and configured allowed origins.
 */
function validateOrigin(origin) {
  if (!origin) {
    // No origin header - allow (curl, non-browser clients)
    return true;
  }

  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();

    // Always allow localhost
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1") {
      return true;
    }

    // Check against allowed origins
    for (const allowed of ALLOWED_ORIGINS) {
      try {
        const allowedUrl = new URL(allowed);
        if (url.origin === allowedUrl.origin) {
          return true;
        }
      } catch {
        // Invalid allowed origin, skip
      }
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Send 401 Unauthorized response.
 */
function send401(res, message = "Unauthorized") {
  res.writeHead(401, {
    "WWW-Authenticate": 'Basic realm="wp-dev terminal"',
    "Content-Type": "text/plain",
  });
  res.end(message);
}

/**
 * Send 403 Forbidden response.
 */
function send403(res, message = "Forbidden") {
  res.writeHead(403, { "Content-Type": "text/plain" });
  res.end(message);
}

/**
 * Forward HTTP request to ttyd.
 */
function forwardHttpRequest(clientReq, clientRes) {
  const options = {
    hostname: "127.0.0.1",
    port: TTYD_INTERNAL_PORT,
    path: clientReq.url,
    method: clientReq.method,
    headers: { ...clientReq.headers },
  };

  // Remove any client-supplied auth header (security: prevent spoofing)
  delete options.headers[TTYD_AUTH_HEADER.toLowerCase()];
  delete options.headers[TTYD_AUTH_HEADER];

  // Remove the Authorization header (already validated, don't pass to ttyd)
  delete options.headers["authorization"];

  // Set the trusted auth header for ttyd
  options.headers[TTYD_AUTH_HEADER] = TTYD_AUTH_VALUE;

  // Fix host header for internal request
  options.headers["host"] = `127.0.0.1:${TTYD_INTERNAL_PORT}`;

  const proxyReq = http.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on("error", (err) => {
    console.error(`[ttyd-auth-proxy] Proxy error: ${err.message}`);
    if (!clientRes.headersSent) {
      clientRes.writeHead(502, { "Content-Type": "text/plain" });
    }
    clientRes.end("Bad Gateway");
  });

  clientReq.pipe(proxyReq);
}

/**
 * Forward WebSocket upgrade to ttyd.
 */
function forwardWebSocketUpgrade(clientReq, clientSocket, head) {
  const options = {
    hostname: "127.0.0.1",
    port: TTYD_INTERNAL_PORT,
    path: clientReq.url,
    method: "GET",
    headers: { ...clientReq.headers },
  };

  // Remove any client-supplied auth header
  delete options.headers[TTYD_AUTH_HEADER.toLowerCase()];
  delete options.headers[TTYD_AUTH_HEADER];
  delete options.headers["authorization"];

  // Set the trusted auth header
  options.headers[TTYD_AUTH_HEADER] = TTYD_AUTH_VALUE;
  options.headers["host"] = `127.0.0.1:${TTYD_INTERNAL_PORT}`;

  const proxyReq = http.request(options);

  proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
    // Send the upgrade response to the client
    let response = `HTTP/1.1 101 Switching Protocols\r\n`;
    for (const [key, value] of Object.entries(proxyRes.headers)) {
      if (Array.isArray(value)) {
        for (const v of value) {
          response += `${key}: ${v}\r\n`;
        }
      } else {
        response += `${key}: ${value}\r\n`;
      }
    }
    response += "\r\n";

    clientSocket.write(response);
    if (proxyHead.length > 0) {
      clientSocket.write(proxyHead);
    }
    if (head.length > 0) {
      proxySocket.write(head);
    }

    // Pipe data both ways
    proxySocket.pipe(clientSocket);
    clientSocket.pipe(proxySocket);

    proxySocket.on("error", () => clientSocket.destroy());
    clientSocket.on("error", () => proxySocket.destroy());
  });

  proxyReq.on("error", (err) => {
    console.error(`[ttyd-auth-proxy] WebSocket proxy error: ${err.message}`);
    clientSocket.destroy();
  });

  proxyReq.end();
}

// Create the proxy server
const server = http.createServer((req, res) => {
  // Validate Origin for CSRF protection
  const origin = req.headers["origin"];
  if (!validateOrigin(origin)) {
    console.error(`[ttyd-auth-proxy] Origin rejected: ${origin}`);
    return send403(res, "Origin not allowed");
  }

  // Validate Basic auth
  const authHeader = req.headers["authorization"];
  if (!validateBasicAuth(authHeader)) {
    return send401(res);
  }

  // Forward to ttyd
  forwardHttpRequest(req, res);
});

// Handle WebSocket upgrades
server.on("upgrade", (req, socket, head) => {
  // Validate Origin
  const origin = req.headers["origin"];
  if (!validateOrigin(origin)) {
    console.error(`[ttyd-auth-proxy] WebSocket Origin rejected: ${origin}`);
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  // Validate Basic auth
  const authHeader = req.headers["authorization"];
  if (!validateBasicAuth(authHeader)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="wp-dev terminal"\r\n\r\n');
    socket.destroy();
    return;
  }

  // Forward to ttyd
  forwardWebSocketUpgrade(req, socket, head);
});

server.listen(LISTEN_PORT, "0.0.0.0", () => {
  console.log(`[ttyd-auth-proxy] Listening on 0.0.0.0:${LISTEN_PORT}, forwarding to ttyd at 127.0.0.1:${TTYD_INTERNAL_PORT}`);
});

server.on("error", (err) => {
  console.error(`[ttyd-auth-proxy] Server error: ${err.message}`);
  process.exit(1);
});
