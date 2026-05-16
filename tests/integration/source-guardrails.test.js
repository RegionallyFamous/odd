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
];

function shouldSkip( path ) {
	const rel = relative( ROOT, path ).replaceAll( '\\', '/' );
	return [ ...SKIP_PARTS ].some( ( part ) => rel === part || rel.startsWith( `${ part }/` ) );
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
} );
