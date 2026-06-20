<?php
/**
 * P1 audit optimizations — run inside Docker as root.
 */
$root  = '/var/www/html/wp-content/themes/agency-starter';
$theme = "$root/theme";

function write_file( $path, $content ) {
	file_put_contents( $path, $content );
	echo "wrote $path\n";
}

// --- schema.php ---
write_file(
	"$theme/inc/schema.php",
	<<<'PHP'
<?php
/**
 * SEO and AEO schema helpers (Yoast-first, theme fallbacks).
 *
 * @package Agency_Starter
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Enrich Yoast Organization schema for entity clarity.
 *
 * @param array $data Organization schema.
 * @return array
 */
function agency_starter_schema_organization( $data ) {
	$data['name'] = get_bloginfo( 'name' );
	$data['url']  = home_url( '/' );

	$same_as = apply_filters( 'agency_starter_organization_same_as', array() );
	if ( ! empty( $same_as ) ) {
		$data['sameAs'] = array_values( array_filter( array_map( 'esc_url_raw', $same_as ) ) );
	}

	if ( empty( $data['logo'] ) ) {
		$custom_logo_id = (int) get_theme_mod( 'custom_logo' );
		if ( $custom_logo_id ) {
			$logo_url = wp_get_attachment_image_url( $custom_logo_id, 'full' );
			if ( $logo_url ) {
				$data['logo'] = array(
					'@type' => 'ImageObject',
					'url'   => $logo_url,
				);
			}
		}
	}

	return $data;
}
add_filter( 'wpseo_schema_organization', 'agency_starter_schema_organization' );

/**
 * Disable JobPosting schema for closed jobs.
 *
 * @param bool $enabled Whether JobPosting is enabled.
 * @return bool
 */
function agency_starter_disable_closed_job_schema( $enabled ) {
	if ( ! is_singular( 'job' ) ) {
		return $enabled;
	}

	$status = get_post_meta( get_the_ID(), 'job_status', true );
	if ( 'closed' === $status ) {
		return false;
	}

	return $enabled;
}
add_filter( 'wpseo_enable_schema_job_posting', 'agency_starter_disable_closed_job_schema' );

/**
 * Output FAQPage JSON-LD when page content includes agency FAQ markup.
 */
function agency_starter_output_faq_schema() {
	if ( ! is_singular() ) {
		return;
	}

	$post = get_queried_object();
	if ( ! $post instanceof WP_Post ) {
		return;
	}

	if ( ! str_contains( $post->post_content, 'agency-faq__item' ) ) {
		return;
	}

	$html = do_blocks( $post->post_content );
	if ( ! preg_match_all(
		'/<details[^>]*class="[^"]*agency-faq__item[^"]*"[^>]*>.*?<summary[^>]*>(.*?)<\/summary>.*?<div[^>]*>(.*?)<\/div>/s',
		$html,
		$matches,
		PREG_SET_ORDER
	) ) {
		return;
	}

	$entities = array();
	foreach ( $matches as $match ) {
		$question = wp_strip_all_tags( $match[1] );
		$answer   = wp_strip_all_tags( $match[2] );
		if ( '' === $question || '' === $answer ) {
			continue;
		}
		$entities[] = array(
			'@type'          => 'Question',
			'name'           => $question,
			'acceptedAnswer' => array(
				'@type' => 'Answer',
				'text'  => $answer,
			),
		);
	}

	if ( empty( $entities ) ) {
		return;
	}

	$schema = array(
		'@context'   => 'https://schema.org',
		'@type'      => 'FAQPage',
		'mainEntity' => $entities,
	);

	echo '<script type="application/ld+json">' . wp_json_encode( $schema, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . "</script>\n";
}
add_action( 'wp_head', 'agency_starter_output_faq_schema', 20 );

/**
 * Fallback meta description when Yoast is inactive.
 */
function agency_starter_fallback_meta_description() {
	if ( defined( 'WPSEO_VERSION' ) ) {
		return;
	}

	$description = '';
	if ( is_singular() ) {
		$description = get_post_meta( get_the_ID(), '_yoast_wpseo_metadesc', true );
		if ( ! $description ) {
			$description = wp_trim_words( wp_strip_all_tags( get_post_field( 'post_excerpt', get_the_ID() ) ?: get_post_field( 'post_content', get_the_ID() ) ), 25 );
		}
	} elseif ( is_front_page() ) {
		$description = get_bloginfo( 'description' );
	}

	if ( ! $description ) {
		return;
	}

	printf(
		'<meta name="description" content="%s" />' . "\n",
		esc_attr( $description )
	);
}
add_action( 'wp_head', 'agency_starter_fallback_meta_description', 1 );

PHP
);

// --- i18n-parts.php ---
write_file(
	"$theme/inc/i18n-parts.php",
	<<<'PHP'
<?php
/**
 * Translate static strings in block template parts at render time.
 *
 * @package Agency_Starter
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Replace known template-part strings with translated equivalents.
 *
 * @param string $block_content Part HTML.
 * @param array  $block         Block data.
 * @return string
 */
function agency_starter_i18n_template_part( $block_content, $block ) {
	$slug = $block['attrs']['slug'] ?? '';
	if ( ! $slug ) {
		return $block_content;
	}

	$map = agency_starter_i18n_string_map( $slug );
	if ( empty( $map ) ) {
		return $block_content;
	}

	foreach ( $map as $search => $replace ) {
		$block_content = str_replace( $search, $replace, $block_content );
	}

	return $block_content;
}
add_filter( 'render_block_core/template-part', 'agency_starter_i18n_template_part', 9, 2 );

/**
 * String replacements per template part slug.
 *
 * @param string $slug Template part slug.
 * @return array<string, string>
 */
function agency_starter_i18n_string_map( $slug ) {
	$maps = array(
		'footer' => array(
			'>Employers<'       => '>' . esc_html__( 'Employers', 'agency-starter' ) . '<',
			'>Candidates<'     => '>' . esc_html__( 'Candidates', 'agency-starter' ) . '<',
			'>Company<'        => '>' . esc_html__( 'Company', 'agency-starter' ) . '<',
			'>Contact<'         => '>' . esc_html__( 'Contact', 'agency-starter' ) . '<',
			'href="#"'          => 'href="' . esc_url( home_url( '/about/' ) ) . '"',
			'All rights reserved.' => esc_html__( 'All rights reserved.', 'agency-starter' ),
		),
		'footer-legal' => array(
			'>Privacy policy<' => '>' . esc_html__( 'Privacy policy', 'agency-starter' ) . '<',
			'>Terms of use<'    => '>' . esc_html__( 'Terms of use', 'agency-starter' ) . '<',
		),
		'header' => array(
			'aria-label="Open menu"' => 'aria-label="' . esc_attr__( 'Open menu', 'agency-starter' ) . '"',
			'aria-label="Primary"'   => 'aria-label="' . esc_attr__( 'Primary', 'agency-starter' ) . '"',
			'<p class="has-sm-font-size">|</p>' => '<span class="agency-utility-bar__sep" aria-hidden="true">|</span>',
		),
	);

	return $maps[ $slug ] ?? array();
}

PHP
);

// --- newsletter.php ---
write_file(
	"$theme/inc/newsletter.php",
	<<<'PHP'
<?php
/**
 * Newsletter placeholder shortcode for patterns.
 *
 * @package Agency_Starter
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Newsletter signup placeholder — replace with Mailchimp/CF7 in production.
 *
 * @return string
 */
function agency_starter_newsletter_shortcode() {
	ob_start();
	?>
	<div class="agency-newsletter__form" role="region" aria-label="<?php esc_attr_e( 'Newsletter signup', 'agency-starter' ); ?>">
		<p class="agency-form-placeholder"><?php esc_html_e( 'Connect your newsletter provider (Mailchimp, CF7, etc.).', 'agency-starter' ); ?></p>
	</div>
	<?php
	return ob_get_clean();
}
add_shortcode( 'agency_starter_newsletter', 'agency_starter_newsletter_shortcode' );

PHP
);

// --- header.html ---
write_file(
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
			<!-- wp:site-logo {"width":40} /-->
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

// --- post-meta.html ---
write_file(
	"$theme/parts/post-meta.html",
	<<<'HTML'
<!-- wp:group {"className":"post-meta agency-entry-meta","layout":{"type":"flex","flexWrap":"wrap"}} -->
<div class="wp-block-group post-meta agency-entry-meta">
	<!-- wp:post-date {"fontSize":"sm","textColor":"muted"} /-->
	<!-- wp:post-author-name {"fontSize":"sm","textColor":"muted"} /-->
	<!-- wp:post-terms {"term":"category","fontSize":"sm","textColor":"muted"} /-->
</div>
<!-- /wp:group -->

HTML
);

// --- navigation.php mobile panel fix ---
$nav = file_get_contents( "$theme/inc/navigation.php" );
$nav = str_replace(
	'<nav id="mobile-nav-panel" class="mobile-nav-panel" aria-modal="true" aria-label="',
	'<div id="mobile-nav-panel" class="mobile-nav-panel" role="dialog" aria-modal="true" aria-label="',
	$nav
);
$nav = str_replace( "</nav>\n\t<?php\n}\nadd_action( 'wp_footer', 'agency_starter_render_mobile_nav_panel', 5 );", "</div>\n\t<?php\n}\nadd_action( 'wp_footer', 'agency_starter_render_mobile_nav_panel', 5 );", $nav );
$nav = str_replace(
	"function agency_starter_render_primary_navigation( \$block_content, \$block ) {\n\t\$class = \$block['attrs']['className'] ?? '';\n\tif ( false === strpos( \$class, 'primary-nav' ) ) {\n\t\treturn \$block_content;\n\t}\n\n\treturn agency_starter_get_primary_nav_markup();\n}",
	"function agency_starter_render_primary_navigation( \$block_content, \$block ) {\n\t\$class = \$block['attrs']['className'] ?? '';\n\tif ( false === strpos( \$class, 'primary-nav' ) ) {\n\t\treturn \$block_content;\n\t}\n\n\treturn agency_starter_get_primary_nav_markup();\n}\n\n/**\n * Strip responsive overlay chrome from core navigation in header.\n *\n * @param string \$block_content Block HTML.\n * @param array  \$block         Block data.\n * @return string\n */\nfunction agency_starter_simplify_header_navigation( \$block_content, \$block ) {\n\t\$class = \$block['attrs']['className'] ?? '';\n\tif ( false === strpos( \$class, 'primary-nav' ) ) {\n\t\treturn \$block_content;\n\t}\n\n\treturn agency_starter_get_primary_nav_markup();\n}",
	$nav
);
// Remove duplicate header template part nav replacement logic - simplify filter
$nav = preg_replace(
	'/function agency_starter_filter_header_template_part\([^}]+\}[^}]+\}[^}]+\}[^}]+\}\nadd_filter\( \'render_block_core\/template-part\', \'agency_starter_filter_header_template_part\', 10, 2 \);/s',
	'',
	$nav
);
file_put_contents( "$theme/inc/navigation.php", $nav );
echo "patched navigation.php\n";

// --- functions.php ---
$fn = file_get_contents( "$theme/functions.php" );
$fn = str_replace( "require get_template_directory() . '/inc/motion.php';\n", '', $fn );
$fn = str_replace(
	"require get_template_directory() . '/inc/breadcrumbs.php';\n",
	"require get_template_directory() . '/inc/breadcrumbs.php';\nrequire get_template_directory() . '/inc/schema.php';\nrequire get_template_directory() . '/inc/i18n-parts.php';\nrequire get_template_directory() . '/inc/newsletter.php';\n",
	$fn
);
$fn = str_replace( "require get_template_directory() . '/inc/template-tags.php';\nrequire get_template_directory() . '/inc/template-functions.php';\n", '', $fn );
file_put_contents( "$theme/functions.php", $fn );
echo "patched functions.php\n";

// --- theme.json appearanceTools ---
$tj = json_decode( file_get_contents( "$theme/theme.json" ), true );
$tj['settings']['appearanceTools'] = false;
file_put_contents( "$theme/theme.json", json_encode( $tj, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES ) . "\n" );
echo "patched theme.json\n";

// --- enqueue: drop a11y-contrast (appearanceTools locked) ---
$enq = file_get_contents( "$theme/inc/enqueue.php" );
$enq = preg_replace(
	"/\/\*\*[\s\S]*?function agency_starter_enqueue_a11y_contrast\(\)[\s\S]*?add_action\( 'wp_enqueue_scripts', 'agency_starter_enqueue_a11y_contrast', 999 \);\n\n/",
	"",
	$enq
);
$enq = str_replace(
	"array( 'wp-block-library' ),",
	"array(),",
	$enq
);
file_put_contents( "$theme/inc/enqueue.php", $enq );
echo "patched enqueue.php\n";

// --- plugins.php wire cf7 capability ---
$pl = file_get_contents( "$theme/inc/plugins.php" );
if ( ! str_contains( $pl, 'agency_starter_can_run_admin_seeder' ) || ! str_contains( $pl, 'wire_cf7' ) ) {
	// already has seeders gated
}
$pl = str_replace(
	"function agency_starter_wire_cf7_conversion_pages() {\n\t\$ids = get_option( 'agency_starter_cf7_ids', array() );",
	"function agency_starter_wire_cf7_conversion_pages() {\n\tif ( ! agency_starter_can_run_admin_seeder() ) {\n\t\treturn;\n\t}\n\n\t\$ids = get_option( 'agency_starter_cf7_ids', array() );",
	$pl
);
file_put_contents( "$theme/inc/plugins.php", $pl );

// --- FAQ pattern ---
$pat = file_get_contents( "$theme/inc/patterns.php" );
$faq_new = <<<'FAQ'
'content'    => '<!-- wp:group {"align":"full","className":"agency-section agency-section--alt","layout":{"type":"default"}} -->
<div class="wp-block-group alignfull agency-section agency-section--alt"><!-- wp:group {"className":"agency-container agency-container--narrow agency-faq","layout":{"type":"default"}} -->
<div class="wp-block-group agency-container agency-container--narrow agency-faq"><!-- wp:heading {"className":"agency-section__title"} -->
<h2 class="wp-block-heading agency-section__title">Lorem ipsum frequently asked questions</h2>
<!-- /wp:heading -->

<!-- wp:html -->
<details class="agency-faq__item"><summary>Lorem ipsum question one?</summary><div class="agency-faq__answer"><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor.</p></div></details>
<details class="agency-faq__item"><summary>Lorem ipsum question two?</summary><div class="agency-faq__answer"><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas faucibus mollis interdum.</p></div></details>
<details class="agency-faq__item"><summary>Lorem ipsum question three?</summary><div class="agency-faq__answer"><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam quis risus eget urna mollis ornare vel eu leo.</p></div></details>
<!-- /wp:html --></div>
<!-- /wp:group --></div>
<!-- /wp:group -->',
FAQ;
$pat = preg_replace(
	"/'slug'       => 'agency-starter\/faq-section',[\s\S]*?'<!-- \/wp:group -->',/",
	"'slug'       => 'agency-starter/faq-section',\n\t\t\t\t'categories' => array( 'corporate-content' ),\n\t\t\t\t" . $faq_new,
	$pat,
	1
);
// Fix hero homepage motion + buttons
$pat = str_replace(
	'<h1 class="wp-block-heading agency-hero__title">',
	'<h1 class="wp-block-heading agency-hero__title agency-motion-enter-subtle">',
	$pat
);
$pat = str_replace(
	'<p class="agency-lead">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.</p>',
	'<p class="agency-lead agency-motion-slide-up agency-motion-delay-sm">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam.</p>',
	$pat
);
$pat = str_replace(
	'<div class="wp-block-buttons agency-hero__actions">',
	'<div class="wp-block-buttons agency-hero__actions agency-motion-slide-up agency-motion-delay-md">',
	$pat
);
file_put_contents( "$theme/inc/patterns.php", $pat );
echo "patched patterns.php\n";

// --- newsletter pattern ---
$pm = file_get_contents( "$theme/inc/patterns-more.php" );
$pm = str_replace( '[Lorem newsletter form placeholder]', '[agency_starter_newsletter]', $pm );
file_put_contents( "$theme/inc/patterns-more.php", $pm );

// --- block-editor.js ---
write_file(
	"$root/javascript/block-editor.js",
	<<<'JS'
/**
 * Block editor modifications
 */
import '@_tw/typography/block-editor-classes';

wp.domReady(() => {
	wp.blocks.registerBlockStyle('core/paragraph', {
		name: 'lead',
		label: 'Lead',
	});

	wp.blocks.registerBlockStyle('core/paragraph', {
		name: 'agency-eyebrow',
		label: 'Eyebrow',
	});

	wp.blocks.registerBlockStyle('core/group', {
		name: 'agency-section-alt',
		label: 'Section Alt',
	});

	wp.blocks.registerBlockStyle('core/group', {
		name: 'agency-section-dark',
		label: 'Section Dark',
	});
});

JS
);

// --- FAQ + utility bar CSS ---
$layout = file_get_contents( "$root/tailwind/custom/components/agency-layout.css" );
if ( ! str_contains( $layout, 'agency-faq__item' ) ) {
	$layout .= <<<'CSS'

.agency-utility-bar__sep {
	color: var(--wp--preset--color--slate, #6b7280);
	font-size: var(--wp--preset--font-size--sm, 0.875rem);
}

.agency-faq__item {
	border-bottom: 1px solid var(--wp--preset--color--border, #e5e7eb);
	padding-block: var(--wp--preset--spacing--md, 16px);
}

.agency-faq__item summary {
	cursor: pointer;
	font-size: var(--wp--preset--font-size--lg, 1.25rem);
	font-weight: 600;
	list-style: none;
}

.agency-faq__item summary::-webkit-details-marker {
	display: none;
}

.agency-faq__answer {
	color: var(--wp--preset--color--foreground, #1f2937);
	line-height: 1.65;
	margin-top: var(--wp--preset--spacing--sm, 12px);
}

CSS;
	file_put_contents( "$root/tailwind/custom/components/agency-layout.css", $layout );
	echo "patched agency-layout.css\n";
}

// --- footer about link ---
$footer = file_get_contents( "$theme/parts/footer.html" );
$footer = str_replace( 'href="#">Lorem about us', 'href="/about/">Lorem about us', $footer );
file_put_contents( "$theme/parts/footer.html", $footer );

// --- delete legacy PHP ---
$legacy = array(
	'theme/header.php',
	'theme/footer.php',
	'theme/index.php',
	'theme/page.php',
	'theme/single.php',
	'theme/archive.php',
	'theme/search.php',
	'theme/404.php',
	'theme/comments.php',
	'theme/inc/template-tags.php',
	'theme/inc/template-functions.php',
	'theme/inc/motion.php',
);
foreach ( glob( "$theme/template-parts/**/*.php" ) as $f ) {
	$legacy[] = str_replace( "$root/", '', $f );
}
foreach ( $legacy as $rel ) {
	$path = "$root/$rel";
	if ( is_file( $path ) ) {
		unlink( $path );
		echo "deleted $rel\n";
	}
}

echo "P1 patch complete\n";
