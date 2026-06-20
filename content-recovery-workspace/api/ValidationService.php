<?php
declare(strict_types=1);

final class ValidationService
{
    public function __construct(private ObjectRepository $repo) {}

    public function validateProject(): array
    {
        $pdo = crw_db()->pdo();
        $projectId = crw_project_id();
        $errors = [];
        $warnings = [];

        $stmt = $pdo->prepare(
            "SELECT * FROM content_object WHERE project_id = ? AND status NOT IN ('excluded') AND object_type IN ('page','post','job')"
        );
        $stmt->execute([$projectId]);
        $objects = $stmt->fetchAll();

        $slugs = [];
        $canonicals = [];

        foreach ($objects as $row) {
            $payload = json_decode((string) $row['payload_json'], true) ?: [];
            $slug = (string) $row['slug'];
            $title = trim((string) $row['title']);
            $id = (string) $row['id'];

            if (isset($slugs[$slug])) {
                $errors[] = ['code' => 'E005', 'message' => "Duplicate slug: {$slug}"];
            }
            $slugs[$slug] = true;

            if ($title === '') {
                $errors[] = ['code' => 'E002', 'message' => "{$slug} has empty title", 'object_id' => $id];
            }
            if (strcasecmp($title, 'Loader') === 0) {
                $errors[] = ['code' => 'E003', 'message' => "{$slug} title is Loader", 'object_id' => $id];
            }

            $body = trim((string) ($payload['body_text'] ?? ''));
            if ($body === '' && in_array($row['object_type'], ['page', 'post', 'job'], true)) {
                $errors[] = ['code' => 'E004', 'message' => "{$slug} body is empty", 'object_id' => $id];
            }

            if (!in_array($row['status'], ['approved', 'ready_for_export', 'exported'], true)) {
                $errors[] = ['code' => 'E001', 'message' => "{$slug} status is {$row['status']}, must be approved", 'object_id' => $id];
            }

            if ((int) $row['compatibility_score'] < 80) {
                $errors[] = ['code' => 'E019', 'message' => "{$slug} score {$row['compatibility_score']}% below threshold", 'object_id' => $id];
            }

            if (str_contains((string) ($payload['body_html'] ?? ''), 'web.archive.org')) {
                $errors[] = ['code' => 'E020', 'message' => "Wayback URL found in {$slug}", 'object_id' => $id];
            }

            $seo = $this->repo->getSeo($id);
            if (empty($seo['meta_description'])) {
                $warnings[] = ['code' => 'W001', 'message' => "{$slug} missing meta description", 'object_id' => $id];
            }
            $canonical = (string) ($seo['canonical_url'] ?? '');
            if ($canonical !== '') {
                if (isset($canonicals[$canonical])) {
                    $errors[] = ['code' => 'E011', 'message' => "Canonical conflict on {$canonical}", 'object_id' => $id];
                }
                $canonicals[$canonical] = $slug;
            }
        }

        $scores = array_map(fn ($r) => (int) $r['compatibility_score'], $objects);
        $avg = count($scores) > 0 ? (int) round(array_sum($scores) / count($scores)) : 0;

        return [
            'ok' => count($errors) === 0,
            'errors' => $errors,
            'warnings' => $warnings,
            'object_count' => count($objects),
            'compatibility_avg' => $avg,
            'passed' => count($objects) - count(array_unique(array_column($errors, 'object_id'))),
        ];
    }
}
