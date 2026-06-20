<?php
/**
 * Install agency-starter/usp-tabs Gutenberg block.
 */
$root  = is_dir( '/workspace/wordpress/wp-content/themes/agency-starter' )
	? '/workspace/wordpress/wp-content/themes/agency-starter'
	: '/var/www/html/wp-content/themes/agency-starter';
$theme = "$root/theme";
$scripts = file_exists( '/workspace/WP-dev/scripts/usp-tabs.js' )
	? '/workspace/WP-dev/scripts'
	: '/home/jesper/Documents/dev/timework/WP-dev/scripts';

mkdir( "$theme/blocks/usp-tabs", 0755, true );

$files = array(
	"$theme/blocks/usp-tabs/block.json" => <<<'JSON'
{
	"$schema": "https://schemas.wp.org/trunk/block.json",
	"apiVersion": 3,
	"name": "agency-starter/usp-tabs",
	"title": "USP Tabs",
	"category": "design",
	"icon": "table-row-after",
	"description": "Vertical tab USP section with expandable items and a preview panel.",
	"keywords": [ "tabs", "usp", "services", "accordion" ],
	"textdomain": "agency-starter",
	"attributes": {
		"eyebrow": { "type": "string", "default": "How we do it" },
		"heading": { "type": "string", "default": "One platform. Every hiring need." },
		"items": { "type": "array", "default": [] }
	},
	"supports": { "html": false, "align": [ "full" ] },
	"render": "file:./render.php"
}

JSON,
	"$theme/inc/usp-tabs.php" => <<<'PHP'
<?php
/**
 * USP Tabs block helpers.
 *
 * @package Agency_Starter
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Default tab items for new blocks and patterns.
 *
 * @return array<int, array<string, string>>
 */
function agency_starter_usp_tabs_default_items() {
	$wide   = agency_starter_placeholder_url( 'wide' );
	$hero   = agency_starter_placeholder_url( 'hero' );
	$square = agency_starter_placeholder_url( 'square' );

	return array(
		array(
			'title'       => __( 'Employer services', 'agency-starter' ),
			'description' => __( 'Need to hire anyone, anywhere? We handle contracts, compliance, and onboarding — in days, not months.', 'agency-starter' ),
			'ctaLabel'    => __( 'Learn more', 'agency-starter' ),
			'ctaUrl'      => '/employers/',
			'imageUrl'    => $wide,
		),
		array(
			'title'       => __( 'Global payroll', 'agency-starter' ),
			'description' => __( 'Accurate, compliant payroll in every market you operate. Run by in-house specialists, not a partner network.', 'agency-starter' ),
			'ctaLabel'    => __( 'Learn more', 'agency-starter' ),
			'ctaUrl'      => '/employers/',
			'imageUrl'    => $hero,
		),
		array(
			'title'       => __( 'Contractor management', 'agency-starter' ),
			'description' => __( 'Engage international contractors compliantly. Contracts, payments, and risk — handled end to end.', 'agency-starter' ),
			'ctaLabel'    => __( 'Learn more', 'agency-starter' ),
			'ctaUrl'      => '/candidates/',
			'imageUrl'    => $square,
		),
		array(
			'title'       => __( 'Candidate matching', 'agency-starter' ),
			'description' => __( 'Source, screen, and place talent faster with a dedicated consultant and a curated shortlist.', 'agency-starter' ),
			'ctaLabel'    => __( 'Learn more', 'agency-starter' ),
			'ctaUrl'      => '/candidates/',
			'imageUrl'    => $wide,
		),
	);
}

/**
 * Sanitize tab items from block attributes.
 *
 * @param array<int, array<string, string>>|mixed $items Raw items.
 * @return array<int, array<string, string>>
 */
function agency_starter_usp_tabs_normalize_items( $items ) {
	if ( ! is_array( $items ) || empty( $items ) ) {
		return agency_starter_usp_tabs_default_items();
	}

	$normalized = array();
	$defaults   = agency_starter_usp_tabs_default_items();

	foreach ( $items as $index => $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$fallback     = $defaults[ $index ] ?? $defaults[0];
		$cta_url      = $item['ctaUrl'] ?? $fallback['ctaUrl'];
		$image_url    = $item['imageUrl'] ?? $fallback['imageUrl'];
		$normalized[] = array(
			'title'       => sanitize_text_field( $item['title'] ?? $fallback['title'] ),
			'description' => sanitize_textarea_field( $item['description'] ?? $fallback['description'] ),
			'ctaLabel'    => sanitize_text_field( $item['ctaLabel'] ?? $fallback['ctaLabel'] ),
			'ctaUrl'      => esc_url_raw( $cta_url ),
			'imageUrl'    => esc_url_raw( $image_url ? $image_url : $fallback['imageUrl'] ),
		);
	}

	return ! empty( $normalized ) ? $normalized : agency_starter_usp_tabs_default_items();
}

PHP,
	"$theme/inc/blocks.php" => <<<'PHP'
<?php
/**
 * Register theme blocks.
 *
 * @package Agency_Starter
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Register custom blocks from block.json metadata.
 */
function agency_starter_register_blocks() {
	register_block_type( get_template_directory() . '/blocks/usp-tabs' );
}
add_action( 'init', 'agency_starter_register_blocks' );

/**
 * Enqueue USP Tabs assets.
 */
function agency_starter_enqueue_usp_tabs_assets() {
	if ( is_admin() ) {
		wp_enqueue_script(
			'agency-starter-usp-tabs-editor',
			get_template_directory_uri() . '/js/usp-tabs-editor.min.js',
			array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n' ),
			AGENCY_STARTER_VERSION,
			true
		);
		return;
	}

	if ( ! has_block( 'agency-starter/usp-tabs' ) ) {
		return;
	}

	wp_enqueue_script(
		'agency-starter-usp-tabs',
		get_template_directory_uri() . '/js/usp-tabs.min.js',
		array(),
		AGENCY_STARTER_VERSION,
		true
	);
}
add_action( 'enqueue_block_assets', 'agency_starter_enqueue_usp_tabs_assets' );

PHP,
);

// render.php written separately below
foreach ( $files as $path => $content ) {
	file_put_contents( $path, $content );
	echo "wrote $path\n";
}

file_put_contents( "$theme/blocks/usp-tabs/render.php", <<<'PHP'
<?php
/**
 * USP Tabs block render.
 *
 * @package Agency_Starter
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block content.
 * @var WP_Block $block      Block instance.
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

$eyebrow = sanitize_text_field( $attributes['eyebrow'] ?? __( 'How we do it', 'agency-starter' ) );
$heading = sanitize_text_field( $attributes['heading'] ?? __( 'One platform. Every hiring need.', 'agency-starter' ) );
$items   = agency_starter_usp_tabs_normalize_items( $attributes['items'] ?? array() );
$uid     = wp_unique_id( 'agency-usp-' );

$wrapper_attrs = get_block_wrapper_attributes(
	array(
		'class'                => 'agency-section agency-section--alt agency-usp-tabs',
		'data-agency-usp-tabs' => '',
	)
);
?>
<section <?php echo $wrapper_attrs; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>>
	<div class="agency-container">
		<?php if ( $eyebrow ) : ?>
			<p class="agency-eyebrow"><?php echo esc_html( $eyebrow ); ?></p>
		<?php endif; ?>

		<?php if ( $heading ) : ?>
			<h2 class="agency-section__title agency-usp-tabs__heading"><?php echo esc_html( $heading ); ?></h2>
		<?php endif; ?>

		<div class="agency-usp-tabs__grid">
			<div class="agency-usp-tabs__list" role="tablist" aria-label="<?php esc_attr_e( 'Services', 'agency-starter' ); ?>">
				<?php foreach ( $items as $index => $item ) : ?>
					<?php
					$is_active  = 0 === $index;
					$tab_id     = $uid . '-tab-' . $index;
					$panel_id   = $uid . '-panel-' . $index;
					$item_class = 'agency-usp-tabs__item' . ( $is_active ? ' is-active' : '' );
					$cta_href   = $item['ctaUrl'];
					if ( $cta_href && str_starts_with( $cta_href, '/' ) ) {
						$cta_href = home_url( $cta_href );
					}
					?>
					<div class="<?php echo esc_attr( $item_class ); ?>" data-usp-item>
						<button
							type="button"
							class="agency-usp-tabs__trigger"
							role="tab"
							id="<?php echo esc_attr( $tab_id ); ?>"
							aria-selected="<?php echo $is_active ? 'true' : 'false'; ?>"
							aria-controls="<?php echo esc_attr( $panel_id ); ?>"
							tabindex="<?php echo $is_active ? '0' : '-1'; ?>"
							data-usp-tab
							data-usp-index="<?php echo esc_attr( (string) $index ); ?>"
						>
							<span class="agency-usp-tabs__icon agency-usp-tabs__icon--<?php echo esc_attr( (string) ( ( $index % 4 ) + 1 ) ); ?>" aria-hidden="true"></span>
							<span class="agency-usp-tabs__label"><?php echo esc_html( $item['title'] ); ?></span>
							<span class="agency-usp-tabs__chevron" aria-hidden="true"></span>
						</button>
						<div
							class="agency-usp-tabs__body"
							role="tabpanel"
							id="<?php echo esc_attr( $panel_id ); ?>"
							aria-labelledby="<?php echo esc_attr( $tab_id ); ?>"
							<?php echo $is_active ? '' : 'hidden'; ?>
							data-usp-panel
							data-usp-index="<?php echo esc_attr( (string) $index ); ?>"
						>
							<p class="agency-usp-tabs__description"><?php echo esc_html( $item['description'] ); ?></p>
							<?php if ( ! empty( $item['ctaLabel'] ) && ! empty( $cta_href ) ) : ?>
								<a class="agency-usp-tabs__cta" href="<?php echo esc_url( $cta_href ); ?>">
									<span><?php echo esc_html( $item['ctaLabel'] ); ?></span>
									<span class="agency-usp-tabs__cta-icon" aria-hidden="true">→</span>
								</a>
							<?php endif; ?>
						</div>
					</div>
				<?php endforeach; ?>
			</div>

			<div class="agency-usp-tabs__preview" aria-live="polite">
				<?php foreach ( $items as $index => $item ) : ?>
					<figure
						class="agency-usp-tabs__figure<?php echo 0 === $index ? ' is-active' : ''; ?>"
						data-usp-figure
						data-usp-index="<?php echo esc_attr( (string) $index ); ?>"
						<?php echo 0 === $index ? '' : 'hidden'; ?>
					>
						<img src="<?php echo esc_url( $item['imageUrl'] ); ?>" alt="" loading="lazy" decoding="async" />
					</figure>
				<?php endforeach; ?>
			</div>
		</div>
	</div>
</section>

PHP
);
echo "wrote render.php\n";

// functions.php requires
$functions = file_get_contents( "$theme/functions.php" );
if ( ! str_contains( $functions, 'inc/usp-tabs.php' ) ) {
	$functions = str_replace(
		"require get_template_directory() . '/inc/media.php';\n",
		"require get_template_directory() . '/inc/media.php';\nrequire get_template_directory() . '/inc/usp-tabs.php';\nrequire get_template_directory() . '/inc/blocks.php';\n",
		$functions
	);
	file_put_contents( "$theme/functions.php", $functions );
	echo "patched functions.php\n";
}

// CSS
file_put_contents(
	"$root/tailwind/custom/components/agency-usp-tabs.css",
	<<<'CSS'
/* Remote-style vertical USP tabs */
.agency-usp-tabs__heading {
	margin-bottom: var(--wp--preset--spacing--2xl, 48px);
	text-align: left;
}

.agency-usp-tabs__grid {
	display: grid;
	gap: var(--wp--preset--spacing--2xl, 48px);
	align-items: start;
}

@media (min-width: 64em) {
	.agency-usp-tabs__grid {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
	}
}

.agency-usp-tabs__list {
	display: flex;
	flex-direction: column;
	border-top: 1px solid var(--wp--preset--color--border, #e5e7eb);
}

.agency-usp-tabs__item {
	border-bottom: 1px solid var(--wp--preset--color--border, #e5e7eb);
}

.agency-usp-tabs__trigger {
	display: grid;
	grid-template-columns: auto 1fr auto;
	align-items: center;
	gap: var(--wp--preset--spacing--md, 16px);
	width: 100%;
	padding: var(--wp--preset--spacing--lg, 24px);
	border: 0;
	background: transparent;
	color: var(--wp--preset--color--foreground, #1f2937);
	font: inherit;
	text-align: left;
	cursor: pointer;
}

.agency-usp-tabs__icon {
	width: 2.5rem;
	height: 2.5rem;
	border-radius: 9999px;
	flex-shrink: 0;
}

.agency-usp-tabs__icon--1 { background: linear-gradient(135deg, #570df8 35%, #f000b8 100%); }
.agency-usp-tabs__icon--2 { background: linear-gradient(135deg, #1fcdbc 35%, #570df8 100%); }
.agency-usp-tabs__icon--3 { background: linear-gradient(135deg, #f000b8 35%, #4506cb 100%); }
.agency-usp-tabs__icon--4 { background: linear-gradient(135deg, #9d0075 35%, #1fcdbc 100%); }

.agency-usp-tabs__label {
	font-size: var(--wp--preset--font-size--lg, 1.25rem);
	font-weight: 600;
	line-height: 1.3;
}

.agency-usp-tabs__chevron {
	width: 0.65rem;
	height: 0.65rem;
	border-right: 2px solid currentColor;
	border-bottom: 2px solid currentColor;
	transform: rotate(45deg);
	transition: transform 0.2s ease;
}

.agency-usp-tabs__item.is-active .agency-usp-tabs__chevron {
	transform: rotate(-135deg);
}

.agency-usp-tabs__item.is-active {
	background: var(--wp--preset--color--surface-dark, #1f2937);
}

.agency-usp-tabs__item.is-active .agency-usp-tabs__trigger,
.agency-usp-tabs__item.is-active .agency-usp-tabs__description,
.agency-usp-tabs__item.is-active .agency-usp-tabs__cta {
	color: var(--wp--preset--color--inverse, #fff);
}

.agency-usp-tabs__body {
	padding: 0 var(--wp--preset--spacing--lg, 24px) var(--wp--preset--spacing--lg, 24px);
}

.agency-usp-tabs__item:not(.is-active) .agency-usp-tabs__body {
	display: none;
}

.agency-usp-tabs__description {
	margin: 0 0 var(--wp--preset--spacing--md, 16px);
	line-height: 1.65;
	max-width: 36rem;
}

.agency-usp-tabs__cta {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	font-weight: 600;
	text-decoration: none;
	color: inherit;
}

.agency-usp-tabs__cta-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2rem;
	height: 2rem;
	border-radius: 9999px;
	background: rgba(255, 255, 255, 0.15);
}

.agency-usp-tabs__preview {
	position: relative;
	min-height: 18rem;
	background:
		linear-gradient(var(--wp--preset--color--border, #e5e7eb) 1px, transparent 1px),
		linear-gradient(90deg, var(--wp--preset--color--border, #e5e7eb) 1px, transparent 1px);
	background-size: 24px 24px;
	background-color: var(--wp--preset--color--background, #fff);
	border-radius: 12px;
	padding: var(--wp--preset--spacing--xl, 32px);
}

.agency-usp-tabs__figure {
	margin: 0;
	border-radius: 8px;
	overflow: hidden;
	box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12);
}

.agency-usp-tabs__figure:not(.is-active) {
	display: none;
}

.agency-usp-tabs__figure img {
	display: block;
	width: 100%;
	height: auto;
}

@media (prefers-reduced-motion: reduce) {
	.agency-usp-tabs__chevron {
		transition: none;
	}
}

CSS
);
echo "wrote agency-usp-tabs.css\n";

// Register pattern in patterns-more.php
$more = file_get_contents( "$theme/inc/patterns-more.php" );
if ( ! str_contains( $more, 'agency-starter/usp-tabs' ) ) {
	$pattern = <<<'PHP'

		array(
			'title'      => __( 'USP Tabs', 'agency-starter' ),
			'slug'       => 'agency-starter/usp-tabs',
			'categories' => array( 'corporate-services' ),
			'content'    => '<!-- wp:agency-starter/usp-tabs {"align":"full"} /-->',
		),
PHP;
	$more = preg_replace(
		'/return array\(\n/',
		"return array(\n" . $pattern,
		$more,
		1
	);
	file_put_contents( "$theme/inc/patterns-more.php", $more );
	echo "registered pattern\n";
}

file_put_contents( "$root/javascript/usp-tabs.js", file_get_contents( 'php://stdin' ) ? '' : '' );

// package.json esbuild entries
$pkg = file_get_contents( "$root/package.json" );
if ( ! str_contains( $pkg, 'usp-tabs.js' ) ) {
	$pkg = str_replace(
		'./javascript/block-editor.js --target=esnext',
		'./javascript/block-editor.js ./javascript/usp-tabs.js ./javascript/usp-tabs-editor.js --target=esnext',
		$pkg
	);
	file_put_contents( "$root/package.json", $pkg );
	echo "patched package.json\n";
}

echo "done\n";
