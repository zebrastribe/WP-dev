<?php
$base = '/var/www/html/wp-content/themes/agency-starter/theme';

$dc = "$base/inc/demo-content.php";
$t  = file_get_contents( $dc );
if ( ! str_contains( $t, 'agency_starter_demo_enabled()' ) ) {
	$t = str_replace(
		"function agency_starter_seed_demo_content() {\n\tif ( get_option( 'agency_starter_demo_seeded' ) )",
		"function agency_starter_seed_demo_content() {\n\tif ( ! agency_starter_demo_enabled() ) {\n\t\treturn;\n\t}\n\n\tif ( get_option( 'agency_starter_demo_seeded' ) )",
		$t
	);
	$t = str_replace(
		"function agency_starter_maybe_upgrade_demo() {\n\t\$version = (int) get_option( 'agency_starter_demo_version', 1 );",
		"function agency_starter_maybe_upgrade_demo() {\n\tif ( ! agency_starter_demo_enabled() ) {\n\t\treturn;\n\t}\n\n\t\$version = (int) get_option( 'agency_starter_demo_version', 1 );",
		$t
	);
	$t = str_replace(
		"function agency_starter_admin_demo_upgrade() {\n\tif ( get_option( 'agency_starter_demo_seeded' ) )",
		"function agency_starter_admin_demo_upgrade() {\n\tif ( ! agency_starter_can_run_admin_seeder() ) {\n\t\treturn;\n\t}\n\n\tif ( get_option( 'agency_starter_demo_seeded' ) )",
		$t
	);
	$t = str_replace( "'Terms of Use'   => '#',", "'Terms of Use'   => '/terms-of-use/',", $t );
	file_put_contents( $dc, $t );
	echo "patched demo-content.php\n";
}

$sp = "$base/inc/synced-patterns.php";
$t  = file_get_contents( $sp );
if ( ! str_contains( $t, 'agency_starter_demo_enabled' ) ) {
	$t = preg_replace(
		'/function agency_starter_seed_synced_patterns\(\) \{/',
		"function agency_starter_seed_synced_patterns() {\n\tif ( ! agency_starter_demo_enabled() ) {\n\t\treturn;\n\t}\n",
		$t,
		1
	);
	file_put_contents( $sp, $t );
	echo "patched synced-patterns.php\n";
}

$pl = "$base/inc/plugins.php";
$t  = file_get_contents( $pl );
if ( str_contains( $t, 'agency_starter_language_switcher' ) ) {
	$t = preg_replace(
		'/\n\/\*\*\n \* Output Polylang language switcher[\s\S]*?function agency_starter_language_switcher\(\) \{[\s\S]*?\n\}\n/',
		"\n",
		$t,
		1
	);
}
if ( ! str_contains( $t, 'agency_starter_demo_enabled()' ) ) {
	$t = str_replace(
		"function agency_starter_setup_polylang() {\n\tif ( ! function_exists( 'pll_languages_list' )",
		"function agency_starter_setup_polylang() {\n\tif ( ! agency_starter_demo_enabled() ) {\n\t\treturn;\n\t}\n\n\tif ( ! function_exists( 'pll_languages_list' )",
		$t
	);
	$t = str_replace(
		"function agency_starter_seed_cf7_forms() {\n\tif ( ! class_exists( 'WPCF7_ContactForm' )",
		"function agency_starter_seed_cf7_forms() {\n\tif ( ! agency_starter_can_run_admin_seeder() ) {\n\t\treturn;\n\t}\n\n\tif ( ! class_exists( 'WPCF7_ContactForm' )",
		$t
	);
	$t = str_replace(
		"function agency_starter_ensure_contact_cf7() {\n\tif ( ! class_exists( 'WPCF7_ContactForm' )",
		"function agency_starter_ensure_contact_cf7() {\n\tif ( ! agency_starter_can_run_admin_seeder() ) {\n\t\treturn;\n\t}\n\n\tif ( ! class_exists( 'WPCF7_ContactForm' )",
		$t
	);
}
file_put_contents( $pl, $t );
echo "patched plugins.php\n";

$setup = "$base/inc/setup.php";
$t     = file_get_contents( $setup );
$t     = str_replace( "\n\tadd_theme_support( 'customize-selective-refresh-widgets' );\n", "\n", $t );
file_put_contents( $setup, $t );
echo "patched setup.php\n";
