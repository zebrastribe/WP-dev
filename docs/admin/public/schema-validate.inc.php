<?php
/**
 * Minimal JSON Schema draft-07 validation for wp-dev.config.json (subset used by generated schema).
 * Loads wp-dev.config.schema.json next to this file — keep in sync via `npm run generate:schema`.
 */
declare(strict_types=1);

/**
 * @param mixed $data
 * @param array<string, mixed> $doc full schema document (with definitions)
 */
function wpdev_validate_against_schema(mixed $data, array $doc): ?string
{
    if (!isset($doc['definitions']) || !is_array($doc['definitions'])) {
        return 'schema_missing_definitions';
    }
    $root = $doc;
    if (isset($doc['$ref']) && is_string($doc['$ref'])) {
        if (preg_match('#^#/definitions/([A-Za-z0-9_]+)$#', $doc['$ref'], $m)) {
            $name = $m[1];
            if (!isset($doc['definitions'][$name]) || !is_array($doc['definitions'][$name])) {
                return 'schema_bad_ref';
            }
            $root = $doc['definitions'][$name];
        }
    }
    return wpdev_validate_node($data, $root, $doc, '');
}

/**
 * @param array<string, mixed> $schema
 * @param array<string, mixed> $doc
 */
function wpdev_validate_node(mixed $data, array $schema, array $doc, string $path): ?string
{
    $type = $schema['type'] ?? null;

    if ($type === 'string') {
        if (!is_string($data)) {
            return 'invalid_type:' . ($path !== '' ? $path : 'root');
        }
        if (isset($schema['minLength']) && is_int($schema['minLength']) && strlen($data) < $schema['minLength']) {
            return 'minLength:' . $path;
        }
        if (isset($schema['maxLength']) && is_int($schema['maxLength']) && strlen($data) > $schema['maxLength']) {
            return 'maxLength:' . $path;
        }
        if (isset($schema['pattern']) && is_string($schema['pattern'])) {
            $p = $schema['pattern'];
            if (@preg_match('#' . str_replace('#', '\#', $p) . '#u', $data) !== 1) {
                return 'pattern:' . $path;
            }
        }
        if (isset($schema['format']) && $schema['format'] === 'uri' && filter_var($data, FILTER_VALIDATE_URL) === false) {
            return 'format_uri:' . $path;
        }
        return null;
    }

    if ($type === 'integer') {
        if (is_int($data)) {
            $n = $data;
        } elseif (is_float($data) && floor($data) === $data) {
            $n = (int) $data;
        } else {
            return 'not_integer:' . $path;
        }
        if (isset($schema['exclusiveMinimum']) && is_int($schema['exclusiveMinimum']) && $n <= $schema['exclusiveMinimum']) {
            return 'exclusiveMinimum:' . $path;
        }
        return null;
    }

    if ($type === 'object') {
        if (!is_array($data) || array_is_list($data)) {
            return 'invalid_type:' . ($path !== '' ? $path : 'root');
        }
        /** @var array<string, mixed> $obj */
        $obj = $data;
        $props = isset($schema['properties']) && is_array($schema['properties']) ? $schema['properties'] : [];
        $required = isset($schema['required']) && is_array($schema['required']) ? $schema['required'] : [];
        foreach ($required as $key) {
            if (!is_string($key) || !array_key_exists($key, $obj)) {
                return 'required:' . ($path !== '' ? $path . '.' : '') . $key;
            }
        }
        $add = $schema['additionalProperties'] ?? true;
        foreach ($obj as $key => $val) {
            if (!is_string($key)) {
                continue;
            }
            if ($add === false && !array_key_exists($key, $props)) {
                return 'additionalProperties:' . ($path !== '' ? $path . '.' : '') . $key;
            }
            if (isset($props[$key]) && is_array($props[$key])) {
                $child = $props[$key];
                $next = $path !== '' ? $path . '.' . $key : $key;
                $err = wpdev_validate_node($val, $child, $doc, $next);
                if ($err !== null) {
                    return $err;
                }
            }
        }
        return null;
    }

    return $type !== null ? 'unsupported_type:' . (string) $type . ':' . $path : null;
}
