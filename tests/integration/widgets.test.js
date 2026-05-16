/**
 * widgets.test.js — smoke-test the stock ODD widget bundles.
 *
 * Widgets ship as separate catalog bundles under
 * `_tools/catalog-sources/widgets/sticky/` and `.../eight-ball/`.
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
const STICKY_JS    = resolve( WIDGETS_ROOT, 'sticky/widget.js' );
const STICKY_CSS   = resolve( WIDGETS_ROOT, 'sticky/widget.css' );
const STICKY_BUNDLE = resolve( __dirname, '../../site/catalog/v1/bundles/widget-sticky.wp' );
const EIGHTBALL_JS  = resolve( WIDGETS_ROOT, 'eight-ball/widget.js' );
const EIGHTBALL_CSS = resolve( WIDGETS_ROOT, 'eight-ball/widget.css' );
const EIGHTBALL_ASSET = resolve( WIDGETS_ROOT, 'eight-ball/assets/oracle-texture.webp' );
const EIGHTBALL_BUNDLE = resolve( __dirname, '../../site/catalog/v1/bundles/widget-eight-ball.wp' );
const SPOTIFY_JS    = resolve( WIDGETS_ROOT, 'spotify/widget.js' );
const SPOTIFY_CSS   = resolve( WIDGETS_ROOT, 'spotify/widget.css' );
const SPOTIFY_BUNDLE = resolve( __dirname, '../../site/catalog/v1/bundles/widget-spotify.wp' );
const WIDGET_MANIFESTS = [
	resolve( WIDGETS_ROOT, 'sticky/manifest.json' ),
	resolve( WIDGETS_ROOT, 'eight-ball/manifest.json' ),
	resolve( WIDGETS_ROOT, 'spotify/manifest.json' ),
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
	const css = [ STICKY_CSS, EIGHTBALL_CSS, SPOTIFY_CSS ]
		.map( ( file ) => readFileSync( file, 'utf8' ) )
		.join( '\n' );
	const style = document.createElement( 'style' );
	style.id = 'odd-widgets-style';
	style.textContent = css;
	document.head.appendChild( style );
}

function loadWidgets() {
	for ( const [ js, name ] of [
		[ STICKY_JS,    'widgets/sticky/widget.js' ],
		[ EIGHTBALL_JS, 'widgets/eight-ball/widget.js' ],
		[ SPOTIFY_JS,   'widgets/spotify/widget.js' ],
	] ) {
		const src = readFileSync( js, 'utf8' );
		const fn = new Function( `${ src }\n//# sourceURL=${ name }` );
		fn.call( globalThis );
	}
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
		expect( ids ).toEqual( [ 'odd/eight-ball', 'odd/spotify', 'odd/sticky' ] );
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

		const listing = execFileSync(
			'python3',
			[
				'-c',
				'import sys, zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))',
				EIGHTBALL_BUNDLE,
			],
			{ encoding: 'utf8' }
		);
		expect( listing ).toContain( 'assets/oracle-texture.webp' );
	} );
} );

describe( 'widget stylesheet scoping', () => {
	it( 'ships a source and bundled stylesheet for every first-party widget', () => {
		for ( const [ manifestFile, cssFile, bundleFile ] of [
			[ WIDGET_MANIFESTS[ 0 ], STICKY_CSS, STICKY_BUNDLE ],
			[ WIDGET_MANIFESTS[ 1 ], EIGHTBALL_CSS, EIGHTBALL_BUNDLE ],
			[ WIDGET_MANIFESTS[ 2 ], SPOTIFY_CSS, SPOTIFY_BUNDLE ],
		] ) {
			const manifest = JSON.parse( readFileSync( manifestFile, 'utf8' ) );
			expect( manifest.css ).toEqual( [ 'widget.css' ] );
			expect( existsSync( cssFile ) ).toBe( true );

			const listing = execFileSync(
				'python3',
				[
					'-c',
					'import sys, zipfile; print("\\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))',
					bundleFile,
				],
				{ encoding: 'utf8' }
			);
			expect( listing ).toContain( 'widget.css' );
		}
	} );

	it( 'keeps first-party widget CSS from styling sibling widgets', () => {
		const stickyCss = readFileSync( STICKY_CSS, 'utf8' );
		const eightCss = readFileSync( EIGHTBALL_CSS, 'utf8' );
		const spotifyCss = readFileSync( SPOTIFY_CSS, 'utf8' );

		expect( stickyCss ).toContain( '.odd-widget--sticky' );
		expect( stickyCss ).not.toMatch( /(^|\n)\.odd-widget\s*\{/ );
		expect( stickyCss ).not.toContain( 'odd-widget--eight' );
		expect( stickyCss ).not.toContain( 'odd-eight__' );
		expect( eightCss ).toContain( '.odd-widget--eight' );
		expect( eightCss ).not.toContain( 'odd-widget--sticky' );
		expect( eightCss ).not.toContain( 'odd-sticky__' );
		expect( spotifyCss ).toContain( '.odd-widget--spotify' );
		expect( spotifyCss ).not.toContain( 'odd-sticky__' );
		expect( spotifyCss ).not.toContain( 'odd-eight__' );
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
