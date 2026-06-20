<?php
declare(strict_types=1);

final class ContentNormalizer
{
    /** @var array<string, string> */
    private array $inventoryTypes = [];

    /** @var array<string, string> */
    private array $inventoryPurpose = [];

    /** @var array<string, true> */
    private array $jobSlugs = [];

    public function __construct(string $knowledgeBasePath)
    {
        $inventoryPath = $knowledgeBasePath . '/page-inventory.json';
        if (is_readable($inventoryPath)) {
            $rows = json_decode((string) file_get_contents($inventoryPath), true);
            if (is_array($rows)) {
                foreach ($rows as $row) {
                    if (!is_array($row)) {
                        continue;
                    }
                    $slug = $row['slug'] ?? '';
                    $type = $row['content_type'] ?? '';
                    if (is_string($slug) && $slug !== '' && is_string($type)) {
                        $this->inventoryTypes[$slug] = $type;
                        if ($type === 'job') {
                            $this->jobSlugs[$slug] = true;
                        }
                    }
                    $purpose = $row['purpose'] ?? '';
                    if (is_string($slug) && $slug !== '' && is_string($purpose) && $purpose !== '') {
                        $this->inventoryPurpose[$slug] = $purpose;
                    }
                }
            }
        }
    }

    public function isLoaderTitle(string $value): bool
    {
        $v = trim($value);
        return $v === '' || strcasecmp($v, 'Loader') === 0;
    }

    /**
     * Wayback often captures <title>Loader</title> before Divi renders. Prefer h1 and inventory purpose.
     */
    public function resolveTitle(string $slug, array $data): string
    {
        $h1 = trim((string) ($data['h1'] ?? ''));
        if (!$this->isLoaderTitle($h1) && !$this->isImageArtifactTitle($h1)) {
            return $h1;
        }

        foreach (['title', 'meta_title'] as $key) {
            $candidate = trim((string) ($data[$key] ?? ''));
            if (
                !$this->isLoaderTitle($candidate)
                && !$this->isImageArtifactTitle($candidate)
                && strcasecmp($candidate, $slug) !== 0
            ) {
                return $candidate;
            }
        }

        $purpose = $this->inventoryPurpose[$slug] ?? '';
        if ($purpose !== '' && preg_match('/[–-]\s*(.+)$/u', $purpose, $m) === 1) {
            $fromPurpose = trim((string) $m[1]);
            if (!$this->isLoaderTitle($fromPurpose)) {
                return $fromPurpose;
            }
        }

        return $this->humanizeSlug($slug);
    }

    public function humanizeSlug(string $slug): string
    {
        $text = str_replace(['-', '_'], ' ', $slug);
        return mb_convert_case($text, MB_CASE_TITLE, 'UTF-8');
    }

    /**
     * HTML defines h1–h6 only (no h7/h8). Merge scrape fields with body HTML parse.
     *
     * @return array{h1: string, h2: list<string>, h3: list<string>, h4: list<string>, h5: list<string>, h6: list<string>}
     */
    public function extractHeadings(array $data, string $bodyHtml): array
    {
        $headings = [
            'h1' => trim((string) ($data['h1'] ?? '')),
            'h2' => is_array($data['h2s'] ?? null) ? array_values($data['h2s']) : [],
            'h3' => is_array($data['h3s'] ?? null) ? array_values($data['h3s']) : [],
            'h4' => is_array($data['h4s'] ?? null) ? array_values($data['h4s']) : [],
            'h5' => is_array($data['h5s'] ?? null) ? array_values($data['h5s']) : [],
            'h6' => is_array($data['h6s'] ?? null) ? array_values($data['h6s']) : [],
        ];

        if (is_array($data['headings'] ?? null)) {
            foreach (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as $level) {
                if (!array_key_exists($level, $data['headings'])) {
                    continue;
                }
                $value = $data['headings'][$level];
                if ($level === 'h1' && is_string($value) && trim($value) !== '') {
                    $headings['h1'] = trim($value);
                } elseif (is_array($value)) {
                    $headings[$level] = array_values(array_filter(array_map('strval', $value)));
                }
            }
        }

        if ($bodyHtml !== '') {
            $parsed = $this->parseHeadingsFromHtml($bodyHtml);
            if ($headings['h1'] === '' && $parsed['h1'] !== '') {
                $headings['h1'] = $parsed['h1'];
            }
            foreach (['h2', 'h3', 'h4', 'h5', 'h6'] as $level) {
                if ($headings[$level] === []) {
                    $headings[$level] = $parsed[$level];
                }
            }
        }

        return $headings;
    }

    /**
     * @return array{h1: string, h2: list<string>, h3: list<string>, h4: list<string>, h5: list<string>, h6: list<string>}
     */
    private function parseHeadingsFromHtml(string $html): array
    {
        $result = ['h1' => '', 'h2' => [], 'h3' => [], 'h4' => [], 'h5' => [], 'h6' => []];
        $prev = libxml_use_internal_errors(true);
        $dom = new DOMDocument();
        if (@$dom->loadHTML('<?xml encoding="utf-8" ?>' . $html, LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD) === false) {
            libxml_clear_errors();
            libxml_use_internal_errors($prev);
            return $result;
        }
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        foreach (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as $tag) {
            $nodes = $dom->getElementsByTagName($tag);
            $texts = [];
            foreach ($nodes as $node) {
                $text = trim($node->textContent ?? '');
                if ($text !== '') {
                    $texts[] = $text;
                }
            }
            if ($tag === 'h1') {
                $result['h1'] = $texts[0] ?? '';
            } else {
                $result[$tag] = $texts;
            }
        }
        return $result;
    }

    public function isImageArtifactTitle(string $value): bool
    {
        $v = trim($value);
        if ($v === '' || $this->isLoaderTitle($v)) {
            return false;
        }

        $patterns = [
            '/^\(print\)/i',
            '/vplogo/i',
            '/_icon_/i',
            '/cmyk/i',
            '/linkedin-graph/i',
            '/thumbs-news/i',
            '/deloitte-logo/i',
            '/kostner-logo/i',
            '/^web$/i',
            '/-logo(-\d+)?$/i',
            '/\.(png|jpe?g|gif|svg|webp)$/i',
            '/^\d{2,4}x\d{2,4}$/i',
        ];
        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $v) === 1) {
                return true;
            }
        }

        return false;
    }

    public function isImageArtifactSlug(string $slug): bool
    {
        $patterns = [
            '/-vplogo(-\d+)?$/',
            '/-logo(-\d+)?$/',
            '/linkedin-graph/',
            '/thumbs-news/',
            '/-print-/',
            '/-web$/',
            '/deloitte-logo/',
            '/kostner-logo/',
            '/mus-forberedelsesskema/',
        ];
        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $slug) === 1) {
                return true;
            }
        }
        return false;
    }

    public function stripDivi(string $html): string
    {
        $html = preg_replace('/\[(?:et_pb|et)_[^\]]+\]/', '', $html) ?? $html;
        $html = preg_replace('/\sstyle="[^"]*"/i', '', $html) ?? $html;
        $html = preg_replace('/<div[^>]*>\s*<\/div>/', '', $html) ?? $html;
        return trim($html);
    }

    public function cleanBodyHtml(string $html): string
    {
        $html = $this->stripDivi($html);
        $html = preg_replace('/<p[^>]*class="[^"]*attachment[^"]*"[^>]*>.*?<\/p>/is', '', $html) ?? $html;
        $html = preg_replace('/<p[^>]*class="[^"]*post-meta[^"]*"[^>]*>.*?<\/p>/is', '', $html) ?? $html;
        $html = $this->normalizeImageUrls($html);
        return $this->normalizeBodyHtml($html);
    }

    public function normalizeBodyHtml(string $html): string
    {
        $html = trim($html);
        if ($html === '') {
            return '';
        }
        $blocks = $this->extractBodyBlocks($html);
        if ($blocks === []) {
            return $html;
        }
        return $this->blocksToHtml($blocks);
    }

    private function normalizeImageUrls(string $html): string
    {
        return preg_replace_callback(
            '/\bsrc=(["\'])([^"\']+)\1/i',
            function (array $m): string {
                return 'src=' . $m[1] . $this->normalizeMediaUrl($m[2]) . $m[1];
            },
            $html,
        ) ?? $html;
    }

    public function normalizeMediaUrl(string $url): string
    {
        if (preg_match('#^https?://web\.archive\.org/web/\d+im_/(https?://.+)$#i', $url, $m) === 1) {
            return $m[1];
        }
        return $url;
    }

    /**
     * @return list<array{type: string, text?: string, items?: list<string>, src?: string, alt?: string}>
     */
    private function extractBodyBlocks(string $html): array
    {
        $prev = libxml_use_internal_errors(true);
        $dom = new DOMDocument();
        if (@$dom->loadHTML('<?xml encoding="utf-8" ?><div id="crw-root">' . $html . '</div>', LIBXML_HTML_NOIMPLIED | LIBXML_HTML_NODEFDTD) === false) {
            libxml_clear_errors();
            libxml_use_internal_errors($prev);
            return [];
        }
        libxml_clear_errors();
        libxml_use_internal_errors($prev);

        $root = $dom->getElementById('crw-root');
        if ($root === null) {
            return [];
        }

        $blocks = [];
        foreach ($root->childNodes as $child) {
            $this->walkBodyNode($child, $blocks);
        }
        return $blocks;
    }

    /** @param list<array{type: string, text?: string, items?: list<string>, src?: string, alt?: string}> $blocks */
    private function walkBodyNode(DOMNode $node, array &$blocks): void
    {
        if ($node->nodeType === XML_TEXT_NODE) {
            $text = trim(preg_replace('/\s+/u', ' ', $node->textContent ?? '') ?? '');
            if ($text !== '') {
                $blocks[] = ['type' => 'p', 'text' => $text];
            }
            return;
        }

        if ($node->nodeType !== XML_ELEMENT_NODE) {
            return;
        }

        /** @var DOMElement $el */
        $el = $node;
        $tag = strtolower($el->tagName);
        $class = $el->getAttribute('class');

        if ($this->isDiviChrome($class)) {
            return;
        }

        if ($tag === 'h1') {
            return;
        }

        if (in_array($tag, ['h2', 'h3', 'h4', 'h5', 'h6'], true)) {
            $text = $this->elementText($el);
            if ($text !== '') {
                $blocks[] = ['type' => $tag, 'text' => $text];
            }
            return;
        }

        if ($tag === 'p') {
            $text = $this->elementText($el);
            if ($text !== '') {
                $blocks[] = ['type' => 'p', 'text' => $text];
            }
            return;
        }

        if ($tag === 'img') {
            $src = $this->normalizeMediaUrl($el->getAttribute('src'));
            if ($src !== '') {
                $blocks[] = [
                    'type' => 'img',
                    'src' => $src,
                    'alt' => trim($el->getAttribute('alt')),
                ];
            }
            return;
        }

        if ($tag === 'ul' || $tag === 'ol') {
            $items = [];
            foreach ($el->childNodes as $child) {
                if ($child->nodeType === XML_ELEMENT_NODE && strtolower($child->nodeName) === 'li') {
                    $item = $this->elementText($child);
                    if ($item !== '') {
                        $items[] = $item;
                    }
                }
            }
            if ($items !== []) {
                $blocks[] = ['type' => $tag, 'items' => $items];
            }
            return;
        }

        if ($tag === 'li') {
            return;
        }

        foreach ($el->childNodes as $child) {
            $this->walkBodyNode($child, $blocks);
        }
    }

    private function isDiviChrome(string $class): bool
    {
        if ($class === '') {
            return false;
        }
        $skip = [
            'et_pb_fullwidth_menu',
            'mobile_nav',
            'et_mobile_nav_menu',
            'et_pb_fullwidth_header_overlay',
            'et_pb_fullwidth_header_scroll',
            'et_parallax_bg',
            'et_parallax_bg_wrap',
        ];
        foreach ($skip as $needle) {
            if (str_contains($class, $needle)) {
                return true;
            }
        }
        return false;
    }

    private function elementText(DOMElement $el): string
    {
        return trim(preg_replace('/\s+/u', ' ', $el->textContent ?? '') ?? '');
    }

    /**
     * @param list<array{type: string, text?: string, items?: list<string>, src?: string, alt?: string}> $blocks
     */
    private function blocksToHtml(array $blocks): string
    {
        $parts = [];
        foreach ($blocks as $block) {
            $type = $block['type'];
            if ($type === 'p') {
                $parts[] = '<p>' . htmlspecialchars((string) ($block['text'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8') . '</p>';
            } elseif ($type === 'ul' || $type === 'ol') {
                $items = '';
                foreach ($block['items'] ?? [] as $item) {
                    $items .= '<li>' . htmlspecialchars($item, ENT_QUOTES | ENT_HTML5, 'UTF-8') . '</li>';
                }
                $parts[] = '<' . $type . '>' . $items . '</' . $type . '>';
            } elseif ($type === 'img') {
                $src = htmlspecialchars((string) ($block['src'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                $alt = htmlspecialchars((string) ($block['alt'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8');
                $parts[] = '<img src="' . $src . '" alt="' . $alt . '"/>';
            } elseif (in_array($type, ['h2', 'h3', 'h4', 'h5', 'h6'], true)) {
                $parts[] = '<' . $type . '>' . htmlspecialchars((string) ($block['text'] ?? ''), ENT_QUOTES | ENT_HTML5, 'UTF-8') . '</' . $type . '>';
            }
        }
        return implode("\n", $parts);
    }

    public function detectObjectType(string $slug, string $folder, array $data): string
    {
        if (isset($this->inventoryTypes[$slug])) {
            $type = $this->inventoryTypes[$slug];
            if ($type === 'job') {
                return 'job';
            }
            if ($type === 'post') {
                return 'post';
            }
            if ($type === 'page') {
                return $this->isAttachmentCandidate($data) ? 'page' : 'page';
            }
        }

        if ($folder === 'posts' && isset($this->jobSlugs[$slug])) {
            return 'job';
        }

        if ($folder === 'posts') {
            return 'post';
        }

        return 'page';
    }

    public function isAttachmentCandidate(array $data): bool
    {
        $html = (string) ($data['body_html'] ?? '');
        return str_contains($html, 'type-attachment') || str_contains($html, 'class="attachment"');
    }

    public function shouldExclude(array $data, string $slug): bool
    {
        if (str_starts_with($slug, 'author-')) {
            return true;
        }
        if (in_array($slug, ['index-htm', 'project'], true)) {
            return true;
        }
        if ($this->isImageArtifactSlug($slug)) {
            return true;
        }
        if ($this->isAttachmentCandidate($data)) {
            return true;
        }
        $title = trim((string) ($data['title'] ?? ''));
        if ($this->isImageArtifactTitle($title)) {
            return true;
        }
        $body = trim((string) ($data['body_text'] ?? ''));
        if (
            strlen($body) < 40
            && ($this->isImageArtifactTitle($title) || $this->isImageArtifactTitle($body))
        ) {
            return true;
        }
        return false;
    }

    public function initialStatus(string $slug, array $data): string
    {
        $title = $this->resolveTitle($slug, $data);
        if ($this->isLoaderTitle($title)) {
            return 'needs_review';
        }
        $body = trim((string) ($data['body_text'] ?? ''));
        if ($body === '' || strlen($body) < 20) {
            return 'needs_review';
        }
        return 'recovered';
    }

    public function wpEntityType(string $objectType): string
    {
        return match ($objectType) {
            'post' => 'post',
            'job' => 'job',
            'page' => 'page',
            default => 'page',
        };
    }

    public function compatibilityScore(array $object, ?array $seo): int
    {
        $score = 0;
        $payload = is_array($object['payload'] ?? null) ? $object['payload'] : [];
        $title = trim((string) ($object['title'] ?? ''));
        if ($title !== '' && strcasecmp($title, 'Loader') !== 0) {
            $score += 15;
        }
        $body = trim((string) ($payload['body_text'] ?? ''));
        if ($body !== '' && strlen($body) >= 20) {
            $score += 15;
        }
        if (!empty($object['slug'])) {
            $score += 10;
        }
        $score += 10;
        if (!empty($seo['seo_title']) || !empty($object['title'])) {
            $score += 10;
        }
        if (!empty($seo['meta_description'])) {
            $score += 10;
        }
        if (($object['status'] ?? '') === 'approved') {
            $score += 15;
        } elseif (in_array($object['status'] ?? '', ['reviewed', 'ready_for_export', 'exported'], true)) {
            $score += 10;
        }
        if (!str_contains((string) ($payload['body_html'] ?? ''), 'web.archive.org')) {
            $score += 15;
        }
        return min(100, $score);
    }
}
