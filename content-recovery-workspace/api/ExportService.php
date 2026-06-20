<?php
declare(strict_types=1);

final class ExportService
{
    public function __construct(
        private ObjectRepository $repo,
        private ValidationService $validation,
    ) {}

    public function export(string $format = 'wxr'): array
    {
        $report = $this->validation->validateProject();
        if (!$report['ok']) {
            return ['ok' => false, 'validation' => $report];
        }

        $timestamp = gmdate('Y-m-d_His');
        $dir = crw_exports_dir() . '/' . $timestamp;
        mkdir($dir, 0775, true);

        $pdo = crw_db()->pdo();
        $stmt = $pdo->prepare(
            "SELECT * FROM content_object WHERE project_id = ? AND status IN ('approved','ready_for_export','exported')
             AND object_type IN ('page','post','job') ORDER BY object_type, title"
        );
        $stmt->execute([crw_project_id()]);
        $objects = $stmt->fetchAll();

        $files = [];
        if ($format === 'wxr' || $format === 'all') {
            $wxrPath = $dir . '/content.wxr';
            file_put_contents($wxrPath, $this->buildWxr($objects));
            $files[] = 'content.wxr';
        }

        if ($format === 'json' || $format === 'all') {
            $backup = $this->buildJsonBackup($objects);
            $jsonPath = $dir . '/project-backup.json';
            file_put_contents($jsonPath, json_encode($backup, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            $files[] = 'project-backup.json';
        }

        if ($format === 'csv' || $format === 'all') {
            $csvPath = $dir . '/content-inventory.csv';
            file_put_contents($csvPath, $this->buildInventoryCsv($objects));
            $files[] = 'content-inventory.csv';
        }

        if ($format === 'all') {
            $navPath = $dir . '/navigation.json';
            file_put_contents($navPath, json_encode($this->buildNavigationExport($pdo), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            $files[] = 'navigation.json';
        }

        $exportReport = [
            'export_id' => crw_uuid(),
            'exported_at' => crw_now(),
            'format' => $format,
            'object_count' => count($objects),
            'validation' => $report,
            'files' => $files,
            'directory' => $dir,
        ];
        file_put_contents($dir . '/export-report.json', json_encode($exportReport, JSON_PRETTY_PRINT));

        $update = $pdo->prepare("UPDATE content_object SET status = 'exported' WHERE project_id = ? AND status = 'approved'");
        $update->execute([crw_project_id()]);

        crw_audit('export', null, $exportReport);
        return ['ok' => true, 'export' => $exportReport];
    }

    /** @param array<int, array<string, mixed>> $objects */
    private function buildWxr(array $objects): string
    {
        $siteUrl = crw_project_config()['local']['url'] ?? 'http://localhost:8889';
        $xml = '<?xml version="1.0" encoding="' . 'UTF-8' . '"?' . ">\n";
        $xml .= '<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:wp="http://wordpress.org/export/1.2/">';
        $xml .= '<channel>';
        $xml .= '<title>Content Recovery Export</title>';
        $xml .= '<link>' . htmlspecialchars((string) $siteUrl) . '</link>';
        $xml .= '<wp:wxr_version>1.2</wp:wxr_version>';

        foreach ($objects as $row) {
            $payload = json_decode((string) $row['payload_json'], true) ?: [];
            $postType = match ($row['object_type']) {
                'post' => 'post',
                'job' => 'job',
                default => 'page',
            };
            $content = (string) ($payload['body_html'] ?? '');
            $title = htmlspecialchars((string) $row['title']);
            $slug = htmlspecialchars((string) $row['slug']);
            $guid = htmlspecialchars((string) ($payload['original_url'] ?? $siteUrl . '/' . $row['slug'] . '/'));

            $xml .= '<item>';
            $xml .= '<title>' . $title . '</title>';
            $xml .= '<link>' . $guid . '</link>';
            $xml .= '<content:encoded><![CDATA[' . $content . ']]></content:encoded>';
            $xml .= '<excerpt:encoded><![CDATA[]]></excerpt:encoded>';
            $xml .= '<wp:post_type>' . $postType . '</wp:post_type>';
            $xml .= '<wp:status>draft</wp:status>';
            $xml .= '<wp:post_name>' . $slug . '</wp:post_name>';
            $xml .= '</item>';
        }

        $xml .= '</channel></rss>';
        return $xml;
    }

    /** @param array<int, array<string, mixed>> $objects */
    private function buildInventoryCsv(array $objects): string
    {
        $lines = ['slug,type,title,status,compatibility_score'];
        foreach ($objects as $row) {
            $lines[] = sprintf(
                '%s,%s,"%s",%s,%d',
                $row['slug'],
                $row['object_type'],
                str_replace('"', '""', (string) $row['title']),
                $row['status'],
                (int) $row['compatibility_score'],
            );
        }
        return implode("\n", $lines) . "\n";
    }

    /** @param array<int, array<string, mixed>> $objects */
    private function buildJsonBackup(array $objects): array
    {
        $backup = [
            'schema_version' => '1.0.0',
            'project_id' => crw_project_id(),
            'exported_at' => crw_now(),
            'objects' => [],
        ];
        foreach ($objects as $row) {
            $obj = $this->repo->getObject((string) $row['id']);
            if ($obj) {
                $backup['objects'][] = $obj;
            }
        }
        return $backup;
    }

    private function buildNavigationExport(PDO $pdo): array
    {
        $stmt = $pdo->prepare(
            "SELECT object_type, slug, title, status, payload_json FROM content_object
             WHERE project_id = ? AND object_type IN ('header', 'footer')
             AND status IN ('approved', 'ready_for_export', 'exported')"
        );
        $stmt->execute([crw_project_id()]);
        $rows = $stmt->fetchAll();
        $out = ['header' => null, 'footer' => null];
        foreach ($rows as $row) {
            $payload = json_decode((string) $row['payload_json'], true);
            if (!is_array($payload)) {
                continue;
            }
            $key = $row['object_type'] === 'header' ? 'header' : 'footer';
            $out[$key] = [
                'title' => $row['title'],
                'status' => $row['status'],
                'menu_items' => $payload['menu_items'] ?? [],
                'body_html' => $payload['body_html'] ?? '',
            ];
        }
        return $out;
    }
}
