import { describe, expect, it } from 'vitest';
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

	it( 'keeps every first-party icon set on a unique Shop fun layer', () => {
		const dir = resolve( ROOT, '_tools/catalog-sources/icon-sets' );
		const rows = readdirSync( dir, { withFileTypes: true } )
			.filter( ( entry ) => entry.isDirectory() )
			.map( ( entry ) => {
				const manifest = JSON.parse( readFileSync( join( dir, entry.name, 'manifest.json' ), 'utf8' ) );
				return {
					slug: entry.name,
					recipe: manifest.funLayer && manifest.funLayer.recipe,
				};
			} );
		const missing = rows.filter( ( row ) => ! row.recipe ).map( ( row ) => row.slug );
		const recipes = rows.map( ( row ) => row.recipe );

		expect( missing ).toEqual( [] );
		expect( new Set( recipes ).size ).toBe( rows.length );
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

	it( 'keeps first-party icon sets on the shared default raster pipeline', () => {
		const glyphDir = resolve( ROOT, '_tools/icon-glyphs/base' );
		const glyphManifest = JSON.parse( readRel( '_tools/icon-glyphs/manifest.json' ) );
		const sourceMap = JSON.parse( readRel( '_tools/catalog-sources/icon-sets/odd-default-icons/source-glyph-map.json' ) );
		const compose = readRel( '_tools/compose-icon-set.py' );
		const catalog = readRel( '_tools/build-catalog.py' );
		const iconDoc = readRel( 'docs/building-an-icon-set.md' );
		const iconSetDir = resolve( ROOT, '_tools/catalog-sources/icon-sets' );
		const defaultManifest = JSON.parse( readRel( '_tools/catalog-sources/icon-sets/odd-default-icons/manifest.json' ) );
		const expectedKeys = [
			'dashboard',
			'posts',
			'pages',
			'media',
			'comments',
			'appearance',
			'plugins',
			'users',
			'tools',
			'settings',
			'profile',
			'links',
			'recycle-bin',
			'fallback',
			'os-settings',
			'import',
			'classic-admin',
		];

		expect( glyphManifest.contract ).toBe( 'default-dashicon-raster-source' );
		expect( glyphManifest.requiredKeys ).toEqual( expectedKeys );
		expect( Object.keys( glyphManifest.glyphs ) ).toEqual( expectedKeys );
		expect( Object.keys( sourceMap.icons ) ).toEqual( expectedKeys );
		expect( Object.keys( sourceMap.codepoints ) ).toEqual( expectedKeys );
		for ( const key of expectedKeys ) {
			expect( existsSync( resolve( glyphDir, `${ key }.png` ) ) ).toBe( true );
			expect( compose ).toContain( `"${ key }"` );
		}
		expect( compose ).toContain( 'def compose_icon(' );
		expect( compose ).toContain( 'DASHICONS_FONT' );
		expect( compose ).toContain( 'def render_dashicon_mask(' );
		expect( compose ).toContain( 'def compose_default_icon(' );
		expect( compose ).toContain( 'def render_set(' );
		expect( compose ).toContain( 'copied default rasters into' );
		expect( compose ).toContain( 'manifest.funLayer' );
		expect( catalog ).toContain( 'def _validate_icon_asset_rel(' );
		expect( catalog ).toContain( 'source-only icon asset path' );
		expect( iconDoc ).toContain( '_tools/compose-icon-set.py --all' );
		expect( iconDoc ).toContain( 'copies those glyphs byte-for-byte' );

		for ( const entry of readdirSync( iconSetDir, { withFileTypes: true } ) ) {
			if ( ! entry.isDirectory() || entry.name === 'odd-default-icons' ) continue;
			const manifest = JSON.parse( readFileSync( join( iconSetDir, entry.name, 'manifest.json' ), 'utf8' ) );
			for ( const key of expectedKeys ) {
				const expected = readFileSync( join( iconSetDir, 'odd-default-icons', defaultManifest.icons[ key ] ) );
				const actual = readFileSync( join( iconSetDir, entry.name, manifest.icons[ key ] ) );
				expect( Buffer.compare( actual, expected ), `${ entry.name }/${ key } must match default raster` ).toBe( 0 );
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

	it( 'keeps rail icon integration on Desktop Mode data contracts', () => {
		const src = readRel( 'odd/src/shell/odd-dock-rail.js' );

		expect( src ).toContain( 'registerDockRailRenderer' );
		expect( src ).toContain( 'listSystemTiles' );
		expect( src ).toContain( 'skinHostSystemTiles' );
		expect( src ).toContain( 'data-odd-skinned-system-icon' );
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
		expect( src ).toContain( 'oddout_shop_desktop_pinned_position' );
	} );

	it( 'keeps Shop chrome theme-aware instead of hard-coding the host accent', () => {
		const css = readRel( 'odd/src/panel/styles.css' );

		expect( css ).toContain( '--odd-desktop-accent' );
		expect( css ).toContain( '--desktop-mode-accent' );
		expect( css ).toContain( '--wp-admin-theme-color' );
		expect( css ).toContain( '--wp-desktop-window-background' );
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
