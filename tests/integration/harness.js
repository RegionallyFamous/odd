/**
 * Shared harness for ODD foundation tests.
 *
 * The foundation modules are authored as classic IIFEs that install
 * onto `window.__odd`, so to drive them from a Vitest test we read
 * each source file, wrap it in `new Function`, and execute it against
 * the current jsdom window. Between tests we reset `window.__odd`
 * (and `window.odd`, and `window.desktopModeConfig`) so every test
 * starts from a clean boot.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const SHARED_DIR = resolve( __dirname, '../../odd/src/shared' );

const MODULE_ORDER = [
	'store.js',
	'events.js',
	'registries.js',
	'lifecycle.js',
	'safecall.js',
	'debug.js',
	'diagnostics.js',
	'desktop-adapter.js',
];

function execInWindow( src, filename ) {
	// Evaluate the module source in the jsdom global scope so the IIFE
	// sees `window`, `document`, and the installed `window.wp.hooks`.
	// Using `new Function` keeps the execution context clean; Node's
	// `vm` module would require more plumbing for the same result.
	const fn = new Function( `${ src }\n//# sourceURL=${ filename }` );
	fn.call( globalThis );
}

export function resetOdd() {
	if ( typeof globalThis.__oddTestReset === 'function' ) {
		globalThis.__oddTestReset();
	}
}

export function seedConfig( patch = {} ) {
	window.odd = Object.assign(
		{
			pluginUrl: 'https://example.invalid/odd',
			version:   'test',
			restUrl:   '',
			restNonce: '',
			scenes:    [],
			iconSets:  [],
			wallpaper: '',
			scene:     '',
			favorites: [],
			recents:   [],
			shuffle:   { enabled: false, minutes: 15 },
			audioReactive: false,
			iconSet:   '',
		},
		patch,
	);
}

export function loadFoundation( { config, debug = false } = {} ) {
	resetOdd();
	if ( debug ) {
		window.desktopModeConfig = Object.assign( {}, window.desktopModeConfig, { debug: true } );
	}
	seedConfig( config || {} );
	for ( const file of MODULE_ORDER ) {
		const src = readFileSync( resolve( SHARED_DIR, file ), 'utf8' );
		execInWindow( src, file );
	}
	return window.__odd;
}

export function sleep( ms = 0 ) {
	return new Promise( ( r ) => setTimeout( r, ms ) );
}
