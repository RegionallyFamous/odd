/**
 * installs.test.js — post-install flows for the ODD Shop.
 *
 * Installs update the Shop in place. Scenes and widgets hot-register
 * via dynamic `<script>` injection; icon sets and apps splice their
 * returned panel row into state. Reload is now an explicit fallback,
 * not the success path.
 *
 * Uses real timers + explicit micro-pause helpers — the install
 * chain is deeply nested promises (`fetch().then(r => r.json().then(...))`
 * → `handleInstallSuccess` → `setTimeout(reload, 500)`), and fake
 * timers need manual drains between every `.then` hop. The handful
 * of real-time sleeps here are smaller than the production reload
 * delay so tests still finish in well under a second.
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
	document.body.appendChild( host );
	const cleanup = window.desktopModeNativeWindows.odd( host );
	return { host, cleanup };
}

// Drain the microtask queue a few times so deeply-nested promise
// chains settle without having to await each level explicitly.
const flush = async () => {
	for ( let i = 0; i < 6; i++ ) await Promise.resolve();
};

const rail = ( host, label ) => Array.from( host.querySelectorAll( '.odd-shop__rail-item' ) )
	.find( ( b ) => b.querySelector( '.odd-shop__rail-label strong' )?.textContent.trim() === label );

describe( 'ODD Shop · install flows', () => {
	let reloadSpy;

	beforeEach( () => {
		document.body.innerHTML = '';
		const existing = document.getElementById( 'odd-panel-styles' );
		if ( existing ) existing.remove();
		delete window.desktopModeNativeWindows;
		try { window.sessionStorage.removeItem( 'odd.justInstalled' ); } catch ( e ) {}
		installHooks();

		reloadSpy = vi.fn();
		Object.defineProperty( window, 'location', {
			configurable: true,
			value: { ...window.location, reload: reloadSpy, href: 'http://localhost/' },
		} );
	} );

	afterEach( () => {
		delete globalThis.fetch;
	} );

	it( 'scene install hot-registers without reloading and adds the tile in-page', async () => {
		seed( {
			bundleCatalog: {
				scene: [ { slug: 'gusts', label: 'Gusts', installed: false } ],
				iconSet: [],
				widget: [],
			},
		} );

		globalThis.fetch = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( {
				installed: true,
				slug:      'gusts',
				type:      'scene',
				manifest:  { slug: 'gusts', label: 'Gusts' },
				entry_url: '/wp-content/odd-scenes/gusts/scene.js',
				row:       { slug: 'gusts', label: 'Gusts', installed: true },
			} ),
		} ) );

		loadPanel();
		const { host } = mount();

		const card = host.querySelector( '[data-odd-shop-card][data-catalog-slug="gusts"]' );
		card.querySelector( '.odd-shop__card-btn' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await flush();
		await new Promise( ( r ) => setTimeout( r, 10 ) );

		const scr = document.head.querySelector( 'script[data-odd-scene-slug="gusts"]' );
		expect( scr, 'scene entry <script> must be injected' ).toBeTruthy();
		expect( scr.getAttribute( 'src' ) ).toBe( '/wp-content/odd-scenes/gusts/scene.js' );

		scr.onload();
		await new Promise( ( r ) => setTimeout( r, 30 ) );

		const installedTile = host.querySelector( '[data-odd-shop-card][data-scene-slug="gusts"]' );
		expect( installedTile, 'hot-registered scene must appear in the grid' ).toBeTruthy();
		expect( reloadSpy ).not.toHaveBeenCalled();
		expect( window.sessionStorage.getItem( 'odd.justInstalled' ) ).toBeNull();
	} );

	it( 'icon-set install updates the grid without reloading', async () => {
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [ { slug: 'filament', label: 'Filament', installed: false } ],
				cursorSet: [],
				widget: [],
			},
		} );

		globalThis.fetch = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( {
				installed: true,
				slug:      'filament',
				type:      'icon-set',
				manifest:  { slug: 'filament', label: 'Filament' },
				entry_url: null,
				row:       { slug: 'filament', label: 'Filament', installed: true },
			} ),
		} ) );

		loadPanel();
		const { host } = mount();

		rail( host, 'Icon Sets' ).dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const card = host.querySelector( '[data-odd-shop-card][data-catalog-slug="filament"]' );
		expect( card, 'catalog icon-set tile must render' ).toBeTruthy();
		card.querySelector( '.odd-shop__card-btn' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await flush();
		await new Promise( ( r ) => setTimeout( r, 10 ) );

		const installedTile = host.querySelector( '[data-odd-shop-card][data-set-slug="filament"]' );
		expect( installedTile, 'installed icon set must appear in the grid' ).toBeTruthy();
		expect( installedTile.querySelector( '.odd-shop__card-btn' ).textContent.trim() ).toBe( 'Preview' );
		expect( reloadSpy ).not.toHaveBeenCalled();
		expect( window.sessionStorage.getItem( 'odd.justInstalled' ) ).toBeNull();
	} );

	it( 'cursor-set install updates the canonical card without reloading', async () => {
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [],
				cursorSet: [ { slug: 'oddlings-cursors', label: 'Oddlings Cursors', installed: false } ],
				widget: [],
			},
		} );

		globalThis.fetch = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( {
				installed: true,
				slug:      'oddlings-cursors',
				type:      'cursor-set',
				manifest:  { slug: 'oddlings-cursors', label: 'Oddlings Cursors' },
				entry_url: null,
				row:       { slug: 'oddlings-cursors', label: 'Oddlings Cursors', installed: true },
			} ),
		} ) );

		loadPanel();
		const { host } = mount();

		rail( host, 'Cursors' ).dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const card = host.querySelector( '[data-odd-shop-card][data-catalog-slug="oddlings-cursors"]' );
		expect( card, 'catalog cursor-set tile must render' ).toBeTruthy();
		card.querySelector( '.odd-shop__card-btn' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await flush();
		await new Promise( ( r ) => setTimeout( r, 10 ) );

		const installedTile = host.querySelector( '[data-odd-shop-card][data-cursor-set-slug="oddlings-cursors"]' );
		expect( installedTile, 'installed cursor set must appear in the grid' ).toBeTruthy();
		expect( installedTile.querySelector( '.odd-shop__card-btn' ).textContent.trim() ).toBe( 'Preview' );
		expect( reloadSpy ).not.toHaveBeenCalled();
		expect( window.sessionStorage.getItem( 'odd.justInstalled' ) ).toBeNull();
	} );

	it( 'widget install hot-registers without reloading and adds the tile in-page', async () => {
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [],
				cursorSet: [],
				widget: [ { slug: 'clock', label: 'Clock', installed: false } ],
			},
		} );

		globalThis.fetch = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( {
				installed: true,
				slug:      'clock',
				type:      'widget',
				manifest:  { slug: 'clock', label: 'Clock' },
				entry_url: '/wp-content/odd-widgets/clock/widget.js',
				row:       { id: 'odd/clock', slug: 'clock', label: 'Clock', installed: true },
			} ),
		} ) );

		loadPanel();
		const { host } = mount();

		rail( host, 'Widgets' ).dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const card = host.querySelector( '[data-odd-shop-card][data-catalog-slug="clock"]' );
		expect( card, 'catalog widget tile must render' ).toBeTruthy();
		card.querySelector( '.odd-shop__card-btn' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await flush();
		await new Promise( ( r ) => setTimeout( r, 5 ) );

		const scr = document.head.querySelector( 'script[data-odd-widget-slug="clock"]' );
		expect( scr, 'widget entry <script> must be injected' ).toBeTruthy();
		expect( scr.getAttribute( 'src' ) ).toBe( '/wp-content/odd-widgets/clock/widget.js' );

		scr.onload();
		await new Promise( ( r ) => setTimeout( r, 30 ) );

		const installedTile = host.querySelector( '[data-odd-shop-card][data-widget-id="odd/clock"]' );
		expect( installedTile, 'hot-registered widget must appear in the grid' ).toBeTruthy();
		expect( reloadSpy ).not.toHaveBeenCalled();
		// No reload → no breadcrumb.
		expect( window.sessionStorage.getItem( 'odd.justInstalled' ) ).toBeNull();
	} );

	it( 'widget hot-register failure schedules admin reload after success path', async () => {
		seed( {
			bundleCatalog: {
				scene: [],
				iconSet: [],
				widget: [ { slug: 'broken', label: 'Broken', installed: false } ],
			},
		} );

		globalThis.fetch = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( {
				installed: true,
				slug:      'broken',
				type:      'widget',
				manifest:  { slug: 'broken', label: 'Broken' },
				entry_url: '/wp-content/odd-widgets/broken/widget.js',
				row:       { id: 'odd/broken', slug: 'broken', label: 'Broken', installed: true },
			} ),
		} ) );

		loadPanel();
		const { host } = mount();

		rail( host, 'Widgets' ).dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		host.querySelector( '[data-odd-shop-card][data-catalog-slug="broken"] .odd-shop__card-btn' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await flush();
		await new Promise( ( r ) => setTimeout( r, 5 ) );

		const scr = document.head.querySelector( 'script[data-odd-widget-slug="broken"]' );
		scr.onerror();

		await flush();
		await new Promise( ( r ) => setTimeout( r, 20 ) );

		const installedTile = host.querySelector( '[data-odd-shop-card][data-widget-id="odd/broken"]' );
		expect( installedTile, 'failed hot-register still adds the installed tile' ).toBeTruthy();
		const btn = installedTile.querySelector( '.odd-shop__card-btn' );
		expect( btn.textContent.trim() ).toBe( 'Applying…' );
		expect( window.sessionStorage.getItem( 'odd.justInstalled' ) ).toBeTruthy();
		await new Promise( ( r ) => setTimeout( r, 450 ) );
		expect( reloadSpy ).toHaveBeenCalled();
	} );

	it( 'mount consumes a pre-existing breadcrumb and navigates to the right department', () => {
		window.sessionStorage.setItem( 'odd.justInstalled', JSON.stringify( {
			type: 'icon-set',
			slug: 'filament',
			name: 'Filament',
			at:   Date.now(),
		} ) );
		seed( {
			iconSets: [
				{ slug: 'filament', label: 'Filament', franchise: 'Filament', accent: '#ff7a3c', icons: { dashboard: '', fallback: '' } },
			],
		} );
		loadPanel();
		const { host } = mount();

		const iconsBtn = rail( host, 'Icon Sets' );
		expect( iconsBtn.classList.contains( 'is-active' ) ).toBe( true );

		expect( window.sessionStorage.getItem( 'odd.justInstalled' ) ).toBeNull();
	} );
} );
