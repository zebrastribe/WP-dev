<?php
/**
 * wp-dev admin: load/save wp-dev.config.json from the browser (same origin as /admin/).
 * Config and logs are bind-mounted at /wp-dev-repo/ (see docker-compose.yml).
 * Optional: set WPDEV_ADMIN_SAVE_TOKEN in docker/.env — then send header X-WP-DEV-Admin-Token on POST.
 * POST action=save-docker-env: JSON {"WPDEV_SIMPLY_API_KEY":"…"} → upserts into host docker/.env (requires ../docker mount).
 * Validation uses wp-dev.config.schema.json (generated from Zod via `npm run generate:schema`).
 * Appends one line per request to /wp-dev-repo/logs/wp-dev-admin-api.log (no request body logged).
 */
declare(strict_types=1);

require_once __DIR__ . '/schema-validate.inc.php';

header('Content-Type: application/json; charset=utf-8');

$configPath = '/wp-dev-repo/wp-dev.config.json';
$dockerDir = '/wp-dev-repo/docker';
$dockerEnvPath = $dockerDir . '/.env';
$dockerEnvExamplePath = $dockerDir . '/.env.example';
$logDir = '/wp-dev-repo/logs';
$logFile = $logDir . '/wp-dev-admin-api.log';
$token = getenv('WPDEV_ADMIN_SAVE_TOKEN') ?: '';
$schemaPath = __DIR__ . '/wp-dev.config.schema.json';

/**
 * @param array<string, string> $updates
 */
function wpdev_upsert_dotenv_file(string $path, array $updates): void
{
    $filtered = [];
    foreach ($updates as $k => $v) {
        if (!is_string($k) || !is_string($v) || $v === '') {
            continue;
        }
        if (preg_match('/[\r\n\0]/', $v) === 1) {
            throw new InvalidArgumentException('invalid env value for ' . $k);
        }
        $filtered[$k] = $v;
    }
    if (count($filtered) === 0) {
        return;
    }
    $cur = is_file($path) ? (string) file_get_contents($path) : '';
    $next = $cur;
    foreach ($filtered as $k => $v) {
        $line = $k . '=' . $v;
        $pat = '/^' . preg_quote($k, '/') . '=.*$/m';
        if (preg_match($pat, $next) === 1) {
            $next = preg_replace($pat, $line, $next, 1);
        } else {
            $next = $next === '' ? ($line . "\n") : (rtrim($next) . "\n" . $line . "\n");
        }
    }
    $tmp = $path . '.' . bin2hex(random_bytes(3)) . '.tmp';
    if (file_put_contents($tmp, $next) === false) {
        throw new RuntimeException('tmp_write_failed');
    }
    if (!rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException('rename_failed');
    }
}

function wpdev_dotenv_value(string $path, string $key): ?string
{
    if (!is_file($path) || !is_readable($path)) {
        return null;
    }
    $raw = (string) file_get_contents($path);
    $pat = '/^' . preg_quote($key, '/') . '=(.*)$/m';
    if (preg_match($pat, $raw, $m) !== 1) {
        return null;
    }
    $v = trim((string) ($m[1] ?? ''));
    if ($v === '') {
        return null;
    }
    $q1 = substr($v, 0, 1);
    $q2 = substr($v, -1);
    if (($q1 === '"' && $q2 === '"') || ($q1 === "'" && $q2 === "'")) {
        $v = substr($v, 1, -1);
    }
    $v = trim($v);
    return $v === '' ? null : $v;
}

function wpdev_simply_api_key(): ?string
{
    global $dockerEnvPath;
    $fromEnv = getenv('WPDEV_SIMPLY_API_KEY');
    if (is_string($fromEnv) && trim($fromEnv) !== '') {
        return trim($fromEnv);
    }
    return wpdev_dotenv_value($dockerEnvPath, 'WPDEV_SIMPLY_API_KEY');
}

function wpdev_parse_http_status_from_headers(array $headers): int
{
    foreach ($headers as $h) {
        if (!is_string($h)) {
            continue;
        }
        if (preg_match('/^HTTP\/\d+(?:\.\d+)?\s+(\d{3})\b/i', $h, $m) === 1) {
            return (int) $m[1];
        }
    }
    return 0;
}

function wpdev_admin_api_log(string $message): void
{
    global $logDir, $logFile;
    if (!is_dir($logDir)) {
        @mkdir($logDir, 0777, true);
    }
    $ip = $_SERVER['REMOTE_ADDR'] ?? '-';
    $line = date('c') . " ip={$ip} " . $message . "\n";
    @file_put_contents($logFile, $line, FILE_APPEND | LOCK_EX);
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = $_GET['action'] ?? '';
wpdev_admin_api_log("request method={$method} action={$action}");

if ($method === 'GET' && $action === 'load') {
    if (!is_file($configPath) || !is_readable($configPath)) {
        http_response_code(404);
        echo json_encode(['ok' => false, 'error' => 'not_found'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('GET load 404 not_found');
        exit;
    }
    $raw = file_get_contents($configPath);
    if ($raw === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'read_failed'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('GET load 500 read_failed');
        exit;
    }
    $len = strlen($raw);
    wpdev_admin_api_log("GET load 200 bytes={$len}");
    echo $raw;
    exit;
}

if ($method === 'GET' && $action === 'simply-status') {
    $key = wpdev_simply_api_key();
    $cfgRaw = is_file($configPath) && is_readable($configPath) ? file_get_contents($configPath) : false;
    $account = null;
    if (is_string($cfgRaw) && $cfgRaw !== '') {
        $cfg = json_decode($cfgRaw, true);
        if (is_array($cfg) && isset($cfg['simply']) && is_array($cfg['simply'])) {
            $acc = $cfg['simply']['account'] ?? null;
            if (is_string($acc) && trim($acc) !== '') {
                $account = trim($acc);
            }
        }
    }
    wpdev_admin_api_log('GET simply-status 200');
    echo json_encode(
        [
            'ok' => true,
            'simplyAccount' => $account,
            'apiKeyPresent' => $key !== null,
        ],
        JSON_UNESCAPED_SLASHES
    );
    exit;
}

if ($method === 'POST' && $action === 'simply-test') {
    $key = wpdev_simply_api_key();
    if ($key === null) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'no_api_key'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST simply-test 400 no_api_key');
        exit;
    }
    if (!is_file($configPath) || !is_readable($configPath)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'missing_config'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST simply-test 400 missing_config');
        exit;
    }
    $cfgRaw = file_get_contents($configPath);
    $cfg = is_string($cfgRaw) && $cfgRaw !== '' ? json_decode($cfgRaw, true) : null;
    if (!is_array($cfg) || !isset($cfg['simply']) || !is_array($cfg['simply'])) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'missing_simply_account'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST simply-test 400 missing_simply_account');
        exit;
    }
    $account = $cfg['simply']['account'] ?? null;
    if (!is_string($account) || trim($account) === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'missing_simply_account'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST simply-test 400 empty_simply_account');
        exit;
    }
    $account = trim($account);
    $auth = base64_encode($account . ':' . $key);
    $ctx = stream_context_create([
        'http' => [
            'method' => 'GET',
            'header' => "Authorization: Basic {$auth}\r\nAccept: application/json\r\n",
            'timeout' => 15,
            'ignore_errors' => true,
        ],
    ]);
    $url = 'https://api.simply.com/2/my/products/';
    $body = @file_get_contents($url, false, $ctx);
    $headers = isset($http_response_header) && is_array($http_response_header) ? $http_response_header : [];
    $status = wpdev_parse_http_status_from_headers($headers);
    if ($body === false && $status === 0) {
        http_response_code(502);
        echo json_encode(
            ['ok' => false, 'error' => 'request_failed', 'detail' => 'Could not reach Simply API.'],
            JSON_UNESCAPED_SLASHES
        );
        wpdev_admin_api_log('POST simply-test 502 request_failed');
        exit;
    }
    $preview = is_string($body) ? substr($body, 0, 240) : '';
    if ($status >= 200 && $status < 300) {
        wpdev_admin_api_log("POST simply-test 200 ok status={$status}");
        echo json_encode(['ok' => true, 'status' => $status], JSON_UNESCAPED_SLASHES);
        exit;
    }
    http_response_code($status > 0 ? $status : 500);
    echo json_encode(
        ['ok' => false, 'error' => 'api_error', 'status' => $status, 'detail' => $preview],
        JSON_UNESCAPED_SLASHES
    );
    wpdev_admin_api_log("POST simply-test {$status} api_error");
    exit;
}

if ($method === 'POST' && $action === 'save') {
    if ($token !== '' && ($_SERVER['HTTP_X_WP_DEV_ADMIN_TOKEN'] ?? '') !== $token) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'forbidden'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 403 forbidden (token mismatch or missing)');
        exit;
    }
    $body = file_get_contents('php://input');
    if ($body === false || $body === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'empty_body'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 400 empty_body');
        exit;
    }
    $data = json_decode($body, true);
    if (!is_array($data)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'invalid_json'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 400 invalid_json');
        exit;
    }
    if (!is_file($schemaPath) || !is_readable($schemaPath)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'schema_unavailable'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 500 schema_unavailable');
        exit;
    }
    $schemaRaw = file_get_contents($schemaPath);
    if ($schemaRaw === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'schema_read_failed'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 500 schema_read_failed');
        exit;
    }
    try {
        $schemaDoc = json_decode($schemaRaw, true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'schema_invalid'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 500 schema_invalid');
        exit;
    }
    if (!is_array($schemaDoc)) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'schema_invalid'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 500 schema_not_object');
        exit;
    }
    $vErr = wpdev_validate_against_schema($data, $schemaDoc);
    if ($vErr !== null) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'config_invalid', 'detail' => $vErr], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 400 config_invalid ' . $vErr);
        exit;
    }
    try {
        $encoded = json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'json_encode'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 500 json_encode');
        exit;
    }
    $tmp = $configPath . '.' . bin2hex(random_bytes(4)) . '.tmp';
    $wrote = false;
    if (file_put_contents($tmp, $encoded) !== false) {
        if (rename($tmp, $configPath)) {
            $wrote = true;
        } else {
            @unlink($tmp);
            wpdev_admin_api_log('POST save warn rename_failed; trying direct write');
        }
    } else {
        wpdev_admin_api_log('POST save warn write_tmp_failed; trying direct write');
    }
    if (!$wrote) {
        if (file_put_contents($configPath, $encoded, LOCK_EX) === false) {
            $perm = @substr(sprintf('%o', @fileperms($configPath)), -4);
            $owner = @fileowner($configPath);
            $group = @filegroup($configPath);
            http_response_code(500);
            echo json_encode(
                [
                    'ok' => false,
                    'error' => 'write_config_failed',
                    'detail' => 'Check host file permissions for wp-dev.config.json (chmod u+rw).',
                ],
                JSON_UNESCAPED_SLASHES
            );
            wpdev_admin_api_log(
                'POST save 500 write_config_failed' .
                ' perms=' . ($perm !== false ? (string)$perm : '-') .
                ' owner=' . ($owner !== false ? (string)$owner : '-') .
                ' group=' . ($group !== false ? (string)$group : '-')
            );
            exit;
        }
    }
    $proj = is_string($data['project']) ? $data['project'] : '?';
    wpdev_admin_api_log("POST save 200 ok project={$proj}");
    echo json_encode(['ok' => true], JSON_UNESCAPED_SLASHES);
    exit;
}

if ($method === 'POST' && $action === 'save-docker-env') {
    if ($token !== '' && ($_SERVER['HTTP_X_WP_DEV_ADMIN_TOKEN'] ?? '') !== $token) {
        http_response_code(403);
        echo json_encode(['ok' => false, 'error' => 'forbidden'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save-docker-env 403 forbidden');
        exit;
    }
    $body = file_get_contents('php://input');
    if ($body === false || $body === '') {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'empty_body'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save-docker-env 400 empty_body');
        exit;
    }
    $data = json_decode($body, true);
    if (!is_array($data)) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'invalid_json'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save-docker-env 400 invalid_json');
        exit;
    }
    $allowed = ['WPDEV_SIMPLY_API_KEY'];
    $updates = [];
    foreach ($allowed as $key) {
        if (!array_key_exists($key, $data)) {
            continue;
        }
        $val = $data[$key];
        if (!is_string($val) || $val === '') {
            continue;
        }
        $updates[$key] = $val;
    }
    if (count($updates) === 0) {
        http_response_code(400);
        echo json_encode(['ok' => false, 'error' => 'no_updates'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save-docker-env 400 no_updates');
        exit;
    }
    if (!is_dir($dockerDir) || !is_writable($dockerDir)) {
        http_response_code(500);
        echo json_encode(
            [
                'ok' => false,
                'error' => 'docker_dir_not_writable',
                'detail' => 'Mount ../docker into the wordpress service (see docker-compose.yml).',
            ],
            JSON_UNESCAPED_SLASHES
        );
        wpdev_admin_api_log('POST save-docker-env 500 docker_dir_not_writable');
        exit;
    }
    if (!is_file($dockerEnvPath)) {
        if (is_file($dockerEnvExamplePath)) {
            copy($dockerEnvExamplePath, $dockerEnvPath);
        } else {
            file_put_contents($dockerEnvPath, "WP_PORT=8888\n");
        }
    }
    try {
        wpdev_upsert_dotenv_file($dockerEnvPath, $updates);
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(
            ['ok' => false, 'error' => 'write_env_failed', 'detail' => $e->getMessage()],
            JSON_UNESCAPED_SLASHES
        );
        wpdev_admin_api_log('POST save-docker-env 500 write_env_failed');
        exit;
    }
    wpdev_admin_api_log('POST save-docker-env 200 ok keys=' . implode(',', array_keys($updates)));
    echo json_encode(['ok' => true], JSON_UNESCAPED_SLASHES);
    exit;
}

http_response_code(404);
echo json_encode(['ok' => false, 'error' => 'not_found'], JSON_UNESCAPED_SLASHES);
wpdev_admin_api_log('response 404 unknown route');
