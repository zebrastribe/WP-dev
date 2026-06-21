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

/** wp-dev admin is intended for loopback — auto-bootstrap session without pasting docker/.env token. */
function wpdev_is_local_admin_request(): bool
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

/** Refuse wp-dev admin API on public hosts (staging/production). */
function wpdev_enforce_local_admin_only(): void
{
    if (wpdev_is_local_admin_request()) {
        return;
    }
    http_response_code(403);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(
        [
            'ok' => false,
            'error' => 'forbidden',
            'detail' => 'wp-dev admin is only available on localhost.',
        ],
        JSON_UNESCAPED_SLASHES
    );
    exit;
}

function wpdev_generate_admin_save_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(24)), '+/', '-_'), '=');
}
