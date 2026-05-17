/**
 * apps-surfaces.test.js — Shop UI contract for the per-app
 * `surfaces` preference (desktop + taskbar placement switches).
 *
 * Mirrors panel.test.js: we load the panel module against a seeded
 * `window.odd` + stubbed `fetch`, switch to the Apps department,
 * then exercise the two placement switches inside each app card.
 *
 * Desktop Mode owns visible placement via its `itemVisibility` OS
 * setting. These tests only care that:
 *
 *   1. The switches initialize from app.surfaces.
 *   2. A toggle writes the canonical `odd-app-{slug}` itemVisibility
 *      placement through `wp.desktop.updateOsSettings()`.
 *   3. The older `/apps/{slug}/toggle` surfaces route remains a fallback
 *      only when the host does not expose Desktop Mode OS settings.
 *   4. Switches are disabled when app.enabled === false.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const PANEL_JS  = resolve( __dirname, '../../odd/src/panel/index.js' );
const SHOP_FLOW_JS = resolve( __dirname, '../../odd/src/panel/shop-flow.js' );
const PANEL_CARD_ART_JS = resolve( __dirname, '../../odd/src/panel/card-art.js' );

function seedConfig( apps ) {
	window.odd = {
		pluginUrl:        '',
		version:          'test',
		restUrl:          '/wp-json/odd/v1/prefs',
		restNonce:        'nonce-abc',
		bundlesUploadUrl: '/wp-json/odd/v1/bundles/upload',
		canInstall:       true,
		installedWidgets: [],
		wallpaper: 'flux',
		scene:     'flux',
		scenes:    [ { slug: 'flux', label: 'Flux', category: 'Generative', tags: [], fallbackColor: '#222' } ],
		sets:      [],
		iconSet:   '',
		favorites: [],
		recents:   [],
		shuffle:       { enabled: false, minutes: 15 },
		screensaver:   { enabled: false, minutes: 10, scene: 'current' },
		audioReactive: false,
		appsEnabled:   true,
		apps:          apps,
		userApps:      { installed: [], pinned: [] },
	};
}

function installHooks() {
	const handlers = new Map();
	window.wp = window.wp || {};
	window.wp.hooks = {
		doAction:   ( name, ...args ) => { ( handlers.get( name ) || [] ).forEach( ( h ) => h( ...args ) ); },
		addAction:  ( name, _ns, fn ) => { if ( ! handlers.has( name ) ) handlers.set( name, [] ); handlers.get( name ).push( fn ); },
		removeAction: () => {},
		applyFilters: ( _name, value ) => value,
	};
	window.wp.i18n = window.wp.i18n || { __: ( s ) => s };
}

function loadPanel() {
	const flowSrc = readFileSync( SHOP_FLOW_JS, 'utf8' );
	const flowFn  = new Function( `${ flowSrc }\n//# sourceURL=panel/shop-flow.js` );
	flowFn.call( globalThis );
	const cardArtSrc = readFileSync( PANEL_CARD_ART_JS, 'utf8' );
	const cardArtFn  = new Function( `${ cardArtSrc }\n//# sourceURL=panel/card-art.js` );
	cardArtFn.call( globalThis );
	const src = readFileSync( PANEL_JS, 'utf8' );
	const fn  = new Function( `${ src }\n//# sourceURL=panel/index.js` );
	fn.call( globalThis );
}

function mountPanel() {
	const host = document.createElement( 'div' );
	host.style.width  = '900px';
	host.style.height = '600px';
	document.body.appendChild( host );
	const cleanup = window.desktopModeNativeWindows.odd( host );
	return { host, cleanup };
}

/**
 * The Apps department is a gated rail — click the "Apps" button to
 * force it into view so the installed-apps gallery renders. Returns
 * once at least one `.odd-card--app` is in the DOM, or throws.
 */
async function gotoAppsDepartment( host ) {
	const btn = Array.from( host.querySelectorAll( '.odd-shop__rail-item' ) )
		.find( ( b ) => b.querySelector( '.odd-shop__rail-label strong' )?.textContent.trim() === 'Apps' );
	if ( ! btn ) throw new Error( 'Apps rail button missing' );
	btn.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
	// fetchApps() resolves microtask-after, then the gallery re-renders.
	for ( let i = 0; i < 10; i++ ) {
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		if ( host.querySelector( '.odd-card--app' ) ) return;
	}
	throw new Error( 'App cards did not render' );
}

describe( 'ODD Shop · App surfaces', () => {
	let fetchMock;
	let reloadSpy;
	let refreshMenuSpy;
	let updateOsSettingsSpy;
	let osSettings;

	beforeEach( () => {
		document.body.innerHTML = '';
		const existing = document.getElementById( 'odd-panel-styles' );
		if ( existing ) existing.remove();
		delete window.desktopModeNativeWindows;

		const apps = [
			{
				slug:        'demo-app',
				name:        'Demo App',
				version:     '1.0.0',
				enabled:     true,
				icon:        '',
				description: 'Just a demo.',
				surfaces:    { desktop: true, taskbar: false },
			},
			{
				slug:        'disabled-app',
				name:        'Disabled App',
				version:     '0.1.0',
				enabled:     false,
				icon:        '',
				description: 'Off for now.',
				surfaces:    { desktop: true, taskbar: true },
			},
		];
		seedConfig( apps );
		installHooks();
		osSettings = { itemVisibility: {}, dockOrder: [] };
		refreshMenuSpy = vi.fn( () => Promise.resolve() );
		updateOsSettingsSpy = vi.fn( ( patch ) => {
			if ( patch && patch.itemVisibility ) {
				osSettings.itemVisibility = Object.assign( {}, patch.itemVisibility );
			}
			if ( patch && patch.dockOrder ) {
				osSettings.dockOrder = patch.dockOrder.slice();
			}
		} );
		window.wp.desktop = {
			refreshMenu: refreshMenuSpy,
			getOsSettings: () => ( {
				itemVisibility: Object.assign( {}, osSettings.itemVisibility ),
				dockOrder: osSettings.dockOrder.slice(),
			} ),
			updateOsSettings: updateOsSettingsSpy,
		};

		// fetchApps() hits GET /odd/v1/apps; toggle POST hits
		// /odd/v1/apps/{slug}/toggle. Both paths share the same
		// stub, returning the list for GET and a normalized shape
		// for POST.
		fetchMock = vi.fn( ( url, opts ) => {
			if ( opts && opts.method === 'POST' && /\/toggle$/.test( url ) ) {
				const body = opts.body ? JSON.parse( opts.body ) : {};
				return Promise.resolve( {
					ok:   true,
					json: () => Promise.resolve( {
						enabled:  true,
						surfaces: { desktop: true, taskbar: !! ( body.surfaces && body.surfaces.taskbar ) },
					} ),
				} );
			}
			return Promise.resolve( {
				ok:   true,
				json: () => Promise.resolve( { apps } ),
			} );
		} );
		globalThis.fetch = fetchMock;

		reloadSpy = vi.fn();
		// window.location.reload is not configurable in jsdom — patch
		// via defineProperty on the descriptor instead.
		Object.defineProperty( window, 'location', {
			configurable: true,
			value: { ...window.location, reload: reloadSpy },
		} );

		loadPanel();
	} );

	afterEach( () => {
		delete globalThis.fetch;
	} );

	// Real timers + microtask flush. The shop's flows are all
	// fetch-then-setTimeout, so a handful of `await Promise.resolve()`
	// + a short real sleep is enough to settle every test path.
	const tick = async ( ms = 0 ) => {
		await new Promise( ( r ) => setTimeout( r, ms ) );
	};

	it( 'renders native placement switches per installed app', async () => {
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const card = host.querySelector( '.odd-card--app[data-app-slug="demo-app"]' );
		expect( card, 'demo-app card must render' ).toBeTruthy();

		const switches = card.querySelectorAll( '.odd-card__surface-switch' );
		expect( switches.length ).toBe( 2 );

		// Initial state mirrors the seeded surfaces object.
		expect( switches[ 0 ].getAttribute( 'aria-checked' ) ).toBe( 'true' );   // Desktop on
		expect( switches[ 1 ].getAttribute( 'aria-checked' ) ).toBe( 'false' );  // Taskbar off
		expect( card.querySelector( '.odd-card__surfaces-state' ).textContent ).toBe( 'Desktop' );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'prefers Desktop Mode itemVisibility over stale ODD surfaces metadata', async () => {
		osSettings.itemVisibility[ 'odd-app-demo-app' ] = 'both';
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const card = host.querySelector( '.odd-card--app[data-app-slug="demo-app"]' );
		const switches = card.querySelectorAll( '.odd-card__surface-switch' );
		expect( switches[ 0 ].getAttribute( 'aria-checked' ) ).toBe( 'true' );
		expect( switches[ 1 ].getAttribute( 'aria-checked' ) ).toBe( 'true' );
		expect( card.querySelector( '.odd-card__surfaces-state' ).textContent ).toBe( 'Both' );
		expect( updateOsSettingsSpy ).not.toHaveBeenCalled();

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'seeds missing Desktop Mode itemVisibility for enabled installed apps', async () => {
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		expect( updateOsSettingsSpy ).toHaveBeenCalledTimes( 1 );
		expect( updateOsSettingsSpy.mock.calls[ 0 ][ 0 ] ).toEqual( {
			itemVisibility: { 'odd-app-demo-app': 'desktop' },
		} );
		expect( osSettings.itemVisibility[ 'odd-app-demo-app' ] ).toBe( 'desktop' );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'toggling taskbar writes the core itemVisibility placement without reloading', async () => {
		osSettings.itemVisibility[ 'odd-app-demo-app' ] = 'desktop';
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const card   = host.querySelector( '.odd-card--app[data-app-slug="demo-app"]' );
		const taskbar = card.querySelector( '.odd-card__surface-switch[data-surface-key="taskbar"]' );
		expect( taskbar ).toBeTruthy();
		taskbar.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await tick( 0 );
		await tick( 0 );
		await tick( 0 );

		const postCall = fetchMock.mock.calls.find( ( c ) => c[ 1 ] && c[ 1 ].method === 'POST' );
		expect( postCall, 'Core Desktop Mode settings should avoid the fallback REST toggle.' ).toBeFalsy();
		expect( updateOsSettingsSpy ).toHaveBeenCalledTimes( 1 );
		expect( updateOsSettingsSpy.mock.calls[ 0 ][ 0 ] ).toEqual( {
			itemVisibility: { 'odd-app-demo-app': 'both' },
		} );

		await tick( 0 );
		expect( refreshMenuSpy ).toHaveBeenCalledTimes( 1 );
		expect( reloadSpy ).not.toHaveBeenCalled();

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'toggling desktop writes hidden when both launch surfaces are off', async () => {
		osSettings.itemVisibility[ 'odd-app-demo-app' ] = 'desktop';
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const card       = host.querySelector( '.odd-card--app[data-app-slug="demo-app"]' );
		const desktop = card.querySelector( '.odd-card__surface-switch[data-surface-key="desktop"]' );
		desktop.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await tick( 0 );
		await tick( 0 );
		await tick( 0 );

		const postCall = fetchMock.mock.calls.find( ( c ) => c[ 1 ] && c[ 1 ].method === 'POST' );
		expect( postCall ).toBeFalsy();
		expect( updateOsSettingsSpy ).toHaveBeenCalledTimes( 1 );
		expect( updateOsSettingsSpy.mock.calls[ 0 ][ 0 ] ).toEqual( {
			itemVisibility: { 'odd-app-demo-app': 'hidden' },
		} );

		await tick( 0 );
		expect( refreshMenuSpy ).toHaveBeenCalledTimes( 1 );
		expect( reloadSpy ).not.toHaveBeenCalled();

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'falls back to the ODD REST surfaces route when core OS settings are unavailable', async () => {
		delete window.wp.desktop.getOsSettings;
		delete window.wp.desktop.updateOsSettings;
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const card   = host.querySelector( '.odd-card--app[data-app-slug="demo-app"]' );
		const taskbar = card.querySelector( '.odd-card__surface-switch[data-surface-key="taskbar"]' );
		taskbar.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await tick( 0 );
		await tick( 0 );

		const postCall = fetchMock.mock.calls.find( ( c ) => c[ 1 ] && c[ 1 ].method === 'POST' );
		expect( postCall, 'The compatibility REST toggle should fire without core OS settings.' ).toBeTruthy();
		expect( postCall[ 0 ] ).toContain( '/odd/v1/apps/demo-app/toggle' );
		const body = JSON.parse( postCall[ 1 ].body );
		expect( body ).toEqual( { surfaces: { taskbar: true } } );

		await tick( 450 );
		expect( updateOsSettingsSpy ).not.toHaveBeenCalled();
		expect( refreshMenuSpy ).not.toHaveBeenCalled();
		expect( reloadSpy ).toHaveBeenCalledTimes( 1 );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'disabled apps render their placement switches as disabled controls', async () => {
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const card = host.querySelector( '.odd-card--app[data-app-slug="disabled-app"]' );
		expect( card ).toBeTruthy();

		const switches = card.querySelectorAll( '.odd-card__surface-switch' );
		expect( switches.length ).toBe( 2 );
		switches.forEach( ( b ) => expect( b.disabled ).toBe( true ) );

		// And a change event must be a no-op — no POST.
		switches[ 1 ].dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		await tick( 0 );
		const postCall = fetchMock.mock.calls.find( ( c ) => c[ 1 ] && c[ 1 ].method === 'POST' );
		expect( postCall ).toBeFalsy();

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'catalog app install opens immediately and refreshes Desktop Mode live', async () => {
		seedConfig( [] );
		fetchMock = vi.fn( ( url, opts ) => {
			if ( opts && opts.method === 'POST' && /\/bundles\/install-from-catalog$/.test( url ) ) {
				return Promise.resolve( {
					ok:   true,
					json: () => Promise.resolve( {
						installed: true,
						manifest:  { slug: 'board', name: 'Board', version: '1.2.0' },
						serve_url: 'http://localhost/odd-app/board/?_wpnonce=fake',
					} ),
				} );
			}
			if ( /\/bundles\/catalog$/.test( url ) ) {
				return Promise.resolve( {
					ok:   true,
					json: () => Promise.resolve( {
						items: [ { slug: 'board', type: 'app', name: 'Board', version: '1.2.0', installed: false } ],
					} ),
				} );
			}
			return Promise.resolve( {
				ok:   true,
				json: () => Promise.resolve( { apps: [] } ),
			} );
		} );
		globalThis.fetch = fetchMock;

		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const install = Array.from( host.querySelectorAll( '.odd-shop__card-btn' ) )
			.find( ( btn ) => btn.textContent.trim() === 'Install' );
		expect( install ).toBeTruthy();
		install.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await tick( 0 );
		await tick( 0 );
		await tick( 0 );

		expect( updateOsSettingsSpy ).toHaveBeenCalledTimes( 1 );
		expect( updateOsSettingsSpy.mock.calls[ 0 ][ 0 ] ).toEqual( {
			itemVisibility: { 'odd-app-board': 'desktop' },
		} );

		const labelsMid = Array.from( host.querySelectorAll( '.odd-shop__card-btn' ) )
			.map( ( btn ) => btn.textContent.trim() );
		expect( labelsMid ).toContain( 'Open' );
		expect( labelsMid ).not.toContain( 'Working…' );

		await tick( 0 );
		expect( refreshMenuSpy ).toHaveBeenCalledTimes( 1 );
		expect( reloadSpy ).not.toHaveBeenCalled();

		if ( typeof cleanup === 'function' ) cleanup();
	} );
} );
