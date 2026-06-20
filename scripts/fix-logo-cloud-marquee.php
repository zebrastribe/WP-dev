<?php
/**
 * Logo Cloud block — full-width marquee (Remote-style), animates when enough logos.
 */
$root  = is_dir( '/workspace/wordpress/wp-content/themes/agency-starter' )
	? '/workspace/wordpress/wp-content/themes/agency-starter'
	: '/var/www/html/wp-content/themes/agency-starter';
$theme = "$root/theme";

mkdir( "$theme/blocks/logo-cloud", 0755, true );
mkdir( "$theme/assets/images/placeholders/logos", 0755, true );

$logos = array(
	'client-01' => array( 'Nordvik', 'font-weight="700" font-size="22"' ),
	'client-02' => array( 'Helix', 'font-weight="600" font-size="24" font-style="italic"' ),
	'client-03' => array( 'Meridian', 'font-weight="500" font-size="20" letter-spacing="2"' ),
	'client-04' => array( 'Vertex', 'font-weight="800" font-size="22"' ),
	'client-05' => array( 'Axis', 'font-weight="700" font-size="26"' ),
	'client-06' => array( 'Pulse', 'font-weight="600" font-size="22"' ),
	'client-07' => array( 'Forge', 'font-weight="700" font-size="21" letter-spacing="1"' ),
	'client-08' => array( 'Lumen', 'font-weight="500" font-size="23"' ),
);

foreach ( $logos as $slug => $meta ) {
	$name = $meta[0];
	$font = $meta[1];
	$svg  = <<<SVG
<svg xmlns="http://www.w3.org/2000/svg" width="140" height="48" viewBox="0 0 140 48" role="img" aria-label="{$name}">
  <text x="70" y="30" font-family="Raleway, ui-sans-serif, system-ui, sans-serif" {$font} fill="currentColor" text-anchor="middle">{$name}</text>
</svg>
SVG;
	file_put_contents( "$theme/assets/images/placeholders/logos/{$slug}.svg", $svg );
}

file_put_contents(
	"$theme/inc/logo-cloud.php",
	<<<'PHP'
<?php
/**
 * Logo Cloud block helpers.
 *
 * @package Agency_Starter
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Default demo logos (wordmark SVGs).
 *
 * @return array<int, array<string, string>>
 */
function agency_starter_logo_cloud_default_logos() {
	$base = get_template_directory_uri() . '/assets/images/placeholders/logos/';

	return array(
		array( 'url' => $base . 'client-01.svg', 'alt' => 'Nordvik' ),
		array( 'url' => $base . 'client-02.svg', 'alt' => 'Helix' ),
		array( 'url' => $base . 'client-03.svg', 'alt' => 'Meridian' ),
		array( 'url' => $base . 'client-04.svg', 'alt' => 'Vertex' ),
		array( 'url' => $base . 'client-05.svg', 'alt' => 'Axis' ),
		array( 'url' => $base . 'client-06.svg', 'alt' => 'Pulse' ),
		array( 'url' => $base . 'client-07.svg', 'alt' => 'Forge' ),
		array( 'url' => $base . 'client-08.svg', 'alt' => 'Lumen' ),
	);
}

/**
 * Normalize logo items from block attributes.
 *
 * @param mixed $logos Raw logos.
 * @return array<int, array<string, string>>
 */
function agency_starter_logo_cloud_normalize_logos( $logos ) {
	if ( ! is_array( $logos ) || empty( $logos ) ) {
		return agency_starter_logo_cloud_default_logos();
	}

	$normalized = array();

	foreach ( $logos as $logo ) {
		if ( ! is_array( $logo ) ) {
			continue;
		}

		$url = esc_url_raw( $logo['url'] ?? '' );
		$alt = sanitize_text_field( $logo['alt'] ?? '' );

		if ( ! $url ) {
			continue;
		}

		$normalized[] = array(
			'url' => $url,
			'alt' => $alt ?: __( 'Client logo', 'agency-starter' ),
		);
	}

	return $normalized ?: agency_starter_logo_cloud_default_logos();
}

PHP
);

file_put_contents(
	"$theme/blocks/logo-cloud/block.json",
	<<<'JSON'
{
	"$schema": "https://schemas.wp.org/trunk/block.json",
	"apiVersion": 3,
	"name": "agency-starter/logo-cloud",
	"title": "Logo Cloud",
	"category": "design",
	"icon": "images-alt2",
	"description": "Full-width logo trust band with optional marquee animation.",
	"keywords": [ "logos", "clients", "trust", "marquee" ],
	"textdomain": "agency-starter",
	"attributes": {
		"label": { "type": "string", "default": "Global companies grow with us" },
		"logos": { "type": "array", "default": [] },
		"minLogosForAnimation": { "type": "number", "default": 6 }
	},
	"supports": { "html": false, "align": [ "full" ] },
	"render": "file:./render.php"
}
JSON
);

file_put_contents(
	"$theme/blocks/logo-cloud/render.php",
	<<<'PHP'
<?php
/**
 * Logo Cloud — full-width marquee when enough logos overflow.
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

$label    = sanitize_text_field( $attributes['label'] ?? __( 'Global companies grow with us', 'agency-starter' ) );
$logos    = agency_starter_logo_cloud_normalize_logos( $attributes['logos'] ?? array() );
$min_anim = max( 2, (int) ( $attributes['minLogosForAnimation'] ?? 6 ) );

$wrapper_attrs = get_block_wrapper_attributes(
	array(
		'class'                   => 'agency-section agency-section--compact agency-logo-cloud',
		'data-agency-logo-marquee' => '',
		'data-min-logos'          => (string) $min_anim,
	)
);
?>
<section <?php echo $wrapper_attrs; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped ?>>
	<?php if ( $label ) : ?>
		<div class="agency-container">
			<p class="agency-logo-cloud__label"><?php echo esc_html( $label ); ?></p>
		</div>
	<?php endif; ?>

	<div class="agency-logo-cloud__viewport" data-marquee-viewport>
		<div class="agency-logo-cloud__track" data-marquee-track>
			<ul class="agency-logo-cloud__list" data-marquee-list role="list">
				<?php foreach ( $logos as $logo ) : ?>
					<li class="agency-logo-cloud__item">
						<img src="<?php echo esc_url( $logo['url'] ); ?>" alt="<?php echo esc_attr( $logo['alt'] ); ?>" loading="lazy" decoding="async" width="140" height="48" />
					</li>
				<?php endforeach; ?>
			</ul>
		</div>
	</div>
</section>

PHP
);

file_put_contents(
	"$root/tailwind/custom/components/agency-logo-marquee.css",
	<<<'CSS'
/**
 * Logo Cloud — Remote-style full-width marquee.
 */
.agency-logo-cloud {
	overflow: hidden;
}

.agency-logo-cloud__label {
	font-size: var(--wp--preset--font-size--sm, 0.875rem);
	font-weight: 500;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: var(--wp--preset--color--slate, #6b7280);
	margin: 0 0 var(--wp--preset--spacing--lg, 24px);
	text-align: center;
}

.agency-logo-cloud__viewport {
	width: 100%;
	overflow: hidden;
	-webkit-mask-image: linear-gradient(
		90deg,
		transparent,
		#000 6%,
		#000 94%,
		transparent
	);
	mask-image: linear-gradient(90deg, transparent, #000 6%, #000 94%, transparent);
}

.agency-logo-cloud__track {
	display: flex;
	width: max-content;
	will-change: transform;
}

.agency-logo-cloud__list {
	display: flex;
	flex-shrink: 0;
	align-items: center;
	gap: clamp(2rem, 5vw, 4rem);
	margin: 0;
	padding: 0.25rem clamp(1rem, 4vw, 2rem);
	list-style: none;
}

.agency-logo-cloud__item {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	margin: 0;
	opacity: 0.72;
	filter: grayscale(100%);
	color: var(--wp--preset--color--foreground, #374151);
	transition: opacity 0.15s ease, filter 0.15s ease;
}

.agency-logo-cloud__item:hover {
	opacity: 1;
	filter: grayscale(0%);
}

.agency-logo-cloud__item img {
	display: block;
	max-height: 2.5rem;
	width: auto;
	max-width: 9rem;
	object-fit: contain;
}

/* Static grid when not enough logos to scroll */
.agency-logo-cloud.is-static .agency-logo-cloud__viewport {
	-webkit-mask-image: none;
	mask-image: none;
	overflow: visible;
}

.agency-logo-cloud.is-static .agency-logo-cloud__track {
	width: 100%;
	justify-content: center;
}

.agency-logo-cloud.is-static .agency-logo-cloud__list {
	flex-wrap: wrap;
	justify-content: center;
	max-width: var(--agency-container-max, 72rem);
	margin-inline: auto;
}

/* Marquee animation */
.agency-logo-cloud.is-animated .agency-logo-cloud__track {
	animation: agency-logo-marquee 45s linear infinite;
}

.agency-logo-cloud.is-animated:hover .agency-logo-cloud__track {
	animation-play-state: paused;
}

@keyframes agency-logo-marquee {
	from {
		transform: translateX(0);
	}
	to {
		transform: translateX(-50%);
	}
}

@media (prefers-reduced-motion: reduce) {
	.agency-logo-cloud.is-animated .agency-logo-cloud__track {
		animation: none;
	}

	.agency-logo-cloud.is-animated .agency-logo-cloud__viewport {
		overflow-x: auto;
		-webkit-mask-image: none;
		mask-image: none;
		scrollbar-width: none;
	}

	.agency-logo-cloud.is-animated .agency-logo-cloud__viewport::-webkit-scrollbar {
		display: none;
	}
}

CSS
);

// --- JS files ---
file_put_contents(
	"$root/javascript/logo-cloud.js",
	<<<'JS'
/**
 * Logo Cloud marquee — animate full width when logos overflow or count threshold met.
 */
document.querySelectorAll('[data-agency-logo-marquee]').forEach((root) => {
	const track = root.querySelector('[data-marquee-track]');
	const list = root.querySelector('[data-marquee-list]');
	const viewport = root.querySelector('[data-marquee-viewport]');

	if (!track || !list || !viewport) {
		return;
	}

	const minLogos = Number(root.dataset.minLogos) || 6;
	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

	const reset = () => {
		track.querySelectorAll('[data-marquee-clone]').forEach((node) => node.remove());
		root.classList.remove('is-animated', 'is-static');
	};

	const setup = () => {
		reset();

		const items = list.querySelectorAll('.agency-logo-cloud__item');
		if (!items.length) {
			return;
		}

		const listWidth = list.scrollWidth;
		const viewportWidth = viewport.clientWidth;
		const shouldAnimate =
			!reducedMotion.matches &&
			(items.length >= minLogos || listWidth > viewportWidth);

		if (shouldAnimate) {
			const clone = list.cloneNode(true);
			clone.setAttribute('data-marquee-clone', '');
			clone.setAttribute('aria-hidden', 'true');
			track.appendChild(clone);
			root.classList.add('is-animated');
			return;
		}

		root.classList.add('is-static');
	};

	setup();

	let resizeTimer;
	window.addEventListener('resize', () => {
		window.clearTimeout(resizeTimer);
		resizeTimer = window.setTimeout(setup, 150);
	});

	reducedMotion.addEventListener('change', setup);
});

JS
);

file_put_contents(
	"$root/javascript/logo-cloud-editor.js",
	<<<'JS'
/**
 * Logo Cloud block editor.
 */
const { registerBlockType } = wp.blocks;
const { useBlockProps, RichText, InspectorControls, MediaUpload, MediaUploadCheck } = wp.blockEditor;
const { PanelBody, TextControl, Button, RangeControl } = wp.components;
const { Fragment } = wp.element;

const DEFAULT_LOGOS = [
	{ url: '', alt: 'Nordvik' },
	{ url: '', alt: 'Helix' },
	{ url: '', alt: 'Meridian' },
	{ url: '', alt: 'Vertex' },
	{ url: '', alt: 'Axis' },
	{ url: '', alt: 'Pulse' },
	{ url: '', alt: 'Forge' },
	{ url: '', alt: 'Lumen' },
];

registerBlockType('agency-starter/logo-cloud', {
	edit({ attributes, setAttributes }) {
		const { label, logos, minLogosForAnimation } = attributes;
		const items = logos?.length ? logos : DEFAULT_LOGOS;
		const blockProps = useBlockProps({
			className: 'agency-logo-cloud-editor alignfull agency-section agency-section--compact agency-logo-cloud is-static',
		});

		const updateLogo = (index, field, value) => {
			setAttributes({
				logos: items.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
			});
		};

		const addLogo = () => {
			if (items.length >= 16) return;
			setAttributes({ logos: [...items, { url: '', alt: 'Client logo' }] });
		};

		const removeLogo = (index) => {
			if (items.length <= 1) return;
			setAttributes({ logos: items.filter((_, i) => i !== index) });
		};

		return wp.element.createElement(
			Fragment,
			null,
			wp.element.createElement(
				InspectorControls,
				null,
				wp.element.createElement(
					PanelBody,
					{ title: 'Marquee', initialOpen: true },
					wp.element.createElement(RangeControl, {
						label: 'Min logos before animation',
						value: minLogosForAnimation ?? 6,
						onChange: (v) => setAttributes({ minLogosForAnimation: v }),
						min: 3,
						max: 12,
					}),
				),
				wp.element.createElement(
					PanelBody,
					{ title: 'Logos', initialOpen: true },
					items.map((item, index) =>
						wp.element.createElement(
							'div',
							{ key: index, style: { marginBottom: '1rem', paddingBottom: '1rem', borderBottom: '1px solid #e5e7eb' } },
							wp.element.createElement(TextControl, {
								label: `Logo ${index + 1} alt text`,
								value: item.alt,
								onChange: (v) => updateLogo(index, 'alt', v),
							}),
							wp.element.createElement(MediaUploadCheck, null,
								wp.element.createElement(MediaUpload, {
									onSelect: (media) => updateLogo(index, 'url', media.url),
									allowedTypes: ['image'],
									render: ({ open }) =>
										wp.element.createElement(Button, { variant: 'secondary', onClick: open }, item.url ? 'Replace image' : 'Upload logo'),
								}),
							),
							item.url
								? wp.element.createElement('img', { src: item.url, alt: item.alt, style: { maxHeight: '32px', marginTop: '0.5rem' } })
								: null,
							wp.element.createElement(Button, { isDestructive: true, onClick: () => removeLogo(index) }, 'Remove'),
						),
					),
					wp.element.createElement(Button, { variant: 'secondary', onClick: addLogo }, 'Add logo'),
				),
			),
			wp.element.createElement(
				'div',
				blockProps,
				wp.element.createElement(RichText, {
					tagName: 'p',
					className: 'agency-logo-cloud__label',
					value: label,
					onChange: (v) => setAttributes({ label: v }),
					placeholder: 'Global companies grow with us',
				}),
				wp.element.createElement(
					'ul',
					{ className: 'agency-logo-cloud__list', style: { display: 'flex', flexWrap: 'wrap', gap: '2rem', justifyContent: 'center', listStyle: 'none', padding: 0 } },
					items.map((item, index) =>
						wp.element.createElement(
							'li',
							{ key: index, className: 'agency-logo-cloud__item' },
							item.url
								? wp.element.createElement('img', { src: item.url, alt: item.alt, style: { maxHeight: '40px' } })
								: wp.element.createElement('span', { style: { opacity: 0.5 } }, item.alt || `Logo ${index + 1}`),
						),
					),
				),
				wp.element.createElement('p', { style: { textAlign: 'center', opacity: 0.6, fontSize: '0.875rem', marginTop: '1rem' } },
					`${items.length} logos — marquee on front end when ≥ ${minLogosForAnimation ?? 6} logos or overflow.`,
				),
			),
		);
	},
	save() {
		return null;
	},
});

JS
);

// Update blocks.php
$blocks = file_get_contents( "$theme/inc/blocks.php" );
if ( ! str_contains( $blocks, 'logo-cloud' ) ) {
	$blocks = str_replace(
		"register_block_type( get_template_directory() . '/blocks/usp-tabs' );",
		"register_block_type( get_template_directory() . '/blocks/usp-tabs' );\n\tregister_block_type( get_template_directory() . '/blocks/logo-cloud' );",
		$blocks
	);
}

if ( ! str_contains( $blocks, 'logo-cloud-editor' ) ) {
	$blocks = str_replace(
		"add_action( 'enqueue_block_assets', 'agency_starter_enqueue_usp_tabs_assets' );",
		<<<'PHP'
add_action( 'enqueue_block_assets', 'agency_starter_enqueue_usp_tabs_assets' );

/**
 * Enqueue Logo Cloud assets.
 */
function agency_starter_enqueue_logo_cloud_assets() {
	if ( is_admin() ) {
		wp_enqueue_script(
			'agency-starter-logo-cloud-editor',
			get_template_directory_uri() . '/js/logo-cloud-editor.min.js',
			array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n' ),
			AGENCY_STARTER_VERSION,
			true
		);
		return;
	}

	if ( ! has_block( 'agency-starter/logo-cloud' ) ) {
		return;
	}

	wp_enqueue_script(
		'agency-starter-logo-cloud',
		get_template_directory_uri() . '/js/logo-cloud.min.js',
		array(),
		AGENCY_STARTER_VERSION,
		true
	);
}
add_action( 'enqueue_block_assets', 'agency_starter_enqueue_logo_cloud_assets' );
PHP,
		$blocks
	);
}
file_put_contents( "$theme/inc/blocks.php", $blocks );

// functions.php require
$functions = file_get_contents( "$theme/functions.php" );
if ( ! str_contains( $functions, 'logo-cloud.php' ) ) {
	$functions = str_replace(
		"require get_template_directory() . '/inc/usp-tabs.php';",
		"require get_template_directory() . '/inc/usp-tabs.php';\nrequire get_template_directory() . '/inc/logo-cloud.php';",
		$functions
	);
	file_put_contents( "$theme/functions.php", $functions );
}

// Update pattern to use block instead of static columns
$more = file_get_contents( "$theme/inc/patterns-more.php" );
if ( str_contains( $more, 'agency-logo-cloud__grid' ) ) {
	$more = preg_replace(
		"/array\(\s*'title'\s*=>\s*__\( 'Logo Cloud'.*?<!-- \/wp:group -->',\s*\),/s",
		"array(\n\t\t\t'title'      => __( 'Logo Cloud', 'agency-starter' ),\n\t\t\t'slug'       => 'agency-starter/logo-cloud',\n\t\t\t'categories' => array( 'corporate-trust' ),\n\t\t\t'content'    => '<!-- wp:agency-starter/logo-cloud {\"align\":\"full\"} />--',\n\t\t),",
		$more,
		1
	);
	file_put_contents( "$theme/inc/patterns-more.php", $more );
}

// package.json esbuild entries
$pkg = file_get_contents( "$root/package.json" );
if ( ! str_contains( $pkg, 'logo-cloud.js' ) ) {
	$pkg = str_replace(
		'./javascript/usp-tabs-editor.js --target=esnext',
		'./javascript/usp-tabs-editor.js ./javascript/logo-cloud.js ./javascript/logo-cloud-editor.js --target=esnext',
		$pkg
	);
	file_put_contents( "$root/package.json", $pkg );
}

// demo homepage
$demo = file_get_contents( "$theme/inc/demo-content.php" );
$demo = str_replace(
	"'<!-- wp:pattern {\"slug\":\"agency-starter/logo-cloud\"} /-->',",
	"'<!-- wp:agency-starter/logo-cloud {\"align\":\"full\"} /-->',",
	$demo
);
if ( str_contains( $demo, "define( 'AGENCY_STARTER_DEMO_VERSION', 7 );" ) ) {
	$demo = str_replace(
		"define( 'AGENCY_STARTER_DEMO_VERSION', 7 );",
		"define( 'AGENCY_STARTER_DEMO_VERSION', 8 );",
		$demo
	);
}
file_put_contents( "$theme/inc/demo-content.php", $demo );

echo "logo-cloud block deployed\n";
