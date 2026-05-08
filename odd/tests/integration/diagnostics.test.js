import { describe, expect, it, beforeEach, vi } from 'vitest';
import { loadFoundation } from './harness.js';

describe( 'ODD diagnostics metrics', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		loadFoundation();
		vi.restoreAllMocks();
	} );

	it( 'records bounded local timing and counter metrics', () => {
		const d = window.__odd.diagnostics;
		d.count( 'catalog.fetch.failure' );
		d.count( 'catalog.fetch.failure', 2 );
		d.timing( 'panel.render', 12.4, { section: 'apps', ignored: { nested: true } } );
		const stop = d.time( 'iframe.load', { slug: 'demo' } );
		stop( { status: 'loaded' } );

		const snap = d.metrics();
		expect( snap.counters[ 'catalog.fetch.failure' ] ).toBe( 3 );
		expect( snap.timings.map( ( row ) => row.name ) ).toEqual( expect.arrayContaining( [ 'panel.render', 'iframe.load' ] ) );
		expect( snap.timings.find( ( row ) => row.name === 'panel.render' ).meta ).toEqual( { section: 'apps' } );
		expect( d.collect().metrics.counters[ 'catalog.fetch.failure' ] ).toBe( 3 );
		expect( d.collect().apps ).toBeDefined();
		expect( Array.isArray( d.collect().apps.iframes ) ).toBe( true );
		expect( d.collectMarkdown() ).toContain( '## Local Metrics' );
	} );

	it( 'actively probes app iframe, module, runtime, and server diagnostics URLs', async () => {
		loadFoundation( {
			config: {
				appsEnabled: true,
				restUrl: 'http://localhost/wp-json/odd/v1/prefs',
				restNonce: 'rest-nonce',
				appServeUrls: { demo: '/odd-app/demo/?_wpnonce=secret' },
				userApps: { installed: [ 'demo' ], pinned: [] },
			},
		} );
		const html = [
			'<!doctype html><html><head>',
			'<script type="importmap">{"imports":{"react":"/odd-app-runtime/react.js"}}</script>',
			'<script id="odd_apps_iframe_fetch_bootstrap"></script>',
			'<script id="odd_apps_iframe_diagnostics_bootstrap"></script>',
			'<script type="module" src="./assets/app.js"></script>',
			'</head><body><div id="root"></div></body></html>',
		].join( '' );
		const mount = document.createElement( 'div' );
		mount.className = 'odd-app-host';
		mount.setAttribute( 'data-odd-app-slug', 'demo' );
		const frame = document.createElement( 'iframe' );
		frame.className = 'odd-app-frame';
		frame.src = '/odd-app/demo/?_wpnonce=secret';
		mount.appendChild( frame );
		document.body.appendChild( mount );

		const makeResponse = ( body, init = {} ) => Promise.resolve( {
			ok: init.ok ?? true,
			status: init.status ?? 200,
			statusText: init.statusText ?? 'OK',
			redirected: false,
			url: init.url || '',
			headers: {
				get: ( key ) => key.toLowerCase() === 'content-type' ? ( init.contentType || 'text/plain' ) : '',
			},
			text: () => Promise.resolve( body ),
		} );

		window.fetch = vi.fn( ( url, opts = {} ) => {
			const u = String( url );
			if ( u.includes( '/apps/diag/demo' ) ) {
				expect( opts.headers[ 'X-WP-Nonce' ] ).toBe( 'rest-nonce' );
				return makeResponse(
					JSON.stringify( { summary: { status: 'pass' } } ),
					{ url: u, contentType: 'application/json' },
				);
			}
			if ( u.includes( '/odd-app/demo/' ) && ! u.includes( 'assets/app.js' ) ) {
				return makeResponse( html, { url: u, contentType: 'text/html' } );
			}
			if ( u.includes( '/odd-app/demo/assets/app.js' ) ) {
				return makeResponse( 'import React from "/odd-app-runtime/react.js";', {
					url: u,
					contentType: 'application/javascript',
				} );
			}
			if ( u.includes( '/odd-app-runtime/react.js' ) ) {
				return makeResponse( 'export default {};', {
					url: u,
					contentType: 'application/javascript',
				} );
			}
			return makeResponse( 'not found', { ok: false, status: 404, url: u } );
		} );

		const probe = await window.__odd.diagnostics.probeApp( 'demo', { reason: 'test' } );

		expect( probe.status ).toBe( 'pass' );
		expect( probe.serveUrl ).toContain( '_wpnonce=[redacted]' );
		expect( probe.html.hasImportmap ).toBe( true );
		expect( probe.fetches.modules ).toHaveLength( 1 );
		expect( probe.fetches.runtimes ).toHaveLength( 1 );
		expect( window.__odd.diagnostics.appProbes() ).toHaveLength( 1 );
		expect( window.__odd.diagnostics.collectMarkdown() ).toContain( 'active app probes' );
	} );

	it( 'captures live iframe DOM state and iframe runtime diagnostics', () => {
		loadFoundation( {
			config: {
				appsEnabled: true,
				appServeUrls: { demo: '/odd-app/demo/?_wpnonce=secret' },
				userApps: { installed: [ 'demo' ], pinned: [] },
			},
		} );

		const mount = document.createElement( 'div' );
		mount.className = 'odd-app-host';
		mount.setAttribute( 'data-odd-app-slug', 'demo' );
		const frame = document.createElement( 'iframe' );
		frame.className = 'odd-app-frame';
		frame.src = '/odd-app/demo/?_wpnonce=secret';
		mount.appendChild( frame );
		document.body.appendChild( mount );
		frame.contentDocument.open();
		frame.contentDocument.write( '<!doctype html><html><body><div id="root"><main>Rendered app</main></div></body></html>' );
		frame.contentDocument.close();

		window.dispatchEvent( new MessageEvent( 'message', {
			source: frame.contentWindow,
			data: {
				type: 'odd-app-diagnostic',
				event: {
					type: 'error',
					message: 'Render exploded',
					href: '/odd-app/demo/?_wpnonce=secret',
				},
			},
		} ) );

		const snap = window.__odd.diagnostics.appIframes()[0];
		expect( snap.slug ).toBe( 'demo' );
		expect( snap.iframeSrc ).toContain( '_wpnonce=[redacted]' );
		expect( snap.document.root.childElementCount ).toBe( 1 );
		expect( snap.document.root.textPreview ).toBe( 'Rendered app' );
		expect( snap.recentErrors[0].message ).toBe( 'Render exploded' );
		expect( snap.recentErrors[0].href ).toContain( '_wpnonce=[redacted]' );
	} );

	it( 'finds app iframes inside open shadow roots', () => {
		loadFoundation( {
			config: {
				appsEnabled: true,
				appServeUrls: { demo: '/odd-app/demo/?_wpnonce=secret' },
				userApps: { installed: [ 'demo' ], pinned: [] },
			},
		} );

		const shell = document.createElement( 'div' );
		const shadow = shell.attachShadow( { mode: 'open' } );
		const mount = document.createElement( 'div' );
		mount.className = 'odd-app-host';
		mount.setAttribute( 'data-odd-app-slug', 'demo' );
		const frame = document.createElement( 'iframe' );
		frame.className = 'odd-app-frame';
		frame.src = '/odd-app/demo/?_wpnonce=secret';
		mount.appendChild( frame );
		shadow.appendChild( mount );
		document.body.appendChild( shell );

		const snap = window.__odd.diagnostics.appIframes()[0];
		expect( snap.slug ).toBe( 'demo' );
		expect( snap.domRoot ).toBe( 'shadowRoot' );
		expect( snap.iframeSrc ).toContain( '_wpnonce=[redacted]' );
	} );
} );
