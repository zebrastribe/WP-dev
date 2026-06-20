<?php
/**
 * USP Tabs v2 — Mantine-style vertical tabs + Heroicons.
 */
$root  = is_dir( '/workspace/wordpress/wp-content/themes/agency-starter' )
	? '/workspace/wordpress/wp-content/themes/agency-starter'
	: '/var/www/html/wp-content/themes/agency-starter';
$theme = "$root/theme";

mkdir( "$theme/blocks/usp-tabs", 0755, true );
mkdir( "$theme/assets/icons/heroicons", 0755, true );

// --- heroicons.php ---
file_put_contents(
	"$theme/inc/heroicons.php",
	<<<'PHP'
<?php
/**
 * Heroicons outline SVGs (MIT — https://heroicons.com).
 *
 * @package Agency_Starter
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Allowed Heroicon slugs for USP tabs.
 *
 * @return array<string, string>
 */
function agency_starter_heroicon_paths() {
	return array(
		'briefcase'     => 'M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z',
		'banknotes'     => 'M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25m2.25 0v.75m0 0v.375c0 .621-.504 1.125-1.125 1.125H21m-7.5 3h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6',
		'user-group'    => 'M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z',
		'users'         => 'M15 19.128a9.38 9.38 0 002.627.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z',
		'globe-alt'     => 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418',
		'building-office' => 'M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21',
		'chevron-up'    => 'M4.5 15.75l7.5-7.5 7.5 7.5',
		'chevron-down'  => 'M19.5 8.25l-7.5 7.5-7.5-7.5',
		'arrow-right'   => 'M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3',
	);
}

/**
 * Render a Heroicon outline SVG.
 *
 * @param string $slug    Icon slug.
 * @param string $class   Optional CSS class on svg.
 * @return string Safe SVG markup.
 */
function agency_starter_heroicon( $slug, $class = 'agency-icon' ) {
	$paths = agency_starter_heroicon_paths();
	$path  = $paths[ $slug ] ?? $paths['briefcase'];

	return sprintf(
		'<svg class="%1$s" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" aria-hidden="true"><path stroke-linecap="round" stroke-linejoin="round" d="%2$s"/></svg>',
		esc_attr( $class ),
		esc_attr( $path )
	);
}

/**
 * Icon choices for block editor.
 *
 * @return array<string, string>
 */
function agency_starter_heroicon_choices() {
	return array(
		'briefcase'       => __( 'Briefcase', 'agency-starter' ),
		'banknotes'       => __( 'Banknotes', 'agency-starter' ),
		'user-group'      => __( 'User group', 'agency-starter' ),
		'users'           => __( 'Users', 'agency-starter' ),
		'globe-alt'       => __( 'Globe', 'agency-starter' ),
		'building-office' => __( 'Building', 'agency-starter' ),
	);
}

PHP
);
echo "heroicons.php\n";

// functions.php require heroicons
$functions = file_get_contents( "$theme/functions.php" );
if ( ! str_contains( $functions, 'inc/heroicons.php' ) ) {
	$functions = str_replace(
		"require get_template_directory() . '/inc/media.php';\n",
		"require get_template_directory() . '/inc/media.php';\nrequire get_template_directory() . '/inc/heroicons.php';\n",
		$functions
	);
	file_put_contents( "$theme/functions.php", $functions );
}

// --- usp-tabs.php ---
file_put_contents(
	"$theme/inc/usp-tabs.php",
	<<<'PHP'
<?php
/**
 * USP Tabs block helpers (Mantine Tabs vertical mapping).
 *
 * @package Agency_Starter
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Default tab items.
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
			'icon'        => 'briefcase',
		),
		array(
			'title'       => __( 'Global payroll', 'agency-starter' ),
			'description' => __( 'Accurate, compliant payroll in every market you operate. Run by in-house specialists, not a partner network.', 'agency-starter' ),
			'ctaLabel'    => __( 'Learn more', 'agency-starter' ),
			'ctaUrl'      => '/employers/',
			'imageUrl'    => $hero,
			'icon'        => 'banknotes',
		),
		array(
			'title'       => __( 'Contractor management', 'agency-starter' ),
			'description' => __( 'Engage international contractors compliantly. Contracts, payments, and risk — handled end to end.', 'agency-starter' ),
			'ctaLabel'    => __( 'Learn more', 'agency-starter' ),
			'ctaUrl'      => '/candidates/',
			'imageUrl'    => $square,
			'icon'        => 'user-group',
		),
		array(
			'title'       => __( 'Candidate matching', 'agency-starter' ),
			'description' => __( 'Source, screen, and place talent faster with a dedicated consultant and a curated shortlist.', 'agency-starter' ),
			'ctaLabel'    => __( 'Learn more', 'agency-starter' ),
			'ctaUrl'      => '/candidates/',
			'imageUrl'    => $wide,
			'icon'        => 'users',
		),
	);
}

/**
 * Normalize tab items from block attributes.
 *
 * @param mixed $items Raw items.
 * @return array<int, array<string, string>>
 */
function agency_starter_usp_tabs_normalize_items( $items ) {
	if ( ! is_array( $items ) || empty( $items ) ) {
		return agency_starter_usp_tabs_default_items();
	}

	$choices    = array_keys( agency_starter_heroicon_choices() );
	$normalized = array();
	$defaults   = agency_starter_usp_tabs_default_items();

	foreach ( $items as $index => $item ) {
		if ( ! is_array( $item ) ) {
			continue;
		}

		$fallback = $defaults[ $index ] ?? $defaults[0];
		$icon     = $item['icon'] ?? $fallback['icon'];
		if ( ! in_array( $icon, $choices, true ) ) {
			$icon = $fallback['icon'];
		}

		$normalized[] = array(
			'title'       => sanitize_text_field( $item['title'] ?? $fallback['title'] ),
			'description' => sanitize_textarea_field( $item['description'] ?? $fallback['description'] ),
			'ctaLabel'    => sanitize_text_field( $item['ctaLabel'] ?? $fallback['ctaLabel'] ),
			'ctaUrl'      => esc_url_raw( $item['ctaUrl'] ?? $fallback['ctaUrl'] ),
			'imageUrl'    => esc_url_raw( ( $item['imageUrl'] ?? '' ) ? $item['imageUrl'] : $fallback['imageUrl'] ),
			'icon'        => $icon,
		);
	}

	return ! empty( $normalized ) ? $normalized : agency_starter_usp_tabs_default_items();
}

PHP
);
echo "usp-tabs.php\n";

// --- render.php (Mantine Tabs structure) ---
file_put_contents(
	"$theme/blocks/usp-tabs/render.php",
	<<<'PHP'
<?php
/**
 * USP Tabs — Mantine Tabs (vertical) + preview panel.
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
		'data-orientation'     => 'vertical',
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

		<div class="agency-usp-tabs__root">
			<div class="agency-usp-tabs__list" role="tablist" aria-orientation="vertical" aria-label="<?php esc_attr_e( 'Services', 'agency-starter' ); ?>">
				<?php foreach ( $items as $index => $item ) : ?>
					<?php
					$is_active = 0 === $index;
					$tab_id    = $uid . '-tab-' . $index;
					$panel_id  = $uid . '-panel-' . $index;
					$cta_href  = $item['ctaUrl'];
					if ( $cta_href && str_starts_with( $cta_href, '/' ) ) {
						$cta_href = home_url( $cta_href );
					}
					?>
					<div class="agency-usp-tabs__item<?php echo $is_active ? ' is-active' : ''; ?>" data-value="<?php echo esc_attr( (string) $index ); ?>">
						<button
							type="button"
							class="agency-usp-tabs__tab"
							role="tab"
							id="<?php echo esc_attr( $tab_id ); ?>"
							aria-selected="<?php echo $is_active ? 'true' : 'false'; ?>"
							aria-controls="<?php echo esc_attr( $panel_id ); ?>"
							tabindex="<?php echo $is_active ? '0' : '-1'; ?>"
							data-usp-tab
							data-usp-index="<?php echo esc_attr( (string) $index ); ?>"
						>
							<span class="agency-usp-tabs__section">
								<?php
								// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in helper.
								echo agency_starter_heroicon( $item['icon'], 'agency-usp-tabs__icon' );
								?>
							</span>
							<span class="agency-usp-tabs__label"><?php echo esc_html( $item['title'] ); ?></span>
							<span class="agency-usp-tabs__chevron" data-usp-chevron aria-hidden="true">
								<?php
								// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in helper.
								echo agency_starter_heroicon( $is_active ? 'chevron-up' : 'chevron-down', 'agency-usp-tabs__chevron-icon' );
								?>
							</span>
						</button>
						<div
							class="agency-usp-tabs__panel"
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
									<span class="agency-usp-tabs__cta-icon" aria-hidden="true">
										<?php
										// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in helper.
										echo agency_starter_heroicon( 'arrow-right', 'agency-usp-tabs__cta-arrow' );
										?>
									</span>
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
echo "render.php\n";

// --- CSS (Mantine Tabs vertical) ---
file_put_contents(
	"$root/tailwind/custom/components/agency-usp-tabs.css",
	<<<'CSS'
/**
 * USP Tabs — maps to Mantine Tabs (orientation=vertical).
 * @see https://ui.mantine.dev/ — Tabs vertical variant
 */
.agency-usp-tabs__heading {
	margin-bottom: var(--wp--preset--spacing--2xl, 48px);
	text-align: left;
}

/* Mantine: <Tabs orientation="vertical"> */
.agency-usp-tabs__root {
	display: grid;
	gap: var(--wp--preset--spacing--2xl, 48px);
	align-items: start;
}

@media (min-width: 64em) {
	.agency-usp-tabs__root {
		grid-template-columns: minmax(0, 1fr) minmax(0, 1.05fr);
	}
}

/* Mantine: <Tabs.List> */
.agency-usp-tabs__list {
	display: flex;
	flex-direction: column;
	border-top: 1px solid var(--wp--preset--color--border, #e5e7eb);
}

/* Mantine: <Tabs.Tab> wrapper (tab + panel pair) */
.agency-usp-tabs__item {
	border-bottom: 1px solid var(--wp--preset--color--border, #e5e7eb);
}

.agency-usp-tabs__item.is-active {
	background: var(--wp--preset--color--surface-dark, #1f2937);
}

/* Mantine: <Tabs.Tab> */
.agency-usp-tabs__tab {
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

.agency-usp-tabs__item.is-active .agency-usp-tabs__tab,
.agency-usp-tabs__item.is-active .agency-usp-tabs__description,
.agency-usp-tabs__item.is-active .agency-usp-tabs__cta {
	color: var(--wp--preset--color--inverse, #fff);
}

/* Mantine: Tabs.Tab leftSection */
.agency-usp-tabs__section {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 2.5rem;
	height: 2.5rem;
	border-radius: 9999px;
	background: var(--wp--preset--color--primary-subtle, #ede9fe);
	color: var(--wp--preset--color--primary, #570df8);
	flex-shrink: 0;
}

.agency-usp-tabs__item.is-active .agency-usp-tabs__section {
	background: rgba(255, 255, 255, 0.12);
	color: var(--wp--preset--color--inverse, #fff);
}

.agency-usp-tabs__icon {
	width: 1.25rem;
	height: 1.25rem;
}

.agency-usp-tabs__label {
	font-size: var(--wp--preset--font-size--lg, 1.25rem);
	font-weight: 600;
	line-height: 1.3;
}

.agency-usp-tabs__chevron-icon {
	width: 1rem;
	height: 1rem;
	opacity: 0.7;
}

/* Mantine: <Tabs.Panel> */
.agency-usp-tabs__panel {
	padding: 0 var(--wp--preset--spacing--lg, 24px) var(--wp--preset--spacing--lg, 24px);
}

.agency-usp-tabs__item:not(.is-active) .agency-usp-tabs__panel {
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

.agency-usp-tabs__cta-arrow {
	width: 1rem;
	height: 1rem;
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

CSS
);
echo "css\n";

// Pattern
$more = file_get_contents( "$theme/inc/patterns-more.php" );
if ( ! str_contains( $more, 'agency-starter/usp-tabs' ) ) {
	$more = preg_replace(
		'/return array\(\n/',
		"return array(\n\t\tarray(\n\t\t\t'title'      => __( 'USP Tabs', 'agency-starter' ),\n\t\t\t'slug'       => 'agency-starter/usp-tabs',\n\t\t\t'categories' => array( 'corporate-services' ),\n\t\t\t'content'    => '<!-- wp:agency-starter/usp-tabs {\"align\":\"full\"} /-->',\n\t\t),\n",
		$more,
		1
	);
	file_put_contents( "$theme/inc/patterns-more.php", $more );
	echo "pattern\n";
}

// JS — read from mounted /scripts or local WP-dev/scripts
$script_dir = is_dir( '/scripts' ) ? '/scripts' : dirname( __FILE__ );
$view_js    = is_readable( "$script_dir/usp-tabs.js" ) ? file_get_contents( "$script_dir/usp-tabs.js" ) : '';
$editor_js  = is_readable( "$script_dir/usp-tabs-editor-v2.js" ) ? file_get_contents( "$script_dir/usp-tabs-editor-v2.js" ) : '';

if ( $view_js ) {
	file_put_contents( "$root/javascript/usp-tabs.js", $view_js );
}
if ( $editor_js ) {
	file_put_contents( "$root/javascript/usp-tabs-editor.js", $editor_js );
}

$pkg = file_get_contents( "$root/package.json" );
if ( ! str_contains( $pkg, 'usp-tabs.js' ) ) {
	$pkg = str_replace(
		'./javascript/block-editor.js --target=esnext',
		'./javascript/block-editor.js ./javascript/usp-tabs.js ./javascript/usp-tabs-editor.js --target=esnext',
		$pkg
	);
	file_put_contents( "$root/package.json", $pkg );
}

echo "done\n";
