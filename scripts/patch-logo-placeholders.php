<?php
/**
 * Logo admin support + theme image placeholders.
 */
require_once '/var/www/html/wp-load.php';

$theme = '/var/www/html/wp-content/themes/agency-starter/theme';
$root  = '/var/www/html/wp-content/themes/agency-starter';

// --- inc/media.php ---
file_put_contents(
	"$theme/inc/media.php",
	<<<'PHP'
<?php
/**
 * Placeholder images and featured-image fallbacks.
 *
 * @package Agency_Starter
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Supported placeholder asset keys.
 *
 * @return array<string, string> slug => filename
 */
function agency_starter_placeholder_files() {
	return array(
		'hero'     => 'hero-abstract.svg',
		'blog'     => 'blog-featured.svg',
		'square'   => 'image-1x1.svg',
		'wide'     => 'image-16x9.svg',
		'logo'     => 'logo-slot.svg',
		'avatar'   => 'avatar-initials.svg',
	);
}

/**
 * URL for a theme placeholder image.
 *
 * @param string $slug hero|blog|square|wide|logo|avatar
 * @return string
 */
function agency_starter_placeholder_url( $slug ) {
	$files = agency_starter_placeholder_files();
	$file  = $files[ $slug ] ?? $files['wide'];

	return get_template_directory_uri() . '/assets/images/placeholders/' . $file;
}

/**
 * Output placeholder featured image when a post has no thumbnail.
 *
 * @param string $block_content Block HTML.
 * @param array  $block         Block data.
 * @return string
 */
function agency_starter_post_featured_image_placeholder( $block_content, $block ) {
	if ( is_admin() || has_post_thumbnail() ) {
		return $block_content;
	}

	$class = $block['attrs']['className'] ?? '';
	$ratio = $block['attrs']['aspectRatio'] ?? '16/9';
	$link  = ! empty( $block['attrs']['isLink'] );
	$url   = agency_starter_placeholder_url( 'blog' );
	$alt   = get_the_title() ? get_the_title() : __( 'Article image placeholder', 'agency-starter' );

	$img = sprintf(
		'<img src="%s" alt="%s" class="agency-post-card__image--placeholder" loading="lazy" decoding="async" />',
		esc_url( $url ),
		esc_attr( $alt )
	);

	if ( $link ) {
		$img = sprintf( '<a href="%s">%s</a>', esc_url( get_permalink() ), $img );
	}

	$classes = trim( 'wp-block-post-featured-image agency-post-card__image agency-post-card__image--empty ' . $class );

	return sprintf(
		'<figure class="%s" style="aspect-ratio:%s">%s</figure>',
		esc_attr( $classes ),
		esc_attr( str_replace( '/', ' / ', $ratio ) ),
		$img
	);
}
add_filter( 'render_block_core/post-featured-image', 'agency_starter_post_featured_image_placeholder', 10, 2 );

PHP
);
echo "wrote media.php\n";

// --- functions.php: require media.php ---
$functions = file_get_contents( "$theme/functions.php" );
if ( ! str_contains( $functions, 'inc/media.php' ) ) {
	$functions = str_replace(
		"require get_template_directory() . '/inc/demo.php';\n",
		"require get_template_directory() . '/inc/demo.php';\nrequire get_template_directory() . '/inc/media.php';\n",
		$functions
	);
	file_put_contents( "$theme/functions.php", $functions );
	echo "patched functions.php\n";
}

// --- setup.php: custom-logo ---
$setup = file_get_contents( "$theme/inc/setup.php" );
if ( ! str_contains( $setup, 'custom-logo' ) ) {
	$setup = str_replace(
		"\tadd_theme_support( 'post-thumbnails' );\n",
		"\tadd_theme_support( 'post-thumbnails' );\n\n\tadd_theme_support(\n\t\t'custom-logo',\n\t\tarray(\n\t\t\t'height'      => 80,\n\t\t\t'width'       => 240,\n\t\t\t'flex-height' => true,\n\t\t\t'flex-width'  => true,\n\t\t)\n\t);\n",
		$setup
	);
	file_put_contents( "$theme/inc/setup.php", $setup );
	echo "patched setup.php\n";
}

// --- header.html ---
file_put_contents(
	"$theme/parts/header.html",
	<<<'HTML'
<!-- wp:group {"className":"agency-utility-bar","layout":{"type":"default"},"tagName":"div"} -->
<div class="wp-block-group agency-utility-bar">
	<!-- wp:group {"className":"agency-container","layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"right"}} -->
	<div class="wp-block-group agency-container">
		<!-- wp:paragraph {"fontSize":"sm"} -->
		<p class="has-sm-font-size"><a href="tel:+4524864646">24 86 46 46</a></p>
		<!-- /wp:paragraph -->
		<!-- wp:html -->
		<span class="agency-utility-bar__sep" aria-hidden="true">|</span>
		<!-- /wp:html -->
		<!-- wp:polylang/language-switcher {"dropdown":0,"show_flags":0,"show_names":1} /-->
	</div>
	<!-- /wp:group -->
</div>
<!-- /wp:group -->

<!-- wp:group {"tagName":"header","className":"site-header","layout":{"type":"default"}} -->
<header class="wp-block-group site-header">
	<!-- wp:group {"className":"agency-container site-header__inner","layout":{"type":"default"}} -->
	<div class="wp-block-group agency-container site-header__inner">
		<!-- wp:group {"className":"site-header__brand","layout":{"type":"flex","flexWrap":"nowrap","verticalAlignment":"center"},"style":{"spacing":{"blockGap":"var:preset|spacing|sm"}}} -->
		<div class="wp-block-group site-header__brand">
			<!-- wp:site-logo {"width":120,"shouldSyncIcon":false} /-->
			<!-- wp:site-title {"level":0} /-->
		</div>
		<!-- /wp:group -->

		<!-- wp:group {"className":"site-header__actions","layout":{"type":"flex","flexWrap":"nowrap","justifyContent":"right"}} -->
		<div class="wp-block-group site-header__actions">
			<!-- wp:navigation {"className":"primary-nav desktop-nav","overlayMenu":"never","layout":{"type":"flex","justifyContent":"right"}} /-->
			<!-- wp:html -->
			<button type="button" class="mobile-nav-toggle" aria-expanded="false" aria-controls="mobile-nav-panel" aria-label="Open menu">
				<span class="mobile-nav-toggle__icon" aria-hidden="true"></span>
			</button>
			<!-- /wp:html -->
		</div>
		<!-- /wp:group -->
	</div>
	<!-- /wp:group -->
</header>
<!-- /wp:group -->

HTML
);
echo "updated header.html\n";

// --- agency-design.css: site-logo + placeholder image styles ---
$css_path = "$root/tailwind/custom/components/agency-design.css";
$css      = file_get_contents( $css_path );

$logo_css = <<<'CSS'

.site-header__brand {
	align-items: center;
}

.site-header__brand .wp-block-site-logo {
	flex-shrink: 0;
	line-height: 0;
	margin: 0;
}

.site-header__brand .wp-block-site-logo a {
	display: block;
	line-height: 0;
}

.site-header__brand .wp-block-site-logo img {
	display: block;
	height: auto;
	max-height: 48px;
	width: auto;
}

/* Site title remains for SEO/a11y; hide visually when a custom logo is set. */
.site-header__brand:has(.wp-block-site-logo a img) .wp-block-site-title {
	border: 0;
	clip: rect(1px, 1px, 1px, 1px);
	clip-path: inset(50%);
	height: 1px;
	margin: -1px;
	overflow: hidden;
	padding: 0;
	position: absolute;
	white-space: nowrap;
	width: 1px;
}

.agency-post-card__image--empty {
	background: var(--wp--preset--color--surface-alt, #fafafa);
	border-bottom: 1px solid var(--wp--preset--color--border, #e5e7eb);
	margin: 0;
	overflow: hidden;
}

.agency-post-card__image--empty img,
.agency-post-card__image--placeholder {
	display: block;
	height: 100%;
	object-fit: cover;
	width: 100%;
}

.agency-location-card__image img,
.agency-hero__media img {
	border-radius: 8px;
	display: block;
	height: auto;
	width: 100%;
}

CSS;

if ( ! str_contains( $css, 'site-header__brand .wp-block-site-logo' ) ) {
	$css = str_replace(
		".site-header .wp-block-site-title a {",
		$logo_css . "\n.site-header .wp-block-site-title a {",
		$css
	);
	file_put_contents( $css_path, $css );
	echo "patched agency-design.css\n";
}

// --- hero-homepage pattern: two-column with hero image ---
$patterns = file_get_contents( "$theme/inc/patterns.php" );
$hero_uri = get_template_directory_uri() . '/assets/images/placeholders/hero-abstract.svg';
$hero_new = '<!-- wp:group {"align":"full","className":"agency-section agency-hero","layout":{"type":"default"}} -->
<div class="wp-block-group alignfull agency-section agency-hero"><!-- wp:group {"className":"agency-container","layout":{"type":"default"}} -->
<div class="wp-block-group agency-container"><!-- wp:columns {"className":"agency-hero-grid"} -->
<div class="wp-block-columns agency-hero-grid"><!-- wp:column -->
<div class="wp-block-column"><!-- wp:paragraph {"className":"agency-eyebrow"} -->
<p class="agency-eyebrow">Lorem recruitment partner</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":1,"className":"agency-hero__title"} -->
<h1 class="wp-block-heading agency-hero__title agency-motion-enter-subtle">Lorem ipsum dolor sit amet consectetur</h1>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"agency-lead"} -->
<p class="agency-lead">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.</p>
<!-- /wp:paragraph -->

<!-- wp:buttons {"className":"agency-hero__actions"} -->
<div class="wp-block-buttons agency-hero__actions agency-motion-slide-up agency-motion-delay-md"><!-- wp:button {"url":"/employers/","className":"agency-btn--employer"} -->
<div class="wp-block-button agency-btn--employer"><a class="wp-block-button__link wp-element-button" href="/employers/">Lorem employer CTA</a></div>
<!-- /wp:button -->

<!-- wp:button {"url":"/candidates/","className":"agency-btn--candidate"} -->
<div class="wp-block-button agency-btn--candidate"><a class="wp-block-button__link wp-element-button" href="/candidates/">Lorem candidate CTA</a></div>
<!-- /wp:button --></div>
<!-- /wp:buttons --></div>
<!-- /wp:column -->

<!-- wp:column -->
<div class="wp-block-column"><!-- wp:image {"sizeSlug":"large","className":"agency-hero__media rounded-lg"} -->
<figure class="wp-block-image size-large agency-hero__media rounded-lg"><img src="' . esc_url( $hero_uri ) . '" alt=""/></figure>
<!-- /wp:image --></div>
<!-- /wp:column --></div>
<!-- /wp:columns --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->';

if ( preg_match( "/'slug'\s*=>\s*'agency-starter\/hero-homepage'[\s\S]*?'content'\s*=>\s*'[^']*'/", $patterns ) ) {
	$patterns = preg_replace(
		"/('slug'\s*=>\s*'agency-starter\/hero-homepage',[\s\S]*?'content'\s*=>\s*)'<!-- wp:group[\s\S]*?<!-- \/wp:group -->'/",
		'$1\'' . str_replace( "'", "\\'", $hero_new ) . '\'',
		$patterns,
		1
	);
	file_put_contents( "$theme/inc/patterns.php", $patterns );
	echo "patched hero-homepage pattern\n";
}

// --- location-card: add wide image placeholder ---
$more = file_get_contents( "$theme/inc/patterns-more.php" );
$wide_uri = get_template_directory_uri() . '/assets/images/placeholders/image-16x9.svg';
$loc_img  = '<!-- wp:image {"sizeSlug":"large","className":"agency-location-card__image rounded-lg"} -->
<figure class="wp-block-image size-large agency-location-card__image rounded-lg"><img src="' . esc_url( $wide_uri ) . '" alt=""/></figure>
<!-- /wp:image -->

';
if ( ! str_contains( $more, 'agency-location-card__image' ) ) {
	$more = str_replace(
		'<div class="wp-block-group agency-card"><!-- wp:heading {"level":3,"className":"agency-card__title"} -->
<h3 class="wp-block-heading agency-card__title">Lorem Copenhagen office</h3>',
		'<div class="wp-block-group agency-card">' . $loc_img . '<!-- wp:heading {"level":3,"className":"agency-card__title"} -->
<h3 class="wp-block-heading agency-card__title">Lorem Copenhagen office</h3>',
		$more
	);
	file_put_contents( "$theme/inc/patterns-more.php", $more );
	echo "patched location-card pattern\n";
}

echo "done\n";
