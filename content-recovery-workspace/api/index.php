<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

Auth::check();

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$path = $_GET['path'] ?? '';
$segments = array_values(array_filter(explode('/', trim((string) $path, '/'))));
$repo = crw_repo();

try {
    if ($path === 'health' || ($segments[0] ?? '') === 'health') {
        $env = crw_read_env_file(dirname(__DIR__) . '/project.env');
        $clientMode = BasicAuth::isEnabled() || (($env['UI_MODE'] ?? '') === 'client');
        crw_json_response([
            'ok' => true,
            'project' => crw_project_id(),
            'db' => is_readable(crw_db_path()),
            'knowledge_base' => is_dir(crw_knowledge_base_path()),
            'client_mode' => $clientMode,
            'requires_token' => trim((string) getenv('WPDEV_IMPORT_TOKEN')) !== '',
        ]);
    }

    if ($method === 'GET' && ($segments[0] ?? '') === 'stats') {
        crw_json_response([
            'ok' => true,
            'project' => crw_project_id(),
            'counts' => $repo->countsByType(),
            'db_path' => crw_db_path(),
        ]);
    }

    if ($method === 'GET' && ($segments[0] ?? '') === 'objects') {
        $type = $_GET['type'] ?? null;
        $status = $_GET['status'] ?? null;
        $search = $_GET['search'] ?? null;
        $limit = min(500, max(1, (int) ($_GET['limit'] ?? 200)));
        $offset = max(0, (int) ($_GET['offset'] ?? 0));
        crw_json_response([
            'ok' => true,
            'objects' => $repo->listObjects($type ?: null, $status ?: null, $search ?: null, $limit, $offset),
        ]);
    }

    if ($method === 'GET' && ($segments[0] ?? '') === 'object' && isset($segments[1])) {
        $object = $repo->getObject($segments[1]);
        if ($object === null) {
            crw_json_response(['ok' => false, 'error' => 'not_found'], 404);
        }
        crw_json_response(['ok' => true, 'object' => $object]);
    }

    if ($method === 'PATCH' && ($segments[0] ?? '') === 'object' && isset($segments[1])) {
        $body = crw_read_json_body();
        $updated = $repo->updateObject($segments[1], $body, (string) ($body['actor'] ?? 'editor'));
        if ($updated === null) {
            crw_json_response(['ok' => false, 'error' => 'not_found'], 404);
        }
        crw_json_response(['ok' => true, 'object' => $updated]);
    }

    if ($method === 'GET' && ($segments[0] ?? '') === 'search') {
        $q = (string) ($_GET['q'] ?? '');
        crw_json_response(['ok' => true, 'results' => $repo->search($q)]);
    }

    if ($method === 'GET' && ($segments[0] ?? '') === 'nav') {
        $pdo = crw_db()->pdo();
        $menus = $pdo->prepare('SELECT * FROM nav_menu WHERE project_id = ?');
        $menus->execute([crw_project_id()]);
        $menuRows = $menus->fetchAll();
        $out = [];
        foreach ($menuRows as $menu) {
            $items = $pdo->prepare('SELECT * FROM nav_item WHERE menu_id = ? ORDER BY sort_order');
            $items->execute([$menu['id']]);
            $out[] = ['menu' => $menu, 'items' => $items->fetchAll()];
        }
        crw_json_response(['ok' => true, 'navigation' => $out]);
    }

    if ($method === 'POST' && ($segments[0] ?? '') === 'import' && ($segments[1] ?? '') === 'knowledge-base') {
        $ingest = new IngestService(
            $repo,
            new ContentNormalizer(crw_knowledge_base_path()),
            crw_knowledge_base_path(),
        );
        $stats = $ingest->ingestKnowledgeBase();
        crw_json_response(['ok' => true, 'stats' => $stats]);
    }

    if ($method === 'GET' && ($segments[0] ?? '') === 'validate') {
        $validation = new ValidationService($repo);
        crw_json_response(['ok' => true, 'report' => $validation->validateProject()]);
    }

    if ($method === 'POST' && ($segments[0] ?? '') === 'export') {
        $body = crw_read_json_body();
        $format = (string) ($body['format'] ?? $_GET['format'] ?? 'wxr');
        $export = new ExportService($repo, new ValidationService($repo));
        $result = $export->export($format);
        if (!$result['ok']) {
            crw_json_response($result, 422);
        }
        crw_json_response($result);
    }

    crw_json_response(['ok' => false, 'error' => 'not_found', 'path' => $path], 404);
} catch (Throwable $e) {
    crw_json_response(['ok' => false, 'error' => $e->getMessage()], 500);
}
