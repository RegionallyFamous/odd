<?php
/**
 * Apps-only runtime contract tests.
 */

class ODDOUT_Apps_Only_Test extends WP_UnitTestCase {
	public function test_catalog_allows_only_apps() {
		$this->assertSame( array( 'app' ), oddout_catalog_allowed_types() );
		$this->assertSame( array( 'odd-notes' ), oddout_catalog_allowed_slugs() );
	}

	public function test_odd_notes_uses_read_capability() {
		$this->assertSame( 'read', oddout_apps_normalize_capability( 'read', 'odd-notes' ) );
		$this->assertSame( 'manage_options', oddout_apps_normalize_capability( 'read', 'untrusted-app' ) );
	}

	public function test_legacy_runtime_modules_are_not_loaded() {
		$this->assertFalse( function_exists( 'oddout_wallpaper_scenes' ) );
		$this->assertFalse( function_exists( 'oddout_icons_get_sets' ) );
		$this->assertFalse( function_exists( 'oddout_cursors_get_sets' ) );
	}

	public function test_notes_identifiers_are_stable() {
		$this->assertSame( 'odd-notes', oddout_notes_slug() );
		$this->assertSame( 'odd-app-odd-notes', oddout_notes_window_id() );
	}
}
