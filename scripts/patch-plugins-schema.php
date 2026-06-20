<?php
$pl = '/var/www/html/wp-content/themes/agency-starter/theme/inc/plugins.php';
$t  = file_get_contents( $pl );
$t  = preg_replace(
	"/\/\*\*\n \* Yoast Organization schema defaults for demo\.[\s\S]*?add_filter\( 'wpseo_schema_organization', 'agency_starter_yoast_organization_schema' \);\n\n/",
	'',
	$t,
	1
);
file_put_contents( $pl, $t );
echo "ok\n";
