import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
} );

describe( 'Desktop Mode integration source contracts', () => {
	it( 'keeps rail icon integration on Desktop Mode data contracts', () => {
		const src = readRel( 'odd/src/shell/odd-dock-rail.js' );

		expect( src ).toContain( 'registerDockRailRenderer' );
		expect( src ).toContain( 'listSystemTiles' );
		expect( src ).not.toMatch( /\breplaceChild\b/ );
		expect( src ).not.toMatch( /querySelectorAll\s*\(\s*['"`][^'"`]*(desktop-mode|wp-desktop)-dock__item--system/ );
		expect( src ).not.toContain( 'data-odd-skinned-system-icon' );
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
