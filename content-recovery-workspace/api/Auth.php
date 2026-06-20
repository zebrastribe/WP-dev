<?php
declare(strict_types=1);

final class Auth
{
    public static function check(): void
    {
        $expected = getenv('WPDEV_IMPORT_TOKEN') ?: '';
        if ($expected === '') {
            return;
        }

        $header = $_SERVER['HTTP_X_WP_DEV_IMPORT_TOKEN'] ?? '';
        if (!is_string($header) || !hash_equals($expected, $header)) {
            crw_json_response(['ok' => false, 'error' => 'unauthorized'], 401);
        }
    }
}
