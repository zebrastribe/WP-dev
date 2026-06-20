<?php
declare(strict_types=1);

require_once __DIR__ . '/BasicAuth.php';
require_once __DIR__ . '/Database.php';
require_once __DIR__ . '/Auth.php';

BasicAuth::check();
require_once __DIR__ . '/Normalizer.php';
require_once __DIR__ . '/ObjectRepository.php';
require_once __DIR__ . '/IngestService.php';
require_once __DIR__ . '/ValidationService.php';
require_once __DIR__ . '/ExportService.php';

function crw_json_response(array $data, int $code = 200): never
{
    http_response_code($code);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function crw_read_json_body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || $raw === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

function crw_read_env_file(string $path): array
{
    if (!is_readable($path)) {
        return [];
    }
    $out = [];
    foreach (file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [] as $line) {
        $line = trim($line);
        if ($line === '' || str_starts_with($line, '#')) {
            continue;
        }
        $eq = strpos($line, '=');
        if ($eq === false) {
            continue;
        }
        $out[substr($line, 0, $eq)] = substr($line, $eq + 1);
    }
    return $out;
}

function crw_read_project_env(string $path): ?string
{
    $value = crw_read_env_file($path)['WPDEV_PROJECT'] ?? '';
    return is_string($value) && $value !== '' ? $value : null;
}

function crw_project_config(): array
{
    static $config = null;
    if ($config !== null) {
        return $config;
    }

    $paths = [
        '/wp-dev-repo/wp-dev.config.json',
        dirname(__DIR__, 2) . '/wp-dev.config.json',
    ];

    foreach ($paths as $path) {
        if (!is_readable($path)) {
            continue;
        }
        $json = json_decode((string) file_get_contents($path), true);
        if (is_array($json)) {
            $config = $json;
            return $config;
        }
    }

    $project = getenv('WPDEV_PROJECT');
    if (!is_string($project) || $project === '') {
        $project = crw_read_project_env(dirname(__DIR__) . '/project.env') ?? 'default';
    }
    $config = ['project' => $project];
    return $config;
}

function crw_project_id(): string
{
    $config = crw_project_config();
    $id = $config['project'] ?? 'default';
    return is_string($id) && $id !== '' ? $id : 'default';
}

function crw_storage_root(): string
{
    $candidates = [
        '/import-storage',
        dirname(__DIR__) . '/storage',
    ];
    foreach ($candidates as $path) {
        if (is_dir($path) || @mkdir($path, 0775, true)) {
            return $path;
        }
    }
    return dirname(__DIR__) . '/storage';
}

function crw_project_dir(): string
{
    $dir = crw_storage_root() . '/' . crw_project_id();
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir;
}

function crw_db_path(): string
{
    return crw_project_dir() . '/repository.sqlite';
}

function crw_knowledge_base_path(): string
{
    $envKb = getenv('WPDEV_KNOWLEDGE_BASE');
    if (is_string($envKb) && $envKb !== '' && is_dir($envKb)) {
        return $envKb;
    }

    $config = crw_project_config();
    $import = $config['importWorkspace']['knowledgeBasePath'] ?? null;
    if (is_string($import) && $import !== '' && is_dir($import)) {
        return $import;
    }

    $candidates = [
        '/workspace/knowledge-base',
        dirname(__DIR__, 3) . '/knowledge-base',
    ];
    foreach ($candidates as $path) {
        if (is_dir($path)) {
            return $path;
        }
    }
    return dirname(__DIR__, 3) . '/knowledge-base';
}

function crw_exports_dir(): string
{
    $dir = crw_project_dir() . '/exports';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    return $dir;
}

function crw_now(): string
{
    return gmdate('c');
}

function crw_uuid(): string
{
    $data = random_bytes(16);
    $data[6] = chr(ord($data[6]) & 0x0f | 0x40);
    $data[8] = chr(ord($data[8]) & 0x3f | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

function crw_db(): Database
{
    static $db = null;
    if ($db === null) {
        $db = new Database(crw_db_path(), __DIR__ . '/schema.sql');
    }
    return $db;
}

function crw_repo(): ObjectRepository
{
    return new ObjectRepository(crw_db(), crw_project_id());
}

function crw_audit(string $action, ?string $objectId = null, ?array $details = null, ?string $actor = null): void
{
    $pdo = crw_db()->pdo();
    $stmt = $pdo->prepare(
        'INSERT INTO audit_log (project_id, action, object_id, actor, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    );
    $stmt->execute([
        crw_project_id(),
        $action,
        $objectId,
        $actor ?? 'api',
        $details !== null ? json_encode($details) : null,
        crw_now(),
    ]);
}
