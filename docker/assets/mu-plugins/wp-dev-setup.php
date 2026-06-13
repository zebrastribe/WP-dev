<?php
/**
 * Plugin Name: wp-dev setup redirect
 * Description: Sends visitors to /admin/ until WordPress is installed (fresh clone onboarding).
 */
declare(strict_types=1);

add_action(
    'init',
    static function (): void {
        if (is_blog_installed()) {
            return;
        }
        $path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
        if (
            str_starts_with($path, '/admin')
            || str_starts_with($path, '/wp-admin')
            || str_starts_with($path, '/wp-login')
        ) {
            return;
        }
        wp_safe_redirect(home_url('/admin/'));
        exit;
    },
    1
);
