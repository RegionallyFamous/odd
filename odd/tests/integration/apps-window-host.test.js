import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFoundation, sleep } from './harness.js';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const SRC = resolve( __dirname, '../../src/apps/window-host.js' );

function loadWindowHost() {
	const src = readFileSync( SRC, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=window-host.js` );
	fn.call( globalThis );
}

describe( 'ODD app window host', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		delete window.desktopModeNativeWindows;
		loadFoundation( {
			config: {
				userApps:     { installed: [ 'demo' ], pinned: [] },
				appServeUrls: { demo: '/odd-app/demo/' },
			},
		} );
	} );

	it( 'marks native-window content loading and loaded around iframe hydration', () => {
		loadWindowHost();
		const body = document.createElement( 'div' );
		document.body.appendChild( body );
		const markContentLoading = vi.fn();
		const markContentLoaded = vi.fn();

		window.desktopModeNativeWindows[ 'odd-app-demo' ]( body, {
			window: { markContentLoading, markContentLoaded },
		} );

		expect( markContentLoading ).toHaveBeenCalledTimes( 1 );
		const frame = body.querySelector( 'iframe.odd-app-frame' );
		expect( frame ).toBeTruthy();

		frame.dispatchEvent( new Event( 'load' ) );
		expect( markContentLoaded ).toHaveBeenCalledTimes( 1 );
		const metrics = window.__odd.diagnostics.metrics();
		expect( metrics.counters[ 'app.iframe.loaded' ] ).toBe( 1 );
		expect( metrics.timings.some( ( row ) => row.name === 'app.iframe.load' && row.meta.slug === 'demo' ) ).toBe( true );
	} );

	it( 'surfaces a visible error when an app has no serve URL', () => {
		window.odd.appServeUrls = {};
		loadWindowHost();
		const body = document.createElement( 'div' );
		document.body.appendChild( body );
		const errors = [];
		window.__odd.events.on( 'odd.iframe-error', ( payload ) => errors.push( payload ) );

		window.desktopModeNativeWindows[ 'odd-app-demo' ]( body, {} );

		expect( body.querySelector( 'iframe.odd-app-frame' ) ).toBeNull();
		expect( body.textContent ).toContain( 'No serve URL is registered' );
		expect( errors.some( ( row ) => row.message === 'odd-apps: missing app serve URL' ) ).toBe( true );
		expect( window.__odd.diagnostics.metrics().counters[ 'app.iframe.skipped' ] ).toBe( 1 );
	} );

	it( 'hydrates server-rendered app hosts inside open shadow roots', () => {
		const shell = document.createElement( 'div' );
		const shadow = shell.attachShadow( { mode: 'open' } );
		const host = document.createElement( 'div' );
		host.className = 'odd-app-host';
		host.setAttribute( 'data-odd-app', '' );
		host.setAttribute( 'data-odd-app-slug', 'demo' );
		host.setAttribute( 'data-odd-app-src', '/odd-app/demo/' );
		const loading = document.createElement( 'div' );
		loading.className = 'odd-app-host__loading';
		host.appendChild( loading );
		shadow.appendChild( host );
		document.body.appendChild( shell );

		loadWindowHost();

		expect( shadow.querySelector( 'iframe.odd-app-frame' ) ).toBeTruthy();
		expect( window.__odd.diagnostics.appIframes()[0].domRoot ).toBe( 'shadowRoot' );
		expect( window.__odd.diagnostics.metrics().counters[ 'app.iframe.loaded' ] ).toBeUndefined();
	} );

	it( 'mounts into the opened window body when no server host exists', () => {
		loadWindowHost();
		const body = document.createElement( 'div' );
		document.body.appendChild( body );
		const appOpened = [];
		window.__odd.events.on( 'odd.app-opened', ( payload ) => appOpened.push( payload ) );

		window.__odd.events.emit( window.__odd.events.NAMES.WINDOW_OPENED, {
			id: 'odd-app-demo',
			body,
		} );

		const frame = body.querySelector( 'iframe.odd-app-frame' );
		expect( frame ).toBeTruthy();
		expect( frame.getAttribute( 'src' ) ).toBe( '/odd-app/demo/' );
		expect( appOpened ).toEqual( [ { slug: 'demo', windowId: 'odd-app-demo' } ] );
	} );

	it( 'hydrates app hosts added to shadow roots after boot', async () => {
		loadWindowHost();
		const shell = document.createElement( 'div' );
		document.body.appendChild( shell );
		const shadow = shell.attachShadow( { mode: 'open' } );
		const host = document.createElement( 'div' );
		host.className = 'odd-app-host';
		host.setAttribute( 'data-odd-app', '' );
		host.setAttribute( 'data-odd-app-slug', 'demo' );
		host.setAttribute( 'data-odd-app-src', '/odd-app/demo/' );

		shadow.appendChild( host );
		await sleep( 0 );

		expect( shadow.querySelector( 'iframe.odd-app-frame' ) ).toBeTruthy();
		expect( window.__odd.diagnostics.appIframes()[0].domRoot ).toBe( 'shadowRoot' );
	} );
} );
