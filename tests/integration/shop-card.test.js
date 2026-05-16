/**
 * shop-card.test.js — state machine for the unified Shop tile.
 *
 * Every department in the Shop (Wallpapers / Icons / Widgets / Apps)
 * renders a single `renderShopCard(row)` tile whose primary action
 * button derives its label from the durable item state:
 *
 *   incompatible?    → "Unavailable" (disabled)
 *   not installed?   → "Install"
 *   broken?          → "Repair"
 *   updateAvailable? → "Update"
 *   requiresReload?  → "Reload" (escape hatch; pending reload → "Working…")
 *   active?          → "Active" (disabled)
 *   type=scene/icon/cursor → "Apply"
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
const PANEL_JS = resolve( __dirname, '../../odd/src/panel/index.js' );
const PANEL_CSS = resolve( __dirname, '../../odd/src/panel/styles.css' );
const SHOP_FLOW_JS = resolve( __dirname, '../../odd/src/panel/shop-flow.js' );

function loadPanel() {
	const flowSrc = readFileSync( SHOP_FLOW_JS, 'utf8' );
	const flowFn = new Function( `${ flowSrc }\n//# sourceURL=panel/shop-flow.js` );
	flowFn.call( globalThis );
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

async function flush() {
	for ( let i = 0; i < 10; i++ ) await Promise.resolve();
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
						category:  'ODD Originals',
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

	it( 'shows the widget catalog grid directly without a featured strip', () => {
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [],
				cursorSet: [],
				widget: [
					{ slug: 'eight-ball', label: 'Magic 8-Ball', category: 'ODD Originals', featured: true, installed: false },
					{ slug: 'spotify-embed', label: 'Spotify Embed', category: 'ODD Originals', installed: false },
					{ slug: 'sticky-note', label: 'Sticky Note', category: 'ODD Originals', installed: false },
				],
				app: [],
			},
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Widgets' );

		expect( host.querySelector( '.odd-shop__editorial' ) ).toBeNull();
		expect( host.textContent ).not.toContain( 'Today at ODD' );
		expect( host.textContent ).not.toContain( 'Fresh from the weird shelf' );
		expect( Array.from( host.querySelectorAll( '[data-odd-shop-card][data-odd-card-type="widget"]' ) )
			.map( ( card ) => card.getAttribute( 'data-catalog-slug' ) ) ).toEqual( [
			'eight-ball',
			'spotify-embed',
			'sticky-note',
		] );
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
		expect( card.getAttribute( 'data-odd-card-state' ) ).toBe( 'available' );
		expect( card.getAttribute( 'data-odd-card-action' ) ).toBe( 'install' );
		expect( card.getAttribute( 'data-odd-trust' ) ).toBe( 'local-code' );
		expect( card.querySelector( '.odd-shop__card-trust' ) ).toBeNull();
		expect( card.querySelector( '.odd-shop__card-state' ) ).toBeNull();
		const body = card.querySelector( '.odd-shop__card' );
		const hiddenStatus = card.querySelector( '#odd-shop-card-gusts-status' );
		const hiddenTrust = card.querySelector( '#odd-shop-card-gusts-trust' );
		expect( hiddenStatus?.id ).toBe( 'odd-shop-card-gusts-status' );
		expect( hiddenStatus?.textContent.trim() ).toBe( 'Available' );
		expect( hiddenTrust?.classList.contains( 'odd-sr-only' ) ).toBe( true );
		expect( hiddenTrust?.textContent.trim() ).toBe( 'Runs locally' );
		expect( body.getAttribute( 'aria-describedby' ) ).toContain( hiddenStatus.id );
		expect( body.getAttribute( 'aria-describedby' ) ).toContain( hiddenTrust.id );
		expect( btn.getAttribute( 'aria-describedby' ) ).toContain( hiddenStatus.id );
		expect( btn.getAttribute( 'aria-label' ) ).toBe( 'Install Gusts - Available' );
		expect( btn.getAttribute( 'aria-pressed' ) ).toBeNull();
		expect( card.querySelector( '.odd-shop__card-badge' ) ).toBeNull();
		expect( card.querySelector( '.odd-shop__card-actions' ) ).toBeTruthy();
		expect( card.querySelector( '.odd-shop__card-actions .odd-shop__card-btn' ) ).toBe( btn );
		expect( card.querySelector( '.odd-shop__card-actions .odd-shop__quick-look' )?.textContent.trim() ).toBe( 'Details' );
		expect( card.querySelector( '.odd-shop__card-actions .odd-shop__quick-look' )?.getAttribute( 'aria-label' ) ).toBe( 'View details for Gusts' );
	} );

	it( 'catalog install enters an inline installing state immediately', async () => {
		let resolveInstall;
		seed( {
			bundleCatalog: {
				scene: [ { slug: 'gusts', label: 'Gusts', installed: false } ],
				iconSet: [],
				widget: [],
			},
		} );
		globalThis.fetch = vi.fn( () => new Promise( ( resolve ) => {
			resolveInstall = () => resolve( {
				ok:   true,
				json: () => Promise.resolve( {
					installed: true,
					slug:      'gusts',
					type:      'scene',
					manifest:  { slug: 'gusts', label: 'Gusts' },
					entry_url: null,
					row:       { slug: 'gusts', label: 'Gusts', installed: true },
				} ),
			} );
		} ) );
		loadPanel();
		const { host } = mount();

		host.querySelector( '[data-odd-shop-card][data-catalog-slug="gusts"] .odd-shop__card-btn' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const installingCard = host.querySelector( '[data-odd-shop-card][data-catalog-slug="gusts"]' );
		const btn = installingCard.querySelector( '.odd-shop__card-btn' );
		expect( installingCard.classList.contains( 'is-installing' ) ).toBe( true );
		expect( installingCard.getAttribute( 'data-odd-card-state' ) ).toBe( 'working' );
		expect( installingCard.querySelector( '.odd-shop__card-state' )?.textContent.trim() ).toBe( 'Working' );
		expect( btn.textContent.trim() ).toBe( 'Working…' );
		expect( btn.disabled ).toBe( true );
		expect( btn.getAttribute( 'aria-busy' ) ).toBe( 'true' );
		expect( btn.querySelector( '.odd-shop__btn-spinner' ) ).toBeTruthy();
		expect( host.querySelector( '.odd-shop__flow-toast' )?.textContent ).toContain( 'Installing Gusts' );

		resolveInstall();
		await flush();
	} );

	it( 'catalog-only scene is canonical and not duplicated by Discover', () => {
		seed( {
			bundleCatalog: {
				scene: [ { slug: 'gusts', label: 'Gusts', category: 'Atmosphere', featured: true, installed: false } ],
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

	it( 'catalog scene card art is derived from the scene preview asset', () => {
		seed( {
			bundleCatalog: {
				scene: [
					{
						slug:        'gusts',
						label:       'Gusts',
						category:   'Atmosphere',
						featured:    true,
						installed:   false,
						card_url:    'https://example.com/catalog/v1/cards/unrelated-art.webp',
						preview_url: 'https://example.com/catalog/v1/previews/scene-gusts.webp',
						wallpaper:   'https://example.com/catalog/v1/wallpapers/scene-gusts.webp',
					},
				],
				iconSet: [],
				cursorSet: [],
				widget: [],
			},
		} );
		loadPanel();
		const { host } = mount();

		const card = host.querySelector( '[data-odd-shop-card][data-catalog-slug="gusts"]' );
		expect( card, 'catalog scene tile must be rendered' ).toBeTruthy();
		const img = card.querySelector( '.odd-shop__card-art--scene img' );
		expect( img, 'scene catalog cards should render real scene artwork' ).toBeTruthy();
		expect( img.getAttribute( 'src' ) ).toBe( 'https://example.com/catalog/v1/previews/scene-gusts.webp' );
		expect( img.getAttribute( 'src' ) ).not.toBe( 'https://example.com/catalog/v1/cards/unrelated-art.webp' );
	} );

	it( 'installed inactive scene renders an Apply button', () => {
		seed( {
			wallpaper: 'gusts',
			scene:     'gusts',
			scenes: [
				{ slug: 'gusts',   label: 'Gusts',   category: 'Atmosphere', fallbackColor: '#333' },
				{ slug: 'terrazzo', label: 'Terrazzo', category: 'Forms',    fallbackColor: '#444' },
			],
		} );
		loadPanel();
		const { host } = mount();

		const card = host.querySelector( '[data-odd-shop-card][data-scene-slug="terrazzo"]' );
		expect( card, 'installed inactive scene must render a unified tile' ).toBeTruthy();
		const btn = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Apply' );
		expect( btn.disabled ).toBe( false );
		expect( card.getAttribute( 'data-odd-card-state' ) ).toBe( 'ready' );
		expect( card.getAttribute( 'data-odd-card-action' ) ).toBe( 'apply' );
		expect( card.getAttribute( 'data-odd-trust' ) ).toBe( 'local-code' );
		expect( card.querySelector( '.odd-shop__card-state' )?.textContent.trim() ).toBe( 'Ready' );
		expect( card.querySelector( '.odd-shop__card-trust' ) ).toBeNull();
		expect( card.querySelector( '#odd-shop-card-terrazzo-trust' )?.textContent.trim() ).toBe( 'Runs locally' );
		expect( card.querySelector( '.odd-shop__card-hint' ) ).toBeNull();
	} );

	it( 'scene Apply posts prefs directly without staging controls', async () => {
		const picked = [];
		window.wp.hooks.addAction( 'odd.pickScene', 'test', ( slug ) => picked.push( slug ) );
		globalThis.fetch = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( { wallpaper: 'terrazzo' } ),
		} ) );
		seed( {
			wallpaper: 'gusts',
			scene:     'gusts',
			scenes: [
				{ slug: 'gusts',   label: 'Gusts',   category: 'Atmosphere', fallbackColor: '#333' },
				{ slug: 'terrazzo', label: 'Terrazzo', category: 'Forms',    fallbackColor: '#444' },
			],
		} );
		loadPanel();
		const { host } = mount();

		const card = host.querySelector( '[data-odd-shop-card][data-scene-slug="terrazzo"]' );
		expect( host.querySelector( '[data-odd-preview-bar]' ) ).toBeNull();

		card.querySelector( '.odd-shop__card' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		await flush();

		expect( picked ).toContain( 'terrazzo' );
		expect( globalThis.fetch ).toHaveBeenCalledWith(
			'/wp-json/odd/v1/prefs',
			expect.objectContaining( {
				method: 'POST',
				body:   JSON.stringify( { wallpaper: 'terrazzo' } ),
			} )
		);
		expect( host.querySelector( '.odd-shop__flow-toast' )?.textContent ).toContain( 'Applied Terrazzo' );
		expect( host.querySelector( '.odd-shop__flow-toast-action' )?.textContent.trim() ).toBe( 'Undo' );
		expect( host.querySelector( '[data-odd-preview-bar]' ) ).toBeNull();
	} );

	it( 'active scene remains disabled while inactive scenes stay directly applicable', async () => {
		globalThis.fetch = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( { wallpaper: 'terrazzo' } ),
		} ) );
		seed( {
			wallpaper: 'gusts',
			scene:     'gusts',
			scenes: [
				{ slug: 'gusts',   label: 'Gusts',   category: 'Atmosphere', fallbackColor: '#333' },
				{ slug: 'terrazzo', label: 'Terrazzo', category: 'Forms',    fallbackColor: '#444' },
			],
		} );
		loadPanel();
		const { host } = mount();

		const activeCard = host.querySelector( '[data-odd-shop-card][data-scene-slug="gusts"]' );
		const activeBtn = activeCard.querySelector( '.odd-shop__card-btn' );
		expect( activeBtn.textContent.trim() ).toBe( 'Active' );
		expect( activeBtn.disabled ).toBe( true );
		expect( activeBtn.getAttribute( 'data-odd-card-action' ) ).toBe( 'active' );
		expect( activeCard.getAttribute( 'data-odd-card-action' ) ).toBe( 'active' );
		expect( activeCard.getAttribute( 'data-odd-card-state' ) ).toBe( 'active' );

		const inactiveBtn = host.querySelector( '[data-odd-shop-card][data-scene-slug="terrazzo"] .odd-shop__card-btn' );
		expect( inactiveBtn.textContent.trim() ).toBe( 'Apply' );
		inactiveBtn.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		await flush();

		expect( globalThis.fetch ).toHaveBeenCalledWith(
			'/wp-json/odd/v1/prefs',
			expect.objectContaining( {
				method: 'POST',
				body:   JSON.stringify( { wallpaper: 'terrazzo' } ),
			} )
		);
	} );

	it( 'active scene renders a disabled Active button', () => {
		seed( {
			wallpaper: 'gusts',
			scene:     'gusts',
			scenes: [
				{ slug: 'gusts', label: 'Gusts', category: 'Atmosphere', fallbackColor: '#333' },
			],
		} );
		loadPanel();
		const { host } = mount();

		const card = host.querySelector( '[data-odd-shop-card][data-scene-slug="gusts"]' );
		const btn  = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Active' );
		expect( btn.disabled ).toBe( true );
		expect( btn.getAttribute( 'aria-disabled' ) ).toBe( 'true' );
		expect( btn.getAttribute( 'aria-pressed' ) ).toBeNull();
		expect( card.classList.contains( 'is-active' ) ).toBe( true );
		expect( card.getAttribute( 'data-odd-card-state' ) ).toBe( 'active' );
		expect( card.querySelector( '.odd-shop__card-state' )?.textContent.trim() ).toBe( 'Active' );
	} );

	it( 'keeps scene cards in place when activation changes', async () => {
		globalThis.fetch = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( { wallpaper: 'mango' } ),
		} ) );
		seed( {
			wallpaper: 'zeta',
			scene:     'zeta',
			scenes: [
				{ slug: 'zeta',  label: 'Zeta',  category: 'Atmosphere', fallbackColor: '#333' },
				{ slug: 'alpha', label: 'Alpha', category: 'Atmosphere', fallbackColor: '#444' },
				{ slug: 'mango', label: 'Mango', category: 'Atmosphere', fallbackColor: '#555' },
			],
		} );
		loadPanel();
		const { host } = mount();
		const orderedSlugs = () => Array.from( host.querySelectorAll( '[data-odd-shop-card][data-scene-slug]' ) )
			.map( ( card ) => card.getAttribute( 'data-scene-slug' ) );

		expect( orderedSlugs() ).toEqual( [ 'alpha', 'mango', 'zeta' ] );

		host.querySelector( '[data-odd-shop-card][data-scene-slug="mango"] .odd-shop__card' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		await flush();

		expect( orderedSlugs() ).toEqual( [ 'alpha', 'mango', 'zeta' ] );
		expect( host.querySelector( '[data-odd-shop-card][data-scene-slug="mango"]' ).getAttribute( 'data-odd-card-state' ) ).toBe( 'active' );
		expect( host.querySelector( '[data-odd-shop-card][data-scene-slug="zeta"]' ).getAttribute( 'data-odd-card-state' ) ).toBe( 'ready' );
	} );

	it( 'incompatible catalog rows render a disabled Unavailable button', () => {
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
		expect( btn.textContent.trim() ).toBe( 'Unavailable' );
		expect( btn.disabled ).toBe( true );
		expect( btn.getAttribute( 'aria-disabled' ) ).toBe( 'true' );
		expect( card.getAttribute( 'data-odd-card-state' ) ).toBe( 'blocked' );
		expect( card.querySelector( '.odd-shop__card-state' )?.textContent.trim() ).toBe( 'Unavailable' );
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
		expect( card.getAttribute( 'data-odd-card-state' ) ).toBe( 'attention' );
		expect( card.querySelector( '.odd-shop__card-state' )?.textContent.trim() ).toBe( 'Needs attention' );
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
		expect( card.getAttribute( 'data-odd-card-state' ) ).toBe( 'attention' );
		expect( card.querySelector( '.odd-shop__card-state' )?.textContent.trim() ).toBe( 'Needs attention' );
		expect( card.querySelectorAll( '.odd-shop__card-btn' ) ).toHaveLength( 1 );
	} );

	it( 'installed rows with catalog updates enter an updating state immediately', async () => {
		seed( {
			appsEnabled: true,
			apps: [ { slug: 'board', name: 'Board', version: '1.0.0', update_available: true } ],
		} );
		globalThis.fetch = vi.fn( ( url, opts = {} ) => {
			if ( opts.method === 'POST' && /\/bundles\/install-from-catalog$/.test( String( url ) ) ) {
				// Keep the update in flight; this spec only cares about
				// the immediate card transition.
				return new Promise( () => {} );
			}
			return Promise.resolve( {
				ok:   true,
				json: () => Promise.resolve( { apps: [] } ),
			} );
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Apps' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		host.querySelector( '[data-odd-shop-card][data-slug="board"] .odd-shop__card-btn' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		await flush();
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const card = host.querySelector( '[data-odd-shop-card][data-slug="board"]' );
		const btn = card.querySelector( '.odd-shop__card-btn' );
		expect( card.getAttribute( 'data-odd-card-state' ) ).toBe( 'working' );
		expect( card.querySelector( '.odd-shop__card-state' )?.textContent.trim() ).toBe( 'Working' );
		expect( btn.textContent.trim() ).toBe( 'Working…' );
		expect( host.querySelector( '.odd-shop__flow-toast' )?.textContent ).toContain( 'Updating Board' );
	} );

	it( 'catalog-only apps render from the embedded bundle catalog', async () => {
		seed( {
			appsEnabled: true,
			bundleCatalog: {
				scene: [],
				iconSet: [],
				cursorSet: [],
				widget: [],
				app: [
					{
						slug:      'board',
						label:     'Board',
						type:      'app',
						version:   '1.0.0',
						installed: false,
						card_url:  'https://example.com/catalog/v1/cards/app-board.webp',
						icon_url:  'https://example.com/catalog/v1/icons/board.svg',
					},
				],
			},
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Apps' );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		const card = host.querySelector( '[data-odd-shop-card][data-slug="board"]' );
		expect( card, 'embedded app catalog row must render' ).toBeTruthy();
		const img = card.querySelector( '.odd-shop__card-art--app img.odd-shop__card-art-fill' );
		expect( img, 'catalog app cards should render generated card_url art' ).toBeTruthy();
		expect( img.getAttribute( 'src' ) ).toBe( 'https://example.com/catalog/v1/cards/app-board.webp' );
		expect( card.querySelector( 'img[src="https://example.com/catalog/v1/icons/board.svg"]' ) ).toBeNull();
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

	it( 'installed inactive icon set renders an Apply button', () => {
		seed( {
			iconSet:   '',
			iconSets:  [
				{ slug: 'filament', label: 'Filament', category: 'Filament', accent: '#ff7a3c', icons: { dashboard: '', fallback: '' } },
			],
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Icon Sets' );

		const card = host.querySelector( '[data-odd-shop-card][data-set-slug="filament"]' );
		expect( card, 'icon-set tile must render' ).toBeTruthy();
		const btn = card.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Apply' );
		expect( card.getAttribute( 'data-odd-trust' ) ).toBe( 'static-images' );
		expect( card.querySelector( '.odd-shop__card-trust' ) ).toBeNull();
		const hiddenTrust = card.querySelector( '#odd-shop-card-filament-trust' );
		expect( hiddenTrust?.classList.contains( 'odd-sr-only' ) ).toBe( true );
		expect( hiddenTrust?.textContent.trim() ).toBe( 'Static images' );
	} );

	it( 'icon department renders catalog cards without the costume hero or stock reset strip', () => {
		seed( {
			iconSet:  'filament',
			iconSets: [
				{ slug: 'filament', label: 'Filament', category: 'Filament', accent: '#ff7a3c', icons: { dashboard: '', fallback: '' } },
			],
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Icon Sets' );

		expect( host.querySelector( '.odd-shop__hero--icons' ) ).toBeNull();
		expect( host.querySelector( '.odd-shop__reset-row' ) ).toBeNull();
		expect( host.textContent ).not.toContain( 'Current costume' );
		expect( host.textContent ).not.toContain( 'Featured costume' );
		expect( host.textContent ).not.toContain( 'Wearing it' );
		expect( host.textContent ).not.toContain( 'Missing the stock WordPress icon wardrobe?' );
		expect( host.textContent ).not.toContain( 'Reset to default' );
		expect( host.querySelector( '[data-odd-shop-card][data-set-slug="filament"]' ) ).toBeTruthy();
	} );

	it( 'installed icon set card prefers live quartet art over catalog splash art', () => {
		seed( {
			iconSet:   '',
			iconSets:  [
				{
						slug: 'odd-default-icons',
						label: 'ODD Default',
						card_url: 'https://example.test/catalog-card.webp',
						icons: {
						dashboard: 'https://example.test/dashboard.webp',
						posts:     'https://example.test/posts.webp',
						pages:     'https://example.test/pages.webp',
						media:     'https://example.test/media.webp',
					},
				},
			],
			bundleCatalog: {
				scene: [],
				iconSet: [
					{
							slug: 'odd-default-icons',
							label: 'ODD Default',
							card_url: 'https://example.test/catalog-card.webp',
							installed: true,
					},
				],
				cursorSet: [],
				widget: [],
				app: [],
			},
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Icon Sets' );

		const card = host.querySelector( '[data-odd-shop-card][data-set-slug="odd-default-icons"]' );
			expect( card, 'icon-set tile must render' ).toBeTruthy();
			const art = card.querySelector( '.odd-shop__card-art--icon-set' );
			expect( art.hasAttribute( 'data-odd-fun-layer' ) ).toBe( false );
			expect( art.querySelector( '.odd-shop__icon-fun-layer' ) ).toBeNull();
			expect( art.classList.contains( 'odd-shop__card-art--quartet' ) ).toBe( true );
		const quartetIcons = Array.from( card.querySelectorAll( '.odd-shop__card-quartet img' ) );
		expect( quartetIcons ).toHaveLength( 4 );
		expect( quartetIcons.map( ( img ) => img.getAttribute( 'src' ) ) ).toEqual( [
			'https://example.test/dashboard.webp',
			'https://example.test/posts.webp',
			'https://example.test/pages.webp',
			'https://example.test/media.webp',
		] );
		expect( card.querySelector( 'img[src="https://example.test/catalog-card.webp"]' ) ).toBeNull();
	} );

	it( 'icon set card art CSS gives live quartets breathing room instead of cover-cropping', () => {
		const css = readFileSync( PANEL_CSS, 'utf8' );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card--app \.odd-shop__card-art > img:not\(\.odd-shop__card-art-fill\)\{[^}]*padding:10%[^}]*object-fit:contain/ );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card--app \.odd-shop__card-art > img\.odd-shop__card-art-fill\{[^}]*padding:0[^}]*object-fit:cover/ );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card-art\{[^}]*border-radius:0/ );
		expect( css ).toMatch( /\.odd-panel\.odd-shop \.odd-shop__card\.odd-card\.odd-shop__tile \.odd-shop__card-art\{[^}]*border-radius:0/ );
		expect( css ).not.toContain( 'border-radius:22.5%' );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card--icon-set \.odd-shop__card-art > img\.odd-shop__card-art-fill\{[^}]*padding:0[^}]*object-fit:cover/ );
		expect( css ).not.toContain( 'data-odd-fun-layer' );
		expect( css ).not.toContain( 'odd-shop__icon-fun-layer' );
		expect( css ).not.toContain( 'odd-icon-card-jitter' );
		expect( css ).not.toContain( '--odd-icon-layer-motion' );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card-art--quartet\{[^}]*padding:clamp\(10px,8%,18px\)[^}]*overflow:visible/ );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card-art--quartet \.odd-shop__card-quartet\{[^}]*width:100%[^}]*gap:clamp\(8px,8%,14px\)/ );
		expect( css ).toMatch( /\.odd-panel\.odd-shop \.odd-shop__shelf\{[^}]*content-visibility:auto/ );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card-wrap\{[^}]*content-visibility:auto/ );
	} );

	it( 'shop card CSS keeps catalog text and keyboard affordances accessible', () => {
		const css = readFileSync( PANEL_CSS, 'utf8' );
		expect( css ).toContain( '--odd-shop-focus-ring:#005fcc' );
		expect( css ).toContain( '--odd-shop-muted-strong:#3f3f46' );
		expect( css ).toContain( '.odd-panel .odd-sr-only' );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card-state\{[^}]*font:800 11px\/1\.25[^}]*color:#333336/ );
		expect( css ).not.toContain( '.odd-shop__card-trust' );
		expect( css ).toMatch( /\.odd-panel\.odd-shop \.odd-shop__card-btn\{[^}]*justify-self:start[^}]*min-width:88px[^}]*text-align:center[^}]*user-select:none/ );
		expect( css ).toMatch( /\.odd-panel\.odd-shop \.odd-shop__quick-look\{[^}]*text-align:center[^}]*user-select:none/ );
		expect( css ).toMatch( /\.odd-panel\.odd-shop \.odd-shop__card-btn--active,\.odd-panel\.odd-shop \.odd-shop__card-btn\.is-disabled\{[^}]*color:#3f3f46/ );
		expect( css ).toContain( '.odd-panel .odd-shop__card-fav:focus-visible' );
		expect( css ).toMatch( /\.odd-panel\.odd-shop \.odd-shop__card-btn:focus-visible,[^{}]*\.odd-panel\.odd-shop \.odd-shop__card-fav:focus-visible\{[^}]*outline:3px solid var\(--odd-shop-focus-ring\)/ );
	} );

	it( 'catalog-only icon set appears as the canonical Install card', () => {
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [
					{
						slug: 'filament',
						label: 'Filament',
						category: 'Filament',
						card_url: 'https://example.test/cards/iconset-filament.webp',
						icon_url: 'https://example.test/icons/iconset-filament.webp',
						installed: false,
					},
				],
				cursorSet: [],
				widget: [],
			},
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Icon Sets' );

		const cards = host.querySelectorAll( '[data-odd-shop-card][data-catalog-slug="filament"]' );
		expect( cards.length ).toBe( 1 );
		expect( cards[ 0 ].querySelector( '.odd-shop__card-art--icon-set img.odd-shop__card-art-fill' ).getAttribute( 'src' ) )
			.toBe( 'https://example.test/cards/iconset-filament.webp' );
		expect( cards[ 0 ].querySelector( '.odd-shop__card-btn' ).textContent.trim() ).toBe( 'Install' );
	} );

	it( 'catalog-only cursor set appears as the canonical Install card', () => {
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [],
				cursorSet: [ { slug: 'oddlings-cursors', label: 'Oddlings Cursors', category: 'ODD Originals', installed: false } ],
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

	it( 'installed inactive cursor set renders an Apply button', () => {
		seed( {
			cursorSet: '',
			cursorSets: [
				{ slug: 'oddlings-cursors', label: 'Oddlings Cursors', category: 'ODD Originals', effects: { accent: '#38e8ff' }, cursors: {} },
			],
		} );
		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Cursors' );

		const card = host.querySelector( '[data-odd-shop-card][data-cursor-set-slug="oddlings-cursors"]' );
		expect( card, 'cursor-set tile must render' ).toBeTruthy();
		expect( card.querySelector( '.odd-shop__card-btn' ).textContent.trim() ).toBe( 'Apply' );
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

	it( 'catalog install falls back to browser download and bundle upload after a server download 502', async () => {
		const downloadUrl = 'https://example.com/catalog/v1/bundles/iconset-filament.wp';
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [
					{
						slug:         'filament',
						label:        'Filament',
						installed:    false,
						download_url: downloadUrl,
					},
				],
				cursorSet: [],
				widget: [],
			},
		} );

		const bundleBlob = new Blob( [ 'bundle bytes' ], { type: 'application/octet-stream' } );
		globalThis.fetch = vi.fn( ( url, opts = {} ) => {
			const href = String( url );
			if ( opts.method === 'POST' && /\/bundles\/install-from-catalog$/.test( href ) ) {
				return Promise.resolve( {
					ok:     false,
					status: 502,
					json:   () => Promise.resolve( {
						code:    'download_failed',
						message: 'Could not download bundle.',
						data:    { status: 502 },
					} ),
				} );
			}
			if ( href === downloadUrl ) {
				return Promise.resolve( {
					ok:     true,
					status: 200,
					blob:   () => Promise.resolve( bundleBlob ),
				} );
			}
			if ( opts.method === 'POST' && /\/bundles\/upload$/.test( href ) ) {
				return Promise.resolve( {
					ok:     true,
					status: 200,
					json:   () => Promise.resolve( {
						installed: true,
						slug:      'filament',
						type:      'icon-set',
						manifest:  { slug: 'filament', label: 'Filament' },
						row:       { slug: 'filament', label: 'Filament', installed: true },
					} ),
				} );
			}
			return Promise.resolve( {
				ok:   true,
				json: () => Promise.resolve( {} ),
			} );
		} );

		loadPanel();
		const { host } = mount();
		goToDepartment( host, 'Icon Sets' );

		const card = host.querySelector( '[data-odd-shop-card][data-catalog-slug="filament"]' );
		card.querySelector( '.odd-shop__card-btn' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await flush();
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await flush();

		const installCall = globalThis.fetch.mock.calls.find( ( [ url, opts = {} ] ) => (
			opts.method === 'POST' && /\/bundles\/install-from-catalog$/.test( String( url ) )
		) );
		const downloadCall = globalThis.fetch.mock.calls.find( ( [ url, opts = {} ] ) => (
			String( url ) === downloadUrl && ! opts.method
		) );
		const uploadCall = globalThis.fetch.mock.calls.find( ( [ url, opts = {} ] ) => (
			opts.method === 'POST' && /\/bundles\/upload$/.test( String( url ) )
		) );
		expect( installCall ).toBeTruthy();
		expect( downloadCall ).toBeTruthy();
		expect( uploadCall ).toBeTruthy();
		expect( uploadCall[ 1 ].body.get( 'file' ).name ).toBe( 'iconset-filament.wp' );
		expect( host.querySelector( '[data-odd-shop-card][data-set-slug="filament"]' ) ).toBeTruthy();
	} );
} );
