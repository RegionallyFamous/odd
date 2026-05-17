import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const ROOT = resolve( __dirname, '../..' );

const ROOTS = [
	'odd',
	'docs',
	'tests',
	'_tools',
	'README.md',
	'CHANGELOG.md',
	'CLAUDE.md',
];

const SKIP_PARTS = new Set( [
	'node_modules',
	'vendor',
	'.git',
	'dist',
	'odd/apps/runtime',
	'tests/integration/source-guardrails.test.js',
] );

const TEXT_EXTENSIONS = new Set( [
	'.css',
	'.html',
	'.js',
	'.json',
	'.md',
	'.php',
	'.py',
	'.sh',
	'.txt',
	'.xml',
] );

const FORBIDDEN = [
	/Back-compat/i,
	/\blegacy\b/i,
	/\bhistorical\b/i,
	/\bfranchise\b/i,
	/\b0\.8\.0\b/,
	/\bpre-v1\b/i,
	/\bpre-1\.0\b/i,
	/type\s+is\s+optional/i,
	/defaults?\s+to\s+"app"/i,
	/wpDesktopNativeWindows/,
	/oddout_catalog_merge_fallback_icon_sets/,
	/oddout_catalog_bundle_type_count/,
	/permission_callback['"]?\s*=>\s*['"]is_user_logged_in['"]/,
	/0\s*!==\s*strpos\(\s*\$full\s*,\s*\$real_base\s*\)/,
	/Permission callback across the whole namespace/i,
];

function shouldSkip( path ) {
	const rel = relative( ROOT, path ).replaceAll( '\\', '/' );
	return [ ...SKIP_PARTS ].some( ( part ) => rel === part || rel.startsWith( `${ part }/` ) );
}

function readRel( path ) {
	return readFileSync( resolve( ROOT, path ), 'utf8' );
}

function textFiles( path, out = [] ) {
	if ( shouldSkip( path ) ) return out;
	const stat = statSync( path );
	if ( stat.isDirectory() ) {
		for ( const entry of readdirSync( path ) ) {
			textFiles( join( path, entry ), out );
		}
		return out;
	}
	if ( TEXT_EXTENSIONS.has( path.slice( path.lastIndexOf( '.' ) ) ) ) {
		out.push( path );
	}
	return out;
}

describe( 'v1 source guardrails', () => {
	it( 'keeps removed compatibility language and paths out of active source', () => {
		const offenders = [];
		for ( const root of ROOTS ) {
			for ( const file of textFiles( resolve( ROOT, root ) ) ) {
				const text = readFileSync( file, 'utf8' );
				for ( const pattern of FORBIDDEN ) {
					if ( pattern.test( text ) ) {
						offenders.push( `${ relative( ROOT, file ) }: ${ pattern }` );
					}
				}
			}
		}

		expect( offenders ).toEqual( [] );
	} );

	it( 'requires signed first-party catalog deploys', () => {
		const pages = readRel( '.github/workflows/pages.yml' );
		const release = readRel( '.github/workflows/release-odd.yml' );

		expect( pages ).toContain( 'ODD_CATALOG_REQUIRE_SIGNATURE' );
		expect( pages ).toContain( 'ODD_VALIDATE_REQUIRE_CATALOG_SIGNATURE' );
		expect( pages ).toContain( 'registry.json.sig' );
		expect( release ).toContain( 'ODD_CATALOG_REQUIRE_SIGNATURE' );
		expect( release ).toContain( 'ODD_VALIDATE_REQUIRE_CATALOG_SIGNATURE' );
	} );

	it( 'keeps Shop card art split out from the main panel renderer', () => {
		const enqueue = readRel( 'odd/includes/enqueue.php' );
		const panel = readRel( 'odd/src/panel/index.js' );
		const cardArt = readRel( 'odd/src/panel/card-art.js' );

		expect( enqueue ).toContain( "'odd-panel-card-art'" );
		expect( enqueue ).toMatch( /'odd-panel'[\s\S]*'odd-panel-card-art'/ );
		expect( panel ).toContain( 'window.__odd && window.__odd.panelCardArt' );
		expect( cardArt ).toContain( 'window.__odd.panelCardArt' );
		expect( cardArt ).toContain( "row.type === 'icon-set'" );
	} );

	it( 'keeps icon-set manifests raster-only with no runtime fun layer contract', () => {
		const dir = resolve( ROOT, '_tools/catalog-sources/icon-sets' );
		const expectedKeys = [
			'odd',
			'my-wordpress',
			'content-graph',
			'recycle-bin',
			'fallback',
		];
		for ( const entry of readdirSync( dir, { withFileTypes: true } ) ) {
			if ( ! entry.isDirectory() ) continue;
			const manifest = JSON.parse( readFileSync( join( dir, entry.name, 'manifest.json' ), 'utf8' ) );
			expect( manifest.funLayer, entry.name ).toBeUndefined();
			expect( Object.keys( manifest.icons || {} ), entry.name ).toEqual( expectedKeys );
		}

		for ( const path of [
			'docs/schemas/manifest.schema.json',
			'_tools/build-catalog.py',
			'odd/src/panel/card-art.js',
			'odd/src/panel/index.js',
			'odd/includes/enqueue.php',
		] ) {
			expect( readRel( path ), path ).not.toContain( 'funLayer' );
		}
	} );

	it( 'keeps catalog validation guarding visible icon footprint', () => {
		const builder = readRel( '_tools/build-catalog.py' );
		const validator = readRel( 'odd/bin/validate-catalog' );

		for ( const source of [ builder, validator ] ) {
			expect( source ).toContain( 'ICON_VISIBLE_MIN_FILL' );
			expect( source ).toContain( 'visible glyph fill' );
			expect( source ).toContain( 'normalize transparent padding' );
		}
	} );

	it( 'keeps the default icon compositor without forcing shared rasters across packs', () => {
		const glyphDir = resolve( ROOT, '_tools/icon-glyphs/base' );
		const glyphManifest = JSON.parse( readRel( '_tools/icon-glyphs/manifest.json' ) );
		const sourceMap = JSON.parse( readRel( '_tools/catalog-sources/icon-sets/odd-default-icons/source-glyph-map.json' ) );
		const compose = readRel( '_tools/compose-icon-set.py' );
		const catalog = readRel( '_tools/build-catalog.py' );
		const iconDoc = readRel( 'docs/building-an-icon-set.md' );
		const iconSetDir = resolve( ROOT, '_tools/catalog-sources/icon-sets' );
		const expectedKeys = [
			'odd',
			'my-wordpress',
			'content-graph',
			'recycle-bin',
			'fallback',
		];

		expect( glyphManifest.contract ).toBe( 'desktop-default-raster-source' );
		expect( glyphManifest.requiredKeys ).toEqual( expectedKeys );
		expect( Object.keys( glyphManifest.glyphs ) ).toEqual( expectedKeys );
		expect( Object.keys( sourceMap.icons ) ).toEqual( expectedKeys );
		expect( sourceMap.contract ).toBe( 'desktop-default-raster-source' );
		for ( const key of expectedKeys ) {
			expect( existsSync( resolve( glyphDir, `${ key }.png` ) ) ).toBe( true );
			expect( compose ).toContain( `"${ key }"` );
		}
		expect( existsSync( resolve( iconSetDir, 'odd-default-icons', 'source-contact-sheet.png' ) ) ).toBe( true );
		expect( compose ).toContain( 'def normalize_icon(' );
		expect( compose ).toContain( 'def animated_frames(' );
		expect( compose ).toContain( 'source-contact-sheet.png' );
		expect( compose ).toContain( 'def render_set(' );
		expect( compose ).toContain( 'kept source rasters for' );
		expect( compose ).not.toContain( 'copied default rasters into' );
		expect( compose ).not.toContain( 'funLayer' );
		expect( catalog ).toContain( 'def _validate_icon_asset_rel(' );
		expect( catalog ).toContain( 'source-only icon asset path' );
		expect( iconDoc ).toContain( '_tools/compose-icon-set.py --all' );
		expect( iconDoc ).toContain( 'source-owned raster icon packs' );

		const defaultManifest = JSON.parse( readFileSync( join( iconSetDir, 'odd-default-icons', 'manifest.json' ), 'utf8' ) );
		const defaultHashes = Object.fromEntries(
			expectedKeys.map( ( key ) => [
				key,
				createHash( 'sha256' )
					.update( readFileSync( join( iconSetDir, 'odd-default-icons', defaultManifest.icons[ key ] ) ) )
					.digest( 'hex' ),
			] )
		);
		for ( const key of expectedKeys ) {
			const bytes = readFileSync( join( iconSetDir, 'odd-default-icons', defaultManifest.icons[ key ] ) );
			expect( bytes.includes( Buffer.from( 'ANMF' ) ), `${ key } should be an animated WebP` ).toBe( true );
		}

		for ( const entry of readdirSync( iconSetDir, { withFileTypes: true } ) ) {
			if ( ! entry.isDirectory() ) continue;
			const manifest = JSON.parse( readFileSync( join( iconSetDir, entry.name, 'manifest.json' ), 'utf8' ) );
			let defaultHashMatches = 0;
			for ( const key of expectedKeys ) {
				expect( existsSync( join( iconSetDir, entry.name, manifest.icons[ key ] ) ), `${ entry.name }/${ key }` ).toBe( true );
				const hash = createHash( 'sha256' )
					.update( readFileSync( join( iconSetDir, entry.name, manifest.icons[ key ] ) ) )
					.digest( 'hex' );
				if ( hash === defaultHashes[ key ] ) {
					defaultHashMatches += 1;
				}
			}
			if ( entry.name !== 'odd-default-icons' ) {
				expect( defaultHashMatches, `${ entry.name } should own raster art instead of copying default` ).toBeLessThan(
					expectedKeys.length
				);
			}
		}
	} );
} );

describe( 'Desktop Mode integration source contracts', () => {
	it( 'keeps Desktop Mode hook integration on 0.8.5 hook names', () => {
		const sources = [
			'odd/includes/native-window.php',
			'odd/includes/starter-pack.php',
			'odd/includes/icons/dock-filter.php',
			'odd/includes/enqueue.php',
			'odd/src/apps/window-host.js',
			'odd/src/iris/reactivity.js',
			'odd/src/panel/index.js',
			'odd/src/shared/api.js',
			'odd/src/shared/desktop-adapter.js',
			'odd/src/shared/desktop-hooks.js',
			'odd/src/shell/odd-dock-rail.js',
			'odd/src/wallpaper/index.js',
		].map( readRel ).join( '\n' );

		expect( sources ).not.toMatch( /wp_desktop_/ );
		expect( sources ).not.toMatch( /wpDesktopNativeWindows/ );
		expect( sources ).not.toMatch( /wpdm_/ );
		expect( sources ).not.toMatch( /wp_register_desktop_/ );
		expect( sources ).not.toMatch( /wp-desktop\./ );
		expect( sources ).not.toMatch( /desktop-mode\.desktop-icon\.menu/ );
		expect( sources ).not.toMatch( /desktop-mode\.file\./ );
		expect( sources ).not.toMatch( /desktop-mode\.folder\./ );
		expect( sources ).not.toMatch( /desktop-mode\.presence\./ );
		expect( sources ).not.toMatch( /desktop-mode\.heartbeat/ );
		expect( sources ).not.toMatch( /desktop-mode\.shared-folder/ );
		expect( sources ).not.toMatch( /desktop-mode\.window\.changed/ );
		expect( sources ).not.toMatch( /desktop-mode\.arrange-menu\.opened/ );
		expect( sources ).not.toMatch( /addAction\(\s*['"]desktop-mode\.window\.attention/ );
		expect( sources ).toContain( 'desktop_mode_shell_config' );
		expect( sources ).toContain( 'desktop-mode.window.opened' );
		expect( sources ).toContain( "addFilter( 'desktop-mode.window.attention'" );
	} );

	it( 'keeps icon sets out of rail and system tile artwork', () => {
		const src = readRel( 'odd/src/shell/odd-dock-rail.js' );
		const php = readRel( 'odd/includes/icons/dock-filter.php' );
		const css = readRel( 'odd/src/icons/contrast.css' );

		expect( src ).toContain( 'registerDockRailRenderer' );
		expect( src ).not.toContain( 'listSystemTiles' );
		expect( src ).not.toContain( 'skinHostSystemTiles' );
		expect( src ).not.toContain( 'data-odd-skinned-system-icon' );
		expect( php ).not.toContain( 'desktop_mode_dock_item' );
		expect( php ).not.toContain( 'taskbarItems' );
		expect( php ).not.toContain( 'systemTiles' );
		expect( css ).not.toContain( 'data-odd-skinned-system-icon' );
		expect( css ).not.toContain( '[src*="/odd/icon-sets/"]' );
		expect( src ).not.toMatch( /\breplaceChild\b/ );
		expect( src ).not.toMatch( /setTimeout\s*\(\s*skin|scheduleSystemRailSkin/ );
	} );

	it( 'keeps rail CSS scoped to the ODD compact renderer instead of host rail visuals', () => {
		const css = [
			readRel( 'odd/src/shell/odd-dock-rail.css' ),
			readRel( 'odd/src/shell/desktop-mode-integration-hints.css' ),
		].join( '\n' );
		const visualProps = /\b(background(?:-color|-image)?|border(?:-radius|-color|-width|-style)?|box-shadow|filter|backdrop-filter|transform|z-index|position)\s*:/;
		const blocks = Array.from( css.matchAll( /(?:^|})\s*([^{}]*\.(?:desktop-mode|wp-desktop)-dock[^{}]*)\{([^{}]*)\}/g ) );
		const offenders = blocks
			.map( ( match ) => ( { selector: match[ 1 ].trim(), body: match[ 2 ] } ) )
			.filter( ( block ) => ! block.selector.includes( '.odd-dock-rail-mount' ) )
			.filter( ( block ) => visualProps.test( block.body ) )
			.map( ( block ) => block.selector );

		expect( offenders ).toEqual( [] );
	} );

	it( 'keeps Desktop Mode window geometry host-owned', () => {
		const src = readRel( 'odd/src/shared/desktop-hooks.js' );

		expect( src ).not.toMatch( /\.style\.(?:top|left|right|bottom|width|height)\s*=/ );
		expect( src ).not.toMatch( /\.config\.(?:x|y|width|height)\s*=/ );
		expect( src ).not.toMatch( /\._emitChange\s*\(/ );
		expect( src ).toContain( 'requestMaximize' );
	} );

	it( 'keeps the ODD Shop icon eligible for Desktop Mode context menus', () => {
		const src = readRel( 'odd/includes/native-window.php' );

		expect( src ).toMatch( /desktop_mode_register_icon\(\s*'odd'/ );
		expect( src ).toMatch( /'pinned'\s*=>\s*false/ );
		expect( src ).toMatch( /'position'\s*=>\s*100/ );
		expect( src ).not.toContain( 'oddout_shop_desktop_pinned' );
	} );

	it( 'keeps app placement sync as a non-fatal Desktop Mode side effect', () => {
		const src = readRel( 'odd/includes/apps/registry.php' );
		const seed = src.slice(
			src.indexOf( 'function oddout_apps_seed_core_item_visibility' ),
			src.indexOf( 'function oddout_apps_remove_core_item_visibility' )
		);
		const remove = src.slice(
			src.indexOf( 'function oddout_apps_remove_core_item_visibility' ),
			src.indexOf( 'function oddout_apps_row_surfaces' )
		);

		for ( const block of [ seed, remove ] ) {
			expect( block ).toContain( "function_exists( 'desktop_mode_get_os_settings' )" );
			expect( block ).toContain( "function_exists( 'desktop_mode_save_os_settings' )" );
			expect( block ).toContain( 'try {' );
			expect( block ).toContain( 'catch ( Throwable $e )' );
		}
		expect( seed ).toContain( "function_exists( 'desktop_mode_default_os_settings' )" );
	} );

	it( 'keeps Shop chrome dark-only while inheriting the host accent', () => {
		const css = readRel( 'odd/src/panel/styles.css' );

		expect( css ).toContain( '--odd-desktop-accent' );
		expect( css ).toContain( '--desktop-mode-accent' );
		expect( css ).toContain( '--wp-admin-theme-color' );
		expect( css ).not.toContain( 'data-odd-theme' );
		expect( css ).not.toContain( 'data-odd-chaos' );
		expect( css ).not.toContain( '--wp-desktop-window-background' );
	} );

	it( 'publishes a creator mini-site for Desktop Mode extension authors', () => {
		const page = readRel( 'site/build/index.html' );
		const home = readRel( 'site/index.html' );

		expect( page ).toContain( 'Build for ODD + WP Desktop Mode' );
		expect( page ).toContain( 'enhance Desktop Mode, do not replace it' );
		expect( page ).toContain( 'examples/build-for-desktop-mode' );
		expect( home ).toContain( 'href="/build/"' );
	} );
} );
