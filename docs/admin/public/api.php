<?php
/**
 * wp-dev admin: load/save wp-dev.config.json from the browser (same origin as /admin/).
 * Config and logs are bind-mounted at /wp-dev-repo/ (see docker-compose.yml).
 * Optional: set WPDEV_ADMIN_SAVE_TOKEN in docker/.env — then send header X-WP-DEV-Admin-Token on POST.
 * Validation uses wp-dev.config.schema.json (generated from Zod via `npm run generate:schema`).
 * Appends one line per request to /wp-dev-repo/logs/wp-dev-admin-api.log (no request body logged).
 */
declare(strict_types=1);

require_once __DIR__ . '/schema-validate.inc.php';

header('Content-Type: application/json; charset=utf-8');

$configPath = '/wp-dev-repo/wp-dev.config.json';
$logDir = '/wp-dev-repo/logs';
$logFile = $logDir . '/wp-dev-admin-api.log';
$token = getenv('WPDEV_ADMIN_SAVE_TOKEN') ?: '';
$schemaPath = __DIR__ . '/wp-dev.config.schema.json';

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
    if (file_put_contents($tmp, $encoded) === false) {
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'write_tmp_failed'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 500 write_tmp_failed');
        exit;
    }
    if (!rename($tmp, $configPath)) {
        @unlink($tmp);
        http_response_code(500);
        echo json_encode(['ok' => false, 'error' => 'rename_failed'], JSON_UNESCAPED_SLASHES);
        wpdev_admin_api_log('POST save 500 rename_failed');
        exit;
    }
    $proj = is_string($data['project']) ? $data['project'] : '?';
    wpdev_admin_api_log("POST save 200 ok project={$proj}");
    echo json_encode(['ok' => true], JSON_UNESCAPED_SLASHES);
    exit;
}

http_response_code(404);
echo json_encode(['ok' => false, 'error' => 'not_found'], JSON_UNESCAPED_SLASHES);
wpdev_admin_api_log('response 404 unknown route');
