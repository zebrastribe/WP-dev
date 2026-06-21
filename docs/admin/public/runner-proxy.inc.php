<?php
/**
 * Proxy admin API → terminal/host runners (same Docker network / host gateway).
 * Browser calls api.php only — no direct 127.0.0.1 runner ports in the client.
 */
declare(strict_types=1);

/** Fixed listen port inside the terminal container (see docker-compose.yml). */
const WPDEV_TERMINAL_RUNNER_CONTAINER_PORT = 7682;
const WPDEV_TERMINAL_RUNNER_DOCKER_HOST = 'terminal';
const WPDEV_HOST_RUNNER_DOCKER_HOST = 'host.docker.internal';

/**
 * @return array{base: string, auth: string, token: string, origin: string}|null
 */
function wpdev_runner_upstream(string $kind, string $dockerEnvPath): ?array
{
    $auth = wpdev_dotenv_value($dockerEnvPath, 'WPDEV_TERMINAL_AUTH');
    $runnerToken = wpdev_dotenv_value($dockerEnvPath, 'WPDEV_TERMINAL_RUNNER_TOKEN');
    $origin = wpdev_dotenv_value($dockerEnvPath, 'WPDEV_TERMINAL_RUNNER_ORIGIN');
    if (
        !is_string($auth) || trim($auth) === ''
        || !is_string($runnerToken) || trim($runnerToken) === ''
        || !is_string($origin) || trim($origin) === ''
    ) {
        return null;
    }

    if ($kind === 'sync') {
        $portRaw = wpdev_dotenv_value($dockerEnvPath, 'WPDEV_HOST_RUNNER_PORT');
        $port = is_string($portRaw) && ctype_digit($portRaw) ? (int) $portRaw : 7683;
        $base = 'http://' . WPDEV_HOST_RUNNER_DOCKER_HOST . ':' . $port;
    } else {
        $base = 'http://' . WPDEV_TERMINAL_RUNNER_DOCKER_HOST . ':' . WPDEV_TERMINAL_RUNNER_CONTAINER_PORT;
    }

    return [
        'base' => $base,
        'auth' => $auth,
        'token' => $runnerToken,
        'origin' => $origin,
    ];
}

/**
 * @param list<string> $headers
 */
function wpdev_runner_curl_request(
    string $method,
    string $url,
    ?string $body,
    array $headers,
    int $timeoutSec = 30,
): array {
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 0, 'body' => '', 'error' => 'curl_unavailable'];
    }
    $ch = curl_init($url);
    if ($ch === false) {
        return ['ok' => false, 'status' => 0, 'body' => '', 'error' => 'curl_init_failed'];
    }
    $opts = [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => $timeoutSec,
    ];
    if ($body !== null) {
        $opts[CURLOPT_POSTFIELDS] = $body;
    }
    curl_setopt_array($ch, $opts);
    $responseBody = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $err = curl_error($ch);
    curl_close($ch);
    if ($responseBody === false) {
        return ['ok' => false, 'status' => $status, 'body' => '', 'error' => $err !== '' ? $err : 'curl_failed'];
    }
    return ['ok' => true, 'status' => $status, 'body' => (string) $responseBody, 'error' => ''];
}

/**
 * @return array{ok: true, data: array<string, mixed>}|array{ok: false, error: string, detail?: string}
 */
function wpdev_runner_proxy_json(string $kind, string $dockerEnvPath, string $method, string $path, ?string $body): array
{
    $upstream = wpdev_runner_upstream($kind, $dockerEnvPath);
    if ($upstream === null) {
        return ['ok' => false, 'error' => 'runner_secrets_unavailable'];
    }
    $basic = base64_encode($upstream['auth']);
    $headers = [
        'Accept: application/json',
        'Authorization: Basic ' . $basic,
        'X-WP-DEV-Terminal-Token: ' . $upstream['token'],
        'Origin: ' . $upstream['origin'],
    ];
    if ($body !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    $url = rtrim($upstream['base'], '/') . $path;
    $res = wpdev_runner_curl_request($method, $url, $body, $headers);
    if (!$res['ok']) {
        return [
            'ok' => false,
            'error' => 'runner_unreachable',
            'detail' => $res['error'] !== '' ? $res['error'] : 'connection_failed',
        ];
    }
    $decoded = json_decode($res['body'], true);
    if (!is_array($decoded)) {
        return [
            'ok' => false,
            'error' => 'runner_invalid_response',
            'detail' => 'HTTP ' . $res['status'],
        ];
    }
    if ($res['status'] < 200 || $res['status'] >= 300) {
        return [
            'ok' => false,
            'error' => is_string($decoded['error'] ?? null) ? (string) $decoded['error'] : 'runner_http_error',
            'detail' => 'HTTP ' . $res['status'],
        ];
    }
    return ['ok' => true, 'data' => $decoded];
}

/**
 * @return array{ok: true, terminal: bool, sync: bool}|array{ok: false, error: string}
 */
function wpdev_runner_health(string $dockerEnvPath): array
{
    $terminal = wpdev_runner_proxy_json('terminal', $dockerEnvPath, 'GET', '/health', null);
    $sync = wpdev_runner_proxy_json('sync', $dockerEnvPath, 'GET', '/health', null);
    return [
        'ok' => true,
        'terminal' => $terminal['ok'] === true && ($terminal['data']['ok'] ?? false) === true,
        'sync' => $sync['ok'] === true && ($sync['data']['ok'] ?? false) === true,
    ];
}
