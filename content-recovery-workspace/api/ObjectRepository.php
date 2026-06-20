<?php
declare(strict_types=1);

final class ObjectRepository
{
    public function __construct(
        private Database $db,
        private string $projectId,
    ) {}

    public function ensureProject(string $name, ?string $sourceDomain = null): void
    {
        $pdo = $this->db->pdo();
        $stmt = $pdo->prepare('SELECT id FROM project WHERE id = ?');
        $stmt->execute([$this->projectId]);
        if ($stmt->fetch()) {
            return;
        }
        $insert = $pdo->prepare(
            'INSERT INTO project (id, name, source_domain, created_at) VALUES (?, ?, ?, ?)'
        );
        $insert->execute([$this->projectId, $name, $sourceDomain, crw_now()]);
    }

    public function listObjects(?string $type = null, ?string $status = null, ?string $search = null, int $limit = 200, int $offset = 0): array
    {
        $pdo = $this->db->pdo();
        $sql = 'SELECT id, object_type, slug, title, status, locale, compatibility_score, updated_at, payload_json
                FROM content_object WHERE project_id = ?';
        $params = [$this->projectId];

        if ($type !== null && $type !== '') {
            $sql .= ' AND object_type = ?';
            $params[] = $type;
        }
        if ($status !== null && $status !== '') {
            $sql .= ' AND status = ?';
            $params[] = $status;
        }
        if ($search !== null && $search !== '') {
            $sql .= ' AND (title LIKE ? OR slug LIKE ? OR payload_json LIKE ?)';
            $q = '%' . $search . '%';
            $params[] = $q;
            $params[] = $q;
            $params[] = $q;
        }

        $sql .= ' ORDER BY object_type, title COLLATE NOCASE LIMIT ? OFFSET ?';
        $params[] = $limit;
        $params[] = $offset;

        $stmt = $pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        return array_map(fn ($row) => $this->mapListRow($row), $rows);
    }

    public function countsByType(): array
    {
        $pdo = $this->db->pdo();
        $stmt = $pdo->prepare(
            'SELECT object_type, status, COUNT(*) AS cnt FROM content_object WHERE project_id = ? GROUP BY object_type, status'
        );
        $stmt->execute([$this->projectId]);
        $rows = $stmt->fetchAll();
        $out = [];
        foreach ($rows as $row) {
            $type = $row['object_type'];
            if (!isset($out[$type])) {
                $out[$type] = ['total' => 0, 'by_status' => []];
            }
            $cnt = (int) $row['cnt'];
            $out[$type]['total'] += $cnt;
            $out[$type]['by_status'][$row['status']] = $cnt;
        }
        return $out;
    }

    public function getObject(string $id): ?array
    {
        $pdo = $this->db->pdo();
        $stmt = $pdo->prepare('SELECT * FROM content_object WHERE id = ? AND project_id = ?');
        $stmt->execute([$id, $this->projectId]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        return $this->mapFullRow($row);
    }

    public function updateObject(string $id, array $patch, string $actor = 'api'): ?array
    {
        $existing = $this->getObject($id);
        if ($existing === null) {
            return null;
        }

        $pdo = $this->db->pdo();
        $pdo->beginTransaction();
        try {
            $title = array_key_exists('title', $patch) ? (string) $patch['title'] : $existing['title'];
            $status = array_key_exists('status', $patch) ? (string) $patch['status'] : $existing['status'];
            $payload = array_key_exists('payload', $patch) && is_array($patch['payload'])
                ? array_merge($existing['payload'], $patch['payload'])
                : $existing['payload'];

            $seoPatch = is_array($patch['seo'] ?? null) ? $patch['seo'] : null;
            $seo = $this->getSeo($id);
            if ($seoPatch !== null) {
                $seo = array_merge($seo ?? [], $seoPatch);
                $this->upsertSeo($id, $seo);
            }

            $objectForScore = [
                'title' => $title,
                'slug' => $existing['slug'],
                'status' => $status,
                'payload' => $payload,
            ];
            $normalizer = new ContentNormalizer(crw_knowledge_base_path());
            $score = $normalizer->compatibilityScore($objectForScore, $seo);

            $now = crw_now();
            $approvedAt = $existing['approved_at'];
            $approvedBy = $existing['approved_by'];
            if ($status === 'approved' && $existing['status'] !== 'approved') {
                $approvedAt = $now;
                $approvedBy = $actor;
            }

            $stmt = $pdo->prepare(
                'UPDATE content_object SET title = ?, status = ?, payload_json = ?, compatibility_score = ?,
                 updated_at = ?, updated_by = ?, approved_at = ?, approved_by = ? WHERE id = ?'
            );
            $stmt->execute([
                $title,
                $status,
                json_encode($payload, JSON_UNESCAPED_UNICODE),
                $score,
                $now,
                $actor,
                $approvedAt,
                $approvedBy,
                $id,
            ]);

            $versionNumber = $this->nextVersionNumber($id);
            $versionStmt = $pdo->prepare(
                'INSERT INTO object_version (object_id, version_number, payload_json, created_at, created_by, source)
                 VALUES (?, ?, ?, ?, ?, ?)'
            );
            $versionStmt->execute([
                $id,
                $versionNumber,
                json_encode($payload, JSON_UNESCAPED_UNICODE),
                $now,
                $actor,
                $patch['version_source'] ?? 'manual',
            ]);

            if (array_key_exists('change_note', $patch) && is_string($patch['change_note'])) {
                $noteStmt = $pdo->prepare('UPDATE object_version SET change_note = ? WHERE object_id = ? AND version_number = ?');
                $noteStmt->execute([$patch['change_note'], $id, $versionNumber]);
            }

            if ($existing['object_type'] === 'header' && is_array($payload['menu_items'] ?? null)) {
                $this->syncPrimaryNavItems($pdo, $payload['menu_items']);
            }

            $pdo->commit();
            crw_audit('object.update', $id, ['status' => $status], $actor);
            return $this->getObject($id);
        } catch (Throwable $e) {
            $pdo->rollBack();
            throw $e;
        }
    }

    public function getVersions(string $objectId): array
    {
        $stmt = $this->db->pdo()->prepare(
            'SELECT version_number, change_note, created_at, created_by, source FROM object_version
             WHERE object_id = ? ORDER BY version_number DESC'
        );
        $stmt->execute([$objectId]);
        return $stmt->fetchAll();
    }

    public function getEvidence(string $objectId): array
    {
        $stmt = $this->db->pdo()->prepare(
            'SELECT id, evidence_type, value, metadata_json, created_at FROM evidence WHERE object_id = ? ORDER BY created_at'
        );
        $stmt->execute([$objectId]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$row) {
            $row['metadata'] = $row['metadata_json'] ? json_decode($row['metadata_json'], true) : null;
            unset($row['metadata_json']);
        }
        return $rows;
    }

    public function getSeo(string $objectId): ?array
    {
        $stmt = $this->db->pdo()->prepare('SELECT * FROM seo_meta WHERE object_id = ?');
        $stmt->execute([$objectId]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }
        unset($row['object_id']);
        return $row;
    }

    public function upsertSeo(string $objectId, array $seo): void
    {
        $stmt = $this->db->pdo()->prepare(
            'INSERT INTO seo_meta (object_id, seo_title, meta_description, canonical_url, og_title, og_description, schema_json, noindex)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(object_id) DO UPDATE SET
               seo_title = excluded.seo_title,
               meta_description = excluded.meta_description,
               canonical_url = excluded.canonical_url,
               og_title = excluded.og_title,
               og_description = excluded.og_description,
               schema_json = excluded.schema_json,
               noindex = excluded.noindex'
        );
        $stmt->execute([
            $objectId,
            $seo['seo_title'] ?? null,
            $seo['meta_description'] ?? null,
            $seo['canonical_url'] ?? null,
            $seo['og_title'] ?? null,
            $seo['og_description'] ?? null,
            $seo['schema_json'] ?? null,
            !empty($seo['noindex']) ? 1 : 0,
        ]);
    }

    public function search(string $query, int $limit = 50): array
    {
        return $this->listObjects(null, null, $query, $limit, 0);
    }

    private function nextVersionNumber(string $objectId): int
    {
        $stmt = $this->db->pdo()->prepare('SELECT COALESCE(MAX(version_number), 0) + 1 FROM object_version WHERE object_id = ?');
        $stmt->execute([$objectId]);
        return (int) $stmt->fetchColumn();
    }

    private function mapListRow(array $row): array
    {
        $payload = json_decode((string) $row['payload_json'], true);
        return [
            'id' => $row['id'],
            'object_type' => $row['object_type'],
            'slug' => $row['slug'],
            'title' => $row['title'],
            'status' => $row['status'],
            'locale' => $row['locale'],
            'compatibility_score' => (int) $row['compatibility_score'],
            'updated_at' => $row['updated_at'],
            'excerpt' => is_array($payload) ? mb_substr((string) ($payload['body_text'] ?? ''), 0, 120) : '',
        ];
    }

    private function mapFullRow(array $row): array
    {
        $payload = json_decode((string) $row['payload_json'], true);
        return [
            'id' => $row['id'],
            'object_type' => $row['object_type'],
            'slug' => $row['slug'],
            'title' => $row['title'],
            'status' => $row['status'],
            'wp_entity_type' => $row['wp_entity_type'],
            'wp_entity_id' => $row['wp_entity_id'],
            'parent_id' => $row['parent_id'],
            'locale' => $row['locale'],
            'compatibility_score' => (int) $row['compatibility_score'],
            'compatibility_issues' => $row['compatibility_issues_json']
                ? json_decode($row['compatibility_issues_json'], true)
                : [],
            'payload' => is_array($payload) ? $payload : [],
            'seo' => $this->getSeo($row['id']),
            'evidence' => $this->getEvidence($row['id']),
            'versions' => $this->getVersions($row['id']),
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
            'updated_by' => $row['updated_by'],
            'approved_at' => $row['approved_at'],
            'approved_by' => $row['approved_by'],
        ];
    }

    /** @param list<array<string, mixed>> $menuItems */
    private function syncPrimaryNavItems(PDO $pdo, array $menuItems): void
    {
        $menuId = 'primary-menu';
        $pdo->prepare('DELETE FROM nav_item WHERE menu_id = ?')->execute([$menuId]);
        $order = 0;
        foreach ($menuItems as $item) {
            if (!is_array($item)) {
                continue;
            }
            $label = trim((string) ($item['label'] ?? ''));
            if ($label === '') {
                continue;
            }
            $insert = $pdo->prepare(
                'INSERT INTO nav_item (id, menu_id, label, url, sort_order) VALUES (?, ?, ?, ?, ?)'
            );
            $insert->execute([
                crw_uuid(),
                $menuId,
                $label,
                (string) ($item['url'] ?? ''),
                $order++,
            ]);
        }
    }
}
