<?php
/**
 * Tests for ODD's writable storage path helpers.
 */

class Test_Storage_Locations extends WP_UnitTestCase {

	public function tear_down() {
		remove_all_filters( 'upload_dir' );
		parent::tear_down();
	}

	public function test_storage_locations_use_wordpress_upload_directory() {
		add_filter(
			'upload_dir',
			static function ( $uploads ) {
				$uploads['basedir'] = '/tmp/example-uploads';
				$uploads['baseurl'] = 'https://cdn.example.test/example-uploads';
				return $uploads;
			}
		);

		$this->assertSame( '/tmp/example-uploads/odd/', oddout_storage_base_dir() );
		$this->assertSame( '/tmp/example-uploads/odd/apps/', oddout_storage_dir( 'apps' ) );
		$this->assertSame( 'https://cdn.example.test/example-uploads/odd/', oddout_storage_base_url() );
		$this->assertSame( 'https://cdn.example.test/example-uploads/odd/widgets/', oddout_storage_url( 'widgets' ) );
	}

	public function test_storage_locations_can_derive_base_from_current_upload_path_and_url() {
		add_filter(
			'upload_dir',
			static function ( $uploads ) {
				$uploads['basedir'] = '';
				$uploads['baseurl'] = '';
				$uploads['path']    = '/tmp/example-uploads/2026/05';
				$uploads['url']     = 'https://cdn.example.test/example-uploads/2026/05';
				$uploads['subdir']  = '/2026/05';
				return $uploads;
			}
		);

		$this->assertSame( '/tmp/example-uploads/odd/', oddout_storage_base_dir() );
		$this->assertSame( '/tmp/example-uploads/odd/cursor-sets/', oddout_storage_dir( 'cursor-sets' ) );
		$this->assertSame( 'https://cdn.example.test/example-uploads/odd/', oddout_storage_base_url() );
		$this->assertSame( 'https://cdn.example.test/example-uploads/odd/cursor-sets/', oddout_storage_url( 'cursor-sets' ) );
	}

	public function test_storage_locations_do_not_reconstruct_uploads_when_wordpress_returns_empty_values() {
		add_filter(
			'upload_dir',
			static function ( $uploads ) {
				$uploads['basedir'] = '';
				$uploads['baseurl'] = '';
				$uploads['path']    = '';
				$uploads['url']     = '';
				return $uploads;
			}
		);

		$this->assertSame( '', oddout_storage_base_dir() );
		$this->assertSame( '', oddout_storage_dir( 'apps' ) );
		$this->assertSame( '', oddout_storage_base_url() );
		$this->assertSame( '', oddout_storage_url( 'widgets' ) );
	}
}
