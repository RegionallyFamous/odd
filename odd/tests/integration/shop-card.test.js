/**
 * shop-card.test.js — state machine for the unified Shop tile.
 *
 * Every department in the Shop (Wallpapers / Icons / Widgets / Apps)
 * renders a single `renderShopCard(row)` tile whose primary action
 * button derives its label from the durable item state:
 *
 *   incompatible?    → "Incompatible" (disabled)
 *   not installed?   → "Install"
 *   broken?          → "Repair"
 *   updateAvailable? → "Update"
 *   requiresReload?  → "Reload now" (escape hatch; pending reload → "Applying…")
 *   active?          → "Active" (disabled)
 *   type=scene/icon  → "Preview"
 *   type=widget      → "Add"
 *   type=app         → "Open"
 *
 * This spec exercises each transition in isolation by swapping
 * `state.cfg` between mounts. The point isn't to assert a particular
 * layout — styles + copy evolve — but that the state-machine logic
 * behind the button is correct and calls through to the right
 * per-type handler.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const PANEL_JS = resolve( __dirname, '../../src/panel/index.js' );

function loadPanel() {
	const src = readFileSync( PANEL_JS, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=panel/index.js` );
	fn.call( globalThis );
}

function installHooks() {
	const handlers = new Map();
	window.wp = window.wp || {};
	window.wp.hooks = {
		doAction: ( name, ...args ) => ( handlers.get( name ) || [] ).forEach( ( h ) => h( ...args ) ),
		addAction: ( name, _ns, fn ) => {
			if ( ! handlers.has( name ) ) handlers.set( name, [] );
			handlers.get( name ).push( fn );
		},
		removeAction: () => {},
		applyFilters: ( _name, value ) => value,
	};
}

function seed( overrides = {} ) {
	window.odd = Object.assign(
		{
			pluginUrl: '',
			version:   'test',
			restUrl:   '/wp-json/odd/v1/prefs',
			restNonce: 'nonce-abc',
			bundlesUploadUrl: '/wp-json/odd/v1/bundles/upload',
			bundleInstallUrl: '/wp-json/odd/v1/bundles/install-from-catalog',
			canInstall:       true,
			wallpaper: '',
			scene:     '',
			scenes:    [],
			iconSet:   '',
			iconSets:  [],
			cursorSet: '',
			cursorSets: [],
			installedWidgets: [],
			favorites: [],
			recents:   [],
			shuffle:   { enabled: false, minutes: 15 },
			screensaver: { enabled: false, minutes: 10, scene: 'current' },
			audioReactive: false,
			appsEnabled:  false,
			apps:         [],
			userApps:     { installed: [], pinned: [] },
			bundleCatalog: { scene: [], iconSet: [], cursorSet: [], widget: [], app: [] },
		},
		overrides
	);
}

function mount() {
	const host = document.createElement( 'div' );
	host.style.width = '900px';
	host.style.height = '600px';
	document.body.appendChild( host );
	const cleanup = window.desktopModeNativeWindows.odd( host );
	return { host, cleanup };
}

function goToDepartment( host, label ) {
	const btn = Array.from( host.querySelectorAll( '.odd-shop__rail-item' ) )
		.find( ( b ) => b.querySelector( '.odd-shop__rail-label strong' )?.textContent.trim() === label );
	expect( btn, `rail button "${ label }" missing` ).toBeTruthy();
	btn.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
}

describe( 'ODD Shop · unified card state machine', () => {
	let reloadSpy;

	beforeEach( () => {
		document.body.innerHTML = '';
		const existing = document.getElementById( 'odd-panel-styles' );
		if ( existing ) existing.remove();
		delete window.desktopModeNativeWindows;
		try { window.sessionStorage.removeItem( 'odd.justInstalled' ); } catch ( e ) {}
		installHooks();

		globalThis.fetch = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( {} ),
		} ) );

		reloadSpy = vi.fn();
		Object.defineProperty( window, 'location', {
			configurable: true,
			value: { ...window.location, reload: reloadSpy, href: 'http://localhost/' },
		} );
	} );

	afterEach( () => {
		delete globalThis.fetch;
	} );

	it( 'installed widget layers catalog icon_url into card art (no generic glyph)', async () => {
		seed( {
			installedWidgets: [ { id: 'odd/eight-ball', slug: 'eight-ball', label: 'Magic 8-Ball' } ],
			bundleCatalog: {
				scene:   [],
				iconSet: [],
				widget: [
					{
						slug:       'eight-ball',
						label:      'Magic 8-Ball',
						franchise:  'ODD Originals',
						icon_url:   'https://example.com/catalog/v1/icons/widget-eight-ball.svg',
						installed:  false,
					},
				],
			},
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Widgets' );

		const card = host.querySelector( '[data-odd-shop-card][data-widget-id="odd/eight-ball"]' );
		expect( card ).toBeTruthy();
		const thumb = card.querySelector( '.odd-shop__card-art--widget img.odd-shop__card-art-fill' );
		expect( thumb ).toBeTruthy();
		expect( thumb.getAttribute( 'src' ) ).toBe( 'https://example.com/catalog/v1/icons/widget-eight-ball.svg' );
		expect( thumb.getAttribute( 'loading' ) ).toBe( 'lazy' );
		expect( thumb.getAttribute( 'decoding' ) ).toBe( 'async' );
		expect( thumb.getAttribute( 'width' ) ).toBe( '512' );
	} );

	it( 'not-installed scene renders an Install button', () => {
		seed( {
			bundleCatalog: {
				scene: [ { slug: 'gusts', label: 'Gusts', installed: false } ],
				iconSet: [],
				widget: [],
			},
		} );
		loadPanel();
		const { host } = mount();

		const card = host.querySelector( '[data-odd-shop-card][data-catalog-slug="gusts"]' );
		expect( card, 'catalog scene tile must be rendered' ).toBeTruthy();
		const btn = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Install' );
	} );

	it( 'catalog-only scene is canonical and not duplicated by Discover', () => {
		seed( {
			bundleCatalog: {
				scene: [ { slug: 'gusts', label: 'Gusts', franchise: 'Atmosphere', featured: true, installed: false } ],
				iconSet: [],
				cursorSet: [],
				widget: [],
			},
		} );
		loadPanel();
		const { host } = mount();

		const cards = host.querySelectorAll( '[data-odd-shop-card][data-catalog-slug="gusts"]' );
		expect( cards.length ).toBe( 1 );
		expect( host.querySelector( '.odd-shop__hero-btn' ) ).toBeNull();
		expect( cards[ 0 ].querySelector( '.odd-shop__card-btn' ).textContent.trim() ).toBe( 'Install' );
	} );

	it( 'installed inactive scene renders a Preview button', () => {
		seed( {
			wallpaper: 'gusts',
			scene:     'gusts',
			scenes: [
				{ slug: 'gusts',   label: 'Gusts',   franchise: 'Atmosphere', fallbackColor: '#333' },
				{ slug: 'terrazzo', label: 'Terrazzo', franchise: 'Forms',    fallbackColor: '#444' },
			],
		} );
		loadPanel();
		const { host } = mount();

		const card = host.querySelector( '[data-odd-shop-card][data-scene-slug="terrazzo"]' );
		expect( card, 'installed inactive scene must render a unified tile' ).toBeTruthy();
		const btn = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Preview' );
		expect( btn.disabled ).toBe( false );
	} );

	it( 'active scene renders a disabled Active button', () => {
		seed( {
			wallpaper: 'gusts',
			scene:     'gusts',
			scenes: [
				{ slug: 'gusts', label: 'Gusts', franchise: 'Atmosphere', fallbackColor: '#333' },
			],
		} );
		loadPanel();
		const { host } = mount();

		const card = host.querySelector( '[data-odd-shop-card][data-scene-slug="gusts"]' );
		const btn  = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Active' );
		expect( btn.disabled ).toBe( true );
		expect( card.classList.contains( 'is-active' ) ).toBe( true );
	} );

	it( 'incompatible catalog rows render a disabled Incompatible button', () => {
		seed( {
			bundleCatalog: {
				scene: [ { slug: 'future-scene', label: 'Future Scene', installed: false, state: 'incompatible' } ],
				iconSet: [],
				widget: [],
			},
		} );
		loadPanel();
		const { host } = mount();

		const card = host.querySelector( '[data-odd-shop-card][data-catalog-slug="future-scene"]' );
		const btn  = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Incompatible' );
		expect( btn.disabled ).toBe( true );
	} );

	it( 'installed broken apps render a Repair button', async () => {
		seed( {
			appsEnabled: true,
			apps: [ { slug: 'board', name: 'Board', version: '1.0.0', broken: true } ],
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Apps' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const card = host.querySelector( '[data-odd-shop-card][data-slug="board"]' );
		const btn  = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Repair' );
		expect( btn.disabled ).toBe( false );
	} );

	it( 'installed rows with catalog updates render an Update button', async () => {
		seed( {
			appsEnabled: true,
			apps: [ { slug: 'board', name: 'Board', version: '1.0.0', update_available: true } ],
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Apps' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const card = host.querySelector( '[data-odd-shop-card][data-slug="board"]' );
		const btn  = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Update' );
		expect( btn.disabled ).toBe( false );
	} );

	it( 'catalog-only apps render from the embedded bundle catalog', async () => {
		seed( {
			appsEnabled: true,
			bundleCatalog: {
				scene: [],
				iconSet: [],
				cursorSet: [],
				widget: [],
				app: [ { slug: 'board', label: 'Board', type: 'app', version: '1.0.0', installed: false } ],
			},
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Apps' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const card = host.querySelector( '[data-odd-shop-card][data-slug="board"]' );
		expect( card, 'embedded app catalog row must render' ).toBeTruthy();
		expect( card.querySelector( '.odd-shop__card-btn' ).textContent.trim() ).toBe( 'Install' );
		expect( host.querySelector( '.odd-apps-empty' ) ).toBeNull();
	} );

	it( 'Apps catalog accepts the unified /bundles/catalog response shape', async () => {
		seed( { appsEnabled: true } );
		globalThis.fetch = vi.fn( ( url ) => Promise.resolve( {
			ok: true,
			json: () => Promise.resolve(
				/\/bundles\/catalog$/.test( url )
					? { bundles: [ { slug: 'flow', label: 'Flow', type: 'app', version: '1.0.0', installed: false } ] }
					: { apps: [] }
			),
		} ) );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Apps' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const card = host.querySelector( '[data-odd-shop-card][data-slug="flow"]' );
		expect( card, 'app row from bundles response must render' ).toBeTruthy();
		expect( card.querySelector( '.odd-shop__card-btn' ).textContent.trim() ).toBe( 'Install' );
		expect( host.querySelector( '.odd-apps-empty' ) ).toBeNull();
	} );

	it( 'installed inactive icon set renders a Preview button', () => {
		seed( {
			iconSet:   '',
			iconSets:  [
				{ slug: 'filament', label: 'Filament', franchise: 'Filament', accent: '#ff7a3c', icons: { dashboard: '', fallback: '' } },
			],
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Icon Sets' );

		const card = host.querySelector( '[data-odd-shop-card][data-set-slug="filament"]' );
		expect( card, 'icon-set tile must render' ).toBeTruthy();
		const btn = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Preview' );
	} );

	it( 'catalog-only icon set appears as the canonical Install card', () => {
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [ { slug: 'filament', label: 'Filament', franchise: 'Filament', installed: false } ],
				cursorSet: [],
				widget: [],
			},
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Icon Sets' );

		const cards = host.querySelectorAll( '[data-odd-shop-card][data-catalog-slug="filament"]' );
		expect( cards.length ).toBe( 1 );
		expect( cards[ 0 ].querySelector( '.odd-shop__card-btn' ).textContent.trim() ).toBe( 'Install' );
	} );

	it( 'catalog-only cursor set appears as the canonical Install card', () => {
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [],
				cursorSet: [ { slug: 'oddlings-cursors', label: 'Oddlings Cursors', franchise: 'ODD Originals', installed: false } ],
				widget: [],
			},
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Cursors' );

		const cards = host.querySelectorAll( '[data-odd-shop-card][data-catalog-slug="oddlings-cursors"]' );
		expect( cards.length ).toBe( 1 );
		expect( cards[ 0 ].querySelector( '.odd-shop__card-btn' ).textContent.trim() ).toBe( 'Install' );
		expect( host.querySelector( '.odd-shop__hero-btn' ) ).toBeNull();
	} );

	it( 'installed widget renders an Add button that calls widgetLayer.add', () => {
		const enabled = [];
		window.wp = window.wp || {};
		window.wp.desktop = window.wp.desktop || {};
		window.wp.desktop.widgetLayer = {
			add: ( id ) => { if ( ! enabled.includes( id ) ) enabled.push( id ); },
			remove: ( id ) => { const i = enabled.indexOf( id ); if ( i >= 0 ) enabled.splice( i, 1 ); },
			getEnabledIds: () => [ ...enabled ],
		};
		seed( {
			installedWidgets: [ { id: 'odd/sticky', slug: 'sticky', label: 'Sticky' } ],
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Widgets' );

		const card = host.querySelector( '[data-odd-shop-card][data-widget-id="odd/sticky"]' );
		expect( card, 'widget tile must render' ).toBeTruthy();
		const btn = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Add' );

		btn.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( enabled ).toContain( 'odd/sticky' );

		const after = host.querySelector( '[data-odd-shop-card][data-widget-id="odd/sticky"]' );
		expect( after.querySelector( '.odd-shop__card-btn' ).textContent.trim() ).toBe( 'Active' );
	} );

	it( 'catalog scene Install click fires the install-from-catalog POST', async () => {
		seed( {
			bundleCatalog: {
				scene: [ { slug: 'gusts', label: 'Gusts', installed: false } ],
				iconSet: [],
				widget: [],
			},
		} );
		loadPanel();

		globalThis.fetch = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( {
				installed: true,
				slug:      'gusts',
				type:      'scene',
				manifest:  { slug: 'gusts', label: 'Gusts' },
				entry_url: null,
				row:       { slug: 'gusts', label: 'Gusts', installed: true },
			} ),
		} ) );

		const { host } = mount();
		const card = host.querySelector( '[data-odd-shop-card][data-catalog-slug="gusts"]' );
		const btn  = card.querySelector( '.odd-shop__card-btn' );
		btn.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		expect( globalThis.fetch ).toHaveBeenCalled();
		const [ url, opts ] = globalThis.fetch.mock.calls[ 0 ];
		expect( url ).toContain( '/bundles/install-from-catalog' );
		expect( opts.method ).toBe( 'POST' );
		expect( JSON.parse( opts.body ) ).toEqual( { slug: 'gusts' } );
	} );
} );
