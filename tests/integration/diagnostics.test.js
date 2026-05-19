import { describe, expect, it, beforeEach, vi } from 'vitest';
import { loadFoundation } from './harness.js';

describe( 'ODD diagnostics metrics', () => {
	beforeEach( () => {
		window.history.replaceState( {}, '', '/wp-admin/index.php' );
		document.head.innerHTML = '';
		document.body.innerHTML = '';
		document.body.className = '';
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

	it( 'summarizes local health for Shop/UI surfaces', () => {
		loadFoundation( {
			config: {
				restUrl: '/wp-json/odd/v1/prefs',
				appsEnabled: true,
				systemHealth: {
					catalog: {
						source: 'remote',
						bundle_count: 4,
						signature_status: 'valid',
						stale_age: 60,
						rollback_count: 0,
						last_error_message: '',
					},
					starter: { status: 'installed' },
					cursors: { active: 'spark', stylesheet: '/cursors/spark.css', runtimeExpected: true },
					desktopMode: { baseline: true, version: '0.8.5' },
				},
			},
		} );
		window.wp.desktop = { desktopLayout: 'desktop' };

		const summary = window.__odd.diagnostics.summary();
		expect( summary.status ).toBe( 'ok' );
		expect( summary.counts.problems ).toBe( 0 );
		expect( summary.ok.map( ( row ) => row.id ) ).toEqual( expect.arrayContaining( [
			'desktopMode.present',
			'catalog.available',
			'logs.quiet',
		] ) );
		expect( window.__odd.diagnostics.collect().health.status ).toBe( 'ok' );
		expect( window.__odd.diagnostics.collectMarkdown() ).toContain( '## Health Summary' );
	} );

	it( 'reports warnings and problems in the diagnostics health summary', () => {
		loadFoundation( {
			config: {
				restUrl: '',
				systemHealth: {
					catalog: {
						source: 'fallback',
						signature_status: 'missing',
						stale_age: 172800,
						rollback_count: 1,
						last_error_message: 'catalog unavailable',
					},
					starter: { status: 'failed' },
					cursors: { active: 'spark', stylesheet: '', runtimeExpected: true },
					desktopMode: { baseline: false },
				},
			},
		} );
		delete window.wp.desktop;
		window.__odd.diagnostics.recordAppIframeError( { slug: 'demo', type: 'error', message: 'boom' } );

		const summary = window.__odd.diagnostics.summary();
		const warningIds = summary.warn.map( ( row ) => row.id );
		const problemIds = summary.problems.map( ( row ) => row.id );
		expect( summary.status ).toBe( 'problems' );
		expect( warningIds ).toEqual( expect.arrayContaining( [
			'prefs.restUrlMissing',
			'catalog.lastError',
			'catalog.signature',
			'catalog.stale',
			'catalog.rollback',
			'cursors.stylesheetMissing',
		] ) );
		expect( problemIds ).toEqual( expect.arrayContaining( [
			'desktopMode.missing',
			'desktopMode.baseline',
			'starter.failed',
			'apps.iframeErrors',
		] ) );
	} );

	it( 'reports portal-only containment state in local diagnostics', () => {
		window.history.replaceState( {}, '', '/wp-admin/index.php?desktop_mode_portal=1' );
		loadFoundation( {
			config: {
				adminBarHidden: true,
				cursorSet: 'spark',
				cursorStylesheet: '/wp-json/odd/v1/cursors/active.css',
				systemHealth: {
					cursors: { active: 'spark', stylesheet: '/wp-json/odd/v1/cursors/active.css', runtimeExpected: true },
				},
			},
		} );
		document.body.className = 'desktop-mode-active';
		const cursorLink = document.createElement( 'link' );
		cursorLink.id = 'odd-cursors-css';
		cursorLink.href = '/wp-json/odd/v1/cursors/active.css';
		document.head.appendChild( cursorLink );
		const adminBarStyle = document.createElement( 'style' );
		adminBarStyle.id = 'oddout-admin-bar-hidden';
		document.head.appendChild( adminBarStyle );
		const root = document.createElement( 'main' );
		root.setAttribute( 'data-odd-cursor-root', 'true' );
		document.body.appendChild( root );

		const payload = window.__odd.diagnostics.collect();
		expect( payload.state.user.adminBarHidden ).toBe( true );
		expect( payload.containment ).toEqual( expect.objectContaining( {
			desktopPortal: true,
			adminBarHiddenPreference: true,
			adminBarStyle: true,
			cursorStylesheet: true,
			cursorRoots: 1,
		} ) );
		expect( payload.health.ok.map( ( row ) => row.id ) ).toContain( 'containment.portal' );
		expect( window.__odd.diagnostics.collectMarkdown() ).toContain( '## Containment' );
	} );

	it( 'flags cursor or admin-bar containment leaks outside the portal', () => {
		window.history.replaceState( {}, '', '/wp-admin/plugins.php' );
		loadFoundation( {
			config: {
				adminBarHidden: true,
				cursorSet: 'spark',
				cursorStylesheet: '/wp-json/odd/v1/cursors/active.css',
			},
		} );
		const cursorLink = document.createElement( 'link' );
		cursorLink.id = 'odd-cursors-css';
		cursorLink.href = '/wp-json/odd/v1/cursors/active.css';
		document.head.appendChild( cursorLink );
		const liveCursor = document.createElement( 'div' );
		liveCursor.id = 'odd-live-cursor';
		document.body.appendChild( liveCursor );
		const adminBarStyle = document.createElement( 'style' );
		adminBarStyle.id = 'oddout-admin-bar-hidden';
		document.head.appendChild( adminBarStyle );

		const summary = window.__odd.diagnostics.summary();
		expect( summary.status ).toBe( 'problems' );
		expect( summary.problems.map( ( row ) => row.id ) ).toEqual( expect.arrayContaining( [
			'containment.cursorBleed',
			'containment.adminBarBleed',
		] ) );
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
			'<script id="oddout_apps_iframe_fetch_bootstrap"></script>',
			'<script id="oddout_apps_iframe_diagnostics_bootstrap"></script>',
			'<script type="module" src="./assets/app.js"></script>',
			'</head><body><div id="root"></div></body></html>',
		].join( '' );
		const mount = document.createElement( 'div' );
		mount.className = 'odd-app-host';
		mount.setAttribute( 'data-odd-app-slug', 'demo' );
		const frame = document.createElement( 'iframe' );
		frame.className = 'odd-app-frame';
		frame.src = '/odd-app/demo/?_wpnonce=secret';
		mount.getBoundingClientRect = () => ( { left: 0, top: 0, right: 320, bottom: 240, width: 320, height: 240 } );
		frame.getBoundingClientRect = () => ( { left: 0, top: 0, right: 320, bottom: 240, width: 320, height: 240 } );
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
		expect( probe.liveIframe.iframeVisible.ok ).toBe( true );
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

	it( 'ignores iframe diagnostics from unknown sources or malformed payloads', () => {
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

		window.dispatchEvent( new MessageEvent( 'message', {
			source: window,
			data: {
				type: 'odd-app-diagnostic',
				event: { type: 'error', message: 'spoofed' },
			},
		} ) );
		window.dispatchEvent( new MessageEvent( 'message', {
			source: frame.contentWindow,
			data: {
				type: 'odd-app-diagnostic',
				event: { type: { nested: true }, message: 'bad shape' },
			},
		} ) );
		window.dispatchEvent( new MessageEvent( 'message', {
			source: frame.contentWindow,
			data: {
				type: 'odd-app-diagnostic',
				event: { type: 'error', slug: 'other-app', message: 'wrong slug' },
			},
		} ) );
		window.dispatchEvent( new MessageEvent( 'message', {
			source: frame.contentWindow,
			data: {
				type: 'odd-app-diagnostic',
				event: { type: 'error', message: 'x'.repeat( 2200 ) },
			},
		} ) );

		const snap = window.__odd.diagnostics.appIframes()[0];
		expect( snap.recentErrors ).toHaveLength( 0 );
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
