import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const CURSORS_JS = resolve( __dirname, '../../odd/src/cursors/index.js' );

function installHooks() {
	const handlers = new Map();
	window.wp = {
		hooks: {
			addAction: ( name, _ns, fn ) => {
				if ( ! handlers.has( name ) ) handlers.set( name, [] );
				handlers.get( name ).push( fn );
			},
			doAction: ( name, ...args ) => {
				( handlers.get( name ) || [] ).forEach( ( fn ) => fn( ...args ) );
			},
		},
	};
}

function loadRuntime() {
	const src = readFileSync( CURSORS_JS, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=cursors/index.js` );
	fn.call( globalThis );
}

describe( 'ODD cursor runtime', () => {
	beforeEach( () => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
		document.body.className = '';
		document.documentElement.style.removeProperty( '--odd-cursor-default' );
		document.documentElement.style.removeProperty( '--odd-cursor-pointer' );
		document.documentElement.className = '';
		Object.defineProperty( window, 'matchMedia', {
			value:        undefined,
			writable:     true,
			configurable: true,
		} );
		delete document.__oddCursorBridge;
		window.__odd = { debug: {} };
		window.odd = {
			cursorSet:        'oddlings-cursors',
			cursorStylesheet: '/wp-json/odd/v1/cursors/active.css?set=oddlings-cursors&v=test',
			cursorSets:       [
				{
					slug:    'oddlings-cursors',
					cursors: {
						default: { url: 'https://example.com/default.svg', hotspot: [ 4, 4 ] },
						pointer: { url: 'https://example.com/pointer.svg', hotspot: [ 18, 6 ] },
					},
				},
			],
		};
		delete window.desktopModeConfig;
		installHooks();
	} );

	it( 'creates the cursor stylesheet link on boot', () => {
		loadRuntime();

		const link = document.getElementById( 'odd-cursors-css' );
		expect( link ).toBeTruthy();
		expect( link.getAttribute( 'href' ) ).toContain( 'set=oddlings-cursors' );
		expect( window.__odd.debug.cursors().link ).toBe( true );
	} );

	it( 'updates and clears the existing link through the public API', () => {
		loadRuntime();

		window.__odd.cursors.apply( '/cursor.css?set=other', 'other' );
		expect( document.getElementById( 'odd-cursors-css' ).getAttribute( 'href' ) ).toBe( '/cursor.css?set=other' );
		expect( window.odd.cursorSet ).toBe( 'other' );

		window.__odd.cursors.clear();
		expect( document.getElementById( 'odd-cursors-css' ) ).toBeNull();
		expect( window.odd.cursorStylesheet ).toBe( '' );
	} );

	it( 'responds to the odd.cursorSet hook', () => {
		loadRuntime();

		window.wp.hooks.doAction( 'odd.cursorSet', 'preview-cursors', '/cursor.css?set=preview-cursors' );

		const link = document.getElementById( 'odd-cursors-css' );
		expect( link.getAttribute( 'href' ) ).toBe( '/cursor.css?set=preview-cursors' );
		expect( window.__odd.cursors.status().activeSlug ).toBe( 'preview-cursors' );
	} );

	it( 'injects the current stylesheet into same-origin iframe documents', () => {
		loadRuntime();
		const iframe = document.createElement( 'iframe' );
		document.body.appendChild( iframe );
		const iframeDoc = iframe.contentDocument;
		iframeDoc.body.innerHTML = '<button>Frame Button</button>';

		window.__odd.cursors.injectInto( iframeDoc );

		const link = iframeDoc.getElementById( 'odd-cursors-css' );
		expect( link ).toBeTruthy();
		expect( link.getAttribute( 'href' ) ).toContain( 'set=oddlings-cursors' );
		iframeDoc.querySelector( 'button' ).dispatchEvent( new iframe.contentWindow.MouseEvent( 'pointerover', { bubbles: true, composed: true } ) );
		expect( iframeDoc.querySelector( 'button' ).style.cursor ).toContain( 'pointer.svg' );
	} );

	it( 'bridges host elements that compute to native pointer cursors', () => {
		loadRuntime();
		const item = document.createElement( 'div' );
		item.style.cursor = 'pointer';
		document.body.appendChild( item );

		window.__odd.cursors.bridgeTarget( item );

		expect( item.style.cursor ).toContain( 'pointer.svg' );
		expect( window.__odd.cursors.status().bridged ).toBe( 1 );

		window.__odd.cursors.clear();
		expect( item.style.cursor ).toBe( 'pointer' );
	} );

	it( 'uses important inline cursor priority inside Desktop Mode cursor resets', () => {
		document.body.className = 'desktop-mode-active';
		const reset = document.createElement( 'style' );
		reset.textContent = 'body.desktop-mode-active, body.desktop-mode-active * { cursor: default !important; }';
		document.head.appendChild( reset );
		loadRuntime();
		const item = document.createElement( 'button' );
		item.textContent = 'Pinned';
		document.body.appendChild( item );

		window.__odd.cursors.bridgeTarget( item );

		expect( item.style.cursor ).toContain( 'pointer.svg' );
		expect( item.style.getPropertyPriority( 'cursor' ) ).toBe( 'important' );

		window.__odd.cursors.clear();
		expect( item.style.cursor ).toBe( '' );
		expect( item.style.getPropertyPriority( 'cursor' ) ).toBe( '' );
	} );

	it( 'bridges icon children that are under Desktop Mode cursor resets', () => {
		document.body.className = 'desktop-mode-active';
		const reset = document.createElement( 'style' );
		reset.textContent = 'body.desktop-mode-active, body.desktop-mode-active * { cursor: default !important; }';
		document.head.appendChild( reset );
		const icon = document.createElement( 'button' );
		icon.className = 'desktop-mode-icon';
		const image = document.createElement( 'img' );
		image.className = 'desktop-mode-icon__image';
		icon.appendChild( image );
		document.body.appendChild( icon );

		loadRuntime();
		window.__odd.cursors.bridgeTarget( image );

		expect( image.style.cursor ).toContain( 'pointer.svg' );
		expect( image.style.getPropertyPriority( 'cursor' ) ).toBe( 'important' );
		expect( icon.style.cursor ).toContain( 'pointer.svg' );
		expect( window.__odd.cursors.status().lastResolved.roleOwner.className ).toContain( 'desktop-mode-icon' );
	} );

	it( 'falls back to loaded stylesheet variables when cursor-set config is stale', () => {
		window.odd.cursorSet = 'new-cursors';
		window.odd.cursorSets = [];
		document.documentElement.style.setProperty( '--odd-cursor-default', 'url("https://example.com/css-default.svg") 1 2, default' );
		document.documentElement.style.setProperty( '--odd-cursor-pointer', 'url("https://example.com/css-pointer.svg") 3 4, pointer' );
		loadRuntime();
		const item = document.createElement( 'button' );
		document.body.appendChild( item );

		window.__odd.cursors.bridgeTarget( item );

		expect( item.style.cursor ).toContain( 'css-pointer.svg' );
		expect( item.style.cursor ).toContain( '3 4' );
	} );

	it( 'stamps semantic roles and resolves them through the runtime controller', () => {
		loadRuntime();
		const shell = document.createElement( 'div' );
		shell.className = 'desktop-mode-shell';
		const tile = document.createElement( 'button' );
		tile.style.cursor = 'pointer';
		shell.appendChild( tile );
		document.body.appendChild( shell );

		window.__odd.cursors.markRoot( shell );
		window.__odd.cursors.mark( tile, 'pointer' );
		window.__odd.cursors.bridgeTarget( tile );

		expect( tile.getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );
		expect( tile.style.cursor ).toContain( 'pointer.svg' );
		expect( window.__odd.cursors.status().bridged ).toBe( 1 );
		expect( window.__odd.cursors.status().semantics.pointer ).toBeGreaterThan( 0 );
	} );

	it( 'maps current WP Desktop Mode desktop surfaces on boot', () => {
		const shell = document.createElement( 'div' );
		shell.id = 'wp-desktop-shell';
		const area = document.createElement( 'div' );
		area.id = 'wp-desktop-area';
		const icon = document.createElement( 'button' );
		icon.className = 'wp-desktop-icon';
		area.appendChild( icon );
		shell.appendChild( area );
		document.body.appendChild( shell );

		loadRuntime();

		expect( shell.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( area.getAttribute( 'data-odd-cursor-root' ) ).toBe( 'true' );
		expect( icon.getAttribute( 'data-odd-cursor' ) ).toBe( 'pointer' );

		area.dispatchEvent( new window.MouseEvent( 'pointerover', { bubbles: true, composed: true } ) );
		expect( area.style.cursor ).toContain( 'default.svg' );
		icon.dispatchEvent( new window.MouseEvent( 'pointerover', { bubbles: true, composed: true } ) );
		expect( icon.style.cursor ).toContain( 'pointer.svg' );
		expect( window.__odd.cursors.status().desktop.roots ).toBeGreaterThan( 0 );
	} );

	it( 'reports mapped Desktop Mode window roots in diagnostics', () => {
		loadRuntime();
		const win = document.createElement( 'div' );
		win.setAttribute( 'data-window-id', 'plugins' );
		document.body.appendChild( win );

		window.__odd.cursors.markRoot( win );

		expect( window.__odd.cursors.status().windows.roots ).toBe( 1 );
	} );

	it( 'bridges unstamped titlebars inside a marked native-window root', () => {
		loadRuntime();

		// Simulate the shape WP Desktop Mode produces: a window root
		// that we've marked with data-odd-cursor-root, containing a
		// titlebar element with an inline `cursor: grab` but *no*
		// data-odd-cursor stamp (this is the gap that causes "cursor
		// doesn't work on the title bar" bug reports).
		const shell = document.createElement( 'div' );
		shell.className = 'desktop-mode-shell';
		const win = document.createElement( 'div' );
		win.setAttribute( 'data-window-id', 'odd' );
		const titlebar = document.createElement( 'div' );
		titlebar.style.cursor = 'grab';
		win.appendChild( titlebar );
		shell.appendChild( win );
		document.body.appendChild( shell );

		window.__odd.cursors.markRoot( win );
		window.__odd.cursors.bridgeTarget( titlebar );

		expect( titlebar.style.cursor ).toContain( 'url(' );
		expect( window.__odd.cursors.status().bridged ).toBeGreaterThanOrEqual( 1 );
	} );

	it( 'resolves close buttons inside native window chrome from real events', () => {
		loadRuntime();

		const win = document.createElement( 'div' );
		win.setAttribute( 'data-window-id', 'odd' );
		const titlebar = document.createElement( 'div' );
		titlebar.setAttribute( 'data-window-titlebar', '' );
		titlebar.style.cursor = 'grab';
		const close = document.createElement( 'button' );
		close.setAttribute( 'aria-label', 'Close' );
		close.style.cursor = 'pointer';
		titlebar.appendChild( close );
		win.appendChild( titlebar );
		document.body.appendChild( win );

		window.__odd.cursors.observeSurface( win, { source: 'test' } );
		close.dispatchEvent( new window.MouseEvent( 'pointerover', { bubbles: true, composed: true } ) );

		expect( close.style.cursor ).toContain( 'url(' );
		expect( close.style.cursor ).toContain( 'pointer.svg' );
		expect( window.__odd.cursors.status().lastResolved.role ).toBe( 'pointer' );
	} );

	it( 'observes late chrome replacements after the surface was registered', () => {
		loadRuntime();

		const win = document.createElement( 'div' );
		win.setAttribute( 'data-window-id', 'odd' );
		document.body.appendChild( win );
		window.__odd.cursors.observeSurface( win, { source: 'test' } );

		const close = document.createElement( 'button' );
		close.setAttribute( 'aria-label', 'Close' );
		close.style.cursor = 'pointer';
		win.appendChild( close );
		close.dispatchEvent( new window.MouseEvent( 'pointerover', { bubbles: true, composed: true } ) );

		expect( close.style.cursor ).toContain( 'pointer.svg' );
		expect( window.__odd.cursors.status().observedSurfaces ).toBeGreaterThanOrEqual( 1 );
	} );

	it( 'uses composed paths for controls inside open shadow roots', () => {
		loadRuntime();

		const host = document.createElement( 'div' );
		const shadow = host.attachShadow( { mode: 'open' } );
		const close = document.createElement( 'button' );
		close.setAttribute( 'aria-label', 'Close' );
		close.style.cursor = 'pointer';
		shadow.appendChild( close );
		document.body.appendChild( host );

		window.__odd.cursors.observeSurface( document.body, { source: 'test' } );
		close.dispatchEvent( new window.MouseEvent( 'pointerover', { bubbles: true, composed: true } ) );

		expect( close.style.cursor ).toContain( 'pointer.svg' );
		expect( window.__odd.cursors.status().shadowRoots ).toBeGreaterThanOrEqual( 1 );
	} );

	it( 'creates a live cursor aura on Desktop surfaces using the active cursor artwork', () => {
		const shell = document.createElement( 'div' );
		shell.className = 'desktop-mode-shell';
		const icon = document.createElement( 'button' );
		icon.className = 'desktop-mode-icon';
		shell.appendChild( icon );
		document.body.appendChild( shell );

		loadRuntime();
		const event = new window.MouseEvent( 'pointermove', { bubbles: true, composed: true, clientX: 123, clientY: 234 } );
		event.getCoalescedEvents = () => [ { clientX: 124, clientY: 235 } ];
		event.getPredictedEvents = () => [ { clientX: 130, clientY: 240 } ];
		icon.dispatchEvent( event );

		const layer = document.getElementById( 'odd-live-cursor' );
		expect( layer ).toBeTruthy();
		expect( layer.getAttribute( 'data-visible' ) ).toBe( 'true' );
		expect( layer.getAttribute( 'data-role' ) ).toBe( 'pointer' );
		expect( layer.getAttribute( 'data-mode' ) ).toBe( 'aura' );
		expect( layer.style.getPropertyValue( '--odd-cursor-image' ) ).toContain( 'pointer.svg' );
		expect( layer.style.getPropertyValue( '--odd-cursor-x' ) ).toBe( '130px' );
		expect( window.__odd.cursors.status().layer.visible ).toBe( true );
		expect( window.__odd.cursors.status().layer.coalesced ).toBe( 1 );
		expect( window.__odd.cursors.status().layer.predicted ).toBe( 1 );
	} );

	it( 'simplifies the live cursor layer over text targets', () => {
		const shell = document.createElement( 'div' );
		shell.className = 'desktop-mode-shell';
		const input = document.createElement( 'input' );
		input.type = 'text';
		shell.appendChild( input );
		document.body.appendChild( shell );

		loadRuntime();
		input.dispatchEvent( new window.MouseEvent( 'pointermove', { bubbles: true, composed: true, clientX: 20, clientY: 30 } ) );

		const layer = document.getElementById( 'odd-live-cursor' );
		expect( layer.getAttribute( 'data-role' ) ).toBe( 'text' );
		expect( layer.getAttribute( 'data-soft' ) ).toBe( 'true' );
	} );

	it( 'respects reduced motion by leaving the live cursor layer inactive', () => {
		window.matchMedia = ( query ) => ( {
			matches: query.includes( 'prefers-reduced-motion' ),
			media: query,
			addEventListener: () => {},
			removeEventListener: () => {},
		} );
		const shell = document.createElement( 'div' );
		shell.className = 'desktop-mode-shell';
		const icon = document.createElement( 'button' );
		icon.className = 'desktop-mode-icon';
		shell.appendChild( icon );
		document.body.appendChild( shell );

		loadRuntime();
		icon.dispatchEvent( new window.MouseEvent( 'pointermove', { bubbles: true, composed: true, clientX: 44, clientY: 55 } ) );

		expect( document.getElementById( 'odd-live-cursor' ) ).toBeNull();
		expect( window.__odd.cursors.status().layer.enabled ).toBe( false );
	} );

	it( 'supports replace mode by hiding native cursor output on live surfaces', () => {
		window.odd.cursorLayerMode = 'replace';
		const shell = document.createElement( 'div' );
		shell.className = 'desktop-mode-shell';
		const icon = document.createElement( 'button' );
		icon.className = 'desktop-mode-icon';
		shell.appendChild( icon );
		document.body.appendChild( shell );

		loadRuntime();
		icon.dispatchEvent( new window.MouseEvent( 'pointermove', { bubbles: true, composed: true, clientX: 66, clientY: 77 } ) );

		const layer = document.getElementById( 'odd-live-cursor' );
		expect( layer.getAttribute( 'data-mode' ) ).toBe( 'replace' );
		expect( icon.style.cursor ).toBe( 'none' );
		expect( window.__odd.cursors.status().lastResolved.cursor ).toContain( 'pointer.svg' );
		expect( window.__odd.cursors.status().lastResolved.nativeCursor ).toBe( 'none' );
	} );

	it( 'captures drag pointers and presents grab as grabbing while pressed', () => {
		const shell = document.createElement( 'div' );
		shell.className = 'desktop-mode-shell';
		const titlebar = document.createElement( 'div' );
		titlebar.setAttribute( 'data-drag', 'true' );
		titlebar.setPointerCapture = vi.fn();
		shell.appendChild( titlebar );
		document.body.appendChild( shell );

		loadRuntime();
		const event = new window.MouseEvent( 'pointerdown', { bubbles: true, composed: true, clientX: 88, clientY: 99 } );
		Object.defineProperty( event, 'pointerId', { value: 7 } );
		Object.defineProperty( event, 'pointerType', { value: 'mouse' } );
		Object.defineProperty( event, 'pressure', { value: 0.7 } );
		Object.defineProperty( event, 'tiltX', { value: 12 } );
		Object.defineProperty( event, 'tiltY', { value: -6 } );
		Object.defineProperty( event, 'twist', { value: 30 } );
		Object.defineProperty( event, 'width', { value: 9 } );
		Object.defineProperty( event, 'height', { value: 5 } );
		titlebar.dispatchEvent( event );

		const layer = document.getElementById( 'odd-live-cursor' );
		expect( titlebar.setPointerCapture ).toHaveBeenCalledWith( 7 );
		expect( layer.getAttribute( 'data-role' ) ).toBe( 'grabbing' );
		expect( layer.getAttribute( 'data-pressed' ) ).toBe( 'true' );
		expect( window.__odd.cursors.status().layer.pressure ).toBe( 0.7 );
		expect( window.__odd.cursors.status().layer.tiltX ).toBe( 12 );
		expect( window.__odd.cursors.status().layer.twist ).toBe( 30 );
		expect( window.__odd.cursors.status().layer.contact ).toBe( 9 );
	} );
} );
