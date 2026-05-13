<?php
/**
 * Tests for read-only installed-content reconciliation.
 */

class Test_Reconcile extends WP_UnitTestCase {

	protected $installed = array();

	public function tear_down() {
		foreach ( $this->installed as $slug ) {
			if ( function_exists( 'oddout_apps_uninstall' ) ) {
				oddout_apps_uninstall( $slug );
			}
		}
		$this->installed = array();
		parent::tear_down();
	}

	protected function install_app_fixture( $slug ) {
		$manifest = array(
			'type'    => 'app',
			'name'    => 'Reconcile ' . $slug,
			'slug'    => $slug,
			'version' => '0.0.1',
			'entry'   => 'index.html',
			'icon'    => 'icon.svg',
		);
		$path     = tempnam( sys_get_temp_dir(), 'oddrec_' ) . '.wp';
		$zip      = new ZipArchive();
		$zip->open( $path, ZipArchive::CREATE | ZipArchive::OVERWRITE );
		$zip->addFromString( 'manifest.json', wp_json_encode( $manifest ) );
		$zip->addFromString( 'index.html', '<!doctype html><script type="module" src="./assets/missing.js"></script>' );
		$zip->addFromString( 'icon.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64"/></svg>' );
		$zip->close();
		$res = oddout_apps_install( $path, $slug . '.wp' );
		@unlink( $path );
		$this->assertIsArray( $res );
		$this->installed[] = $slug;
	}

	public function test_reconcile_reports_missing_index_assets_and_icon_health() {
		$this->install_app_fixture( 'reconcile-missing-asset' );

		$report = oddout_reconcile_installed_content();
		$this->assertArrayHasKey( 'apps', $report );
		$app = null;
		foreach ( $report['apps'] as $row ) {
			if ( 'reconcile-missing-asset' === $row['slug'] ) {
				$app = $row;
				break;
			}
		}

		$this->assertNotNull( $app );
		$this->assertTrue( $app['directory_exists'] );
		$this->assertTrue( $app['manifest_exists'] );
		$this->assertTrue( $app['entry_exists'] );
		$this->assertNotEmpty( $app['missing_assets'] );
		$this->assertSame( './assets/missing.js', $app['missing_assets'][0]['ref'] );
		$this->assertSame( 'ok', $app['icon']['status'] );
	}
}
