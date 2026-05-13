<?php
/**
 * @covers oddout_dm_ai_installed_bundles_summary
 */
class ODDOUT_Desktop_Mode_AI_Integration_Test extends WP_UnitTestCase {

	public function test_installed_bundles_summary_returns_expected_shape() {
		$payload = oddout_dm_ai_installed_bundles_summary( array(), 1 );

		$this->assertIsArray( $payload );
		foreach (
			array(
				'active_wallpaper_scene',
				'installed_scene_slugs',
				'installed_icon_set_slugs',
				'installed_widget_slugs',
				'installed_app_slugs',
				'installed_cursor_set_slugs',
			) as $key
		) {
			$this->assertArrayHasKey( $key, $payload, 'Missing key ' . $key );
		}
		$this->assertIsString( $payload['active_wallpaper_scene'] );
		$this->assertIsArray( $payload['installed_scene_slugs'] );
	}
}
