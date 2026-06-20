<?php
$theme = '/var/www/html/wp-content/themes/agency-starter/theme';

$nav = file_get_contents( "$theme/inc/navigation.php" );
$nav = preg_replace(
	"/\/\*\*\n \* Strip responsive overlay[\s\S]*?return agency_starter_get_primary_nav_markup\(\);\n\}\n/",
	'',
	$nav,
	1
);
$nav = preg_replace(
	"/\/\*\*\n \* Ensure header template part[\s\S]*?\n \*\/\n\n\n/",
	'',
	$nav,
	1
);
file_put_contents( "$theme/inc/navigation.php", $nav );
echo "navigation fixed\n";

$pat = file_get_contents( "$theme/inc/patterns.php" );
$faq_old = '<!-- wp:heading {"level":3,"className":"agency-card__title"} -->
<h3 class="wp-block-heading agency-card__title">Lorem ipsum question one?</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"agency-card__text"} -->
<p class="agency-card__text">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":3,"className":"agency-card__title"} -->
<h3 class="wp-block-heading agency-card__title">Lorem ipsum question two?</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"agency-card__text"} -->
<p class="agency-card__text">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas faucibus mollis interdum. Cras mattis consectetur purus.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":3,"className":"agency-card__title"} -->
<h3 class="wp-block-heading agency-card__title">Lorem ipsum question three?</h3>
<!-- /wp:heading -->

<!-- wp:paragraph {"className":"agency-card__text"} -->
<p class="agency-card__text">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam quis risus eget urna mollis ornare vel eu leo.</p>
<!-- /wp:paragraph -->';

$faq_new = '<!-- wp:html -->
<details class="agency-faq__item"><summary>Lorem ipsum question one?</summary><div class="agency-faq__answer"><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Vivamus sagittis lacus vel augue laoreet rutrum faucibus dolor auctor.</p></div></details>
<details class="agency-faq__item"><summary>Lorem ipsum question two?</summary><div class="agency-faq__answer"><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Maecenas faucibus mollis interdum.</p></div></details>
<details class="agency-faq__item"><summary>Lorem ipsum question three?</summary><div class="agency-faq__answer"><p>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Nullam quis risus eget urna mollis ornare vel eu leo.</p></div></details>
<!-- /wp:html -->';

if ( str_contains( $pat, $faq_old ) ) {
	$pat = str_replace(
		'<div class="wp-block-group agency-container agency-container--narrow"><!-- wp:heading {"className":"agency-section__title"} -->
<h2 class="wp-block-heading agency-section__title">Lorem ipsum frequently asked questions</h2>',
		'<div class="wp-block-group agency-container agency-container--narrow agency-faq"><!-- wp:heading {"className":"agency-section__title"} -->
<h2 class="wp-block-heading agency-section__title">Lorem ipsum frequently asked questions</h2>',
		$pat
	);
	$pat   = str_replace( $faq_old, $faq_new, $pat );
	file_put_contents( "$theme/inc/patterns.php", $pat );
	echo "faq fixed\n";
}
