<?php
/**
 * P1 remaining fixes: i18n cleanup, dead links, footer-legal URLs.
 */
$theme = '/var/www/html/wp-content/themes/agency-starter/theme';

// i18n-parts: remove blanket href="#" replacement.
$i18n = file_get_contents( "$theme/inc/i18n-parts.php" );
$i18n = preg_replace( "/\t\t\t'href=\"#'\".*\n/", '', $i18n );
$i18n = preg_replace( "/\t\t\t'aria-label=\"Primary\"'.*\n/", '', $i18n );
$i18n = preg_replace( "/\t\t\t'<p class=\"has-sm-font-size\">\\|<\\/p>'.*\n/", '', $i18n );
file_put_contents( "$theme/inc/i18n-parts.php", $i18n );
echo "i18n-parts cleaned\n";

// footer-legal.html
file_put_contents(
	"$theme/parts/footer-legal.html",
	<<<'HTML'
<!-- wp:group {"className":"footer-legal","layout":{"type":"default"}} -->
<div class="wp-block-group footer-legal">
	<!-- wp:group {"className":"agency-container","layout":{"type":"flex","flexWrap":"wrap","justifyContent":"center"}} -->
	<div class="wp-block-group agency-container">
		<!-- wp:paragraph {"fontSize":"sm","textColor":"muted"} -->
		<p class="has-muted-color has-text-color has-sm-font-size"><a href="/privacy-policy/">Privacy policy</a> · <a href="/privacy-policy/">Terms of use</a></p>
		<!-- /wp:paragraph -->
	</div>
	<!-- /wp:group -->
</div>
<!-- /wp:group -->

HTML
);
echo "footer-legal updated\n";

$replacements = array(
	'<a href="#">Lorem read more →</a>'       => '<a href="/knowledge-hub/">Lorem read more →</a>',
	'<a href="#">Lorem read more →</a>'       => '<a href="/knowledge-hub/">Lorem read more →</a>',
	'<a href="#">Lorem privacy policy</a>'    => '<a href="/privacy-policy/">Lorem privacy policy</a>',
	'<a href="#">Lorem download</a>'          => '<a href="/knowledge-hub/">Lorem download</a>',
	'<a href="#">Lorem related article one</a>' => '<a href="/articles/">Lorem related article one</a>',
	'<a href="#">Lorem related article two</a>' => '<a href="/articles/">Lorem related article two</a>',
	'<a href="#">Lorem related resource</a>'  => '<a href="/knowledge-hub/">Lorem related resource</a>',
	'<a href="#">Lorem directions</a>'        => '<a href="/contact/">Lorem directions</a>',
);

foreach ( array( 'inc/patterns.php', 'inc/patterns-more.php' ) as $rel ) {
	$path = "$theme/$rel";
	$content = file_get_contents( $path );
	$count   = 0;
	foreach ( $replacements as $search => $replace ) {
		$content = str_replace( $search, $replace, $content, $c );
		$count  += $c;
	}
	file_put_contents( $path, $content );
	echo "patched $rel ($count replacements)\n";
}
