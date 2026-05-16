/**
 * panel.test.js — smoke-test the ODD Shop render pipeline.
 *
 * Loads odd/src/panel/index.js, which registers a render callback on
 * Desktop Mode's native-window global. We invoke that callback against
 * a detached host element with a stubbed `window.odd` config and
 * stubbed global.fetch, then exercise the critical paths:
 *
 *   - Rail lists the expected departments (Wallpapers, Icon Sets,
 *     Widgets, About).
 *   - Wallpaper department renders category shelves + scene cards.
 *   - Clicking an inactive scene card applies it directly.
 *   - Widgets department renders a widget shelf with Add/Remove buttons
 *     wired to `wp.desktop.widgetLayer`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const PANEL_JS = resolve( __dirname, '../../odd/src/panel/index.js' );
const SHOP_FLOW_JS = resolve( __dirname, '../../odd/src/panel/shop-flow.js' );
const WORKSPACE_JS = resolve( __dirname, '../../odd/src/shared/workspace.js' );

function seedConfig() {
	window.odd = {
		pluginUrl: '',
		version:   'test',
		restUrl:   '/wp-json/odd/v1/prefs',
		restNonce: 'nonce-abc',
		bundlesUploadUrl: '/wp-json/odd/v1/bundles/upload',
		bundleCatalogUrl: '/wp-json/odd/v1/bundles/catalog',
		canInstall:       true,
		// Widgets are installed as catalog bundles and the
		// panel renders whatever the server reports in this list.
		// The two stock widgets live at `_tools/catalog-sources/
		// widgets/{sticky,eight-ball}/` — seed them here so the
		// Widgets-department test has cards to click.
		installedWidgets: [
			{ id: 'odd/sticky',     slug: 'sticky',     label: 'Sticky Note',    description: 'Tilted handwritten note that auto-saves.' },
			{ id: 'odd/eight-ball', slug: 'eight-ball', label: 'Magic 8-Ball',   description: 'Shake for definitive-ish WordPress advice.' },
		],
		wallpaper: 'flux',
		scene:     'flux',
		// Three slugs, three distinct categories: flux→Forms,
		// aurora→Skies, circuit-garden→Wilds. Lets us assert the
		// shelf grouping without depending on the per-category
		// labels that no longer drive layout.
		scenes: [
			{ slug: 'flux',           label: 'Flux',           category: 'Generative',    tags: [], fallbackColor: '#222233' },
			{ slug: 'aurora',         label: 'Aurora',         category: 'Atmosphere',    tags: [], fallbackColor: '#112233' },
			{ slug: 'circuit-garden', label: 'Circuit Garden', category: 'ODD Originals', tags: [], fallbackColor: '#0b1a10' },
		],
		theme: 'auto',
		chaosMode: false,
		sets: [
			{ slug: 'filament', label: 'Filament', category: 'Filament', accent: '#ff7a3c', icons: { odd: '', 'my-wordpress': '', fallback: '' } },
		],
		iconSet:     '',
		favorites:   [],
		recents:     [],
		shuffle:     { enabled: false, minutes: 15 },
		screensaver: { enabled: false, minutes: 10, scene: 'current' },
		audioReactive: false,
		appsEnabled: false,
		apps:        [],
		userApps:    { installed: [], pinned: [] },
		systemHealth: {
			catalog: {
				source: 'fallback_file',
				bundle_count: 12,
				raw_bundle_count: 14,
				effective_bundle_count: 12,
				signature_status: 'missing',
				registry_sha256: 'abcdef1234567890',
				registry_bytes: 2048,
				last_error_message: 'offline',
			},
			starter: { status: 'partial' },
			apps: { installed: 2 },
		},
	};
}

function installHooks() {
	const handlers = new Map();
	window.wp = window.wp || {};
	window.wp.hooks = {
		doAction: ( name, ...args ) => {
			( handlers.get( name ) || [] ).forEach( ( h ) => h( ...args ) );
		},
		addAction: ( name, _ns, fn ) => {
			if ( ! handlers.has( name ) ) handlers.set( name, [] );
			handlers.get( name ).push( fn );
		},
		removeAction: () => {},
		applyFilters: ( _name, value ) => value,
	};
}

function installWidgetLayer() {
	const calls = { add: [], remove: [] };
	let enabled = [];
	window.wp = window.wp || {};
	window.wp.desktop = window.wp.desktop || {};
	window.wp.desktop.widgetLayer = {
		add: ( id ) => { calls.add.push( id ); if ( ! enabled.includes( id ) ) enabled.push( id ); },
		remove: ( id ) => { calls.remove.push( id ); enabled = enabled.filter( ( x ) => x !== id ); },
		getEnabledIds: () => [ ...enabled ],
		__setEnabled: ( ids ) => { enabled = ids.slice(); },
	};
	return calls;
}

function loadPanel() {
	const flowSrc = readFileSync( SHOP_FLOW_JS, 'utf8' );
	const flowFn = new Function( `${ flowSrc }\n//# sourceURL=panel/shop-flow.js` );
	flowFn.call( globalThis );
	const src = readFileSync( PANEL_JS, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=panel/index.js` );
	fn.call( globalThis );
}

function loadWorkspace() {
	const src = readFileSync( WORKSPACE_JS, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=shared/workspace.js` );
	fn.call( globalThis );
}

function mountPanel( options = {} ) {
	const width = typeof options.width === 'number' ? options.width : 900;
	const host = document.createElement( 'div' );
	host.style.width = `${ width }px`;
	host.style.height = '600px';
	host.getBoundingClientRect = () => ( {
		width,
		height: 600,
		top: 0,
		left: 0,
		right: width,
		bottom: 600,
		x: 0,
		y: 0,
		toJSON: () => {},
	} );
	document.body.appendChild( host );
	const cleanup = window.desktopModeNativeWindows.odd( host );
	return { host, cleanup };
}

function setViewportWidth( width ) {
	Object.defineProperty( window, 'innerWidth', { configurable: true, value: width } );
}

describe( 'ODD Shop', () => {
	let fetchMock;

	beforeEach( () => {
		document.body.innerHTML = '';
		const existing = document.getElementById( 'odd-panel-styles' );
		if ( existing ) existing.remove();
		delete window.__odd;
		delete window.desktopModeNativeWindows;
		delete window.WebGLRenderingContext;
		if ( window.wp && window.wp.desktop ) delete window.wp.desktop.widgetLayer;
		try { window.localStorage.removeItem( 'desktop-mode-widgets' ); } catch ( e ) {}
		seedConfig();
		installHooks();

		fetchMock = vi.fn( () => Promise.resolve( {
			ok:   true,
			json: () => Promise.resolve( { wallpaper: 'aurora' } ),
		} ) );
		globalThis.fetch = fetchMock;

		loadWorkspace();
		loadPanel();
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		delete globalThis.fetch;
		delete window.__odd;
		delete window.WebGLRenderingContext;
		document.body.classList.remove( 'desktop-mode-has-fullscreen-window' );
	} );

	it( 'registers a render callback under Desktop Mode native-window globals', () => {
		expect( typeof window.desktopModeNativeWindows.odd ).toBe( 'function' );
	} );

	it( 'renders the department rail + shelf-grouped scene grid', () => {
		const { host, cleanup } = mountPanel();

		// Each rail button carries its store label inside a dedicated
		// node; scan `.odd-shop__rail-label strong` rather than the whole
		// button text (which also contains the glyph + tagline).
		const railLabels = Array.from( host.querySelectorAll( '.odd-shop__rail-label strong' ) )
			.map( ( n ) => n.textContent.trim() );
		expect( railLabels ).toEqual( expect.arrayContaining( [ 'Wallpapers', 'Icon Sets', 'Widgets', 'About' ] ) );
		const railGroups = Array.from( host.querySelectorAll( '.odd-shop__rail-group-heading' ) )
			.map( ( n ) => n.textContent.trim() );
		expect( railGroups ).toEqual( [ 'Decorate', 'Do more', 'You' ] );

		// Wallpapers department groups scenes by category; with
		// three slugs that map to three distinct categories
		// (Forms / Skies / Wilds), we should see three shelves.
		const shelves = host.querySelectorAll( '.odd-shop__shelf' );
		expect( shelves.length ).toBe( 3 );

		const cards = host.querySelectorAll( '.odd-card[data-slug]' );
		expect( cards.length ).toBe( 3 );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'keeps the Shop rail native, vertical, and keyboard navigable', () => {
		const { host, cleanup } = mountPanel();
		const rail = host.querySelector( '.odd-shop__rail' );
		const items = Array.from( host.querySelectorAll( '.odd-shop__rail-item' ) );

		expect( rail ).toBeTruthy();
		expect( rail.getAttribute( 'role' ) ).toBe( 'navigation' );
		expect( rail.getAttribute( 'aria-label' ) ).toBe( 'Store sections' );
		expect( host.querySelector( '.odd-shop__rail-scroll' ) ).toBeNull();
		expect( host.querySelector( '.odd-shop__rail-fade' ) ).toBeNull();
		expect( items.length ).toBeGreaterThan( 2 );
		expect( items[ 0 ].getAttribute( 'title' ) ).toBe( 'Wallpapers - Living desktop weather' );
		expect( items[ 0 ].getAttribute( 'aria-label' ) ).toBe( 'Wallpapers - Living desktop weather' );
		expect( document.body.querySelector( '.odd-shop__rail-tooltip-popover' ) ).toBeTruthy();

		items[ 0 ].focus();
		items[ 0 ].dispatchEvent( new KeyboardEvent( 'keydown', { key: 'ArrowDown', bubbles: true, cancelable: true } ) );
		expect( document.activeElement ).toBe( items[ 1 ] );

		items[ 1 ].dispatchEvent( new KeyboardEvent( 'keydown', { key: 'ArrowUp', bubbles: true, cancelable: true } ) );
		expect( document.activeElement ).toBe( items[ 0 ] );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'renders store controls and filters rows without changing departments', () => {
		const { host, cleanup } = mountPanel();

		const storebar = host.querySelector( '[data-odd-storebar]' );
		expect( storebar ).toBeTruthy();
		expect( storebar.textContent ).toContain( '3 wallpapers' );
		expect( storebar.textContent ).toContain( '3 installed' );
		const css = readFileSync( resolve( __dirname, '../../odd/src/panel/styles.css' ), 'utf8' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__storebar{position:relative;display:grid;grid-template-columns:minmax(0,1fr);align-items:stretch;gap:10px;box-sizing:border-box;width:100%;max-width:none;' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__store-views{display:flex;align-items:center;width:100%;max-width:none;' );

		const available = host.querySelector( '[data-odd-store-view="available"]' );
		available.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( host.querySelector( '[data-odd-store-view="available"]' ).classList.contains( 'is-active' ) ).toBe( true );
		expect( host.querySelectorAll( '.odd-card[data-slug]' ).length ).toBe( 0 );
		expect( host.querySelector( '.odd-shop__empty' ).textContent ).toContain( 'No scenes' );

		const clear = host.querySelector( '.odd-shop__clear-filters' );
		clear.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( host.querySelectorAll( '.odd-card[data-slug]' ).length ).toBe( 3 );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'surfaces catalog trouble near browsing shelves', () => {
		const { host, cleanup } = mountPanel();

		const notice = host.querySelector( '.odd-shop__catalog-notice' );
		expect( notice ).toBeTruthy();
		expect( notice.textContent ).toContain( 'Catalog signature needs attention' );
		expect( notice.textContent ).toContain( 'Missing signature' );
		expect( notice.querySelectorAll( 'button' ).length ).toBeGreaterThanOrEqual( 2 );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'opens a Quick Look product sheet without applying decor', () => {
		const { host, cleanup } = mountPanel();
		const quick = host.querySelector( '[data-odd-shop-card][data-scene-slug="flux"] .odd-shop__quick-look' );
		expect( quick ).toBeTruthy();

		quick.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const sheet = host.querySelector( '.odd-shop__detail-sheet' );
		expect( sheet ).toBeTruthy();
		expect( sheet.querySelector( '.odd-shop__detail-title' ).textContent.trim() ).toBe( 'Flux' );
		expect( sheet.textContent ).toContain( 'What changes' );
		expect( sheet.textContent ).not.toContain( 'Preview first' );
		expect( fetchMock ).not.toHaveBeenCalled();

		sheet.querySelector( '.odd-shop__detail-secondary' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( host.querySelector( '.odd-shop__detail-sheet' ) ).toBeNull();

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'selects icon sets without patching live Desktop Mode DOM', async () => {
		document.body.innerHTML = [
			'<div class="desktop-mode-dock__item" data-menu-slug="menu-posts">',
			'  <button class="desktop-mode-dock__item-primary">',
			'    <img class="desktop-mode-dock__item-img" src="dock-native.png" alt="">',
			'  </button>',
			'</div>',
			'<button class="desktop-mode-icon" data-icon-id="posts">',
			'  <span class="desktop-mode-icon__image"><img src="posts-native.png" alt=""></span>',
			'</button>',
			'<button class="desktop-mode-icon" data-icon-id="odd">',
			'  <span class="desktop-mode-icon__image"><img src="odd-native.png" alt=""></span>',
			'</button>',
		].join( '' );
		window.odd.sets = [
			{
				slug: 'filament',
				label: 'Filament',
				category: 'ODD Defaults',
				accent: '#ff7a3c',
				icons: {
					odd: 'https://example.test/icons/odd.webp',
					'my-wordpress': 'https://example.test/icons/my-wordpress.webp',
					fallback: 'https://example.test/icons/fallback.webp',
				},
			},
		];
		window.odd.iconSets = window.odd.sets;

		const { host, cleanup } = mountPanel();
		host.querySelector( '[data-section="icons"]' ).click();

		const card = host.querySelector( '[data-odd-shop-card][data-set-slug="filament"]' );
		expect( card ).toBeTruthy();
		card.querySelector( '.odd-shop__card' ).click();
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		expect( document.querySelector( '.desktop-mode-dock__item-img' ).getAttribute( 'src' ) ).toBe( 'dock-native.png' );
		expect( document.querySelector( '.desktop-mode-icon[data-icon-id="posts"] img' ).getAttribute( 'src' ) ).toBe( 'posts-native.png' );
		expect( document.querySelector( '.desktop-mode-icon[data-icon-id="odd"] img' ).getAttribute( 'src' ) ).toBe( 'odd-native.png' );
		expect( host.querySelector( '[data-odd-preview-bar]' ) ).toBeNull();
		expect( fetchMock ).toHaveBeenCalledWith(
			'/wp-json/odd/v1/prefs',
			expect.objectContaining( {
				method: 'POST',
				body:   JSON.stringify( { iconSet: 'filament' } ),
			} )
		);

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'does not render department hero banners', () => {
		const { host, cleanup } = mountPanel();

		expect( host.querySelector( '.odd-shop__hero' ) ).toBeNull();
		[ 'icons', 'cursors', 'widgets', 'apps' ].forEach( ( section ) => {
			const button = host.querySelector( `[data-section="${ section }"]` );
			if ( button ) {
				button.click();
				expect( host.querySelector( '.odd-shop__hero' ) ).toBeNull();
			}
		} );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'clicking an inactive scene card applies it directly', async () => {
		const { host, cleanup } = mountPanel();

		const target = host.querySelector( '.odd-card[data-slug="aurora"]' );
		expect( target ).toBeTruthy();
		target.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( fetchMock ).toHaveBeenCalled();
		const [ url, opts ] = fetchMock.mock.calls[ 0 ];
		expect( url ).toContain( '/odd/v1/prefs' );
		expect( opts.method ).toBe( 'POST' );
		expect( JSON.parse( opts.body ) ).toMatchObject( { wallpaper: 'aurora' } );

		// Wait for the fetch chain to flush the state updates.
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		expect( host.querySelector( '[data-odd-preview-bar]' ) ).toBeFalsy();
		expect( target.classList.contains( 'is-previewing' ) ).toBe( false );
		expect( target.classList.contains( 'is-active' ) ).toBe( true );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'clicking the active scene card does not re-apply', () => {
		const { host, cleanup } = mountPanel();

		host.querySelector( '.odd-card[data-slug="flux"]' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( host.querySelector( '[data-odd-preview-bar]' ) ).toBeFalsy();
		expect( fetchMock ).not.toHaveBeenCalled();

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'stamps mobile layout and host fullscreen state for a phone viewport', () => {
		// Simulate a 390x844 phone with a coarse pointer and no
		// hover. JSDOM has no matchMedia by default, so synthesize
		// one that returns truthy for the mobile queries and falsy
		// for hover: hover.
		const origMM = window.matchMedia;
		const win = { state: 'fullscreen', markContentLoading: vi.fn(), markContentLoaded: vi.fn() };
		window.wp.desktop = {
			windowManager: {
				getById: vi.fn( () => win ),
			},
		};
		document.body.classList.add( 'desktop-mode-has-fullscreen-window' );
		window.matchMedia = ( q ) => ( {
			matches:           /pointer:\s*coarse/.test( q ) || /any-pointer:\s*coarse/.test( q ) ? true :
			                   /hover:\s*hover/.test( q ) ? false :
			                   false,
			media:             q,
			addEventListener:  () => {},
			removeEventListener: () => {},
		} );
		const origInner = window.innerWidth;
		try {
			setViewportWidth( 390 );
			const { host, cleanup } = mountPanel();
			// renderPanel applies the .odd-panel.odd-shop classes to
			// the host itself, so the responsive attributes land on
			// the same node.
			expect( host.classList.contains( 'odd-shop' ) ).toBe( true );
			expect( host.getAttribute( 'data-odd-layout' ) ).toBe( 'mobile' );
			expect( host.getAttribute( 'data-odd-pointer' ) ).toBe( 'coarse' );
			expect( host.getAttribute( 'data-odd-viewport' ) ).toBe( 'xs' );
			expect( host.getAttribute( 'data-odd-host-state' ) ).toBe( 'fullscreen' );
			expect( host.getAttribute( 'data-odd-host-fullscreen' ) ).toBe( 'true' );
			expect( host.hasAttribute( [ 'data-odd', 'mobile' ].join( '-' ) ) ).toBe( false );
			expect( document.body.classList.contains( [ 'odd-shop-mobile', 'escape' ].join( '-' ) ) ).toBe( false );
			expect( host.querySelector( '[' + [ 'data-odd', 'mobile', 'close' ].join( '-' ) + ']' ) ).toBeFalsy();
			expect( win.markContentLoading ).toHaveBeenCalledTimes( 1 );
			cleanup?.();
		} finally {
			window.matchMedia = origMM;
			setViewportWidth( origInner );
			document.body.classList.remove( 'desktop-mode-has-fullscreen-window' );
		}
	} );

	it( 'uses mobile layout on a phone viewport even when pointer detection is fine', () => {
		const origMM = window.matchMedia;
		window.matchMedia = ( q ) => ( {
			matches:           /hover:\s*hover/.test( q ),
			media:             q,
			addEventListener:  () => {},
			removeEventListener: () => {},
		} );
		const origInner = window.innerWidth;
		try {
			setViewportWidth( 390 );
			const { host, cleanup } = mountPanel( { width: 900 } );
			expect( host.getAttribute( 'data-odd-layout' ) ).toBe( 'mobile' );
			expect( host.getAttribute( 'data-odd-pointer' ) ).toBe( 'fine' );
			expect( host.hasAttribute( [ 'data-odd', 'mobile' ].join( '-' ) ) ).toBe( false );
			expect( document.body.classList.contains( [ 'odd-shop-mobile', 'escape' ].join( '-' ) ) ).toBe( false );
			cleanup?.();
		} finally {
			window.matchMedia = origMM;
			setViewportWidth( origInner );
		}
	} );

	it( 'uses mobile layout on an S phone viewport even when the saved native window is wide', () => {
		const origInner = window.innerWidth;
		try {
			setViewportWidth( 620 );
			const { host, cleanup } = mountPanel( { width: 1080 } );
			expect( host.getAttribute( 'data-odd-size' ) ).toBe( 'l' );
			expect( host.getAttribute( 'data-odd-viewport' ) ).toBe( 's' );
			expect( host.getAttribute( 'data-odd-layout' ) ).toBe( 'mobile' );
			expect( host.hasAttribute( [ 'data-odd', 'mobile' ].join( '-' ) ) ).toBe( false );
			expect( document.body.classList.contains( [ 'odd-shop-mobile', 'escape' ].join( '-' ) ) ).toBe( false );
			cleanup?.();
		} finally {
			setViewportWidth( origInner );
		}
	} );

	it( 'keeps tablet-width browser resizing compact without local fullscreen escape', () => {
		const origInner = window.innerWidth;
		try {
			setViewportWidth( 800 );
			const { host, cleanup } = mountPanel( { width: 1080 } );
			expect( host.getAttribute( 'data-odd-size' ) ).toBe( 'l' );
			expect( host.getAttribute( 'data-odd-viewport' ) ).toBe( 'm' );
			expect( host.getAttribute( 'data-odd-layout' ) ).toBe( 'compact' );
			expect( host.hasAttribute( [ 'data-odd', 'mobile' ].join( '-' ) ) ).toBe( false );
			expect( document.body.classList.contains( [ 'odd-shop-mobile', 'escape' ].join( '-' ) ) ).toBe( false );
			cleanup?.();
		} finally {
			setViewportWidth( origInner );
		}
	} );

	it( 'updates layout attributes when the browser is resized under an already-open wide Shop window', () => {
		const origInner = window.innerWidth;
		try {
			setViewportWidth( 1440 );
			const { host, cleanup } = mountPanel( { width: 1080 } );
			expect( host.getAttribute( 'data-odd-layout' ) ).toBe( 'desktop' );
			expect( host.hasAttribute( [ 'data-odd', 'mobile' ].join( '-' ) ) ).toBe( false );

			setViewportWidth( 620 );
			window.dispatchEvent( new Event( 'resize' ) );

			expect( host.getAttribute( 'data-odd-viewport' ) ).toBe( 's' );
			expect( host.getAttribute( 'data-odd-layout' ) ).toBe( 'mobile' );
			expect( host.hasAttribute( [ 'data-odd', 'mobile' ].join( '-' ) ) ).toBe( false );
			expect( document.body.classList.contains( [ 'odd-shop-mobile', 'escape' ].join( '-' ) ) ).toBe( false );
			cleanup?.();
		} finally {
			setViewportWidth( origInner );
		}
	} );

	it( 'updates host-state attributes from Desktop Mode fullscreen and bounds events', () => {
		const origInner = window.innerWidth;
		const win = { state: 'normal' };
		try {
			window.wp.desktop = {
				windowManager: {
					getById: vi.fn( () => win ),
				},
			};
			const { host, cleanup } = mountPanel( { width: 1080 } );
			expect( host.getAttribute( 'data-odd-host-state' ) ).toBe( 'normal' );
			expect( host.getAttribute( 'data-odd-host-fullscreen' ) ).toBe( 'false' );

			win.state = 'fullscreen';
			document.body.classList.add( 'desktop-mode-has-fullscreen-window' );
			window.wp.hooks.doAction( 'desktop-mode.window.fullscreen-entered', { windowId: 'odd' } );
			expect( host.getAttribute( 'data-odd-host-state' ) ).toBe( 'fullscreen' );
			expect( host.getAttribute( 'data-odd-host-fullscreen' ) ).toBe( 'true' );

			setViewportWidth( 620 );
			window.wp.hooks.doAction( 'desktop-mode.window.bounds-changed', { windowId: 'odd' } );
			expect( host.getAttribute( 'data-odd-layout' ) ).toBe( 'mobile' );
			cleanup?.();
		} finally {
			setViewportWidth( origInner );
			document.body.classList.remove( 'desktop-mode-has-fullscreen-window' );
		}
	} );

	it( 'uses compact layout for a narrow native window without body-locking a desktop viewport', () => {
		const origInner = window.innerWidth;
		try {
			setViewportWidth( 1440 );
			const { host, cleanup } = mountPanel( { width: 620 } );
			expect( host.getAttribute( 'data-odd-size' ) ).toBe( 's' );
			expect( host.getAttribute( 'data-odd-viewport' ) ).toBe( 'xl' );
			expect( host.getAttribute( 'data-odd-layout' ) ).toBe( 'compact' );
			expect( host.hasAttribute( [ 'data-odd', 'mobile' ].join( '-' ) ) ).toBe( false );
			expect( document.body.classList.contains( [ 'odd-shop-mobile', 'escape' ].join( '-' ) ) ).toBe( false );
			cleanup?.();
		} finally {
			setViewportWidth( origInner );
		}
	} );

	it( 'does not render a topbar Install pill — uploads go through the dedicated Install tab', () => {
		const { host, cleanup } = mountPanel();

		// The topbar Install pill was removed in favor of the
		// dedicated Install rail tab + the shop-wide drop overlay.
		// Guard against it sneaking back in via a casual edit.
		expect( host.querySelector( '[data-odd-install-pill]' ) ).toBeFalsy();
		expect( host.querySelector( '[data-odd-install-input]' ) ).toBeFalsy();
		const css = readFileSync( resolve( __dirname, '../../odd/src/panel/styles.css' ), 'utf8' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__topbar{grid-column:1/-1;display:grid;grid-template-columns:72px minmax(0,1fr)' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__command{grid-area:command;justify-self:stretch;width:100%;max-width:min(100%,1280px)' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__search-tools{display:flex;align-items:center;justify-content:flex-start;gap:4px;min-width:0;overflow-x:auto;padding:3px;border-radius:23px' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__brand-text{display:none;' );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'offers .odd workspace import/export from the Install tab', () => {
		const { host, cleanup } = mountPanel();
		const createObjectURL = vi.fn( () => 'blob:odd-workspace' );
		const revokeObjectURL = vi.fn();
		const clickSpy = vi.spyOn( HTMLAnchorElement.prototype, 'click' ).mockImplementation( () => {} );
		Object.defineProperty( window.URL, 'createObjectURL', { configurable: true, value: createObjectURL } );
		Object.defineProperty( window.URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL } );

		host.querySelector( '[data-section="install"]' ).click();

		expect( host.querySelector( '.odd-shop__dropzone-title' ).textContent ).toContain( '.odd workspace' );
		expect( host.querySelector( '[data-odd-install-file-input]' ).getAttribute( 'accept' ) ).toBe( '.wp,.odd' );
		host.querySelector( '[data-odd-export-workspace]' ).click();

		expect( createObjectURL ).toHaveBeenCalled();
		expect( clickSpy ).toHaveBeenCalled();

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'imports a .odd workspace and enables saved widgets', async () => {
		const widgetCalls = installWidgetLayer();
		window.odd.iconSets = [
			{ slug: 'filament', label: 'Filament', category: 'ODD Defaults', accent: '#ff7a3c', icons: { dashboard: '', fallback: '' } },
		];
		const { host, cleanup } = mountPanel();
		fetchMock.mockResolvedValueOnce( {
			ok: true,
			json: () => Promise.resolve( {
				wallpaper: 'aurora',
				iconSet: 'filament',
				shuffle: { enabled: true, minutes: 30 },
			} ),
		} );

		host.querySelector( '[data-section="install"]' ).click();
		const input = host.querySelector( '[data-odd-install-file-input]' );
		const payload = {
			format: 'com.regionallyfamous.odd.workspace',
			schema: 1,
			name: 'Shared Mood',
			prefs: {
				wallpaper: 'aurora',
				iconSet: 'filament',
				shuffle: { enabled: true, minutes: 30 },
			},
			desktop: {
				widgets: { enabled: [ 'odd/sticky' ] },
			},
			content: [
				{ type: 'scene', slug: 'aurora' },
				{ type: 'icon-set', slug: 'filament' },
				{ type: 'widget', slug: 'sticky' },
			],
		};
		const file = new File( [ JSON.stringify( payload ) ], 'shared-mood.odd', { type: 'application/json' } );
		Object.defineProperty( input, 'files', { configurable: true, value: [ file ] } );
		input.dispatchEvent( new Event( 'change', { bubbles: true } ) );

		await vi.waitFor( () => {
			expect( fetchMock ).toHaveBeenCalledWith(
				'/wp-json/odd/v1/prefs',
				expect.objectContaining( {
					method: 'POST',
					body: expect.stringContaining( '"wallpaper":"aurora"' ),
				} )
			);
		} );
		await vi.waitFor( () => expect( widgetCalls.add ).toContain( 'odd/sticky' ) );
		expect( window.odd.wallpaper ).toBe( 'aurora' );
		expect( host.querySelector( '.odd-shop__dropzone-status' ).textContent ).toContain( 'Workspace imported' );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'searches across departments and renders unified results', () => {
		window.odd.iconSets = [
			{ slug: 'filament', label: 'Filament', category: 'ODD Defaults', accent: '#ff7a3c', icons: { dashboard: '', fallback: '' } },
		];
		const { host, cleanup } = mountPanel();

		const search = host.querySelector( '[data-odd-search]' );
		search.value = 'filament';
		search.dispatchEvent( new Event( 'input', { bubbles: true } ) );

		expect( host.querySelector( '.odd-section-header h2' ).textContent.trim() ).toBe( 'Search' );
		expect( host.querySelector( '[data-odd-shop-card][data-set-slug="filament"]' ) ).toBeTruthy();
		const shelfTitles = Array.from( host.querySelectorAll( '.odd-shop__shelf-title' ) )
			.map( ( node ) => node.textContent.trim() );
		expect( shelfTitles ).toContain( 'Icon Sets' );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'uses category chips as filters without filling the search field', () => {
		const { host, cleanup } = mountPanel();

		const chip = Array.from( host.querySelectorAll( '.odd-shop__search-chip' ) )
			.find( ( node ) => node.textContent.trim() === 'Generative' );
		expect( chip ).toBeTruthy();
		chip.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( host.querySelector( '[data-odd-search]' ).value ).toBe( '' );
		expect( chip.classList.contains( 'is-active' ) ).toBe( true );
		const cards = Array.from( host.querySelectorAll( '.odd-card[data-slug]' ) )
			.map( ( node ) => node.getAttribute( 'data-slug' ) );
		expect( cards ).toEqual( [ 'flux' ] );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'Settings renders server-provided system health and copy diagnostics action', () => {
		window.__odd = window.__odd || {};
		window.__odd.diagnostics = { copy: vi.fn( () => Promise.resolve( true ) ) };
		const { host, cleanup } = mountPanel();

		const settingsTab = Array.from( host.querySelectorAll( '.odd-shop__rail-item' ) )
			.find( ( b ) => b.querySelector( '.odd-shop__rail-label strong' )?.textContent.trim() === 'Settings' );
		settingsTab.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const health = host.querySelector( '.odd-shop__health' );
		expect( health ).toBeTruthy();
		expect( health.textContent ).toContain( 'Bundled fallback catalog' );
		expect( health.textContent ).toContain( 'Missing signature' );
		expect( health.textContent ).toContain( 'Registry hash' );
		expect( health.textContent ).toContain( 'Starterpartial' );
		expect( health.tagName ).toBe( 'SECTION' );
		expect( health.getAttribute( 'aria-label' ) ).toBe( 'Catalog integrity status' );
		expect( health.querySelectorAll( '.odd-shop__health-signals .odd-shop__health-metric' ) ).toHaveLength( 3 );
		expect( health.querySelector( '.odd-shop__health-orbit' ) ).toBeTruthy();
		const css = readFileSync( resolve( __dirname, '../../odd/src/panel/styles.css' ), 'utf8' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__dept--settings{width:100%;max-width:none}' );
		expect( css ).toContain( '.odd-panel.odd-shop .odd-shop__health{position:relative;display:block;width:100%;max-width:none;' );
		const copy = Array.from( health.querySelectorAll( 'button' ) )
			.find( ( b ) => b.textContent.trim() === 'Copy diagnostics' );
		expect( copy.classList.contains( 'odd-shop__health-action--primary' ) ).toBe( true );
		copy.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( window.__odd.diagnostics.copy ).toHaveBeenCalled();

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'Settings taskbar toggle writes Desktop Mode itemVisibility', async () => {
		window.odd.shopTaskbar = false;
		const osSettings = { itemVisibility: { odd: 'desktop' }, dockOrder: [] };
		const updateOsSettings = vi.fn( ( patch ) => {
			if ( patch && patch.itemVisibility ) {
				osSettings.itemVisibility = Object.assign( {}, patch.itemVisibility );
			}
		} );
		window.wp.desktop = {
			getOsSettings: () => ( {
				itemVisibility: Object.assign( {}, osSettings.itemVisibility ),
				dockOrder: osSettings.dockOrder.slice(),
			} ),
			updateOsSettings,
		};
		fetchMock.mockImplementation( ( _url, opts ) => {
			const body = opts && opts.body ? JSON.parse( opts.body ) : {};
			return Promise.resolve( {
				ok:   true,
				json: () => Promise.resolve( { shopTaskbar: !! body.shopTaskbar } ),
			} );
		} );

		const { host, cleanup } = mountPanel();
		const settingsTab = Array.from( host.querySelectorAll( '.odd-shop__rail-item' ) )
			.find( ( b ) => b.querySelector( '.odd-shop__rail-label strong' )?.textContent.trim() === 'Settings' );
		settingsTab.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const dockBox = host.querySelector( '.odd-setting-card--shop-taskbar input[type="checkbox"]' );
		expect( dockBox.checked ).toBe( false );
		dockBox.checked = true;
		dockBox.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		await new Promise( ( r ) => setTimeout( r, 0 ) );

		expect( updateOsSettings ).toHaveBeenCalledTimes( 1 );
		expect( updateOsSettings.mock.calls[ 0 ][ 0 ] ).toEqual( {
			itemVisibility: { odd: 'both' },
		} );
		expect( osSettings.itemVisibility.odd ).toBe( 'both' );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'refreshing the catalog rehydrates the open Shop shelves', async () => {
		window.odd.bundleCatalog = {
			scene: [
				{ type: 'scene', slug: 'old-clouds', name: 'Old Clouds', category: 'Archive', installed: false },
			],
			iconSet: [],
			cursorSet: [],
			widget: [],
			app: [],
		};
		fetchMock.mockImplementation( ( url ) => {
			if ( String( url ).endsWith( '/bundles/refresh' ) ) {
				return Promise.resolve( {
					ok: true,
					json: () => Promise.resolve( {
						refreshed: true,
						count: 1,
						meta: {
							source: 'remote',
							bundle_count: 1,
							raw_bundle_count: 1,
							effective_bundle_count: 1,
							signature_status: 'valid',
							registry_sha256: 'feedface12345678',
							registry_bytes: 4096,
						},
						bundles: [
							{ type: 'scene', slug: 'fresh-clouds', name: 'Fresh Clouds', category: 'Skies', installed: false },
						],
					} ),
				} );
			}
			return Promise.resolve( {
				ok: true,
				json: () => Promise.resolve( { wallpaper: 'aurora' } ),
			} );
		} );

		const { host, cleanup } = mountPanel();
		expect( host.querySelector( '[data-odd-shop-card][data-catalog-slug="old-clouds"]' ) ).toBeTruthy();

		const refresh = Array.from( host.querySelectorAll( '.odd-shop__catalog-notice button' ) )
			.find( ( b ) => b.textContent.trim() === 'Refresh catalog' );
		expect( refresh ).toBeTruthy();
		refresh.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		await vi.waitFor( () => {
			expect( host.querySelector( '[data-odd-shop-card][data-catalog-slug="fresh-clouds"]' ) ).toBeTruthy();
		} );
		expect( host.querySelector( '[data-odd-shop-card][data-catalog-slug="old-clouds"]' ) ).toBeNull();
		expect( window.odd.bundleCatalog.scene.map( ( row ) => row.slug ) ).toEqual( [ 'fresh-clouds' ] );

		if ( typeof cleanup === 'function' ) cleanup();
	} );

	it( 'Widgets department renders unified widget cards with the Add/Active state machine', () => {
		const calls = installWidgetLayer();
		const { host, cleanup } = mountPanel();

		// Switch to the Widgets tab.
		const widgetsTab = Array.from( host.querySelectorAll( '.odd-shop__rail-item' ) )
			.find( ( b ) => b.querySelector( '.odd-shop__rail-label strong' )?.textContent.trim() === 'Widgets' );
		expect( widgetsTab, 'Widgets rail button must be present' ).toBeTruthy();
		widgetsTab.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		// Both ODD widgets should render as unified tiles.
		const cards = host.querySelectorAll( '[data-odd-shop-card][data-odd-card-type="widget"]' );
		expect( cards.length ).toBe( 2 );

		const stickyCard = host.querySelector( '.odd-shop__tile--widget[data-widget-id="odd/sticky"]' );
		expect( stickyCard, 'sticky card must be rendered' ).toBeTruthy();

		// Installed-but-not-on-desktop widgets show `Add`.
		const addBtn = stickyCard.parentNode.querySelector( '.odd-shop__card-btn' );
		expect( addBtn.textContent.trim() ).toBe( 'Add' );
		addBtn.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( calls.add ).toEqual( [ 'odd/sticky' ] );

		// After add the card flips to `Active` (disabled) and the
		// wrap is marked `.is-active`. The plan explicitly keeps
		// Remove out of the card surface — removal happens from
		// the desktop widget chrome itself.
		const refreshedSticky = host.querySelector( '.odd-shop__tile--widget[data-widget-id="odd/sticky"]' );
		const refreshedWrap   = refreshedSticky.closest( '.odd-shop__card-wrap' );
		expect( refreshedWrap.classList.contains( 'is-active' ) ).toBe( true );
		const activeBtn = refreshedWrap.querySelector( '.odd-shop__card-btn' );
		expect( activeBtn.textContent.trim() ).toBe( 'Active' );
		expect( activeBtn.disabled ).toBe( true );

		if ( typeof cleanup === 'function' ) cleanup();
	} );
} );
