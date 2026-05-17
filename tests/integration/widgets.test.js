/**
 * widgets.test.js — smoke-test the stock ODD widget bundles.
 *
 * Widgets ship as separate catalog bundles under
 * `_tools/catalog-sources/widgets/<slug>/`.
 * Each bundle exposes `window.desktopModeWidgets[id]`; metadata lives
 * in manifest.json and PHP hands it to Desktop Mode. This test loads
 * the bundle sources, asserts they do not self-register, then mounts
 * each widget against a detached DOM container and exercises the
 * minimum interactions:
 *
 *   - Sticky: typing saves through Desktop Mode ctx.storage after the debounce window.
 *   - Eight-ball: clicking adds `.is-shaking`, swaps the answer,
 *     and every decorative child has computed `pointer-events: none`.
 *
 * The pointer-events check is a direct regression guard for the
 * Magic 8-Ball fix in v1.4.3 — before the fix, clicks were eaten
 * by the shine/window/badge overlays and the ball never responded.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const WIDGETS_ROOT = resolve( __dirname, '../../_tools/catalog-sources/widgets' );
const CATALOG_BUNDLES_ROOT = resolve( __dirname, '../../site/catalog/v1/bundles' );
const FIRST_PARTY_WIDGETS = [
	{ slug: 'sticky', id: 'odd/sticky', cssRoot: '.odd-widget--sticky' },
	{ slug: 'eight-ball', id: 'odd/eight-ball', cssRoot: '.odd-widget--eight', assets: [ 'assets/oracle-texture.webp' ] },
	{ slug: 'spotify', id: 'odd/spotify', cssRoot: '.odd-widget--spotify' },
	{ slug: 'desk-pet-oddling', id: 'odd/desk-pet-oddling', cssRoot: '.odd-widget--desk-pet-oddling', assets: [ 'assets/oddling-sprites.webp' ] },
	{ slug: 'fortune-terminal', id: 'odd/fortune-terminal', cssRoot: '.odd-widget--fortune-terminal' },
	{ slug: 'plugin-panic-button', id: 'odd/plugin-panic-button', cssRoot: '.odd-widget--plugin-panic-button' },
	{ slug: 'tiny-aquarium', id: 'odd/tiny-aquarium', cssRoot: '.odd-widget--tiny-aquarium', assets: [ 'assets/aquarium-backdrop.webp', 'assets/fish-sprites.webp' ] },
].map( ( widget ) => ( {
	...widget,
	js: resolve( WIDGETS_ROOT, `${ widget.slug }/widget.js` ),
	css: resolve( WIDGETS_ROOT, `${ widget.slug }/widget.css` ),
	manifest: resolve( WIDGETS_ROOT, `${ widget.slug }/manifest.json` ),
	bundle: resolve( CATALOG_BUNDLES_ROOT, `widget-${ widget.slug }.wp` ),
} ) );
const WIDGET_MANIFESTS = FIRST_PARTY_WIDGETS.map( ( widget ) => widget.manifest );
const STICKY_CSS = FIRST_PARTY_WIDGETS.find( ( widget ) => widget.slug === 'sticky' ).css;
const EIGHTBALL_CSS = FIRST_PARTY_WIDGETS.find( ( widget ) => widget.slug === 'eight-ball' ).css;
const EIGHTBALL_ASSET = resolve( WIDGETS_ROOT, 'eight-ball/assets/oracle-texture.webp' );
const EIGHTBALL_BUNDLE = FIRST_PARTY_WIDGETS.find( ( widget ) => widget.slug === 'eight-ball' ).bundle;
const SPOTIFY_CSS = FIRST_PARTY_WIDGETS.find( ( widget ) => widget.slug === 'spotify' ).css;
const DESK_PET_ASSET = resolve( WIDGETS_ROOT, 'desk-pet-oddling/assets/oddling-sprites.webp' );
const TINY_AQUARIUM_ASSETS = [
	resolve( WIDGETS_ROOT, 'tiny-aquarium/assets/aquarium-backdrop.webp' ),
	resolve( WIDGETS_ROOT, 'tiny-aquarium/assets/fish-sprites.webp' ),
];

function installWpDesktop() {
	const registerWidget = vi.fn( () => {
		throw new Error( 'Widget bundles must expose window.desktopModeWidgets[id], not call wp.desktop.registerWidget().' );
	} );
	window.wp = window.wp || {};
	window.wp.desktop = {
		registerWidget,
		ready: ( cb ) => cb(),
	};
	return registerWidget;
}

/**
 * Vitest's jsdom build ships without a complete Storage implementation.
 * Install a small in-memory shim before each test so unexpected localStorage
 * writes are observable and do not leak between tests.
 */
function clearStorage() {
	const store = new Map();
	const api = {
		getItem:    ( k ) => ( store.has( k ) ? store.get( k ) : null ),
		setItem:    ( k, v ) => { store.set( String( k ), String( v ) ); },
		removeItem: ( k ) => { store.delete( k ); },
		clear:      () => { store.clear(); },
		key:        ( i ) => Array.from( store.keys() )[ i ] ?? null,
		get length() { return store.size; },
	};
	Object.defineProperty( window, 'localStorage', {
		value: api,
		configurable: true,
		writable: true,
	} );
}

function createCtxStorage( initial = {} ) {
	const values = new Map( Object.entries( initial ) );
	return {
		values,
		storage: {
			get:    ( key ) => values.has( key ) ? values.get( key ) : null,
			set:    ( key, value ) => { values.set( key, value ); },
			remove: ( key ) => { values.delete( key ); },
			clear:  () => { values.clear(); },
		},
	};
}

function widgetMount( id ) {
	return window.desktopModeWidgets && window.desktopModeWidgets[ id ];
}

function injectWidgetStyles() {
	const css = FIRST_PARTY_WIDGETS
		.map( ( widget ) => widget.css )
		.map( ( file ) => readFileSync( file, 'utf8' ) )
		.join( '\n' );
	const style = document.createElement( 'style' );
	style.id = 'odd-widgets-style';
	style.textContent = css;
	document.head.appendChild( style );
}

function loadWidgets() {
	for ( const widget of FIRST_PARTY_WIDGETS ) {
		const src = readFileSync( widget.js, 'utf8' );
		const fn = new Function( `${ src }\n//# sourceURL=widgets/${ widget.slug }/widget.js` );
		fn.call( globalThis );
	}
}

function zipListing( bundleFile ) {
	return execFileSync(
		'python3',
		[
			'-c',
			'import sys, zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))',
			bundleFile,
		],
		{ encoding: 'utf8' }
	);
}

describe( 'widgets registration', () => {
	let registerWidget;

	beforeEach( () => {
		document.body.innerHTML = '';
		clearStorage();
		registerWidget = installWpDesktop();
		loadWidgets();
	} );

	afterEach( () => {
		const s = document.getElementById( 'odd-widgets-style' );
		if ( s ) s.remove();
		vi.restoreAllMocks();
		vi.useRealTimers();
	} );

	it( 'exports mount callbacks and keeps metadata in manifests', () => {
		expect( registerWidget ).not.toHaveBeenCalled();

		const ids = Object.keys( window.desktopModeWidgets || {} ).sort();
		expect( ids ).toEqual( FIRST_PARTY_WIDGETS.map( ( widget ) => widget.id ).sort() );
		for ( const id of ids ) {
			expect( typeof window.desktopModeWidgets[ id ] ).toBe( 'function' );
		}

		for ( const file of WIDGET_MANIFESTS ) {
			const manifest = JSON.parse( readFileSync( file, 'utf8' ) );
			expect( manifest.id ).toMatch( /^odd\// );
			expect( manifest.entry ).toBe( 'widget.js' );
			expect( typeof manifest.label ).toBe( 'string' );
			expect( typeof manifest.icon ).toBe( 'string' );
			expect( manifest.css ).toEqual( [ 'widget.css' ] );
			expect( existsSync( resolve( dirname( file ), manifest.entry ) ) ).toBe( true );
			expect( existsSync( resolve( dirname( file ), manifest.css[ 0 ] ) ) ).toBe( true );
			expect( manifest.minWidth ).toBeGreaterThan( 0 );
			expect( manifest.minHeight ).toBeGreaterThan( 0 );
			expect( manifest.defaultWidth ).toBeGreaterThanOrEqual( manifest.minWidth );
			expect( manifest.defaultHeight ).toBeGreaterThanOrEqual( manifest.minHeight );
		}
	} );
} );

describe( 'sticky widget', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		clearStorage();
		installWpDesktop();
		loadWidgets();
	} );

	it( 'mounts, auto-saves text after the debounce window, and cleans up', () => {
		vi.useFakeTimers();

		const mount = widgetMount( 'odd/sticky' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );
		const { storage, values } = createCtxStorage();

		const cleanup = mount( container, { storage } );

		expect( container.querySelector( '.odd-sticky__paper' ) ).toBeTruthy();
		const ta = container.querySelector( 'textarea.odd-sticky__text' );
		expect( ta ).toBeTruthy();

		ta.value = 'hello sticky';
		ta.dispatchEvent( new Event( 'input' ) );

		vi.advanceTimersByTime( 500 );
		expect( values.get( 'text' ) ).toBe( 'hello sticky' );
		expect( window.localStorage.getItem( 'odd:sticky' ) ).toBeNull();

		expect( typeof cleanup ).toBe( 'function' );
		expect( () => cleanup() ).not.toThrow();
	} );

	it( 'restores prior content from Desktop Mode ctx.storage on mount', () => {
		window.localStorage.setItem( 'odd:sticky', 'ignored value' );

		const mount = widgetMount( 'odd/sticky' );
		const container = document.createElement( 'div' );
		const { storage } = createCtxStorage( { text: 'from storage' } );
		const cleanup = mount( container, { storage } );

		const ta = container.querySelector( 'textarea.odd-sticky__text' );
		expect( ta.value ).toBe( 'from storage' );
		cleanup();
	} );
} );

describe( 'eight-ball widget', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		clearStorage();
		installWpDesktop();
		injectWidgetStyles();
		loadWidgets();
	} );

	it( 'mounts, reacts to clicks, cycles the answer, and cleans up', () => {
		vi.useFakeTimers();

		const mount = widgetMount( 'odd/eight-ball' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const cleanup = mount( container, {} );

		const stage  = container.querySelector( '.odd-eight__stage' );
		const ball   = container.querySelector( '.odd-eight__ball' );
		const answer = container.querySelector( '.odd-eight__answer' );

		expect( stage ).toBeTruthy();
		expect( ball ).toBeTruthy();
		expect( answer ).toBeTruthy();
		expect( answer.textContent ).toBe( 'Ask a question' );

		stage.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( ball.classList.contains( 'is-shaking' ) ).toBe( true );

		vi.advanceTimersByTime( 600 );

		expect( ball.classList.contains( 'is-shaking' ) ).toBe( false );
		expect( answer.textContent ).not.toBe( 'Ask a question' );

		cleanup();
	} );

	it( 'fits long code-like answers without clipping against the triangle', () => {
		vi.useFakeTimers();
		vi.spyOn( Math, 'random' ).mockReturnValue( 0.37 );

		const mount = widgetMount( 'odd/eight-ball' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const cleanup = mount( container, {} );
		const stage  = container.querySelector( '.odd-eight__stage' );
		const answer = container.querySelector( '.odd-eight__answer' );

		stage.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		vi.advanceTimersByTime( 600 );

		expect( answer.textContent ).toBe( 'Ask again after\nwp_cache_flush()' );
		expect( answer.classList.contains( 'is-long' ) ).toBe( true );
		expect( answer.classList.contains( 'is-code' ) ).toBe( true );

		const css = readFileSync( EIGHTBALL_CSS, 'utf8' );
		expect( css ).toContain( '.odd-eight__triangle::before' );
		expect( css ).toContain( 'overflow-wrap: anywhere' );

		cleanup();
	} );

	it( 'pointer-events: none on every decorative child (regression guard)', () => {
		const mount = widgetMount( 'odd/eight-ball' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );
		mount( container, {} );

		const decorative = [
			'.odd-eight__shine',
			'.odd-eight__badge',
			'.odd-eight__window',
			'.odd-eight__triangle',
		];

		for ( const sel of decorative ) {
			const node = container.querySelector( sel );
			expect( node, `missing decorative element ${ sel }` ).toBeTruthy();
			const computed = window.getComputedStyle( node );
			expect( computed.pointerEvents, `${ sel } must have pointer-events: none` ).toBe( 'none' );
		}

		// The stage button itself must remain clickable.
		const stage = container.querySelector( '.odd-eight__stage' );
		const stageComputed = window.getComputedStyle( stage );
		expect( stageComputed.pointerEvents ).not.toBe( 'none' );
	} );

	it( 'ships the generated oracle texture in source and built bundle', () => {
		const css = readFileSync( EIGHTBALL_CSS, 'utf8' );
		expect( css ).toContain( 'assets/oracle-texture.webp' );
		expect( existsSync( EIGHTBALL_ASSET ) ).toBe( true );

		const listing = zipListing( EIGHTBALL_BUNDLE );
		expect( listing ).toContain( 'assets/oracle-texture.webp' );
	} );
} );

describe( 'new ODD Originals widgets', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		clearStorage();
		installWpDesktop();
		injectWidgetStyles();
		loadWidgets();
	} );

	afterEach( () => {
		const s = document.getElementById( 'odd-widgets-style' );
		if ( s ) s.remove();
		vi.restoreAllMocks();
		vi.useRealTimers();
		delete window.__odd;
	} );

	it( 'desk pet watches the cursor, reacts to Desktop Mode events, and cleans up', () => {
		const handlers = new Map();
		window.__odd = {
			events: {
				on: vi.fn( ( name, fn ) => {
					handlers.set( name, fn );
					return () => handlers.delete( name );
				} ),
				emit: vi.fn(),
			},
		};

		const mount = widgetMount( 'odd/desk-pet-oddling' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const cleanup = mount( container, {} );
		expect( container.querySelector( '.odd-oddling__sprite' ) ).toBeTruthy();
		expect( handlers.has( 'odd.window-bounds-changed' ) ).toBe( true );
		expect( handlers.has( 'odd.window-focused' ) ).toBe( true );
		expect( handlers.has( 'odd.desktop-layout-changed' ) ).toBe( true );

		window.dispatchEvent( new MouseEvent( 'pointermove', { clientX: 24, clientY: 42 } ) );
		expect( container.classList.contains( 'is-watching' ) ).toBe( true );
		expect( container.style.getPropertyValue( '--oddling-look-x' ) ).not.toBe( '' );

		handlers.get( 'odd.window-bounds-changed' )();
		expect( container.getAttribute( 'data-mood' ) ).toBe( 'surprised' );
		expect( container.classList.contains( 'is-surprised' ) ).toBe( true );

		expect( typeof cleanup ).toBe( 'function' );
		expect( () => cleanup() ).not.toThrow();
		expect( () => cleanup() ).not.toThrow();
		expect( handlers.size ).toBe( 0 );
	} );

	it( 'fortune terminal prints a new line and restores the last five lines', () => {
		vi.useFakeTimers();
		vi.spyOn( Math, 'random' ).mockReturnValue( 0.2 );

		const mount = widgetMount( 'odd/fortune-terminal' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );
		const { storage, values } = createCtxStorage();

		const cleanup = mount( container, { storage } );
		expect( container.querySelectorAll( '.odd-fortune__line' ).length ).toBe( 1 );

		const prompt = container.querySelector( '.odd-fortune__prompt' );
		prompt.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		vi.advanceTimersByTime( 4000 );

		const stored = values.get( 'lines' );
		expect( Array.isArray( stored ) ).toBe( true );
		expect( stored.length ).toBeGreaterThan( 1 );
		expect( stored.length ).toBeLessThanOrEqual( 5 );
		expect( container.querySelectorAll( '.odd-fortune__line' ).length ).toBe( stored.length );

		cleanup();
		container.innerHTML = '';
		const cleanupAgain = mount( container, { storage } );
		expect( container.querySelectorAll( '.odd-fortune__line' ).length ).toBe( stored.length );
		cleanupAgain();
	} );

	it( 'plugin panic button settles into a checklist and persists checklist state', () => {
		vi.useFakeTimers();

		const mount = widgetMount( 'odd/plugin-panic-button' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );
		const { storage, values } = createCtxStorage();

		const cleanup = mount( container, { storage } );
		const button = container.querySelector( '.odd-panic__button' );
		button.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( container.classList.contains( 'is-running' ) ).toBe( true );
		vi.advanceTimersByTime( 2000 );
		expect( container.classList.contains( 'is-calm' ) ).toBe( true );
		expect( container.querySelector( '.odd-panic__status' ).textContent ).toBe( 'Calm path found' );

		const first = container.querySelector( '.odd-panic__item' );
		first.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( values.get( 'checked' )[ 0 ] ).toBe( true );

		cleanup();
		container.innerHTML = '';
		const cleanupAgain = mount( container, { storage } );
		expect( container.querySelector( '.odd-panic__item' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
		cleanupAgain();
	} );

	it( 'tiny aquarium renders fish, adds a feed burst, and honors reduced motion', () => {
		Object.defineProperty( window, 'matchMedia', {
			value: vi.fn( ( query ) => ( {
				matches: query.includes( 'prefers-reduced-motion' ),
				media: query,
				addEventListener: vi.fn(),
				removeEventListener: vi.fn(),
				addListener: vi.fn(),
				removeListener: vi.fn(),
				dispatchEvent: vi.fn(),
			} ) ),
			configurable: true,
			writable: true,
		} );

		const mount = widgetMount( 'odd/tiny-aquarium' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const cleanup = mount( container, {} );
		expect( container.classList.contains( 'is-reduced' ) ).toBe( true );
		expect( container.querySelectorAll( '.odd-aquarium__fish' ).length ).toBe( 3 );

		const tank = container.querySelector( '.odd-aquarium__tank' );
		tank.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );
		expect( container.querySelector( '.odd-aquarium__burst' ) ).toBeTruthy();
		expect( container.querySelector( '.odd-aquarium__feed' ) ).toBeTruthy();
		expect( container.querySelector( '.odd-aquarium__status' ).textContent ).toBe( 'Bubbles!' );

		cleanup();
	} );
} );

describe( 'widget stylesheet scoping', () => {
	it( 'ships a source and bundled stylesheet for every first-party widget', () => {
		for ( const widget of FIRST_PARTY_WIDGETS ) {
			const manifest = JSON.parse( readFileSync( widget.manifest, 'utf8' ) );
			expect( manifest.css ).toEqual( [ 'widget.css' ] );
			expect( existsSync( widget.css ) ).toBe( true );

			const listing = zipListing( widget.bundle );
			expect( listing ).toContain( 'widget.css' );
		}
	} );

	it( 'ships runtime bitmap assets in source and built bundles', () => {
		expect( existsSync( DESK_PET_ASSET ) ).toBe( true );
		for ( const asset of TINY_AQUARIUM_ASSETS ) {
			expect( existsSync( asset ) ).toBe( true );
		}

		for ( const widget of FIRST_PARTY_WIDGETS.filter( ( item ) => item.assets ) ) {
			const listing = zipListing( widget.bundle );
			for ( const asset of widget.assets ) {
				expect( listing ).toContain( asset );
			}
		}
	} );

	it( 'keeps first-party widget CSS from styling sibling widgets', () => {
		for ( const widget of FIRST_PARTY_WIDGETS ) {
			const css = readFileSync( widget.css, 'utf8' );
			expect( css ).toContain( widget.cssRoot );
			expect( css ).not.toMatch( /(^|\n)\.odd-widget\s*\{/ );
			for ( const sibling of FIRST_PARTY_WIDGETS ) {
				if ( sibling.slug === widget.slug ) continue;
				expect( css ).not.toContain( sibling.cssRoot.replace( '.', '' ) );
			}
		}
	} );
} );

describe( 'spotify widget', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		clearStorage();
		installWpDesktop();
		injectWidgetStyles();
		loadWidgets();
	} );

	it( 'parser accepts every supported open.spotify.com URL shape', () => {
		const parse = window.__odd.widgets.spotify.parse;
		const cases = [
			[ 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M', 'playlist', '37i9dQZF1DXcBWIGoYBM5M' ],
			[ 'https://open.spotify.com/album/2noRn2Aes5aoNVsU6iWThc',    'album',    '2noRn2Aes5aoNVsU6iWThc' ],
			[ 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',    'track',    '4iV5W9uYEdYUVa79Axb7Rh' ],
			[ 'https://open.spotify.com/artist/6qqNVTkY8uBg9cP3Jd7DAH',   'artist',   '6qqNVTkY8uBg9cP3Jd7DAH' ],
			[ 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',     'show',     '4rOoJ6Egrf8K2IrywzwOMk' ],
			[ 'https://open.spotify.com/episode/7makk4oTQel546B0PZlDM5', 'episode',  '7makk4oTQel546B0PZlDM5' ],
			[ 'https://open.spotify.com/intl-en/track/4iV5W9uYEdYUVa79Axb7Rh', 'track', '4iV5W9uYEdYUVa79Axb7Rh' ],
			[ 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M', 'playlist', '37i9dQZF1DXcBWIGoYBM5M' ],
			[ '  https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc#x ', 'playlist', '37i9dQZF1DXcBWIGoYBM5M' ],
		];
		for ( const [ input, type, id ] of cases ) {
			const r = parse( input );
			expect( r, `failed to parse ${ input }` ).toBeTruthy();
			expect( r.type ).toBe( type );
			expect( r.id ).toBe( id );
			expect( r.openUrl ).toBe( `https://open.spotify.com/${ type }/${ id }` );
		}
	} );

	it( 'parser accepts spotify: URIs', () => {
		const parse = window.__odd.widgets.spotify.parse;
		const r = parse( 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' );
		expect( r ).toBeTruthy();
		expect( r.type ).toBe( 'playlist' );
		expect( r.id ).toBe( '37i9dQZF1DXcBWIGoYBM5M' );
		expect( r.originalUrl ).toBe( 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' );
	} );

	it( 'parser rejects HTML, javascript: URLs, and non-Spotify hosts', () => {
		const parse = window.__odd.widgets.spotify.parse;
		const bad = [
			'',
			'   ',
			'not a url',
			'<iframe src="https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M"></iframe>',
			'javascript:alert(1)',
			'https://evil.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
			'https://open.spotify.com/user/foo',
			'https://open.spotify.com/playlist/!!!',
			'spotify:user:foo',
			'https://open.spotify.com/playlist/',
			'spotify:playlist:',
			'https://spotify.link/AbCdEf',
		];
		for ( const input of bad ) {
			expect( parse( input ), `leaked: ${ JSON.stringify( input ) }` ).toBeNull();
		}
	} );

	it( 'embedUrl builds the official Spotify embed URL', () => {
		const { parse, embedUrl } = window.__odd.widgets.spotify;
		const r = parse( 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh' );
		expect( embedUrl( r ) ).toBe( 'https://open.spotify.com/embed/track/4iV5W9uYEdYUVa79Axb7Rh?utm_source=odd' );
	} );

	it( 'starts with a default playlist, allows Change + submit to swap embed', () => {
		const mount = widgetMount( 'odd/spotify' );
		expect( mount ).toBeTruthy();
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const { storage, values } = createCtxStorage();
		const cleanup = mount( container, { storage } );

		let iframe = container.querySelector( 'iframe.odd-spotify__iframe' );
		expect( iframe ).toBeTruthy();
		expect( iframe.getAttribute( 'src' ) )
			.toBe( 'https://open.spotify.com/embed/playlist/37i9dQZEVXbLp5XoPON0wI?utm_source=odd' );
		expect( iframe.getAttribute( 'allow' ) ).toContain( 'encrypted-media' );
		expect( iframe.getAttribute( 'loading' ) ).toBe( 'lazy' );
		expect( iframe.getAttribute( 'referrerpolicy' ) ).toBe( 'strict-origin-when-cross-origin' );

		expect( values.get( 'embed' ) ).toMatchObject( {
			type:        'playlist',
			id:          '37i9dQZEVXbLp5XoPON0wI',
			originalUrl: 'https://open.spotify.com/playlist/37i9dQZEVXbLp5XoPON0wI',
		} );

		const change = container.querySelector( '.odd-spotify__btn[aria-label="Change Spotify embed"]' );
		expect( change ).toBeTruthy();
		change.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const input = container.querySelector( 'input.odd-spotify__input' );
		const form  = container.querySelector( 'form.odd-spotify__row' );
		expect( input ).toBeTruthy();
		expect( form ).toBeTruthy();
		const submit = form.querySelector( '.odd-spotify__btn--primary' );
		expect( submit.textContent ).toBe( 'Embed' );
		expect( window.getComputedStyle( submit ).minWidth ).toBe( '72px' );
		expect( container.querySelector( '.odd-spotify__styles' ) ).toBeNull();

		input.value = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
		form.dispatchEvent( new Event( 'submit', { bubbles: true, cancelable: true } ) );

		iframe = container.querySelector( 'iframe.odd-spotify__iframe' );
		expect( iframe ).toBeTruthy();
		expect( iframe.getAttribute( 'src' ) )
			.toBe( 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=odd' );

		expect( values.get( 'embed' ) ).toMatchObject( {
			type:        'playlist',
			id:          '37i9dQZF1DXcBWIGoYBM5M',
			originalUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
		} );

		cleanup();
	} );

	it( 'surfaces an error and stays in setup state when input is invalid', () => {
		const mount = widgetMount( 'odd/spotify' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );
		const { storage } = createCtxStorage();
		mount( container, { storage } );

		const change = container.querySelector( '.odd-spotify__btn[aria-label="Change Spotify embed"]' );
		expect( change ).toBeTruthy();
		change.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		const input = container.querySelector( 'input.odd-spotify__input' );
		const form  = container.querySelector( 'form.odd-spotify__row' );
		input.value = 'https://evil.com/playlist/whatever';
		form.dispatchEvent( new Event( 'submit', { bubbles: true, cancelable: true } ) );

		expect( container.querySelector( 'iframe.odd-spotify__iframe' ) ).toBeNull();
		const err = container.querySelector( '.odd-spotify__error' );
		expect( err.textContent.length ).toBeGreaterThan( 0 );
	} );

	it( 'restores persisted state on re-mount and Clear wipes it back to setup', () => {
		const mount = widgetMount( 'odd/spotify' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const { storage, values } = createCtxStorage( {
			embed: {
				type:        'track',
				id:          '4iV5W9uYEdYUVa79Axb7Rh',
				originalUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
				updatedAt:   1,
			},
		} );
		mount( container, { storage } );

		const iframe = container.querySelector( 'iframe.odd-spotify__iframe' );
		expect( iframe ).toBeTruthy();
		expect( iframe.getAttribute( 'src' ) )
			.toBe( 'https://open.spotify.com/embed/track/4iV5W9uYEdYUVa79Axb7Rh?utm_source=odd' );

		const clear = container.querySelector( '.odd-spotify__btn[aria-label="Clear Spotify embed"]' );
		expect( clear ).toBeTruthy();
		clear.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( values.has( 'embed' ) ).toBe( false );
		expect( container.querySelector( 'iframe.odd-spotify__iframe' ) ).toBeNull();
		expect( container.querySelector( 'input.odd-spotify__input' ) ).toBeTruthy();
	} );

	it( 'uses Desktop Mode ctx.storage when available', () => {
		const mount = widgetMount( 'odd/spotify' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const { storage, values } = createCtxStorage();

		mount( container, { storage } );
		expect( values.get( 'embed' ) ).toMatchObject( {
			type: 'playlist',
			id:   '37i9dQZEVXbLp5XoPON0wI',
		} );

		values.set( 'embed', {
			type:        'track',
			id:          '4iV5W9uYEdYUVa79Axb7Rh',
			originalUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
		} );
		container.innerHTML = '';
		mount( container, { storage } );
		const iframe = container.querySelector( 'iframe.odd-spotify__iframe' );
		expect( iframe.getAttribute( 'src' ) )
			.toBe( 'https://open.spotify.com/embed/track/4iV5W9uYEdYUVa79Axb7Rh?utm_source=odd' );
	} );
} );
