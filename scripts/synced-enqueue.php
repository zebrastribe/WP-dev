<?php
/**
 * Absolute URI to self-hosted Raleway font files.
 *
 * @return string
 */
function agency_starter_fonts_uri() {
	return trailingslashit( get_template_directory_uri() . '/assets/fonts' );
}

/**
 * Print @font-face rules with absolute URLs (avoids broken relative paths in bundled CSS).
 */
function agency_starter_print_font_faces() {
	$base    = agency_starter_fonts_uri();
	$weights = array( 400, 500, 600, 700 );

	echo "<style id=\"agency-font-faces\">\n";
	foreach ( $weights as $weight ) {
		printf(
			"@font-face{font-family:'Raleway';font-style:normal;font-weight:%d;font-display:swap;src:url('%sraleway-%d.woff2') format('woff2')}\n",
			(int) $weight,
			esc_url( $base ),
			(int) $weight // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- integer font-weight in printf %d.
		);
	}
	echo "</style>\n";
}
add_action( 'wp_head', 'agency_starter_print_font_faces', 1 );

/**
 * Preload fonts used on first paint (body 400, nav 600).
 */
function agency_starter_preload_fonts() {
	$base = agency_starter_fonts_uri();
	foreach ( array( 400, 600, 700 ) as $weight ) {
		printf(
			'<link rel="preload" href="%s" as="font" type="font/woff2" crossorigin>' . "\n",
			esc_url( $base . 'raleway-' . $weight . '.woff2' )
		);
	}
}
add_action( 'wp_head', 'agency_starter_preload_fonts', 2 );

/**
 * Critical header layout — printed after WP global styles to prevent desktop shift.
 */
function agency_starter_critical_header_css() {
	$css = <<<'CSS'
:root{--agency-container-padding-x:1rem;--agency-container-size:75rem}
@media(min-width:36em){:root{--agency-container-padding-x:2rem}}
.agency-container{width:100%;max-width:var(--agency-container-size);margin-inline:auto;padding-inline:var(--agency-container-padding-x);box-sizing:border-box}
.site-header-shell{position:sticky;top:0;z-index:40;background:var(--wp--preset--color--background,#fff)}
.site-header{border-bottom:1px solid var(--wp--preset--color--border,#e5e7eb)}
.site-header__inner{display:flex;align-items:center;gap:24px;min-height:72px;padding-block:16px}
.site-header__brand{flex:0 0 auto;min-width:0}
.site-header__actions{display:flex;align-items:center;justify-content:flex-end;gap:24px;flex:0 0 auto;margin-left:auto;min-height:44px}
.site-header .wp-block-site-title a{font-size:1.25rem;font-weight:700;color:var(--wp--preset--color--foreground,#1f2937);text-decoration:none}
.site-header .desktop-nav{display:none}
.site-header .wp-block-navigation__container{display:flex;flex-wrap:nowrap;align-items:center;gap:24px;list-style:none;margin:0;padding:0}
.site-header .wp-block-navigation-item__content{font-size:.875rem;font-weight:600;color:var(--wp--preset--color--foreground,#1f2937);text-decoration:none;padding:.375rem 0;white-space:nowrap}
.site-header .mobile-nav-toggle{display:inline-flex;align-items:center;justify-content:center;min-height:44px;min-width:44px;flex-shrink:0;color:var(--wp--preset--color--foreground,#1f2937)}
@media(min-width:64em){
.site-header .desktop-nav{display:flex}
.site-header .mobile-nav-toggle{display:none}
}
CSS;

	echo '<style id="agency-critical-header">' . $css . '</style>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static heredoc CSS.
}
add_action( 'wp_head', 'agency_starter_critical_header_css', 100 );
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


/**
 * Output skip link for keyboard and screen reader users.
 */
function agency_starter_skip_link() {
	echo '<a class="skip-link screen-reader-text bg-primary text-inverse focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:px-4 focus:py-2" href="#content">' . esc_html__( 'Skip to content', 'agency-starter' ) . '</a>';
}
add_action( 'wp_body_open', 'agency_starter_skip_link', 5 );

/**
 * Use theme skip link only — avoid duplicate core skip link.
 */
function agency_starter_remove_core_skip_link() {
	remove_action( 'wp_body_open', 'wp_print_skip_link' );
	remove_action( 'wp_enqueue_scripts', 'wp_enqueue_block_template_skip_link' );
	remove_action( 'wp_footer', 'the_block_template_skip_link' );
}
add_action( 'init', 'agency_starter_remove_core_skip_link', 0 );

/**
 * Enqueue block editor script.
 */
function agency_starter_enqueue_block_editor_script() {
	$current_screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;

	if (
		$current_screen &&
		$current_screen->is_block_editor() &&
		'widgets' !== $current_screen->id
	) {
		wp_enqueue_script(
			'agency-starter-editor',
			get_template_directory_uri() . '/js/block-editor.min.js',
			array(
				'wp-blocks',
				'wp-edit-post',
			),
			AGENCY_STARTER_VERSION,
			true
		);
		wp_add_inline_script( 'agency-starter-editor', "tailwindTypographyClasses = '" . esc_attr( AGENCY_STARTER_TYPOGRAPHY_CLASSES ) . "'.split(' ');", 'before' );
	}
}
add_action( 'enqueue_block_assets', 'agency_starter_enqueue_block_editor_script' );
