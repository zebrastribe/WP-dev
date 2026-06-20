<?php
declare(strict_types=1);

require_once __DIR__ . '/api/BasicAuth.php';
BasicAuth::check();

$html = __DIR__ . '/index.html';
if (!is_readable($html)) {
    http_response_code(500);
    header('Content-Type: text/plain; charset=utf-8');
    echo 'index.html missing';
    exit;
}

header('Content-Type: text/html; charset=utf-8');
readfile($html);
