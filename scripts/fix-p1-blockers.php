<?php
/**
 * Fix P1 blockers: fonts_uri, schema.php, i18n-parts cleanup.
 */
$theme = '/var/www/html/wp-content/themes/agency-starter/theme';

// --- enqueue.php: add fonts_uri if missing ---
$enqueue = "$theme/inc/enqueue.php";
$content = file_get_contents( $enqueue );
if ( ! str_contains( $content, 'function agency_starter_fonts_uri' ) ) {
	$fn = <<<'PHP'

/**
 * Absolute URI to self-hosted Raleway font files.
 *
 * @return string
 */
function agency_starter_fonts_uri() {
	return trailingslashit( get_template_directory_uri() . '/assets/fonts' );
}

PHP;
	$content = preg_replace(
		'/^<\?php\n\/\*\*\n \* Print @font-face/',
		'<?php' . $fn . '/**' . "\n * Print @font-face",
		$content,
		1
	);
	file_put_contents( $enqueue, $content );
	echo "patched enqueue.php\n";
} else {
	echo "enqueue.php ok\n";
}

// --- schema.php ---
file_put_contents(
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
	if ( ! is_singular( 'page' ) || is_front_page() ) {
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
			$excerpt = get_post_field( 'post_excerpt', get_the_ID() );
			$content = $excerpt ? $excerpt : get_post_field( 'post_content', get_the_ID() );
			$description = wp_trim_words( wp_strip_all_tags( $content ), 25 );
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
echo "wrote schema.php\n";

// --- i18n-parts.php ---
$i18n = file_get_contents( "$theme/inc/i18n-parts.php" );
$i18n = preg_replace(
	"/\t\t\t'href=\"#'\".*?\\n/",
	'',
	$i18n
);
$i18n = preg_replace(
	"/\t\t\t'aria-label=\"Primary\"'.*?\\n/",
	'',
	$i18n
);
$i18n = preg_replace(
	"/\t\t\t'<p class=\"has-sm-font-size\">\\|<\\/p>'.*?\\n/",
	'',
	$i18n
);
file_put_contents( "$theme/inc/i18n-parts.php", $i18n );
echo "patched i18n-parts.php\n";
