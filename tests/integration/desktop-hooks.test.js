import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFoundation } from './harness.js';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const SRC = resolve( __dirname, '../../odd/src/shared/desktop-hooks.js' );

function loadDesktopHooks() {
	const src = readFileSync( SRC, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=desktop-hooks.js` );
	fn.call( globalThis );
}

describe( 'Desktop Mode hook bridge', () => {
	beforeEach( () => {
		if ( window.__odd && window.__odd.desktopHooks && typeof window.__odd.desktopHooks.uninstall === 'function' ) {
			try { window.__odd.desktopHooks.uninstall(); } catch ( e ) {}
		}
		loadFoundation( {
			config: {
				version: 'test',
				scene: 'oddling-desktop',
				iconSet: 'odd-default-icons',
				cursorSet: 'odd-default-cursors',
				systemHealth: { catalog: { source: 'transient' }, content: { scenes: 1 } },
			},
		} );
	} );

	it( 'registers the ODD settings tab when Desktop Mode exposes settings tabs', () => {
		const registerSettingsTab = vi.fn();
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			registerSettingsTab,
		};

		loadDesktopHooks();

		expect( registerSettingsTab ).toHaveBeenCalledTimes( 1 );
		expect( registerSettingsTab.mock.calls[ 0 ][ 0 ] ).toMatchObject( {
			id: 'odd',
			label: 'ODD',
			owner: 'odd-desktop-hooks',
		} );
		expect( typeof registerSettingsTab.mock.calls[ 0 ][ 0 ].render ).toBe( 'function' );
	} );

	it( 'renders ODD status and actions inside the Desktop Mode settings tab', () => {
		const registerSettingsTab = vi.fn();
		const shuffle = vi.fn();
		const copy = vi.fn();
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			registerSettingsTab,
		};
		window.__odd.api = {
			openPanel: vi.fn( () => true ),
			shuffle,
			tidyWidgets: vi.fn( () => true ),
			resetDecorations: vi.fn( () => true ),
		};
		window.__odd.diagnostics.copy = copy;

		loadDesktopHooks();
		const body = document.createElement( 'div' );
		registerSettingsTab.mock.calls[ 0 ][ 0 ].render( body );

		expect( body.textContent ).toContain( 'Catalog source' );
		expect( body.textContent ).toContain( 'Signature' );
		expect( body.textContent ).toContain( 'Bundle rows' );
		expect( body.querySelector( 'wpd-code' ) ).toBeNull();
		expect( body.querySelector( '[data-odd-settings-health]' ).tagName ).toBe( 'PRE' );
		expect( body.querySelector( '[data-odd-settings-log]' ).classList.contains( 'odd-settings-code' ) ).toBe( true );

		body.querySelector( '[data-odd-settings-action="oddout-shuffle-wallpaper"]' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		body.querySelector( '[data-odd-settings-action="oddout-copy-diagnostics"]' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );

		expect( shuffle ).toHaveBeenCalledTimes( 1 );
		expect( copy ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'registers the ODD namespace, modules, and file openers with Desktop Mode', () => {
		const registerNamespace = vi.fn();
		const registerModule = vi.fn();
		const registerType = vi.fn();
		const registerOpener = vi.fn();
		const openPanel = vi.fn( () => true );
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			registerNamespace,
			registerModule,
			files: {
				registerType,
				registerOpener,
			},
		};
		window.__odd.api = {
			openPanel,
			shuffle: vi.fn( () => true ),
			openOsSettings: vi.fn( () => true ),
		};

		loadDesktopHooks();

		expect( registerNamespace ).toHaveBeenCalledWith( 'odd', expect.objectContaining( {
			actions: expect.any( Function ),
			runAction: expect.any( Function ),
			openShop: expect.any( Function ),
		} ) );
		const namespace = registerNamespace.mock.calls[ 0 ][ 1 ];
		expect( namespace.actions().map( ( action ) => action.id ) ).toContain( 'oddout-open-shop' );
		expect( namespace.openShop() ).toBe( true );
		expect( openPanel ).toHaveBeenCalledTimes( 1 );

		expect( registerModule.mock.calls.map( ( call ) => call[ 0 ].id ) ).toEqual( expect.arrayContaining( [
			'odd-desktop-adapter',
			'odd-api',
			'odd',
		] ) );
		expect( registerType.mock.calls.map( ( call ) => call[ 0 ].type ) ).toEqual( [
			'odd-bundle',
			'odd-catalog',
			'odd-workspace',
		] );
		expect( registerOpener ).toHaveBeenCalledWith( expect.objectContaining( {
			id: 'odd/open-file',
			types: [ 'odd-bundle', 'odd-catalog', 'odd-workspace' ],
		} ) );

		const opener = registerOpener.mock.calls[ 0 ][ 0 ];
		expect( opener.handler.open( { type: 'odd-bundle', name: 'test.wp' }, { source: 'test' } ) ).toBe( true );
		expect( window.__odd.pendingDesktopFile.file.name ).toBe( 'test.wp' );
	} );

	it( 'records iframe failures and mirrors them to the ODD event bus', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		const seen = [];
		window.__odd.events.on( 'odd.iframe-error', ( payload ) => seen.push( payload ) );

		loadDesktopHooks();
		window.wp.hooks.doAction( 'desktop-mode.iframe.error', {
			windowId: 'odd-app-demo',
			message: 'boom',
		} );

		expect( seen ).toHaveLength( 1 );
		expect( seen[ 0 ].message ).toBe( 'boom' );
		expect( window.__odd.diagnostics.recent().some( ( row ) => row.message.includes( 'desktop-mode.iframe.error' ) ) ).toBe( true );
	} );

	it( 'does not keep fallback hook subscriptions once Desktop Mode exposes a HOOKS key', () => {
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			HOOKS: {
				IFRAME_ERROR: 'desktop-mode.current.iframe.error',
			},
		};
		const seen = [];
		window.__odd.events.on( 'odd.iframe-error', ( payload ) => seen.push( payload.message ) );

		loadDesktopHooks();
		window.wp.hooks.doAction( 'desktop-mode.iframe.error', { message: 'fallback' } );
		window.wp.hooks.doAction( 'desktop-mode.current.iframe.error', { message: 'current' } );

		expect( seen ).toEqual( [ 'current' ] );
	} );

	it( 'seeds a desktopState snapshot before any Desktop Mode hooks fire', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };

		loadDesktopHooks();

		expect( window.__odd.desktopState ).toMatchObject( {
			revision: 0,
			supports: { windows: false, wallpaperSurfaces: false, activity: false },
			document: { hidden: false },
			wallpaper: { visible: true, state: 'visible' },
			windows: { all: [], focusedId: '', count: 0 },
			surfaces: { all: [], count: 0 },
			activity: { window: 0, dock: 0, presence: 0 },
		} );
	} );

	it( 'normalizes Desktop Mode window payloads for ODD app listeners', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		const opened = [];
		const stateChanges = [];
		window.__odd.events.on( 'odd.window-opened', ( payload ) => opened.push( payload ) );
		window.__odd.events.on( 'odd.desktop-state-changed', ( payload ) => stateChanges.push( payload ) );

		loadDesktopHooks();
		window.wp.hooks.doAction( 'desktop-mode.window.opened', {
			windowId: 'odd-app-demo',
			title: 'Demo',
			bounds: { x: 10, y: 20, width: 300, height: 200 },
		} );

		expect( opened ).toHaveLength( 1 );
		expect( opened[ 0 ].id ).toBe( 'odd-app-demo' );
		expect( opened[ 0 ].windowId ).toBe( 'odd-app-demo' );
		expect( stateChanges.length ).toBeGreaterThan( 0 );
		expect( window.__odd.desktopState.supports.windows ).toBe( true );
		expect( window.__odd.desktopState.windows.focusedId ).toBe( 'odd-app-demo' );
		expect( window.__odd.desktopState.windows.all[ 0 ] ).toMatchObject( {
			id: 'odd-app-demo',
			title: 'Demo',
			bounds: { x: 10, y: 20, width: 300, height: 200 },
		} );
	} );

	it( 'fullscreens the ODD Shop on touch-only open events', () => {
		const toggleFullscreen = vi.fn();
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			windowManager: {
				getById: vi.fn( () => ( { id: 'odd', state: 'normal', toggleFullscreen } ) ),
			},
		};
		loadDesktopHooks();
		window.__odd.api = {
			isTouchOnly:     vi.fn( () => true ),
			requestMaximize: vi.fn( () => {
				toggleFullscreen();
				return 'fullscreen';
			} ),
		};

		window.wp.hooks.doAction( 'desktop-mode.window.opened', { windowId: 'odd' } );

		expect( window.__odd.api.requestMaximize ).toHaveBeenCalledWith( window.wp.desktop );
		expect( toggleFullscreen ).toHaveBeenCalledTimes( 1 );
		expect( window.__odd.desktopState.windows.all.find( ( row ) => row.id === 'odd' ) ).toMatchObject( {
			state: 'fullscreen',
			layoutSource: 'fullscreen',
		} );
	} );

	it( 'does not re-toggle fullscreen when the ODD Shop is already fullscreen', () => {
		const requestMaximize = vi.fn();
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			windowManager: {
				getById: vi.fn( () => ( { id: 'odd', state: 'fullscreen' } ) ),
			},
		};
		loadDesktopHooks();
		window.__odd.api = {
			isTouchOnly:     vi.fn( () => true ),
			requestMaximize,
		};

		window.wp.hooks.doAction( 'desktop-mode.window.reopened', { windowId: 'odd' } );

		expect( requestMaximize ).not.toHaveBeenCalled();
	} );

	it( 'observes low ODD Shop placement without moving the host window', () => {
		const element = document.createElement( 'div' );
		element.style.left = '120px';
		element.style.top = '260px';
		const emitChange = vi.fn();
		const win = { id: 'odd', state: 'normal', element, config: { id: 'odd', y: 260 }, _emitChange: emitChange };
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			windowManager: {
				getById: vi.fn( () => win ),
			},
		};

		loadDesktopHooks();
		window.wp.hooks.doAction( 'desktop-mode.window.opened', {
			windowId: 'odd',
			bounds: { x: 120, y: 260, width: 1080, height: 720 },
		} );

		expect( element.style.top ).toBe( '260px' );
		expect( win.config.y ).toBe( 260 );
		expect( emitChange ).not.toHaveBeenCalled();
		expect( window.__odd.desktopState.windows.all.find( ( row ) => row.id === 'odd' ).bounds.y ).toBe( 260 );
		expect( window.__odd.diagnostics.recent().some( ( row ) => row.message.includes( 'odd.shop-window.host-placement-observed' ) ) ).toBe( true );
	} );

	it( 'repairs impossible ODD Shop geometry through the native Desktop Mode geometry filter', () => {
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			HOOKS: {
				WINDOW_GEOMETRY: 'desktop-mode.window.geometry',
			},
		};

		loadDesktopHooks();
		const repaired = window.wp.hooks.applyFilters(
			'desktop-mode.window.geometry',
			{ x: 96, y: 260, width: 1040, height: 640, state: 'normal' },
			{ windowId: 'odd', baseId: 'odd', hasSavedGeometry: true, callerPinned: true },
		);
		const untouched = window.wp.hooks.applyFilters(
			'desktop-mode.window.geometry',
			{ x: 12, y: 260, width: 500, height: 400, state: 'normal' },
			{ windowId: 'notes', baseId: 'notes', hasSavedGeometry: true },
		);

		expect( repaired ).toMatchObject( { x: 96, y: 16, width: 1040, height: 640 } );
		expect( untouched.y ).toBe( 260 );
		expect( window.__odd.desktopState.supports.windowGeometry ).toBe( true );
		expect( window.__odd.diagnostics.recent().some( ( row ) => row.message.includes( 'odd.shop-window.geometry-filtered' ) ) ).toBe( true );
	} );

	it( 'opens fallback Arrange Shop actions with source metadata', () => {
		const openWindow = vi.fn();
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			openWindow,
		};
		loadDesktopHooks();

		window.wp.hooks.doAction( 'desktop-mode.arrange.custom-action', { id: 'oddout-open-shop' } );

		expect( openWindow ).toHaveBeenCalledWith( 'odd', {
			source: 'odd.shop-window.fallback-open',
		} );
	} );

	it( 'does not move ODD app windows or fullscreen Shop windows during top correction', () => {
		const shop = document.createElement( 'div' );
		shop.style.top = '260px';
		const app = document.createElement( 'div' );
		app.style.top = '260px';
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			windowManager: {
				getById: vi.fn( () => ( { id: 'odd', state: 'fullscreen', element: shop } ) ),
			},
		};

		loadDesktopHooks();
		window.wp.hooks.doAction( 'desktop-mode.window.opened', { windowId: 'odd' } );
		window.wp.hooks.doAction( 'desktop-mode.window.opened', {
			windowId: 'odd-app-demo',
			element: app,
		} );

		expect( shop.style.top ).toBe( '260px' );
		expect( app.style.top ).toBe( '260px' );
	} );

	it( 'emits one normalized wallpaper visibility event from the hook bridge', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		const seen = [];
		window.__odd.events.on( 'odd.visibility-changed', ( payload ) => seen.push( payload ) );

		loadDesktopHooks();
		window.wp.hooks.doAction( 'desktop-mode.wallpaper.visibility', {
			id: 'odd',
			state: 'hidden',
		} );

		expect( seen ).toEqual( [ { state: 'hidden' } ] );
		expect( window.__odd.desktopState.wallpaper.visible ).toBe( false );
		expect( window.__odd.desktopState.wallpaper.state ).toBe( 'hidden' );
	} );

	it( 'marks ODD loading overlays without replacing them', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		loadDesktopHooks();

		const overlay = document.createElement( 'div' );
		const next = window.wp.hooks.applyFilters(
			'desktop-mode.window.loading-overlay',
			overlay,
			{ windowId: 'odd' },
		);

		expect( next ).toBe( overlay );
		expect( overlay.getAttribute( 'data-odd-loading-observed' ) ).toBe( 'true' );
	} );

	it( 'registers a title-bar diagnostics button for ODD windows', () => {
		const registerTitleBarButton = vi.fn();
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			registerTitleBarButton,
		};

		loadDesktopHooks();

		expect( registerTitleBarButton ).toHaveBeenCalledTimes( 1 );
		const def = registerTitleBarButton.mock.calls[ 0 ][ 0 ];
		expect( def ).toMatchObject( {
			id:    'odd/copy-diagnostics',
			owner: 'odd-desktop-hooks',
		} );
		expect( def.match( { id: 'odd-app-demo' } ) ).toBe( true );
		expect( def.match( { id: 'plugins' } ) ).toBe( false );
	} );

	it( 'observes the Desktop Mode window attention filter without changing the mode', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		loadDesktopHooks();

		const mode = window.wp.hooks.applyFilters(
			'desktop-mode.window.attention',
			'shake',
			{ windowId: 'odd-app-demo' },
		);

		expect( mode ).toBe( 'shake' );
		expect( window.__odd.diagnostics.recent().some( ( row ) => row.message.includes( 'desktop-mode.window.attention' ) ) ).toBe( true );
	} );

	it( 'decorates ODD dock tiles without replacing the tile element', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		loadDesktopHooks();
		const openPanel = vi.fn( () => true );
		window.__odd.api = {
			openPanel,
			shuffle: vi.fn( () => true ),
			tidyWidgets: vi.fn( () => true ),
			resetDecorations: vi.fn( () => true ),
			openOsSettings: vi.fn( () => true ),
		};

		const classes = window.wp.hooks.applyFilters(
			'desktop-mode.dock.tile-class',
			[ 'tile' ],
			{ item: { id: 'odd-app-demo', title: 'Demo' } },
		);
		expect( classes ).toContain( 'odd-desktop-tile' );

		const tile = document.createElement( 'button' );
		const next = window.wp.hooks.applyFilters(
			'desktop-mode.dock.tile-element',
			tile,
			{ item: { id: 'odd', title: 'ODD Shop' } },
		);
		expect( next ).toBe( tile );
		expect( tile.getAttribute( 'data-odd-dock-tile' ) ).toBe( 'odd' );
		expect( tile.getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
		expect( tile.getAttribute( 'data-odd-dock-menu-bound' ) ).toBe( 'true' );

		const canceled = ! tile.dispatchEvent( new MouseEvent( 'contextmenu', {
			bubbles:    true,
			cancelable: true,
			clientX:    44,
			clientY:    66,
		} ) );
		expect( canceled ).toBe( true );

		const menu = document.querySelector( '[data-odd-dock-context-menu]' );
		expect( menu ).toBeTruthy();
		expect( Array.from( menu.querySelectorAll( 'wpd-context-menu-option' ) ).map( ( item ) => item.dataset.menuItemId ) ).toContain( 'oddout-open-shop' );

		menu.querySelector( '[data-menu-item-id="oddout-open-shop"]' ).dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( openPanel ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'binds ODD dock menus to already-rendered native window system tiles', () => {
		const tile = document.createElement( 'div' );
		tile.className = 'desktop-mode-dock__item desktop-mode-dock__item--system';
		tile.setAttribute( 'data-system-id', 'odd' );
		tile.innerHTML = '<button class="desktop-mode-dock__item-primary" aria-label="ODD Shop" type="button"></button>';
		document.body.appendChild( tile );

		window.wp.desktop = {
			ready: ( cb ) => cb(),
			getSystemTile: ( id ) => id === 'odd' ? { id: 'odd', title: 'ODD Shop' } : null,
		};
		window.__odd.api = {
			openPanel: vi.fn( () => true ),
			shuffle: vi.fn( () => true ),
			tidyWidgets: vi.fn( () => true ),
			resetDecorations: vi.fn( () => true ),
			openOsSettings: vi.fn( () => true ),
		};

		loadDesktopHooks();

		expect( tile.getAttribute( 'data-odd-dock-menu-bound' ) ).toBe( 'true' );
		expect( tile.getAttribute( 'data-odd-dock-tile' ) ).toBe( 'odd' );

		const canceled = ! tile.querySelector( 'button' ).dispatchEvent( new MouseEvent( 'contextmenu', {
			bubbles:    true,
			cancelable: true,
			clientX:    24,
			clientY:    36,
		} ) );
		expect( canceled ).toBe( true );
		expect( document.querySelector( '[data-odd-dock-context-menu]' ) ).toBeTruthy();
	} );

	it( 'maps window and widget hook payload elements to semantic cursor roots', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		loadDesktopHooks();

		const win = document.createElement( 'div' );
		win.innerHTML = '<div class="desktop-mode-window-titlebar"></div><button>Run</button><input type="text">';
		window.wp.hooks.doAction( 'desktop-mode.window.opened', {
			windowId: 'odd-app-demo',
			element: win,
		} );

		expect( win.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( win.querySelector( '.desktop-mode-window-titlebar' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'grab' );
		expect( win.querySelector( 'button' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
		expect( win.querySelector( 'input' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'text' );

		const widget = document.createElement( 'div' );
		widget.innerHTML = '<div class="odd-widget__move"></div><button>Tap</button>';
		window.wp.hooks.doAction( 'desktop-mode.widget.mounted', {
			id: 'odd/weather',
			element: widget,
		} );

		expect( widget.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( widget.querySelector( '.odd-widget__move' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'grab' );

		const file = document.createElement( 'div' );
		file.innerHTML = '<button class="desktop-mode-files__tile">Open</button><wpd-context-menu-item>Rename</wpd-context-menu-item>';
		window.wp.hooks.doAction( 'desktop-mode.files.opened', {
			id: 'file:notes',
			element: file,
		} );

		expect( file.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( file.querySelector( '.desktop-mode-files__tile' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
		expect( file.querySelector( 'wpd-context-menu-item' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
	} );

	it( 'maps desktop icon and file tile render hooks to cursor semantics', () => {
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			HOOKS: {
				DESKTOP_ICONS_RENDERED: 'desktop-mode.desktop-icons.rendered',
			},
		};
		const icons = document.createElement( 'div' );
		icons.className = 'desktop-mode-icons';
		const icon = document.createElement( 'button' );
		icon.className = 'desktop-mode-icon';
		icons.appendChild( icon );
		document.body.appendChild( icons );
		const tile = document.createElement( 'button' );
		tile.className = 'desktop-mode-files__tile';

		loadDesktopHooks();
		window.wp.hooks.doAction( 'desktop-mode.desktop-icons.rendered', {
			ids: [ 'odd' ],
			container: icons,
			tiles: new Map( [ [ 'odd', icon ] ] ),
		} );
		window.wp.hooks.doAction( 'desktop-mode.files.tile-rendered', {
			tile,
			placement: { id: 'notes' },
		} );

		expect( icons.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( icon.getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
		expect( tile.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( tile.getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
		expect( window.__odd.diagnostics.recent().some( ( row ) => row.message.includes( '"structured":true' ) ) ).toBe( true );
	} );

	it( 'records Desktop Mode 0.8.5 file, presence, heartbeat, and arrange surfaces', () => {
		window.wp.desktop = {
			ready:          ( cb ) => cb(),
			registerWidget: () => {},
			registerSystemTile: () => 'taskbar',
			registerPalette: () => () => {},
			widgetLayer:    {},
			files:          {
				getTypes:   () => [ { type: 'shortcut' }, { type: 'folder' } ],
				getOpeners: () => [ { type: 'shortcut' } ],
			},
			getOsSettings:  () => ( { foldersSharingEnabled: true } ),
			getMenuItems:   () => [],
			listCommands:   () => [ { slug: 'open' } ],
			refreshMenu:    () => Promise.resolve(),
			getWallpaperSurfaces: () => [],
			registerModule: () => {},
			loadModules:    () => Promise.resolve(),
			ai:             {},
			dragBridge:     {},
			activity:       {
				subscribe: ( channel, cb ) => {
					if ( channel === 'desktop-mode/presence-changed' ) cb( { userId: 1, status: 'online' } );
					if ( channel === 'desktop-mode/presence-snapshot-applied' ) cb( { applied: 1 } );
					return () => {};
				},
			},
		};

		loadDesktopHooks();

		const log = window.__odd.diagnostics.recent().map( ( row ) => row.message ).join( '\n' );
		expect( log ).toContain( 'wp.desktop.surface-summary' );
		expect( log ).toContain( '"fileTypes":2' );
		expect( log ).toContain( '"hostWidgets":true' );
		expect( log ).toContain( '"desktopFiles":true' );
		expect( log ).toContain( '"sharedFolders":true' );
		expect( log ).toContain( 'wp.desktop.activity.desktop-mode/presence-changed' );
		expect( log ).toContain( 'wp.desktop.activity.desktop-mode/presence-snapshot-applied' );
		expect( log ).toContain( '"arrangeMenu":true' );
		expect( log ).toContain( '"systemTileApi":true' );
		expect( log ).toContain( '"commands":1' );
		expect( log ).toContain( '"palettesApi":true' );
		expect( log ).toContain( '"refreshMenu":true' );
		expect( log ).toContain( '"wallpaperSurfacesApi":true' );
		expect( log ).toContain( '"modulesApi":true' );
		expect( log ).toContain( '"ai":true' );
		expect( log ).toContain( '"dragBridge":true' );
	} );

	it( 'honors current Desktop Mode hook constants when Desktop Mode exposes them', () => {
		window.wp.desktop = {
			ready:      ( cb ) => cb(),
			openWindow: vi.fn(),
			HOOKS: {
				WINDOW_OPENED:               'desktop-mode.window.opened',
				IFRAME_ERROR:                'desktop-mode.iframe.error',
				WIDGET_MOUNTED:              'desktop-mode.widget.mounted',
				WALLPAPER_VISIBILITY:        'desktop-mode.wallpaper.visibility',
				WALLPAPER_SURFACES:          'desktop-mode.wallpaper.surfaces',
				NATIVE_WINDOW_BEFORE_RENDER: 'desktop-mode.native-window.before-render',
				ARRANGE_CUSTOM_ACTION:       'desktop-mode.arrange.custom-action',
				COMMAND_ERROR:               'desktop-mode.command.error',
				DESKTOP_ICON_CLICKED:        'desktop-mode.desktop-icon.clicked',
			},
		};
		const iframeErrors = [];
		const iconClicks = [];
		loadDesktopHooks();
		window.__odd.events.on( 'odd.iframe-error', ( payload ) => iframeErrors.push( payload ) );
		window.__odd.events.on( 'odd.desktop-icon-clicked', ( payload ) => iconClicks.push( payload ) );
		window.__odd.api = { shuffle: vi.fn() };

		window.wp.hooks.doAction( 'desktop-mode.window.opened', {
			windowId: 'odd-app-demo',
			title: 'Demo',
		} );
		window.wp.hooks.doAction( 'desktop-mode.iframe.error', { windowId: 'odd-app-demo', message: 'boom' } );
		window.wp.hooks.doAction( 'desktop-mode.wallpaper.visibility', { id: 'odd', state: 'hidden' } );

		const widget = document.createElement( 'div' );
		widget.innerHTML = '<button>Tap</button>';
		window.wp.hooks.doAction( 'desktop-mode.widget.mounted', { id: 'odd/weather', element: widget } );

		const nativeBody = document.createElement( 'div' );
		const filteredBody = window.wp.hooks.applyFilters(
			'desktop-mode.native-window.before-render',
			nativeBody,
			{ windowId: 'odd-app-demo' },
		);
		const surfaces = window.wp.hooks.applyFilters( 'desktop-mode.wallpaper.surfaces', [
			{ id: 'dock:edge', x: 0, y: 0, width: 48, height: 600 },
		] );
		const openItems = window.wp.hooks.applyFilters( 'desktop-mode.open-command.items', [] );
		window.wp.hooks.doAction( 'desktop-mode.arrange.custom-action', { id: 'oddout-shuffle-wallpaper' } );
		window.wp.hooks.doAction( 'desktop-mode.command.error', {
			slug: 'odd-panel',
			error: new Error( 'nope' ),
		} );
		window.wp.hooks.doAction( 'desktop-mode.desktop-icon.clicked', { id: 'odd', target: 'window' } );

		expect( window.__odd.desktopState.windows.focusedId ).toBe( 'odd-app-demo' );
		expect( iframeErrors ).toHaveLength( 1 );
		expect( window.__odd.desktopState.wallpaper.state ).toBe( 'hidden' );
		expect( widget.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( filteredBody ).toBe( nativeBody );
		expect( nativeBody.getAttribute( 'data-odd-native-window' ) ).toBe( 'odd-app-demo' );
		expect( surfaces ).toHaveLength( 1 );
		expect( window.__odd.desktopState.surfaces.count ).toBe( 1 );
		expect( openItems.map( ( item ) => item.id ) ).toContain( 'odd' );
		expect( window.__odd.api.shuffle ).toHaveBeenCalledTimes( 1 );
		expect( iconClicks ).toEqual( [ { id: 'odd', target: 'window' } ] );
	} );

	it( 'handles ODD custom Arrange menu actions', () => {
		const shuffle = vi.fn();
		const tidyWidgets = vi.fn();
		const openPanel = vi.fn();
		const resetDecorations = vi.fn();
		window.wp.desktop = { ready: ( cb ) => cb() };
		loadDesktopHooks();
		window.__odd.api = {
			shuffle,
			tidyWidgets,
			openPanel,
			resetDecorations,
		};

		window.wp.hooks.doAction( 'desktop-mode.arrange.custom-action', { id: 'oddout-shuffle-wallpaper' } );
		window.wp.hooks.doAction( 'desktop-mode.arrange.custom-action', { id: 'oddout-tidy-widgets' } );
		window.wp.hooks.doAction( 'desktop-mode.arrange.custom-action', { id: 'oddout-open-shop' } );
		window.wp.hooks.doAction( 'desktop-mode.arrange.custom-action', { id: 'oddout-reset-decorations' } );

		expect( shuffle ).toHaveBeenCalledTimes( 1 );
		expect( tidyWidgets ).toHaveBeenCalledTimes( 1 );
		expect( openPanel ).toHaveBeenCalledTimes( 1 );
		expect( resetDecorations ).toHaveBeenCalledTimes( 1 );

		const log = window.__odd.diagnostics.recent().map( ( row ) => row.message ).join( '\n' );
		expect( log ).toContain( 'desktop-mode.arrange.custom-action' );
		expect( log ).toContain( '"handled":true' );
	} );

	it( 'maps current WP Desktop Mode desktop area and icon surfaces', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		const shell = document.createElement( 'div' );
		shell.id = 'wp-desktop-shell';
		const area = document.createElement( 'div' );
		area.id = 'wp-desktop-area';
		const icons = document.createElement( 'div' );
		icons.className = 'wp-desktop-icons';
		const icon = document.createElement( 'button' );
		icon.className = 'wp-desktop-icon';
		icons.appendChild( icon );
		area.appendChild( icons );
		shell.appendChild( area );
		document.body.appendChild( shell );

		loadDesktopHooks();

		expect( shell.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( area.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( icons.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( icon.getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
	} );

	it( 'injects active cursor stylesheets into same-origin iframe ready payloads', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		const injectInto = vi.fn();
		window.__odd.cursors = { injectInto };
		loadDesktopHooks();

		const doc = document.implementation.createHTMLDocument( 'frame' );
		window.wp.hooks.doAction( 'desktop-mode.iframe.ready', {
			windowId: 'plugins',
			document: doc,
		} );

		expect( injectInto ).toHaveBeenCalledWith( doc );
	} );

	it( 'maps non-ODD native windows discovered by window id fallback selectors', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		loadDesktopHooks();

		const win = document.createElement( 'div' );
		win.setAttribute( 'data-window-id', 'plugins' );
		win.innerHTML = '<div data-window-titlebar></div><button>Close</button><textarea></textarea>';
		document.body.appendChild( win );

		window.wp.hooks.doAction( 'desktop-mode.window.content-loaded', {
			windowId: 'plugins',
		} );

		expect( win.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( win.querySelector( '[data-window-titlebar]' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'grab' );
		expect( win.querySelector( 'button' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
		expect( win.querySelector( 'textarea' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'text' );
	} );

	it( 'adds ODD entries to Desktop Mode open command suggestions', () => {
		const openWindow = vi.fn();
		window.odd.apps = [ { slug: 'timer', name: 'Timer' } ];
		window.wp.desktop = { ready: ( cb ) => cb(), openWindow };
		loadDesktopHooks();

		const items = window.wp.hooks.applyFilters( 'desktop-mode.open-command.items', [] );
		expect( items.map( ( item ) => item.id ) ).toEqual( expect.arrayContaining( [ 'odd', 'odd-app-timer' ] ) );

		items.find( ( item ) => item.id === 'odd-app-timer' ).open();
		expect( openWindow ).toHaveBeenCalledWith( 'odd-app-timer', {
			source: 'desktop-mode.open-command.items',
		} );
	} );

	it( 'adds ODD file and wallpaper context menu integrations', () => {
		const openPanel = vi.fn( () => true );
		const shuffle = vi.fn( () => true );
		window.wp.desktop = { ready: ( cb ) => cb() };
		window.__odd.api = {
			openPanel,
			shuffle,
			tidyWidgets: vi.fn( () => true ),
			resetDecorations: vi.fn( () => true ),
			openOsSettings: vi.fn( () => true ),
		};
		loadDesktopHooks();

		const fileItems = window.wp.hooks.applyFilters(
			'desktop-mode.files.tile-menu',
			[ { id: 'rename', label: 'Rename' } ],
			{ file: { type: 'odd-bundle', name: 'sparkles.wp' } },
		);
		expect( fileItems.map( ( item ) => item.id ) ).toEqual( [ 'oddout-open-file', 'rename' ] );
		fileItems[ 0 ].onSelect();
		expect( window.__odd.pendingDesktopFile.file.name ).toBe( 'sparkles.wp' );
		expect( openPanel ).toHaveBeenCalledTimes( 1 );

		const wallpaperItems = window.wp.hooks.applyFilters( 'desktop-mode.wallpaper-context-menu', [] );
		expect( wallpaperItems.map( ( item ) => item.id ) ).toEqual( expect.arrayContaining( [
			'oddout-open-shop',
			'oddout-shuffle-wallpaper',
			'oddout-open-settings',
		] ) );
		wallpaperItems.find( ( item ) => item.id === 'oddout-shuffle-wallpaper' ).onSelect();
		expect( shuffle ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'routes .wp and .odd OS file drops into ODD before Media Library upload', () => {
		const openPanel = vi.fn( () => true );
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			HOOKS: {
				FILE_DROP_FILES_DETECTED: 'desktop-mode.drop.files-detected',
				FILE_DROP_BEFORE_UPLOAD: 'desktop-mode.drop.before-upload',
			},
		};
		window.__odd.api = {
			openPanel,
		};
		loadDesktopHooks();

		const bundle = new File( [ 'bundle' ], 'sparkles.wp', { type: 'application/octet-stream' } );
		const odd = new File( [ '{}' ], 'workspace.odd', { type: 'application/json' } );
		const image = new File( [ 'png' ], 'photo.png', { type: 'image/png' } );

		const keep = window.wp.hooks.applyFilters(
			'desktop-mode.drop.files-detected',
			[ bundle, image ],
			{ surface: 'wallpaper' },
		);
		expect( keep ).toEqual( [ image ] );
		expect( window.__odd.pendingDesktopFile.file.name ).toBe( 'sparkles.wp' );
		expect( openPanel ).toHaveBeenCalledTimes( 1 );

		const beforeUpload = window.wp.hooks.applyFilters(
			'desktop-mode.drop.before-upload',
			{ file: odd, mime: 'application/json', fields: {} },
			{ surface: 'window', windowId: 'odd' },
		);
		expect( beforeUpload ).toBeNull();
		expect( window.__odd.pendingDesktopFile.file.name ).toBe( 'workspace.odd' );
		expect( window.__odd.desktopState.supports.fileDrop ).toBe( true );
	} );

	it( 'offers My WordPress preview actions for uploaded ODD bundles only', () => {
		const openPanel = vi.fn( () => true );
		window.wp.desktop = { ready: ( cb ) => cb() };
		window.__odd.api = { openPanel };
		loadDesktopHooks();

		const regular = window.wp.hooks.applyFilters(
			'desktop-mode.my-wordpress.preview-actions',
			[],
			{ kind: 'media', mime: 'image/png', item: { id: 1, source_url: 'https://example.test/photo.png' } },
		);
		const bundle = window.wp.hooks.applyFilters(
			'desktop-mode.my-wordpress.preview-actions',
			[],
			{ kind: 'media', mime: 'application/zip', item: { id: 2, source_url: 'https://example.test/oddling.wp' } },
		);

		expect( regular ).toEqual( [] );
		expect( bundle.map( ( action ) => action.id ) ).toContain( 'odd/open-media-bundle' );
		bundle.find( ( action ) => action.id === 'odd/open-media-bundle' ).onSelect();
		expect( window.__odd.pendingDesktopFile.file.name ).toBe( 'oddling.wp' );
		expect( openPanel ).toHaveBeenCalledTimes( 1 );
		expect( window.__odd.desktopState.supports.myWordPress ).toBe( true );
	} );

	it( 'bridges ODD runtime events to sanitized Desktop Mode window notices', () => {
		const registerWindowNotice = vi.fn( () => () => {} );
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			registerWindowNotice,
		};
		loadDesktopHooks();

		window.__odd.events.emit( 'odd.error', { message: '<img src=x onerror=alert(1)>' } );
		window.__odd.events.emit( 'odd.bundle-installed', { slug: 'sparkles' } );

		expect( registerWindowNotice ).toHaveBeenCalledWith( expect.objectContaining( {
			id: 'odd/runtime-health',
			tone: 'warning',
			match: { window: 'odd' },
		} ) );
		expect( registerWindowNotice.mock.calls[ 0 ][ 0 ].message ).not.toContain( '<img' );
		expect( registerWindowNotice ).toHaveBeenCalledWith( expect.objectContaining( {
			id: 'odd/install-complete',
			tone: 'success',
		} ) );
		expect( window.__odd.desktopState.supports.windowNotices ).toBe( true );
	} );

	it( 'tracks ODD app window lifecycle as local state', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		const changes = [];
		loadDesktopHooks();
		window.__odd.events.on( 'odd.app-window-state-changed', ( payload ) => changes.push( payload ) );

		window.wp.hooks.doAction( 'desktop-mode.window.opened', {
			windowId: 'odd-app-timer',
			state: 'normal',
		} );
		window.wp.hooks.doAction( 'desktop-mode.window.focused', {
			windowId: 'odd-app-timer',
			state: 'normal',
		} );

		expect( window.__odd.appWindows.count ).toBe( 1 );
		expect( window.__odd.appWindows.focusedSlug ).toBe( 'timer' );
		expect( window.__odd.appWindows.bySlug.timer ).toMatchObject( {
			slug: 'timer',
			windowId: 'odd-app-timer',
			focused: true,
		} );

		window.wp.hooks.doAction( 'desktop-mode.window.closed', { windowId: 'odd-app-timer' } );
		expect( window.__odd.appWindows.count ).toBe( 0 );
		expect( changes.map( ( payload ) => payload.reason ) ).toEqual( [ 'opened', 'focused', 'closed' ] );
	} );

	it( 'records command lifecycle diagnostics for ODD commands', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		loadDesktopHooks();

		window.wp.hooks.applyFilters( 'desktop-mode.command.before-run', { slug: 'shuffle', args: '' } );
		window.wp.hooks.doAction( 'desktop-mode.command.error', {
			slug: 'odd-panel',
			error: new Error( 'nope' ),
		} );

		const log = window.__odd.diagnostics.recent().map( ( row ) => row.message );
		expect( log.some( ( row ) => row.includes( 'desktop-mode.command.before-run' ) ) ).toBe( true );
		expect( log.some( ( row ) => row.includes( 'desktop-mode.command.error' ) ) ).toBe( true );
	} );

	it( 're-runs app window registration when host native-windows registry gains odd-app-*', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		const registerWpdmCallbacks = vi.fn();
		window.__odd.apps = { registerWpdmCallbacks };
		loadDesktopHooks();

		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-registry-changed', {
				detail: { registry: 'native-windows', added: [ 'plugins' ], removed: [] },
			} ),
		);
		expect( registerWpdmCallbacks ).not.toHaveBeenCalled();

		document.dispatchEvent(
			new CustomEvent( 'desktop-mode-registry-changed', {
				detail: { registry: 'native-windows', added: [ 'odd-app-timer' ], removed: [] },
			} ),
		);
		expect( registerWpdmCallbacks ).toHaveBeenCalledTimes( 1 );
	} );
} );
