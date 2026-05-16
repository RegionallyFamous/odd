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
				cursorSet: 'oddlings',
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

	it( 'keeps the ODD Shop host window near the top when the host opens it too low', () => {
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

		expect( element.style.top ).toBe( '32px' );
		expect( win.config.y ).toBe( 32 );
		expect( emitChange ).toHaveBeenCalledWith( 'moved' );
		expect( window.__odd.desktopState.windows.all.find( ( row ) => row.id === 'odd' ).bounds.y ).toBe( 32 );
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

	it( 'decorates ODD dock tiles without replacing the tile element', () => {
		window.wp.desktop = { ready: ( cb ) => cb() };
		loadDesktopHooks();

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
		window.wp.hooks.doAction( 'desktop-mode.file.updated', {
			id: 'file:notes',
			element: file,
		} );

		expect( file.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( file.querySelector( '.desktop-mode-files__tile' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
		expect( file.querySelector( 'wpd-context-menu-item' ).getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
	} );

	it( 'records Desktop Mode 0.8.5 file, presence, heartbeat, and arrange surfaces', () => {
		window.wp.desktop = {
			ready:          ( cb ) => cb(),
			registerWidget: () => {},
			widgetLayer:    {},
			files:          {
				getTypes:   () => [ { type: 'shortcut' }, { type: 'folder' } ],
				getOpeners: () => [ { type: 'shortcut' } ],
			},
			getOsSettings:  () => ( { foldersSharingEnabled: true } ),
			getMenuItems:   () => [],
			presence:       {},
			heartbeat:      {},
		};

		loadDesktopHooks();
		window.wp.hooks.doAction( 'desktop-mode.presence.changed', { userId: 1, status: 'online' } );
		window.wp.hooks.doAction( 'desktop-mode.heartbeat.pulse', { tick: 1 } );

		const log = window.__odd.diagnostics.recent().map( ( row ) => row.message ).join( '\n' );
		expect( log ).toContain( 'wp.desktop.surface-summary' );
		expect( log ).toContain( '"fileTypes":2' );
		expect( log ).toContain( '"hostWidgets":true' );
		expect( log ).toContain( '"desktopFiles":true' );
		expect( log ).toContain( '"sharedFolders":true' );
		expect( log ).toContain( 'desktop-mode.presence.changed' );
		expect( log ).toContain( 'desktop-mode.heartbeat.pulse' );
		expect( log ).toContain( '"arrangeMenu":true' );
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
		expect( openWindow ).toHaveBeenCalledWith( 'odd-app-timer' );
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
