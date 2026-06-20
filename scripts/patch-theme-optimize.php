<?php
$base = '/var/www/html/wp-content/themes/agency-starter';

function patch( $rel, $pairs ) {
	$path = "$base/$rel";
	$t    = file_get_contents( $path );
	$o    = $t;
	foreach ( $pairs as $pair ) {
		$t = str_replace( $pair[0], $pair[1], $t );
	}
	if ( $t !== $o ) {
		file_put_contents( $path, $t );
		echo "patched $rel\n";
	}
}

// Text domain
patch( 'tailwind/custom/file-header.css', array( array( 'Text Domain: agency_starter', 'Text Domain: agency-starter' ) ) );

// Footer landmark
patch( 'theme/parts/footer.html', array(
	array( '<!-- wp:group {"tagName":"footer","className":"site-footer"', '<!-- wp:group {"className":"site-footer"' ),
	array( '<footer class="wp-block-group site-footer">', '<div class="wp-block-group site-footer">' ),
	array( '</footer>', '</div>' ),
) );

// Breadcrumbs
file_put_contents(
	"$base/theme/parts/breadcrumbs.html",
	"<!-- wp:group {\"className\":\"agency-breadcrumbs\",\"layout\":{\"type\":\"default\"}} -->\n<div class=\"wp-block-group agency-breadcrumbs\">\n\t<!-- wp:shortcode -->\n\t[agency_starter_breadcrumbs]\n\t<!-- /wp:shortcode -->\n</div>\n<!-- /wp:group -->\n"
);
echo "patched theme/parts/breadcrumbs.html\n";

// Archive templates
$archive_header = <<<'HTML'
	<!-- wp:group {"align":"full","className":"agency-section agency-section--compact","layout":{"type":"default"}} -->
	<div class="wp-block-group alignfull agency-section agency-section--compact">
		<!-- wp:group {"className":"agency-container","layout":{"type":"default"}} -->
		<div class="wp-block-group agency-container">
			<!-- wp:query-title {"type":"archive","level":1,"className":"agency-hero__title"} /-->
		</div>
		<!-- /wp:group -->
	</div>
	<!-- /wp:group -->

HTML;

foreach ( array( 'archive-job.html', 'page-archive-articles.html', 'page-archive-news.html' ) as $tpl ) {
	$path = "$base/theme/templates/$tpl";
	$t    = file_get_contents( $path );
	$t    = preg_replace(
		'/\t<!-- wp:pattern \{"slug":"agency-starter\/hero-minimal"\} \/-->\n\n/',
		$archive_header,
		$t,
		1
	);
	file_put_contents( $path, $t );
	echo "patched theme/templates/$tpl\n";
}

// Animation - remove opacity from slide-up
$anim = "$base/tailwind/custom/components/animation.css";
$t    = file_get_contents( $anim );
$t    = preg_replace(
	'/@keyframes agency-slide-up \{[^}]+\}/s',
	"@keyframes agency-slide-up {\n\tfrom {\n\t\ttransform: translateY(var(--wp--custom--motion--distance--md, 16px));\n\t}\n\tto {\n\t\ttransform: translateY(0);\n\t}\n}",
	$t
);
file_put_contents( $anim, $t );
echo "patched animation.css\n";

// Motion.php - use slide-up instead of fade-in
$motion = "$base/theme/inc/motion.php";
$t      = file_get_contents( $motion );
$t      = str_replace(
	"'agency-lead'          => 'agency-motion-fade-in agency-motion-delay-sm',",
	"'agency-lead'          => 'agency-motion-slide-up agency-motion-delay-sm',",
	$t
);
$t      = str_replace(
	"'agency-hero__actions' => 'agency-motion-fade-in agency-motion-delay-md',",
	"'agency-hero__actions' => 'agency-motion-slide-up agency-motion-delay-md',",
	$t
);
file_put_contents( $motion, $t );
echo "patched motion.php\n";

// CSS fallback colors
$design = "$base/tailwind/custom/components/agency-design.css";
$t      = file_get_contents( $design );
$t      = str_replace( '#3296d2', '#570DF8', $t );
$t      = str_replace( '#2a82b8', '#4506CB', $t );
$t      = str_replace( '#2db8a8', '#9D0075', $t );
file_put_contents( $design, $t );
echo "patched agency-design.css\n";

// Pattern button URLs
$button_map = array(
	'<!-- wp:button {"className":"agency-btn--employer"} -->' => '<!-- wp:button {"url":"/employers/","className":"agency-btn--employer"} -->',
	'<!-- wp:button {"className":"agency-btn--candidate"} -->' => '<!-- wp:button {"url":"/candidates/","className":"agency-btn--candidate"} -->',
	'<!-- wp:button {"className":"agency-btn--on-dark"} -->' => '<!-- wp:button {"url":"/contact/","className":"agency-btn--on-dark"} -->',
	'<!-- wp:button {"className":"agency-btn--ghost"} -->' => '<!-- wp:button {"url":"/articles/","className":"agency-btn--ghost"} -->',
	'<a class="wp-block-button__link wp-element-button">Lorem employer CTA</a>' => '<a class="wp-block-button__link wp-element-button" href="/employers/">Lorem employer CTA</a>',
	'<a class="wp-block-button__link wp-element-button">Lorem candidate CTA</a>' => '<a class="wp-block-button__link wp-element-button" href="/candidates/">Lorem candidate CTA</a>',
	'<a class="wp-block-button__link wp-element-button">Lorem primary CTA</a>' => '<a class="wp-block-button__link wp-element-button" href="/contact/">Lorem primary CTA</a>',
	'<a class="wp-block-button__link wp-element-button">Lorem contact CTA</a>' => '<a class="wp-block-button__link wp-element-button" href="/contact/">Lorem contact CTA</a>',
	'<a class="wp-block-button__link wp-element-button">Lorem employer path</a>' => '<a class="wp-block-button__link wp-element-button" href="/employers/">Lorem employer path</a>',
	'<a class="wp-block-button__link wp-element-button">Lorem candidate path</a>' => '<a class="wp-block-button__link wp-element-button" href="/candidates/">Lorem candidate path</a>',
	'<a class="wp-block-button__link wp-element-button">Lorem apply now</a>' => '<a class="wp-block-button__link wp-element-button" href="/employer-form/">Lorem apply now</a>',
	'<a class="wp-block-button__link wp-element-button">Lorem view all jobs</a>' => '<a class="wp-block-button__link wp-element-button" href="/kandidater/it-jobs/">Lorem view all jobs</a>',
	'<a class="wp-block-button__link wp-element-button">Lorem view all articles</a>' => '<a class="wp-block-button__link wp-element-button" href="/articles/">Lorem view all articles</a>',
	'<a class="wp-block-button__link wp-element-button">Lorem contact us</a>' => '<a class="wp-block-button__link wp-element-button" href="/contact/">Lorem contact us</a>',
);

foreach ( array( 'theme/inc/patterns.php', 'theme/inc/patterns-more.php', 'theme/inc/synced-patterns.php' ) as $rel ) {
	$path = "$base/$rel";
	$t    = file_get_contents( $path );
	$o    = $t;
	foreach ( $button_map as $from => $to ) {
		$t = str_replace( $from, $to, $t );
	}
	if ( $t !== $o ) {
		file_put_contents( $path, $t );
		echo "patched $rel buttons\n";
	}
}

// Footer links use home_url paths - update footer.html
$footer = "$base/theme/parts/footer.html";
$t      = file_get_contents( $footer );
$t      = str_replace( 'href="/employers/"', 'href="/employers/"', $t ); // keep paths - WP resolves

// Enqueue - preload 700
$enqueue = "$base/theme/inc/enqueue.php";
$t       = file_get_contents( $enqueue );
if ( ! str_contains( $t, 'raleway-700' ) ) {
	$t = str_replace(
		"foreach ( array( 400, 600 ) as \$weight ) {",
		"foreach ( array( 400, 600, 700 ) as \$weight ) {",
		$t
	);
	file_put_contents( $enqueue, $t );
	echo "patched enqueue.php preload\n";
}

echo "done\n";
