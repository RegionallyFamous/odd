<?php
/**
 * Regression tests for `oddout_icons_get_sets( $reset = true )` semantics.
 *
 * History: in v1.8.x a test (`Test_Bundle_Install::test_iconset_round_trip_install_register_uninstall`)
 * failed intermittently because `oddout_icons_get_sets( true )` cleared the
 * static cache but short-circuited without rebuilding the fresh registry,
 * so the call returned an empty array. Commit 8344c2f fixed it by also
 * busting the version-keyed transient and then falling through to
 * rebuild. These tests pin that semantics down so reverting the fix
 * turns them red instantly.
 */

class Test_Icons_Registry_Cache extends WP_UnitTestCase {

	public function set_up() {
		parent::set_up();
		// Start every test from a clean cache state — both the
		// static inside the function and the version-keyed transient.
		oddout_icons_get_sets( true );
		delete_transient( oddout_icons_registry_transient_key() );

		// The plugin ships no icon sets. Install a fixture so
		// the registry has something in it for the "returns populated
		// sets / survives poisoned transient / rebuild re-registers"
		// assertions. The fixture hooks the `oddout_icon_set_registry`
		// filter which runs on every build, so it's immune to the
		// transient-poisoning test.
		ODDOUT_Registry_Fixtures::install_iconset( 'filament' );
	}

	public function test_fresh_call_returns_registered_sets() {
		$sets = oddout_icons_get_sets();
		$this->assertIsArray( $sets );
		$this->assertNotEmpty( $sets, 'registered icon sets must be non-empty' );
		$slugs = wp_list_pluck( $sets, 'slug' );
		$this->assertContains( 'filament', $slugs, 'fixture set must register' );
	}

	public function test_reset_returns_fresh_rebuild_in_same_call() {
		// Prime the cache.
		$first = oddout_icons_get_sets();
		$this->assertNotEmpty( $first );

		// Now ask for a reset. The return value must be the freshly
		// rebuilt list, not the empty stub the static held momentarily
		// after being wiped. This is the exact bug 8344c2f fixed.
		$reset = oddout_icons_get_sets( true );
		$this->assertIsArray( $reset );
		$this->assertNotEmpty( $reset, 'oddout_icons_get_sets(true) must rebuild, not just clear' );
		$this->assertSameSize( $first, $reset, 'reset result must match pre-reset registry' );
	}

	public function test_reset_clears_version_keyed_transient() {
		oddout_icons_get_sets();
		// Poison the transient. If `reset=true` delegated to a stale
		// transient read, we'd get the sentinel back; the fix must
		// delete + rebuild, so the rebuilt registry is what comes out
		// and the stale sentinel never reaches a caller.
		set_transient( oddout_icons_registry_transient_key(), array( 'stale' => array( 'slug' => 'stale' ) ), HOUR_IN_SECONDS );

		$fresh = oddout_icons_get_sets( true );
		$this->assertIsArray( $fresh );
		$this->assertArrayNotHasKey(
			'stale',
			$fresh,
			'reset=true must bypass a poisoned transient and rebuild from disk'
		);
		$this->assertArrayHasKey( 'filament', $fresh, 'rebuild must re-register fixture sets' );
	}

	public function test_subsequent_calls_hit_static_cache() {
		// Warm it.
		$first = oddout_icons_get_sets();

		// Second call should return the identical array reference-wise
		// (PHP compares by value, but arrays count the same), meaning
		// no rescan happened. We probe this indirectly by asserting
		// stability across calls under a transient-delete — without
		// the static cache, the second call would rescan; with it,
		// the transient miss is irrelevant.
		delete_transient( oddout_icons_registry_transient_key() );
		$second = oddout_icons_get_sets();
		$this->assertSame( $first, $second, 'static cache must serve the second call' );
	}
}
