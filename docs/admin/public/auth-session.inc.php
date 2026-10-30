<?php
/**
 * HttpOnly session auth for wp-dev admin API (replaces per-request token header after unlock).
 */
declare(strict_types=1);

const WPDEV_ADMIN_SESSION_KEY = 'wpdev_admin';
/** Session lifetime in seconds (24h). */
const WPDEV_ADMIN_SESSION_TTL = 86400;

function wpdev_session_start(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $savePath = '/wp-dev-repo/logs/sessions';
    if (!is_dir($savePath)) {
        @mkdir($savePath, 0770, true);
    }
    if (is_dir($savePath) && is_writable($savePath)) {
        session_save_path($savePath);
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/admin/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Lax',
    ]);
    session_name('WPDEV_ADMIN_SID');
    session_start();
}

function wpdev_admin_session_valid(): bool
{
    wpdev_session_start();
    $s = $_SESSION[WPDEV_ADMIN_SESSION_KEY] ?? null;
    if (!is_array($s)) {
        return false;
    }
    $at = $s['authed_at'] ?? 0;
    if (!is_numeric($at)) {
        return false;
    }
    return (time() - (int) $at) < WPDEV_ADMIN_SESSION_TTL;
}

function wpdev_admin_session_establish(): string
{
    wpdev_session_start();
    $nonce = bin2hex(random_bytes(16));
    $_SESSION[WPDEV_ADMIN_SESSION_KEY] = [
        'authed_at' => time(),
        'nonce' => $nonce,
    ];
    session_regenerate_id(true);
    return $nonce;
}

function wpdev_admin_session_nonce(): ?string
{
    if (!wpdev_admin_session_valid()) {
        return null;
    }
    $s = $_SESSION[WPDEV_ADMIN_SESSION_KEY] ?? null;
    if (!is_array($s)) {
        return null;
    }
    $nonce = $s['nonce'] ?? null;
    return is_string($nonce) && $nonce !== '' ? $nonce : null;
}

function wpdev_admin_session_destroy(): void
{
    wpdev_session_start();
    unset($_SESSION[WPDEV_ADMIN_SESSION_KEY]);
    if (session_status() !== PHP_SESSION_ACTIVE) {
        return;
    }
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(
            session_name(),
            '',
            time() - 42000,
            $p['path'],
            $p['domain'] ?? '',
            (bool) $p['secure'],
            (bool) $p['httponly'],
        );
    }
    session_destroy();
}

function wpdev_header_admin_token(): string
{
    $h = $_SERVER['HTTP_X_WP_DEV_ADMIN_TOKEN'] ?? '';
    return is_string($h) ? $h : '';
}

function wpdev_header_admin_nonce(): string
{
    $h = $_SERVER['HTTP_X_WP_DEV_NONCE'] ?? '';
    return is_string($h) ? $h : '';
}

function wpdev_legacy_token_valid(string $serverToken): bool
{
    if ($serverToken === '') {
        return false;
    }
    $provided = wpdev_header_admin_token();
    return $provided !== '' && hash_equals($serverToken, $provided);
}

function wpdev_session_auth_valid(bool $requireNonce): bool
{
    if (!wpdev_admin_session_valid()) {
        return false;
    }
    if (!$requireNonce) {
        return true;
    }
    $nonce = wpdev_admin_session_nonce();
    if ($nonce === null) {
        return false;
    }
    $provided = wpdev_header_admin_nonce();
    return $provided !== '' && hash_equals($nonce, $provided);
}

/** Session cookie or legacy X-WP-DEV-Admin-Token header. */
function wpdev_admin_auth_ok(string $serverToken, bool $requireNonce = false): bool
{
    if (wpdev_legacy_token_valid($serverToken)) {
        return true;
    }
    return wpdev_session_auth_valid($requireNonce);
}

/**
 * Gate 0: network address check — REMOTE_ADDR must be loopback or the trusted Docker gateway.
 * Blocks requests that spoof Host/Origin headers from non-local network positions.
 * @return array{ok: bool, reason?: string}
 */
function wpdev_check_remote_addr(): array
{
    $remoteAddr = trim((string) ($_SERVER['REMOTE_ADDR'] ?? ''));
    if ($remoteAddr === '') {
        return ['ok' => false, 'reason' => 'REMOTE_ADDR empty'];
    }

    if (in_array($remoteAddr, ['127.0.0.1', '::1'], true)) {
        return ['ok' => true];
    }

    $trustedGateway = trim((string) getenv('WPDEV_ADMIN_TRUSTED_GATEWAY'));
    if ($trustedGateway === '') {
        return ['ok' => false, 'reason' => 'REMOTE_ADDR=' . $remoteAddr . ' not loopback and WPDEV_ADMIN_TRUSTED_GATEWAY not set'];
    }

    $gateways = array_filter(array_map('trim', explode(',', $trustedGateway)));
    if (in_array($remoteAddr, $gateways, true)) {
        return ['ok' => true];
    }

    return ['ok' => false, 'reason' => 'REMOTE_ADDR=' . $remoteAddr . ' not in allowed list (127.0.0.1, ::1, ' . $trustedGateway . ')'];
}

/**
 * Gate 0: Host header check — blocks DNS rebinding attacks.
 * Must be localhost, 127.0.0.1, or [::1] (with optional port).
 */
function wpdev_check_host_header(): bool
{
    $host = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
    if ($host === '') {
        return false;
    }
    $hostOnly = preg_replace('/:\d+$/', '', $host);
    if (!is_string($hostOnly) || $hostOnly === '') {
        $hostOnly = $host;
    }
    return in_array($hostOnly, ['localhost', '127.0.0.1', '[::1]'], true);
}

/**
 * Gate 0: defense-in-depth — refuse auto-unlock unless WordPress port is published on 127.0.0.1.
 * Even with REMOTE_ADDR checks, Docker can relay LAN traffic through the gateway in some configurations.
 * @return array{ok: bool, reason?: string}
 */
function wpdev_check_bind_local(): array
{
    $bindLocal = trim((string) getenv('WPDEV_WP_BIND_LOCAL'));
    if ($bindLocal === '1') {
        return ['ok' => true];
    }
    if ($bindLocal === '0') {
        return ['ok' => false, 'reason' => 'WPDEV_WP_BIND_LOCAL=0 (port exposed beyond localhost)'];
    }
    return ['ok' => false, 'reason' => 'WPDEV_WP_BIND_LOCAL not set (run wp-dev up to set it)'];
}

/**
 * wp-dev admin is intended for loopback — auto-bootstrap session without pasting docker/.env token.
 * Combined gate: Host header + REMOTE_ADDR + bind-local check.
 * @param bool $requireBindLocal If true, also require WPDEV_WP_BIND_LOCAL=1 (for auto-unlock).
 * @return array{ok: bool, reason?: string}
 */
function wpdev_is_local_admin_request_full(bool $requireBindLocal = false): array
{
    if (!wpdev_check_host_header()) {
        return ['ok' => false, 'reason' => 'Host header not localhost'];
    }

    $addrCheck = wpdev_check_remote_addr();
    if (!$addrCheck['ok']) {
        return $addrCheck;
    }

    if ($requireBindLocal) {
        $bindCheck = wpdev_check_bind_local();
        if (!$bindCheck['ok']) {
            return $bindCheck;
        }
    }

    return ['ok' => true];
}

/** wp-dev admin is intended for loopback — auto-bootstrap session without pasting docker/.env token. */
function wpdev_is_local_admin_request(): bool
{
    $result = wpdev_is_local_admin_request_full(false);
    return $result['ok'] === true;
}

/**
 * True for same-origin browser fetches. Requires Sec-Fetch-Site + Sec-Fetch-Mode
 * and an Origin that matches HTTP_HOST — spoofing only Sec-Fetch-Site is not enough.
 */
function wpdev_is_browser_fetch_request(): bool
{
    $site = strtolower(trim((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? '')));
    if ($site !== 'same-origin') {
        return false;
    }
    $mode = strtolower(trim((string) ($_SERVER['HTTP_SEC_FETCH_MODE'] ?? '')));
    if ($mode !== 'cors' && $mode !== 'navigate') {
        return false;
    }
    return wpdev_request_origin_matches_host();
}

/** Origin host[:port] must match HTTP_HOST (blocks header-only spoof without Origin). */
function wpdev_request_origin_matches_host(): bool
{
    $origin = trim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''));
    $hostHeader = strtolower(trim((string) ($_SERVER['HTTP_HOST'] ?? '')));
    if ($origin === '' || $hostHeader === '') {
        return false;
    }
    $parts = parse_url($origin);
    if (!is_array($parts) || empty($parts['host'])) {
        return false;
    }
    $originHost = strtolower((string) $parts['host']);
    if (isset($parts['port'])) {
        $originHost .= ':' . (int) $parts['port'];
    }
    return hash_equals($hostHeader, $originHost);
}

/** Issue a short-lived HttpOnly challenge cookie (requires prior GET auth-status). */
function wpdev_issue_bootstrap_challenge(): void
{
    wpdev_session_start();
    $existing = $_SESSION['wpdev_bootstrap_challenge'] ?? null;
    if (!is_string($existing) || $existing === '') {
        $existing = bin2hex(random_bytes(16));
        $_SESSION['wpdev_bootstrap_challenge'] = $existing;
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    setcookie('WPDEV_BOOTSTRAP', $existing, [
        'expires' => time() + 600,
        'path' => '/admin/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
}

/** Validate and consume the bootstrap challenge cookie + session value. */
function wpdev_consume_bootstrap_challenge(): bool
{
    wpdev_session_start();
    $expected = $_SESSION['wpdev_bootstrap_challenge'] ?? null;
    unset($_SESSION['wpdev_bootstrap_challenge']);
    $provided = $_COOKIE['WPDEV_BOOTSTRAP'] ?? '';
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    setcookie('WPDEV_BOOTSTRAP', '', [
        'expires' => time() - 42000,
        'path' => '/admin/',
        'secure' => $secure,
        'httponly' => true,
        'samesite' => 'Strict',
    ]);
    if (!is_string($expected) || $expected === '' || !is_string($provided) || $provided === '') {
        return false;
    }
    return hash_equals($expected, $provided);
}

/** Refuse wp-dev admin API on public hosts (staging/production). */
function wpdev_enforce_local_admin_only(): void
{
    $result = wpdev_is_local_admin_request_full(false);
    if ($result['ok'] === true) {
        return;
    }
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    $detail = 'wp-dev admin is only available on localhost.';
    if (isset($result['reason']) && $result['reason'] !== '') {
        $detail .= ' (' . $result['reason'] . ')';
    }
    echo json_encode(
        [
            'ok' => false,
            'error' => 'forbidden',
            'detail' => $detail,
        ],
        JSON_UNESCAPED_SLASHES
    );
    exit;
}

function wpdev_generate_admin_save_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
}
