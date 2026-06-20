<?php
$path = '/var/www/html/wp-content/themes/agency-starter/theme/inc/schema.php';
file_put_contents( $path, file_get_contents( '/tmp/schema-fixed.php' ) );
echo "schema fixed\n";
