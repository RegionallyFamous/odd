/**
 * apps-surfaces.test.js — Shop UI contract for the per-app
 * `surfaces` preference (Desktop icon + Taskbar icon checkboxes).
 *
 * Mirrors panel.test.js: we load the panel module against a seeded
 * `window.odd` + stubbed `fetch`, switch to the Apps department,
 * then exercise the two checkboxes inside each app card.
 *
 * The server normalizes the response shape (`{ enabled, surfaces }`);
 * these tests only care that:
 *
 *   1. The checkboxes initialize from app.surfaces.
 *   2. A toggle POSTs `/odd/v1/apps/{slug}/toggle` with
 *      `{ surfaces: { <field>: bool } }` — partial payloads only,
 *      so the two checkboxes stay independent.
 *   3. After a successful POST the panel schedules the shared
 *      `scheduleAdminReload()` (surfaces delay) so Desktop Mode
 *      re-reads native registration on the next load.
 *   4. Toggles are disabled when app.enabled === false.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const PANEL_JS  = resolve( __dirname, '../../odd/src/panel/index.js' );

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

	it( 'renders a Desktop icon + Taskbar icon checkbox per installed app', async () => {
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const card = host.querySelector( '.odd-card--app[data-app-slug="demo-app"]' );
		expect( card, 'demo-app card must render' ).toBeTruthy();

		const checks = card.querySelectorAll( '.odd-card__surfaces input[type="checkbox"]' );
		expect( checks.length ).toBe( 2 );

		// Initial state mirrors the seeded surfaces object.
		expect( checks[ 0 ].checked ).toBe( true );   // Desktop icon on
		expect( checks[ 1 ].checked ).toBe( false );  // Taskbar icon off

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'toggling taskbar posts a partial { surfaces: { taskbar } } payload and schedules admin reload', async () => {
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const card   = host.querySelector( '.odd-card--app[data-app-slug="demo-app"]' );
		const labels = card.querySelectorAll( '.odd-card__surface' );
		expect( labels.length ).toBe( 2 );
		const taskbarBox = labels[ 1 ].querySelector( 'input[type="checkbox"]' );
		taskbarBox.checked = true;
		taskbarBox.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		await tick( 0 );
		await tick( 0 );

		const postCall = fetchMock.mock.calls.find( ( c ) => c[ 1 ] && c[ 1 ].method === 'POST' );
		expect( postCall, 'A POST to /apps/{slug}/toggle must fire' ).toBeTruthy();
		expect( postCall[ 0 ] ).toContain( '/odd/v1/apps/demo-app/toggle' );
		const body = JSON.parse( postCall[ 1 ].body );
		expect( body ).toEqual( { surfaces: { taskbar: true } } );
		expect( Object.keys( body.surfaces ) ).toEqual( [ 'taskbar' ] );

		await tick( 400 );
		expect( reloadSpy ).toHaveBeenCalled();

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'toggling desktop posts only { surfaces: { desktop } } — independent of taskbar', async () => {
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const card       = host.querySelector( '.odd-card--app[data-app-slug="demo-app"]' );
		const desktopBox = card.querySelector( '.odd-card__surfaces input[type="checkbox"]' );
		desktopBox.checked = false;
		desktopBox.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		await tick( 0 );
		await tick( 0 );

		const postCall = fetchMock.mock.calls.find( ( c ) => c[ 1 ] && c[ 1 ].method === 'POST' );
		expect( postCall ).toBeTruthy();
		const body = JSON.parse( postCall[ 1 ].body );
		expect( body ).toEqual( { surfaces: { desktop: false } } );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'disabled apps render their checkboxes as disabled controls', async () => {
		const { host, cleanup } = mountPanel();
		await gotoAppsDepartment( host );

		const card = host.querySelector( '.odd-card--app[data-app-slug="disabled-app"]' );
		expect( card ).toBeTruthy();

		const boxes = card.querySelectorAll( '.odd-card__surfaces input[type="checkbox"]' );
		expect( boxes.length ).toBe( 2 );
		boxes.forEach( ( b ) => expect( b.disabled ).toBe( true ) );

		// And a change event must be a no-op — no POST.
		boxes[ 1 ].dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await tick( 0 );
		const postCall = fetchMock.mock.calls.find( ( c ) => c[ 1 ] && c[ 1 ].method === 'POST' );
		expect( postCall ).toBeFalsy();

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'catalog app install shows Applying… and schedules admin reload', async () => {
		seedConfig( [] );
		fetchMock = vi.fn( ( url, opts ) => {
			if ( opts && opts.method === 'POST' && /\/bundles\/install-from-catalog$/.test( url ) ) {
				return Promise.resolve( {
					ok:   true,
					json: () => Promise.resolve( {
						installed: true,
						manifest:  { slug: 'board', name: 'Board', version: '1.2.0' },
						// Even with a hot serve URL, the Shop still schedules a full
						// admin reload so Desktop Mode picks up the new app surfaces.
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

		const labelsMid = Array.from( host.querySelectorAll( '.odd-shop__card-btn' ) )
			.map( ( btn ) => btn.textContent.trim() );
		expect( labelsMid ).toContain( 'Applying…' );

		await tick( 450 );
		expect( reloadSpy ).toHaveBeenCalled();

		if ( typeof cleanup === 'function' ) cleanup();
	} );
} );
