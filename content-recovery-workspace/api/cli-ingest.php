<?php
declare(strict_types=1);

require_once __DIR__ . '/bootstrap.php';

$repo = crw_repo();
$kb = crw_knowledge_base_path();

if (!is_dir($kb)) {
    fwrite(STDERR, "Knowledge base not found: {$kb}\n");
    exit(1);
}

$ingest = new IngestService($repo, new ContentNormalizer($kb), $kb);
$stats = $ingest->ingestKnowledgeBase();

echo json_encode(['ok' => true, 'project' => crw_project_id(), 'stats' => $stats], JSON_PRETTY_PRINT) . "\n";
