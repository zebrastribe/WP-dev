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
		),
	);

	return $maps[ $slug ] ?? array();
}
