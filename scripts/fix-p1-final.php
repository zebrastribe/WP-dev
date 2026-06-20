<?php
/**
 * Final P1: a11y-contrast enqueue, i18n line cleanup.
 */
$theme = '/var/www/html/wp-content/themes/agency-starter/theme';
$enqueue = "$theme/inc/enqueue.php";

// Re-enqueue contrast fixes after global styles.
$content = file_get_contents( $enqueue );
if ( ! str_contains( $content, 'agency_starter_enqueue_a11y_contrast' ) ) {
	$patch = <<<'PHP'

/**
 * Late-loaded contrast overrides (footer muted text, CTA buttons).
 */
function agency_starter_enqueue_a11y_contrast() {
	wp_enqueue_style(
		'agency-starter-a11y-contrast',
		get_template_directory_uri() . '/css/a11y-contrast.css',
		array( 'global-styles' ),
		AGENCY_STARTER_VERSION
	);
}
add_action( 'wp_enqueue_scripts', 'agency_starter_enqueue_a11y_contrast', 100 );

PHP;
	$content = str_replace(
		"add_action( 'wp_head', 'agency_starter_critical_header_css', 100 );",
		"add_action( 'wp_head', 'agency_starter_critical_header_css', 100 );" . $patch,
		$content
	);
	file_put_contents( $enqueue, $content );
	echo "enqueue a11y-contrast\n";
} else {
	echo "enqueue already patched\n";
}

// i18n: drop obsolete map entries line by line.
$i18n_path = "$theme/inc/i18n-parts.php";
$lines     = file( $i18n_path );
$filtered  = array_filter(
	$lines,
	static function ( $line ) {
		if ( str_contains( $line, "'href=\"#'\"" ) ) {
			return false;
		}
		if ( str_contains( $line, "'aria-label=\"Primary\"'" ) ) {
			return false;
		}
		if ( str_contains( $line, "'<p class=\"has-sm-font-size\">|</p>'" ) ) {
			return false;
		}
		return true;
	}
);
file_put_contents( $i18n_path, implode( '', $filtered ) );
echo "i18n-parts line filter done\n";
