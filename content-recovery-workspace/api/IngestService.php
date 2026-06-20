<?php
declare(strict_types=1);

final class IngestService
{
    public function __construct(
        private ObjectRepository $repo,
        private ContentNormalizer $normalizer,
        private string $knowledgeBasePath,
    ) {}

    public function ingestKnowledgeBase(): array
    {
        $pdo = crw_db()->pdo();
        $this->repo->ensureProject($this->projectName(), 'https://www.timework.dk');

        $stats = [
            'created' => 0,
            'updated' => 0,
            'skipped' => 0,
            'excluded' => 0,
            'services' => 0,
            'nav' => 0,
            'titles_fixed' => 0,
        ];
        $contentRoot = $this->knowledgeBasePath . '/content';

        foreach (['pages' => 'pages', 'posts' => 'posts'] as $folder => $label) {
            $dir = $contentRoot . '/' . $folder;
            if (!is_dir($dir)) {
                continue;
            }
            foreach (glob($dir . '/*.json') ?: [] as $file) {
                $data = json_decode((string) file_get_contents($file), true);
                if (!is_array($data)) {
                    $stats['skipped']++;
                    continue;
                }
                $slug = (string) ($data['slug'] ?? basename($file, '.json'));
                $result = $this->upsertContentObject($pdo, $slug, $folder, $data, $stats);
                if ($result === 'excluded') {
                    $stats['excluded']++;
                } else {
                    $stats[$result]++;
                }
            }
        }

        $stats['services'] = $this->ingestServices($pdo);
        $stats['nav'] = $this->ingestNavigation($pdo);

        crw_audit('import.knowledge-base', null, $stats);
        return $stats;
    }

    private function upsertContentObject(PDO $pdo, string $slug, string $folder, array $data, array &$stats): string
    {
        $objectType = $this->normalizer->detectObjectType($slug, $folder, $data);
        $exclude = $this->normalizer->shouldExclude($data, $slug);
        if ($exclude) {
            $this->removeContentObjectIfExists($pdo, $slug, $objectType);
            return 'excluded';
        }
        $bodyHtml = $this->normalizer->cleanBodyHtml((string) ($data['body_html'] ?? ''));
        $rawTitle = (string) ($data['title'] ?? $slug);
        $title = $this->normalizer->resolveTitle($slug, $data);
        if ($this->normalizer->isLoaderTitle($rawTitle) && !$this->normalizer->isLoaderTitle($title)) {
            $stats['titles_fixed']++;
        }
        $headings = $this->normalizer->extractHeadings($data, $bodyHtml);
        $h1 = $headings['h1'] !== '' ? $headings['h1'] : $title;
        $status = $this->normalizer->initialStatus($slug, $data);
        $bodyText = $this->buildBodyText($bodyHtml, (string) ($data['body_text'] ?? ''));

        $payload = [
            'title' => $title,
            'h1' => $h1,
            'headings' => $headings,
            'body_html' => $bodyHtml,
            'body_text' => $bodyText,
            'h2s' => $headings['h2'],
            'cta_buttons' => $data['cta_buttons'] ?? [],
            'downloads' => $data['downloads'] ?? [],
            'exclude_from_import' => false,
            'original_url' => (string) ($data['url'] ?? ''),
            'confidence' => $data['confidence'] ?? null,
            'title_was_loader' => $this->normalizer->isLoaderTitle($rawTitle),
        ];

        $stmt = $pdo->prepare(
            'SELECT id FROM content_object WHERE project_id = ? AND object_type = ? AND slug = ? AND locale = ?'
        );
        $stmt->execute([crw_project_id(), $objectType, $slug, 'da']);
        $existingId = $stmt->fetchColumn();

        $now = crw_now();
        $wpEntity = $this->normalizer->wpEntityType($objectType);
        $normalizer = $this->normalizer;
        $score = $normalizer->compatibilityScore([
            'title' => $title,
            'slug' => $slug,
            'status' => $status,
            'payload' => $payload,
        ], [
            'seo_title' => $this->normalizer->isLoaderTitle((string) ($data['meta_title'] ?? ''))
                ? $title
                : (string) ($data['meta_title'] ?? $title),
            'meta_description' => $data['meta_description'] ?? '',
        ]);

        if ($existingId) {
            $update = $pdo->prepare(
                'UPDATE content_object SET title = ?, status = ?, payload_json = ?, compatibility_score = ?,
                 wp_entity_type = ?, updated_at = ? WHERE id = ?'
            );
            $update->execute([
                $title,
                $status,
                json_encode($payload, JSON_UNESCAPED_UNICODE),
                $score,
                $wpEntity,
                $now,
                $existingId,
            ]);
            $objectId = (string) $existingId;
            $result = 'updated';
        } else {
            $objectId = crw_uuid();
            $insert = $pdo->prepare(
                'INSERT INTO content_object (
                    id, project_id, object_type, slug, title, status, wp_entity_type, locale,
                    compatibility_score, payload_json, created_at, updated_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
            );
            $insert->execute([
                $objectId,
                crw_project_id(),
                $objectType,
                $slug,
                $title,
                $status,
                $wpEntity,
                'da',
                $score,
                json_encode($payload, JSON_UNESCAPED_UNICODE),
                $now,
                $now,
            ]);
            $version = $pdo->prepare(
                'INSERT INTO object_version (object_id, version_number, payload_json, created_at, created_by, source)
                 VALUES (?, 1, ?, ?, ?, ?)'
            );
            $version->execute([
                $objectId,
                json_encode($payload, JSON_UNESCAPED_UNICODE),
                $now,
                'ingest',
                'recovered',
            ]);
            $result = 'created';
        }

        $this->upsertSeo($pdo, $objectId, $data);
        $this->upsertEvidence($pdo, $objectId, $data);
        $this->upsertMedia($pdo, $objectId, $data);

        return $result;
    }

    private function upsertSeo(PDO $pdo, string $objectId, array $data): void
    {
        $repo = $this->repo;
        $resolvedTitle = $this->normalizer->resolveTitle((string) ($data['slug'] ?? ''), $data);
        $seoTitle = $this->normalizer->isLoaderTitle((string) ($data['meta_title'] ?? ''))
            ? $resolvedTitle
            : (string) ($data['meta_title'] ?? $resolvedTitle);
        $repo->upsertSeo($objectId, [
            'seo_title' => $seoTitle,
            'meta_description' => (string) ($data['meta_description'] ?? ''),
            'canonical_url' => (string) ($data['url'] ?? ''),
            'og_title' => $seoTitle,
            'og_description' => (string) ($data['meta_description'] ?? ''),
        ]);
    }

    private function upsertEvidence(PDO $pdo, string $objectId, array $data): void
    {
        $url = (string) ($data['url'] ?? '');
        if ($url !== '') {
            $this->insertEvidenceIfMissing($pdo, $objectId, 'original_url', $url);
        }
        foreach ($data['sources'] ?? [] as $source) {
            if (is_string($source)) {
                $this->insertEvidenceIfMissing($pdo, $objectId, 'recovery_source', $source);
            }
        }
        if ($url !== '' && str_contains($url, 'timework.dk')) {
            $this->insertEvidenceIfMissing($pdo, $objectId, 'recovery_source', 'knowledge-base');
        }
    }

    private function insertEvidenceIfMissing(PDO $pdo, string $objectId, string $type, string $value): void
    {
        $check = $pdo->prepare('SELECT id FROM evidence WHERE object_id = ? AND evidence_type = ? AND value = ?');
        $check->execute([$objectId, $type, $value]);
        if ($check->fetch()) {
            return;
        }
        $insert = $pdo->prepare(
            'INSERT INTO evidence (id, object_id, evidence_type, value, created_at) VALUES (?, ?, ?, ?, ?)'
        );
        $insert->execute([crw_uuid(), $objectId, $type, $value, crw_now()]);
    }

    private function upsertMedia(PDO $pdo, string $objectId, array $data): void
    {
        foreach ($data['images'] ?? [] as $image) {
            if (!is_array($image)) {
                continue;
            }
            $original = (string) ($image['source_url'] ?? '');
            $filename = (string) ($image['filename'] ?? basename(parse_url($original, PHP_URL_PATH) ?: 'file'));
            if ($original === '') {
                continue;
            }

            $find = $pdo->prepare('SELECT id FROM media_ref WHERE project_id = ? AND original_url = ?');
            $find->execute([crw_project_id(), $original]);
            $mediaId = $find->fetchColumn();
            if (!$mediaId) {
                $mediaId = crw_uuid();
                $insert = $pdo->prepare(
                    'INSERT INTO media_ref (id, project_id, filename, original_url, wayback_url, local_path, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?)'
                );
                $insert->execute([
                    $mediaId,
                    crw_project_id(),
                    $filename,
                    $original,
                    (string) ($image['archived_url'] ?? ''),
                    (string) ($image['local_path'] ?? ''),
                    !empty($image['local_path']) ? 'downloaded' : 'referenced',
                ]);
            }

            $link = $pdo->prepare(
                'INSERT OR IGNORE INTO object_media (object_id, media_id, role) VALUES (?, ?, ?)'
            );
            $link->execute([$objectId, $mediaId, 'inline']);
        }
    }

    private function ingestServices(PDO $pdo): int
    {
        $path = $this->knowledgeBasePath . '/services.json';
        if (!is_readable($path)) {
            return 0;
        }
        $data = json_decode((string) file_get_contents($path), true);
        $count = 0;
        foreach ($data['services'] ?? [] as $service) {
            if (!is_array($service)) {
                continue;
            }
            $slug = (string) ($service['id'] ?? '');
            $name = (string) ($service['name'] ?? $slug);
            if ($slug === '') {
                continue;
            }

            $pageSlugs = is_array($service['pages'] ?? null) ? $service['pages'] : [];
            $payload = [
                'name' => $name,
                'page_slugs' => $pageSlugs,
                'description' => $this->serviceDescription($name, $pageSlugs),
                'body_text' => $this->serviceDescription($name, $pageSlugs),
            ];

            $stmt = $pdo->prepare(
                'SELECT id FROM content_object WHERE project_id = ? AND object_type = ? AND slug = ?'
            );
            $stmt->execute([crw_project_id(), 'service', $slug]);
            $existing = $stmt->fetchColumn();
            $now = crw_now();

            if ($existing) {
                $upd = $pdo->prepare('UPDATE content_object SET title = ?, payload_json = ?, updated_at = ? WHERE id = ?');
                $upd->execute([$name, json_encode($payload), $now, $existing]);
            } else {
                $id = crw_uuid();
                $ins = $pdo->prepare(
                    'INSERT INTO content_object (id, project_id, object_type, slug, title, status, wp_entity_type,
                     payload_json, created_at, updated_at, compatibility_score)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
                );
                $ins->execute([
                    $id, crw_project_id(), 'service', $slug, $name, 'recovered', 'page',
                    json_encode($payload), $now, $now, 100,
                ]);
            }
            $count++;
        }
        return $count;
    }

    private function ingestNavigation(PDO $pdo): int
    {
        $path = $this->knowledgeBasePath . '/navigation.json';
        if (!is_readable($path)) {
            return 0;
        }
        $data = json_decode((string) file_get_contents($path), true);
        $menuId = 'primary-menu';
        $now = crw_now();

        $menuStmt = $pdo->prepare('SELECT id FROM nav_menu WHERE id = ?');
        $menuStmt->execute([$menuId]);
        if (!$menuStmt->fetch()) {
            $insertMenu = $pdo->prepare(
                'INSERT INTO nav_menu (id, project_id, slug, name, locale) VALUES (?, ?, ?, ?, ?)'
            );
            $insertMenu->execute([$menuId, crw_project_id(), 'primary', 'Primary Menu', 'da']);
        }

        $pdo->prepare('DELETE FROM nav_item WHERE menu_id = ?')->execute([$menuId]);

        $order = 0;
        foreach ($data['main_menu'] ?? [] as $item) {
            if (!is_array($item)) {
                continue;
            }
            $insert = $pdo->prepare(
                'INSERT INTO nav_item (id, menu_id, label, url, sort_order) VALUES (?, ?, ?, ?, ?)'
            );
            $insert->execute([
                crw_uuid(),
                $menuId,
                (string) ($item['label'] ?? ''),
                (string) ($item['url'] ?? ''),
                $order++,
            ]);
        }

        $this->upsertGlobalPart($pdo, 'global-header', 'header', 'Header', $this->buildHeaderPayload($data), $now);
        $this->upsertGlobalPart($pdo, 'global-footer', 'footer', 'Footer', $this->buildFooterPayload($data), $now);

        return count($data['main_menu'] ?? []);
    }

    private function upsertGlobalPart(PDO $pdo, string $id, string $type, string $title, array $payload, string $now): void
    {
        $check = $pdo->prepare('SELECT id FROM content_object WHERE id = ?');
        $check->execute([$id]);
        $json = json_encode($payload, JSON_UNESCAPED_UNICODE);
        if ($check->fetch()) {
            $upd = $pdo->prepare(
                'UPDATE content_object SET title = ?, payload_json = ?, updated_at = ?, compatibility_score = 80 WHERE id = ?'
            );
            $upd->execute([$title, $json, $now, $id]);
            return;
        }
        $ins = $pdo->prepare(
            'INSERT INTO content_object (id, project_id, object_type, slug, title, status, wp_entity_type,
             payload_json, created_at, updated_at, compatibility_score)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $ins->execute([
            $id, crw_project_id(), $type, $type, $title, 'recovered', 'theme_mod',
            $json, $now, $now, 80,
        ]);
    }

    /** @param array<string, mixed> $navData */
    private function buildHeaderPayload(array $navData): array
    {
        $items = [];
        foreach ($navData['main_menu'] ?? [] as $item) {
            if (!is_array($item)) {
                continue;
            }
            $items[] = [
                'label' => (string) ($item['label'] ?? ''),
                'url' => (string) ($item['url'] ?? ''),
            ];
        }
        $lines = ["<!-- Recovered primary navigation -->", "<nav aria-label=\"Primary\">", "<ul>"];
        foreach ($items as $item) {
            $lines[] = sprintf(
                '  <li><a href="%s">%s</a></li>',
                htmlspecialchars($item['url'], ENT_QUOTES),
                htmlspecialchars($item['label'], ENT_QUOTES),
            );
        }
        $lines[] = '</ul></nav>';
        $html = implode("\n", $lines);
        return [
            'template_part' => 'header',
            'blocks_html' => $html,
            'body_html' => $html,
            'body_text' => implode(' · ', array_column($items, 'label')),
            'menu_items' => $items,
        ];
    }

    /** @param array<string, mixed> $navData */
    private function buildFooterPayload(array $navData): array
    {
        $footerItems = is_array($navData['footer_menu'] ?? null) ? $navData['footer_menu'] : [];
        if ($footerItems === []) {
            $footerItems = [
                ['label' => 'Kontakt', 'url' => '/kontakt/'],
                ['label' => 'Privatlivspolitik', 'url' => '/kandidater/privatlivspolitik/'],
                ['label' => 'Om TimeWork', 'url' => '/om-timework/'],
            ];
        }
        foreach ($navData['utility_navigation'] ?? [] as $item) {
            if (is_array($item)) {
                $footerItems[] = $item;
            }
        }
        $lines = ["<!-- Recovered footer navigation -->", '<nav aria-label="Footer">', '<ul>'];
        foreach ($footerItems as $item) {
            if (!is_array($item)) {
                continue;
            }
            $lines[] = sprintf(
                '  <li><a href="%s">%s</a></li>',
                htmlspecialchars((string) ($item['url'] ?? ''), ENT_QUOTES),
                htmlspecialchars((string) ($item['label'] ?? ''), ENT_QUOTES),
            );
        }
        $lines[] = '</ul></nav>';
        $html = implode("\n", $lines);
        return [
            'template_part' => 'footer',
            'blocks_html' => $html,
            'body_html' => $html,
            'body_text' => implode(' · ', array_map(fn ($i) => (string) ($i['label'] ?? ''), $footerItems)),
            'menu_items' => $footerItems,
        ];
    }

    /** @param list<string> $pageSlugs */
    private function serviceDescription(string $name, array $pageSlugs): string
    {
        if ($pageSlugs === []) {
            return $name;
        }
        return $name . ' — linked pages: ' . implode(', ', $pageSlugs);
    }

    private function projectName(): string
    {
        $config = crw_project_config();
        return (string) ($config['project'] ?? 'default');
    }

    private function buildBodyText(string $bodyHtml, string $fallback): string
    {
        if ($bodyHtml === '') {
            return $fallback;
        }
        $withBreaks = str_replace(
            ['</p>', '<br>', '<br/>', '<br />', '</li>', '</h1>', '</h2>', '</h3>', '</h4>', '</h5>', '</h6>'],
            ["\n\n", "\n", "\n", "\n", "\n", "\n", "\n", "\n", "\n", "\n", "\n"],
            $bodyHtml,
        );
        $text = html_entity_decode(strip_tags($withBreaks), ENT_QUOTES | ENT_HTML5, 'UTF-8');
        $text = trim(preg_replace('/\n{3,}/', "\n\n", $text) ?? $text);
        return $text !== '' ? $text : $fallback;
    }

    private function removeContentObjectIfExists(PDO $pdo, string $slug, string $objectType): void
    {
        $stmt = $pdo->prepare(
            'SELECT id FROM content_object WHERE project_id = ? AND object_type = ? AND slug = ? AND locale = ?'
        );
        $stmt->execute([crw_project_id(), $objectType, $slug, 'da']);
        $existingId = $stmt->fetchColumn();
        if (!$existingId) {
            return;
        }
        $objectId = (string) $existingId;
        foreach (['object_media', 'evidence', 'seo_meta', 'object_version'] as $table) {
            $pdo->prepare("DELETE FROM {$table} WHERE object_id = ?")->execute([$objectId]);
        }
        $pdo->prepare('DELETE FROM content_object WHERE id = ?')->execute([$objectId]);
    }
}
