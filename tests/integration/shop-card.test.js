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
 *   type=scene/icon/cursor → "Apply" (card body still previews)
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
		expect( btn.textContent.trim() ).toBe( 'Installing…' );
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
		expect( card.querySelector( '.odd-shop__card-hint' )?.textContent ).toBe( 'Click card to preview' );
	} );

	it( 'scene Apply posts prefs directly while card body still previews', async () => {
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
		const button = card.querySelector( '.odd-shop__card-btn' );
		card.querySelector( '.odd-shop__card' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( host.querySelector( '[data-odd-preview-bar]' ) ).toBeTruthy();

		button.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
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
		expect( css ).toMatch( /\.odd-panel\.odd-shop \.odd-shop__card\.odd-card\.odd-shop__tile \.odd-shop__card-art\{[^}]*border-radius:22\.5%/ );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card--icon-set \.odd-shop__card-art > img\.odd-shop__card-art-fill\{[^}]*padding:12%[^}]*object-fit:contain/ );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card-art--quartet\{[^}]*padding:clamp\(18px,13%,28px\)[^}]*overflow:visible/ );
		expect( css ).toMatch( /\.odd-panel \.odd-shop__card-art--quartet \.odd-shop__card-quartet\{[^}]*width:100%[^}]*gap:clamp\(12px,12%,20px\)/ );
	} );

	it( 'catalog-only icon set appears as the canonical Install card', () => {
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [ { slug: 'filament', label: 'Filament', category: 'Filament', installed: false } ],
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
				{ slug: 'oddlings-cursors', label: 'Oddlings Cursors', category: 'ODD Originals', cursors: { default: { url: '/cursor.svg', hotspot: [ 1, 1 ] } } },
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
