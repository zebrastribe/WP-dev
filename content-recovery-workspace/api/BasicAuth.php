<?php
declare(strict_types=1);

final class BasicAuth
{
    public static function isEnabled(): bool
    {
        return self::env('IMPORT_BASIC_AUTH_USER') !== '' && self::env('IMPORT_BASIC_AUTH_PASSWORD') !== '';
    }

    public static function check(): void
    {
        $expectedUser = self::env('IMPORT_BASIC_AUTH_USER');
        $expectedPass = self::env('IMPORT_BASIC_AUTH_PASSWORD');
        if ($expectedUser === '' || $expectedPass === '') {
            return;
        }

        $user = (string) ($_SERVER['PHP_AUTH_USER'] ?? '');
        $pass = (string) ($_SERVER['PHP_AUTH_PW'] ?? '');
        if (hash_equals($expectedUser, $user) && hash_equals($expectedPass, $pass)) {
            return;
        }

        header('WWW-Authenticate: Basic realm="Import Workspace"');
        header('Content-Type: text/plain; charset=utf-8');
        http_response_code(401);
        echo 'Unauthorized';
        exit;
    }

    private static function env(string $key): string
    {
        $value = getenv($key);
        if (is_string($value) && $value !== '') {
            return $value;
        }

        static $fileValues = null;
        if ($fileValues === null) {
            $fileValues = self::loadEnvFile(dirname(__DIR__) . '/api/import.auth.env');
        }
        return $fileValues[$key] ?? '';
    }

    /** @return array<string, string> */
    private static function loadEnvFile(string $path): array
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
}
