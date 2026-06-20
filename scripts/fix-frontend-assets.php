<?php
/**
 * Restore frontend style.css + script.min.js enqueue (removed in P1 patch).
 */
$path = '/var/www/html/wp-content/themes/agency-starter/theme/inc/enqueue.php';
$content = file_get_contents( $path );

if ( str_contains( $content, 'agency_starter_enqueue_frontend_assets' ) ) {
	echo "already patched\n";
	exit( 0 );
}

$patch = <<<'PHP'

/**
 * Main theme stylesheet and mobile navigation script.
 */
function agency_starter_enqueue_frontend_assets() {
	wp_enqueue_style(
		'agency-starter-style',
		get_stylesheet_uri(),
		array( 'global-styles' ),
		AGENCY_STARTER_VERSION
	);

	wp_enqueue_script(
		'agency-starter-script',
		get_template_directory_uri() . '/js/script.min.js',
		array(),
		AGENCY_STARTER_VERSION,
		true
	);
}
add_action( 'wp_enqueue_scripts', 'agency_starter_enqueue_frontend_assets' );

PHP;

$anchor = "add_action( 'wp_head', 'agency_starter_critical_header_css', 100 );";
if ( ! str_contains( $content, $anchor ) ) {
	fwrite( STDERR, "anchor not found\n" );
	exit( 1 );
}

$content = str_replace( $anchor, $anchor . $patch, $content );
file_put_contents( $path, $content );
echo "restored frontend assets enqueue\n";
