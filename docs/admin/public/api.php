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
    // Accept common dotenv variants:
    //   KEY=value
    //   export KEY=value
    // with optional leading/trailing whitespace.
    $pat = '/^\s*(?:export\s+)?' . preg_quote($key, '/') . '\s*=\s*(.*)\s*$/m';
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

function wpdev_header_value(array $headers, string $name): ?string
{
    $want = strtolower($name);
    foreach ($headers as $h) {
        if (!is_string($h)) {
            continue;
        }
        $p = strpos($h, ':');
        if ($p === false) {
            continue;
        }
        $k = strtolower(trim(substr($h, 0, $p)));
        if ($k !== $want) {
            continue;
        }
        $v = trim(substr($h, $p + 1));
        return $v !== '' ? $v : null;
    }
    return null;
}

function wpdev_json_error(int $status, string $error, ?string $detail = null): void
{
    http_response_code($status);
    $o = ['ok' => false, 'error' => $error];
    if ($detail !== null && $detail !== '') {
        $o['detail'] = $detail;
    }
    echo json_encode($o, JSON_UNESCAPED_SLASHES);
}

function wpdev_require_mutation_token(string $token, string $action): void
{
    if ($token === '') {
        wpdev_json_error(503, 'token_not_configured', 'Set WPDEV_ADMIN_SAVE_TOKEN in docker/.env and restart.');
        wpdev_admin_api_log("POST {$action} 503 token_not_configured");
        exit;
    }
    $provided = $_SERVER['HTTP_X_WP_DEV_ADMIN_TOKEN'] ?? '';
    if (!is_string($provided) || !hash_equals($token, $provided)) {
        wpdev_json_error(403, 'forbidden', 'Missing or invalid admin token.');
        wpdev_admin_api_log("POST {$action} 403 forbidden");
        exit;
    }
}

function wpdev_parse_main_domain(string $raw): ?string
{
    $s = strtolower(trim($raw));
    if ($s === '') {
        return null;
    }
    $s = preg_replace('#^https?://#', '', $s);
    $host = preg_split('#[/:]#', $s)[0] ?? '';
    if ($host === '') {
        return null;
    }
    if (str_starts_with($host, 'www.')) {
        $host = substr($host, 4);
    }
    return preg_match('/^[a-z0-9.-]+$/', $host) === 1 ? $host : null;
}

function wpdev_is_ipv4(?string $s): bool
{
    return is_string($s) && filter_var(trim($s), FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false;
}

function wpdev_normalize_dns_name(string $s): string
{
    return rtrim(strtolower(trim($s)), '.');
}

function wpdev_dns_name_matches_fqdn(string $name, string $fqdn, string $apex): bool
{
    $n = wpdev_normalize_dns_name($name);
    $f = wpdev_normalize_dns_name($fqdn);
    $a = wpdev_normalize_dns_name($apex);
    if ($n === $f) {
        return true;
    }
    // Some APIs return short labels (e.g. "staging") instead of full FQDN.
    if ($n !== '' && strpos($n, '.') === false) {
        return ($n . '.' . $a) === $f;
    }
    return false;
}

function wpdev_domain_slug(string $host): string
{
    return str_replace('.', '-', strtolower($host));
}

/**
 * @param array<string, string> $headers
 * @return array{status:int, body:string}
 */
function wpdev_http_request(
    string $method,
    string $url,
    array $headers,
    ?string $body
): array {
    $headerLines = [];
    foreach ($headers as $k => $v) {
        $headerLines[] = $k . ': ' . $v;
    }
    $ctx = stream_context_create([
        'http' => [
            'method' => $method,
            'header' => implode("\r\n", $headerLines) . "\r\n",
            'timeout' => 20,
            'ignore_errors' => true,
            'content' => $body ?? '',
        ],
    ]);
    $res = @file_get_contents($url, false, $ctx);
    $respHeaders = isset($http_response_header) && is_array($http_response_header)
        ? $http_response_header
        : [];
    $status = wpdev_parse_http_status_from_headers($respHeaders);
    if ($res === false && $status === 0) {
        return ['status' => 0, 'body' => ''];
    }
    return ['status' => $status, 'body' => is_string($res) ? $res : ''];
}

/**
 * @return array{ok:true, json:mixed}|array{ok:false, status:int, detail:string}
 */
function wpdev_simply_json(
    string $account,
    string $key,
    string $method,
    string $path,
    ?array $payload
): array {
    $url = 'https://api.simply.com/2' . (str_starts_with($path, '/') ? $path : ('/' . $path));
    $auth = base64_encode($account . ':' . $key);
    $headers = [
        'Authorization' => 'Basic ' . $auth,
        'Accept' => 'application/json',
    ];
    $body = null;
    if ($payload !== null) {
        $headers['Content-Type'] = 'application/json';
        $body = (string) json_encode($payload, JSON_UNESCAPED_SLASHES);
    }
    $r = wpdev_http_request($method, $url, $headers, $body);
    if ($r['status'] < 200 || $r['status'] >= 300) {
        return [
            'ok' => false,
            'status' => $r['status'] > 0 ? $r['status'] : 502,
            'detail' => substr($r['body'], 0, 240),
        ];
    }
    $json = json_decode($r['body'], true);
    if (!is_array($json)) {
        return ['ok' => false, 'status' => 502, 'detail' => 'Simply API returned non-JSON'];
    }
    return ['ok' => true, 'json' => $json];
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

if ($method === 'GET' && $action === 'staging-db-secrets') {
    $out = [
        'ok' => true,
        'host' => wpdev_dotenv_value($dockerEnvPath, 'WPDEV_STAGING_DB_HOST'),
        'name' => wpdev_dotenv_value($dockerEnvPath, 'WPDEV_STAGING_DB_NAME'),
        'user' => wpdev_dotenv_value($dockerEnvPath, 'WPDEV_STAGING_DB_USER'),
        'password' => wpdev_dotenv_value($dockerEnvPath, 'WPDEV_STAGING_DB_PASSWORD'),
        'prefix' => wpdev_dotenv_value($dockerEnvPath, 'WPDEV_STAGING_DB_PREFIX'),
    ];
    wpdev_admin_api_log('GET staging-db-secrets 200');
    echo json_encode($out, JSON_UNESCAPED_SLASHES);
    exit;
}

if ($method === 'GET' && $action === 'terminal-runner-secrets') {
    $auth = wpdev_dotenv_value($dockerEnvPath, 'WPDEV_TERMINAL_AUTH');
    $runnerToken = wpdev_dotenv_value($dockerEnvPath, 'WPDEV_TERMINAL_RUNNER_TOKEN');
    $runnerOrigin = wpdev_dotenv_value($dockerEnvPath, 'WPDEV_TERMINAL_RUNNER_ORIGIN');
    $terminalPortRaw = wpdev_dotenv_value($dockerEnvPath, 'WPDEV_TERMINAL_PORT');
    $runnerPortRaw = wpdev_dotenv_value($dockerEnvPath, 'WPDEV_TERMINAL_RUNNER_PORT');
    $terminalPort = is_string($terminalPortRaw) && ctype_digit($terminalPortRaw) ? (int) $terminalPortRaw : 7681;
    $runnerPort = is_string($runnerPortRaw) && ctype_digit($runnerPortRaw) ? (int) $runnerPortRaw : 7682;
    if (!is_string($auth) || trim($auth) === '' || !is_string($runnerToken) || trim($runnerToken) === '') {
        http_response_code(503);
        echo json_encode(
            ['ok' => false, 'error' => 'runner_secrets_unavailable', 'detail' => 'Run wp-dev up to initialize runner secrets.'],
            JSON_UNESCAPED_SLASHES
        );
        wpdev_admin_api_log('GET terminal-runner-secrets 503 unavailable');
        exit;
    }
    wpdev_admin_api_log('GET terminal-runner-secrets 200');
    echo json_encode(
        [
            'ok' => true,
            'terminalAuth' => $auth,
            'runnerToken' => $runnerToken,
            'runnerOrigin' => is_string($runnerOrigin) ? $runnerOrigin : null,
            'terminalPort' => $terminalPort,
            'runnerPort' => $runnerPort,
        ],
        JSON_UNESCAPED_SLASHES
    );
    exit;
}

if ($method === 'POST' && $action === 'simply-test') {
    $body = file_get_contents('php://input');
    $in = is_string($body) && trim($body) !== '' ? json_decode($body, true) : null;
    $input = is_array($in) ? $in : [];

    $key = null;
    $inKey = $input['apiKey'] ?? null;
    if (is_string($inKey) && trim($inKey) !== '') {
        $key = trim($inKey);
    } else {
        $key = wpdev_simply_api_key();
    }

    $account = null;
    $inAccount = $input['account'] ?? null;
    if (is_string($inAccount) && trim($inAccount) !== '') {
        $account = trim($inAccount);
    } else {
        if (is_file($configPath) && is_readable($configPath)) {
            $cfgRaw = file_get_contents($configPath);
            $cfg = is_string($cfgRaw) && $cfgRaw !== '' ? json_decode($cfgRaw, true) : null;
            if (is_array($cfg) && isset($cfg['simply']) && is_array($cfg['simply'])) {
                $acc = $cfg['simply']['account'] ?? null;
                if (is_string($acc) && trim($acc) !== '') {
                    $account = trim($acc);
                }
            }
        }
    }

    if ($key === null) {
        http_response_code(400);
        echo json_encode(
            [
                'ok' => false,
                'error' => 'no_api_key',
                'detail' => 'No key provided and WPDEV_SIMPLY_API_KEY not found in PHP env or /wp-dev-repo/docker/.env',
            ],
            JSON_UNESCAPED_SLASHES
        );
        wpdev_admin_api_log('POST simply-test 400 no_api_key');
        exit;
    }
    if ($account === null) {
        http_response_code(400);
        echo json_encode(
            [
                'ok' => false,
                'error' => 'missing_simply_account',
                'detail' => 'No account provided and simply.account was not found in wp-dev.config.json',
            ],
            JSON_UNESCAPED_SLASHES
        );
        wpdev_admin_api_log('POST simply-test 400 missing_simply_account');
        exit;
    }

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
    wpdev_require_mutation_token($token, 'save');
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
    wpdev_require_mutation_token($token, 'save-docker-env');
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
    $allowed = [
        'WPDEV_SIMPLY_API_KEY',
        'WPDEV_STAGING_DB_HOST',
        'WPDEV_STAGING_DB_NAME',
        'WPDEV_STAGING_DB_USER',
        'WPDEV_STAGING_DB_PASSWORD',
        'WPDEV_STAGING_DB_PREFIX',
    ];
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

if ($method === 'POST' && $action === 'simply-setup-staging') {
    wpdev_json_error(410, 'gone', 'This endpoint is deprecated and disabled.');
    wpdev_admin_api_log('POST simply-setup-staging 410 gone');
    exit;
}

if (false && $method === 'POST' && $action === 'simply-setup-staging') {
    $body = file_get_contents('php://input');
    $in = is_string($body) && trim($body) !== '' ? json_decode($body, true) : null;
    $input = is_array($in) ? $in : [];

    if (!is_file($configPath) || !is_readable($configPath)) {
        wpdev_json_error(400, 'missing_config');
        wpdev_admin_api_log('POST simply-setup-staging 400 missing_config');
        exit;
    }
    $cfgRaw = file_get_contents($configPath);
    $cfg = is_string($cfgRaw) && $cfgRaw !== '' ? json_decode($cfgRaw, true) : null;
    if (!is_array($cfg)) {
        wpdev_json_error(400, 'invalid_config');
        wpdev_admin_api_log('POST simply-setup-staging 400 invalid_config');
        exit;
    }
    $simply = isset($cfg['simply']) && is_array($cfg['simply']) ? $cfg['simply'] : [];
    $account = null;
    $inAccount = $input['account'] ?? null;
    if (is_string($inAccount) && trim($inAccount) !== '') {
        $account = trim($inAccount);
        $cfg['simply'] = ['account' => $account];
    } else {
        $acc = $simply['account'] ?? null;
        if (is_string($acc) && trim($acc) !== '') {
            $account = trim($acc);
        }
    }
    if ($account === null) {
        wpdev_json_error(400, 'missing_simply_account');
        wpdev_admin_api_log('POST simply-setup-staging 400 missing_simply_account');
        exit;
    }
    $key = null;
    $inKey = $input['apiKey'] ?? null;
    if (is_string($inKey) && trim($inKey) !== '') {
        $key = trim($inKey);
    } else {
        $key = wpdev_simply_api_key();
    }
    if ($key === null) {
        wpdev_json_error(400, 'no_api_key');
        wpdev_admin_api_log('POST simply-setup-staging 400 no_api_key');
        exit;
    }

    $apex = null;
    $inApex = $input['apex'] ?? null;
    if (is_string($inApex) && trim($inApex) !== '') {
        $apex = wpdev_parse_main_domain($inApex);
    } else {
        $prodUrl = is_array($cfg['production'] ?? null) ? ($cfg['production']['url'] ?? '') : '';
        $apex = is_string($prodUrl) ? wpdev_parse_main_domain($prodUrl) : null;
    }
    if ($apex === null) {
        wpdev_json_error(400, 'missing_apex', 'Set production.url or pass apex.');
        wpdev_admin_api_log('POST simply-setup-staging 400 missing_apex');
        exit;
    }
    $label = 'staging';
    $inLabel = $input['stagingLabel'] ?? null;
    if (is_string($inLabel) && trim($inLabel) !== '') {
        $label = strtolower(trim($inLabel));
    }
    if (preg_match('/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/', $label) !== 1) {
        wpdev_json_error(400, 'invalid_staging_label');
        wpdev_admin_api_log('POST simply-setup-staging 400 invalid_staging_label');
        exit;
    }
    $keepExisting = (bool) ($input['keepExistingDns'] ?? false);
    $stagingFqdn = $label . '.' . strtolower($apex);

    $lines = [];
    $products = wpdev_simply_json($account, $key, 'GET', '/my/products/', null);
    if ($products['ok'] !== true) {
        wpdev_json_error($products['status'], 'simply_products_failed', $products['detail']);
        wpdev_admin_api_log('POST simply-setup-staging products_failed');
        exit;
    }
    $plist = $products['json']['products'] ?? [];
    if (!is_array($plist)) {
        $plist = [];
    }
    $product = null;
    foreach ($plist as $p) {
        if (!is_array($p)) {
            continue;
        }
        if (!empty($p['cancelled'])) {
            continue;
        }
        $dname = is_array($p['domain'] ?? null) ? ($p['domain']['name'] ?? null) : null;
        $obj = $p['object'] ?? null;
        $cand = is_string($dname) ? strtolower($dname) : (is_string($obj) ? strtolower($obj) : '');
        if ($cand === strtolower($apex)) {
            $product = $p;
            break;
        }
    }
    if (!is_array($product)) {
        wpdev_json_error(400, 'simply_product_not_found', 'No Simply product matched apex ' . $apex);
        wpdev_admin_api_log('POST simply-setup-staging product_not_found');
        exit;
    }
    $object = is_string($product['object'] ?? null) ? $product['object'] : '';
    if ($object === '') {
        wpdev_json_error(400, 'simply_product_invalid');
        wpdev_admin_api_log('POST simply-setup-staging product_invalid');
        exit;
    }
    $lines[] = 'Simply: using DNS zone product "' . $object . '"';
    $recordsPath = '/my/products/' . rawurlencode($object) . '/dns/records/';
    $recordsRes = wpdev_simply_json($account, $key, 'GET', $recordsPath, null);
    if ($recordsRes['ok'] !== true) {
        wpdev_json_error($recordsRes['status'], 'simply_records_failed', $recordsRes['detail']);
        wpdev_admin_api_log('POST simply-setup-staging records_failed');
        exit;
    }
    $records = $recordsRes['json']['records'] ?? [];
    if (!is_array($records)) {
        $records = [];
    }

    $ip = null;
    $servers = is_array($product['servers'] ?? null) ? $product['servers'] : [];
    $webserver = is_array($servers['webserver'] ?? null) ? $servers['webserver'] : [];
    $sshserver = is_array($servers['sshserver'] ?? null) ? $servers['sshserver'] : [];
    $wip = $webserver['ip'] ?? null;
    $sip = $sshserver['ip'] ?? null;
    if (wpdev_is_ipv4(is_string($wip) ? $wip : null)) {
        $ip = trim((string) $wip);
    } elseif (wpdev_is_ipv4(is_string($sip) ? $sip : null)) {
        $ip = trim((string) $sip);
    } else {
        $wantA = [wpdev_normalize_dns_name($apex), wpdev_normalize_dns_name('www.' . $apex)];
        foreach ($records as $r) {
            if (!is_array($r)) {
                continue;
            }
            $t = strtoupper((string) ($r['type'] ?? ''));
            $name = wpdev_normalize_dns_name((string) ($r['name'] ?? ''));
            $data = (string) ($r['data'] ?? '');
            if ($t === 'A' && in_array($name, $wantA, true) && wpdev_is_ipv4($data)) {
                $ip = trim($data);
                break;
            }
        }
    }
    if ($ip === null) {
        wpdev_json_error(400, 'staging_ip_not_found', 'No IPv4 available for staging DNS target.');
        wpdev_admin_api_log('POST simply-setup-staging ip_not_found');
        exit;
    }

    $existingAtName = null;
    $existingA = null;
    foreach ($records as $r) {
        if (!is_array($r)) {
            continue;
        }
        $nameRaw = (string) ($r['name'] ?? '');
        if (!wpdev_dns_name_matches_fqdn($nameRaw, $stagingFqdn, $apex)) {
            continue;
        }
        $existingAtName = $r;
        if (strtoupper((string) ($r['type'] ?? '')) === 'A') {
            $existingA = $r;
        }
        break;
    }
    if (is_array($existingA)) {
        $existingData = trim((string) ($existingA['data'] ?? ''));
        if ($existingData === $ip) {
            $lines[] = 'Simply: A record ' . $stagingFqdn . ' → ' . $ip . ' already present.';
        } elseif (!$keepExisting) {
            wpdev_json_error(409, 'dns_conflict', 'Existing A record at ' . $stagingFqdn . ' → ' . $existingData);
            wpdev_admin_api_log('POST simply-setup-staging dns_conflict_a');
            exit;
        } else {
            $lines[] = 'Simply: keeping existing A at ' . $stagingFqdn . ' → ' . $existingData . ' (config only).';
        }
    } elseif (is_array($existingAtName)) {
        $typ = strtoupper((string) ($existingAtName['type'] ?? ''));
        $data = trim((string) ($existingAtName['data'] ?? ''));
        if (!$keepExisting) {
            wpdev_json_error(409, 'dns_conflict', 'Existing ' . $typ . ' record at ' . $stagingFqdn);
            wpdev_admin_api_log('POST simply-setup-staging dns_conflict_other');
            exit;
        } else {
            $lines[] = 'Simply: keeping existing ' . $typ . ' at ' . $stagingFqdn . ' → ' . $data . ' (config only).';
        }
    } else {
        $post = wpdev_simply_json($account, $key, 'POST', $recordsPath, [
            'type' => 'A',
            'name' => $stagingFqdn,
            'data' => $ip,
        ]);
        if ($post['ok'] !== true) {
            wpdev_json_error($post['status'], 'dns_create_failed', $post['detail']);
            wpdev_admin_api_log('POST simply-setup-staging dns_create_failed');
            exit;
        }
        $lines[] = 'Simply: created A record ' . $stagingFqdn . ' → ' . $ip;
    }

    $staging = is_array($cfg['staging'] ?? null) ? $cfg['staging'] : [];
    $stagingHost = is_string($staging['host'] ?? null) ? (string) $staging['host'] : '';
    $stagingPath = is_string($staging['path'] ?? null) ? (string) $staging['path'] : '';
    $sshHost = is_string($sshserver['hostname'] ?? null) ? trim((string) $sshserver['hostname']) : '';
    if ($sshHost !== '' && str_ends_with(strtolower(trim($stagingHost)), '.invalid')) {
        $staging['host'] = $sshHost;
        $lines[] = 'Config: staging.host set to ' . $sshHost;
    }
    $legacyGuess = '/var/www/' . wpdev_domain_slug($apex) . '/public_html';
    if ($stagingPath === '/var/www/staging-not-used') {
        $guess = '/' . $label;
        $staging['path'] = $guess;
        $lines[] = 'Config: staging.path set to ' . $guess . ' (Simply subdomain folder; verify in hosting panel).';
    } elseif ($stagingPath === $legacyGuess) {
        $guess = '/' . $label;
        $staging['path'] = $guess;
        $lines[] = 'Config: staging.path migrated from legacy ' . $legacyGuess . ' to ' . $guess . ' (Simply subdomain folder).';
    }
    $staging['url'] = 'https://' . $stagingFqdn;
    $cfg['staging'] = $staging;
    $lines[] = 'Config: staging.url set to https://' . $stagingFqdn;
    $lines[] = 'Note: Simply subdomain folder mapping is separate from DNS. Ensure subdomain "' . $stagingFqdn . '" exists in Subdomains and points to ' . ($staging['path'] ?? ('/' . $label)) . '.';

    $encoded = json_encode($cfg, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if (!is_string($encoded) || file_put_contents($configPath, $encoded, LOCK_EX) === false) {
        wpdev_json_error(500, 'write_config_failed');
        wpdev_admin_api_log('POST simply-setup-staging 500 write_config_failed');
        exit;
    }

    wpdev_admin_api_log('POST simply-setup-staging 200 ok');
    echo json_encode(
        [
            'ok' => true,
            'lines' => $lines,
            'staging' => $cfg['staging'],
        ],
        JSON_UNESCAPED_SLASHES
    );
    exit;
}

if ($method === 'POST' && $action === 'staging-https-check') {
    $body = file_get_contents('php://input');
    $in = is_string($body) && trim($body) !== '' ? json_decode($body, true) : null;
    $input = is_array($in) ? $in : [];

    $url = null;
    $inUrl = $input['url'] ?? null;
    if (is_string($inUrl) && trim($inUrl) !== '') {
        $url = trim($inUrl);
    } elseif (is_file($configPath) && is_readable($configPath)) {
        $cfgRaw = file_get_contents($configPath);
        $cfg = is_string($cfgRaw) && $cfgRaw !== '' ? json_decode($cfgRaw, true) : null;
        if (is_array($cfg) && isset($cfg['staging']) && is_array($cfg['staging'])) {
            $u = $cfg['staging']['url'] ?? null;
            if (is_string($u) && trim($u) !== '') {
                $url = trim($u);
            }
        }
    }
    if ($url === null) {
        wpdev_json_error(400, 'missing_staging_url');
        wpdev_admin_api_log('POST staging-https-check 400 missing_staging_url');
        exit;
    }
    if (!str_starts_with(strtolower($url), 'https://')) {
        wpdev_json_error(400, 'invalid_staging_url', 'Expected https:// URL');
        wpdev_admin_api_log('POST staging-https-check 400 invalid_staging_url');
        exit;
    }

    $httpsRes = wpdev_http_request('GET', $url, ['Accept' => 'text/html'], null);
    $httpsHeaders = isset($http_response_header) && is_array($http_response_header)
        ? $http_response_header
        : [];
    $httpsStatus = $httpsRes['status'];
    $httpsOk = $httpsStatus >= 200 && $httpsStatus < 400;
    $httpsLocation = wpdev_header_value($httpsHeaders, 'Location');

    $httpUrl = preg_replace('#^https://#i', 'http://', $url) ?? $url;
    $httpRes = wpdev_http_request('GET', $httpUrl, ['Accept' => 'text/html'], null);
    $httpHeaders = isset($http_response_header) && is_array($http_response_header)
        ? $http_response_header
        : [];
    $httpStatus = $httpRes['status'];
    $httpLocation = wpdev_header_value($httpHeaders, 'Location');
    $httpRedirectsToHttps =
        $httpLocation !== null && str_starts_with(strtolower($httpLocation), 'https://');

    wpdev_admin_api_log(
        'POST staging-https-check 200 https=' . $httpsStatus .
        ' http=' . $httpStatus .
        ' redirect=' . ($httpRedirectsToHttps ? 'yes' : 'no')
    );
    echo json_encode(
        [
            'ok' => true,
            'url' => $url,
            'https' => [
                'ok' => $httpsOk,
                'status' => $httpsStatus,
                'location' => $httpsLocation,
                'preview' => substr($httpsRes['body'], 0, 180),
            ],
            'http' => [
                'status' => $httpStatus,
                'location' => $httpLocation,
                'redirectsToHttps' => $httpRedirectsToHttps,
            ],
        ],
        JSON_UNESCAPED_SLASHES
    );
    exit;
}

if ($method === 'POST' && $action === 'staging-domain-check') {
    $body = file_get_contents('php://input');
    $in = is_string($body) && trim($body) !== '' ? json_decode($body, true) : null;
    $input = is_array($in) ? $in : [];

    $url = null;
    $inUrl = $input['url'] ?? null;
    if (is_string($inUrl) && trim($inUrl) !== '') {
        $url = trim($inUrl);
    } elseif (is_file($configPath) && is_readable($configPath)) {
        $cfgRaw = file_get_contents($configPath);
        $cfg = is_string($cfgRaw) && $cfgRaw !== '' ? json_decode($cfgRaw, true) : null;
        if (is_array($cfg) && isset($cfg['staging']) && is_array($cfg['staging'])) {
            $u = $cfg['staging']['url'] ?? null;
            if (is_string($u) && trim($u) !== '') {
                $url = trim($u);
            }
        }
    }
    if ($url === null) {
        wpdev_json_error(400, 'missing_staging_url');
        wpdev_admin_api_log('POST staging-domain-check 400 missing_staging_url');
        exit;
    }

    $parts = @parse_url($url);
    $host = is_array($parts) && isset($parts['host']) && is_string($parts['host'])
        ? strtolower(trim($parts['host']))
        : '';
    if ($host === '') {
        wpdev_json_error(400, 'invalid_staging_url', 'Could not parse host from URL');
        wpdev_admin_api_log('POST staging-domain-check 400 invalid_staging_url');
        exit;
    }

    $records = [];
    $a = @dns_get_record($host, DNS_A);
    if (is_array($a)) {
        foreach ($a as $r) {
            if (is_array($r) && isset($r['ip']) && is_string($r['ip'])) {
                $records[] = 'A ' . $r['ip'];
            }
        }
    }
    $aaaa = @dns_get_record($host, DNS_AAAA);
    if (is_array($aaaa)) {
        foreach ($aaaa as $r) {
            if (is_array($r) && isset($r['ipv6']) && is_string($r['ipv6'])) {
                $records[] = 'AAAA ' . $r['ipv6'];
            }
        }
    }
    $cname = @dns_get_record($host, DNS_CNAME);
    if (is_array($cname)) {
        foreach ($cname as $r) {
            if (is_array($r) && isset($r['target']) && is_string($r['target'])) {
                $records[] = 'CNAME ' . rtrim($r['target'], '.');
            }
        }
    }
    $dnsOk = count($records) > 0;

    $httpsRes = wpdev_http_request('GET', $url, ['Accept' => 'text/html'], null);
    $httpsHeaders = isset($http_response_header) && is_array($http_response_header)
        ? $http_response_header
        : [];
    $httpsStatus = $httpsRes['status'];
    $httpsLocation = wpdev_header_value($httpsHeaders, 'Location');
    $httpsOk = $httpsStatus >= 200 && $httpsStatus < 400;

    $httpUrl = preg_replace('#^https://#i', 'http://', $url) ?? $url;
    $httpRes = wpdev_http_request('GET', $httpUrl, ['Accept' => 'text/html'], null);
    $httpHeaders = isset($http_response_header) && is_array($http_response_header)
        ? $http_response_header
        : [];
    $httpStatus = $httpRes['status'];
    $httpLocation = wpdev_header_value($httpHeaders, 'Location');
    $httpRedirectsToHttps =
        $httpLocation !== null && str_starts_with(strtolower($httpLocation), 'https://');

    $finalHost = $host;
    if (is_string($httpsLocation) && $httpsLocation !== '') {
        $locParts = @parse_url($httpsLocation);
        if (is_array($locParts) && isset($locParts['host']) && is_string($locParts['host'])) {
            $finalHost = strtolower(trim($locParts['host']));
        }
    }
    $finalHostMatches = $finalHost === $host;

    $hints = [];
    if (!$dnsOk) {
        $hints[] = 'No DNS records found for staging host. Add A/AAAA/CNAME in your hosting DNS panel.';
    }
    if (!$httpsOk) {
        $hints[] = 'HTTPS is not healthy yet. Issue/renew SSL certificate for this hostname.';
    }
    if (!$httpRedirectsToHttps) {
        $hints[] = 'HTTP does not redirect to HTTPS. Enable forced HTTPS redirect in hosting settings.';
    }
    if (!$finalHostMatches) {
        $hints[] = 'HTTPS redirects to a different host. Check site URL settings and vhost/domain mapping.';
    }
    if (count($hints) === 0) {
        $hints[] = 'Staging domain check looks good.';
    }

    wpdev_admin_api_log(
        'POST staging-domain-check 200 host=' . $host .
        ' dns=' . ($dnsOk ? 'ok' : 'bad') .
        ' https=' . $httpsStatus .
        ' redirect=' . ($httpRedirectsToHttps ? 'yes' : 'no') .
        ' finalHost=' . $finalHost
    );
    echo json_encode(
        [
            'ok' => true,
            'url' => $url,
            'host' => $host,
            'dns' => ['ok' => $dnsOk, 'records' => $records],
            'https' => [
                'ok' => $httpsOk,
                'status' => $httpsStatus,
                'location' => $httpsLocation,
            ],
            'http' => [
                'status' => $httpStatus,
                'location' => $httpLocation,
                'redirectsToHttps' => $httpRedirectsToHttps,
            ],
            'finalHostMatches' => $finalHostMatches,
            'hints' => $hints,
        ],
        JSON_UNESCAPED_SLASHES
    );
    exit;
}

if ($method === 'POST' && $action === 'staging-db-check') {
    $body = file_get_contents('php://input');
    $in = is_string($body) && trim($body) !== '' ? json_decode($body, true) : null;
    $input = is_array($in) ? $in : [];

    $host = isset($input['host']) && is_string($input['host']) ? trim($input['host']) : '';
    $name = isset($input['name']) && is_string($input['name']) ? trim($input['name']) : '';
    $user = isset($input['user']) && is_string($input['user']) ? trim($input['user']) : '';
    $pass = isset($input['password']) && is_string($input['password']) ? $input['password'] : '';
    $port = isset($input['port']) ? (int) $input['port'] : 3306;

    if ($host === '' || $name === '' || $user === '' || $pass === '') {
        wpdev_json_error(400, 'missing_db_fields', 'Need host, name, user, password');
        wpdev_admin_api_log('POST staging-db-check 400 missing_db_fields');
        exit;
    }
    if ($port < 1 || $port > 65535) {
        wpdev_json_error(400, 'invalid_db_port');
        wpdev_admin_api_log('POST staging-db-check 400 invalid_db_port');
        exit;
    }

    mysqli_report(MYSQLI_REPORT_OFF);
    $mysqli = mysqli_init();
    if ($mysqli === false) {
        wpdev_json_error(500, 'mysqli_init_failed');
        wpdev_admin_api_log('POST staging-db-check 500 mysqli_init_failed');
        exit;
    }
    mysqli_options($mysqli, MYSQLI_OPT_CONNECT_TIMEOUT, 8);
    $ok = @mysqli_real_connect($mysqli, $host, $user, $pass, $name, $port);
    if ($ok !== true) {
        $msg = mysqli_connect_error();
        @mysqli_close($mysqli);
        wpdev_json_error(400, 'db_connect_failed', is_string($msg) ? $msg : 'connect_failed');
        wpdev_admin_api_log('POST staging-db-check 400 db_connect_failed');
        exit;
    }
    $server = (string) @mysqli_get_server_info($mysqli);
    @mysqli_close($mysqli);
    wpdev_admin_api_log('POST staging-db-check 200 ok');
    echo json_encode(
        [
            'ok' => true,
            'message' => 'Database connection OK',
            'server' => $server,
            'database' => $name,
        ],
        JSON_UNESCAPED_SLASHES
    );
    exit;
}

http_response_code(404);
echo json_encode(['ok' => false, 'error' => 'not_found'], JSON_UNESCAPED_SLASHES);
wpdev_admin_api_log('response 404 unknown route');
