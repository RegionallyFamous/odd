/**
 * Vitest setup for ODD foundation integration tests.
 *
 * Each test file imports `loadFoundation()` from ./harness.js to hydrate
 * a fresh set of foundation modules into the jsdom `window`. This setup
 * only installs the @wordpress/hooks shim that the modules expect to
 * find on `window.wp.hooks` and clears any leftover ODD globals between
 * files.
 */
import { createHooks } from '@wordpress/hooks';

if ( ! globalThis.window ) {
	throw new Error( 'ODD tests require jsdom (vitest environment: jsdom).' );
}

function installHooks() {
	window.wp = window.wp || {};
	window.wp.hooks = createHooks();
}

function installStorage( name ) {
	const current = window[ name ];
	if (
		current &&
		typeof current.getItem === 'function' &&
		typeof current.setItem === 'function' &&
		typeof current.removeItem === 'function' &&
		typeof current.clear === 'function' &&
		typeof current.key === 'function'
	) {
		return;
	}

	const store = new Map();
	const api = {
		getItem:    ( k ) => ( store.has( String( k ) ) ? store.get( String( k ) ) : null ),
		setItem:    ( k, v ) => { store.set( String( k ), String( v ) ); },
		removeItem: ( k ) => { store.delete( String( k ) ); },
		clear:      () => { store.clear(); },
		key:        ( i ) => Array.from( store.keys() )[ i ] ?? null,
		get length() { return store.size; },
	};

	Object.defineProperty( window, name, {
		value: api,
		configurable: true,
		writable: true,
	} );
}

function resetGlobals() {
	try { delete window.__odd; } catch ( e ) { window.__odd = undefined; }
	try { delete window.odd; } catch ( e ) { window.odd = undefined; }
	try { delete window.oddout; } catch ( e ) { window.oddout = undefined; }
	try { delete window.desktopModeConfig; } catch ( e ) { window.desktopModeConfig = undefined; }
	installStorage( 'localStorage' );
	installStorage( 'sessionStorage' );
	installHooks();
}

resetGlobals();

globalThis.__oddTestReset = resetGlobals;
