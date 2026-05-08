/**
 * widgets.test.js — smoke-test the two stock ODD widget bundles.
 *
 * Widgets ship as separate catalog bundles under
 * `_tools/catalog-sources/widgets/sticky/` and `.../eight-ball/`.
 * Each bundle self-registers through `wp.desktop.registerWidget`;
 * this test loads both bundle sources, captures the registration
 * calls, then mounts each widget against a detached DOM container
 * and exercises the minimum interactions:
 *
 *   - Sticky: typing saves to localStorage after the debounce window.
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
const WIDGETS_ROOT = resolve( __dirname, '../../../_tools/catalog-sources/widgets' );
const STICKY_JS    = resolve( WIDGETS_ROOT, 'sticky/widget.js' );
const STICKY_CSS   = resolve( WIDGETS_ROOT, 'sticky/widget.css' );
const EIGHTBALL_JS  = resolve( WIDGETS_ROOT, 'eight-ball/widget.js' );
const EIGHTBALL_CSS = resolve( WIDGETS_ROOT, 'eight-ball/widget.css' );
const EIGHTBALL_ASSET = resolve( WIDGETS_ROOT, 'eight-ball/assets/oracle-texture.webp' );
const EIGHTBALL_BUNDLE = resolve( __dirname, '../../../site/catalog/v1/bundles/widget-eight-ball.wp' );
const SPOTIFY_JS    = resolve( WIDGETS_ROOT, 'spotify/widget.js' );

function installWpDesktop() {
	const calls = [];
	window.wp = window.wp || {};
	window.wp.desktop = {
		registerWidget: ( def ) => { calls.push( def ); },
		ready: ( cb ) => cb(),
	};
	return calls;
}

/**
 * Vitest's jsdom build ships without a complete Storage implementation.
 * Install a small in-memory shim before each test so the widgets can
 * read/write localStorage without blowing up.
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

function injectWidgetStyles() {
	const css = readFileSync( STICKY_CSS, 'utf8' ) + '\n' + readFileSync( EIGHTBALL_CSS, 'utf8' );
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
	let captured;

	beforeEach( () => {
		document.body.innerHTML = '';
		clearStorage();
		captured = installWpDesktop();
		loadWidgets();
	} );

	afterEach( () => {
		const s = document.getElementById( 'odd-widgets-style' );
		if ( s ) s.remove();
		vi.useRealTimers();
	} );

	it( 'registers three widgets with required fields', () => {
		expect( captured.length ).toBe( 3 );
		for ( const def of captured ) {
			expect( def.id ).toMatch( /^odd\// );
			expect( typeof def.label ).toBe( 'string' );
			expect( typeof def.icon ).toBe( 'string' );
			expect( typeof def.mount ).toBe( 'function' );
			expect( def.minWidth ).toBeGreaterThan( 0 );
			expect( def.minHeight ).toBeGreaterThan( 0 );
			expect( def.defaultWidth ).toBeGreaterThanOrEqual( def.minWidth );
			expect( def.defaultHeight ).toBeGreaterThanOrEqual( def.minHeight );
		}
		const ids = captured.map( ( d ) => d.id ).sort();
		expect( ids ).toEqual( [ 'odd/eight-ball', 'odd/spotify', 'odd/sticky' ] );
	} );
} );

describe( 'sticky widget', () => {
	let captured;

	beforeEach( () => {
		document.body.innerHTML = '';
		clearStorage();
		captured = installWpDesktop();
		loadWidgets();
	} );

	it( 'mounts, auto-saves text after the debounce window, and cleans up', () => {
		vi.useFakeTimers();

		const def = captured.find( ( d ) => d.id === 'odd/sticky' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const cleanup = def.mount( container, {} );

		expect( container.querySelector( '.odd-sticky__paper' ) ).toBeTruthy();
		const ta = container.querySelector( 'textarea.odd-sticky__text' );
		expect( ta ).toBeTruthy();

		ta.value = 'hello sticky';
		ta.dispatchEvent( new Event( 'input' ) );

		vi.advanceTimersByTime( 500 );
		expect( window.localStorage.getItem( 'odd:sticky' ) ).toBe( 'hello sticky' );

		expect( typeof cleanup ).toBe( 'function' );
		expect( () => cleanup() ).not.toThrow();
	} );

	it( 'restores prior content from localStorage on mount', () => {
		window.localStorage.setItem( 'odd:sticky', 'from before' );

		const def = captured.find( ( d ) => d.id === 'odd/sticky' );
		const container = document.createElement( 'div' );
		const cleanup = def.mount( container, {} );

		const ta = container.querySelector( 'textarea.odd-sticky__text' );
		expect( ta.value ).toBe( 'from before' );
		cleanup();
	} );
} );

describe( 'eight-ball widget', () => {
	let captured;

	beforeEach( () => {
		document.body.innerHTML = '';
		clearStorage();
		captured = installWpDesktop();
		injectWidgetStyles();
		loadWidgets();
	} );

	it( 'mounts, reacts to clicks, cycles the answer, and cleans up', () => {
		vi.useFakeTimers();

		const def = captured.find( ( d ) => d.id === 'odd/eight-ball' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const cleanup = def.mount( container, {} );

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

	it( 'pointer-events: none on every decorative child (regression guard)', () => {
		const def = captured.find( ( d ) => d.id === 'odd/eight-ball' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );
		def.mount( container, {} );

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

describe( 'spotify widget', () => {
	let captured;

	beforeEach( () => {
		document.body.innerHTML = '';
		clearStorage();
		captured = installWpDesktop();
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
		const def = captured.find( ( d ) => d.id === 'odd/spotify' );
		expect( def ).toBeTruthy();
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const persisted = [];
		const cleanup = def.mount( container, {
			persist: ( v ) => { persisted.push( v ); },
			restore: () => null,
		} );

		let iframe = container.querySelector( 'iframe.odd-spotify__iframe' );
		expect( iframe ).toBeTruthy();
		expect( iframe.getAttribute( 'src' ) )
			.toBe( 'https://open.spotify.com/embed/playlist/37i9dQZEVXbLp5XoPON0wI?utm_source=odd' );
		expect( iframe.getAttribute( 'allow' ) ).toContain( 'encrypted-media' );
		expect( iframe.getAttribute( 'loading' ) ).toBe( 'lazy' );
		expect( iframe.getAttribute( 'referrerpolicy' ) ).toBe( 'strict-origin-when-cross-origin' );

		expect( persisted.length ).toBe( 1 );
		expect( persisted[ 0 ] ).toMatchObject( {
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

		input.value = 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M';
		form.dispatchEvent( new Event( 'submit', { bubbles: true, cancelable: true } ) );

		iframe = container.querySelector( 'iframe.odd-spotify__iframe' );
		expect( iframe ).toBeTruthy();
		expect( iframe.getAttribute( 'src' ) )
			.toBe( 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M?utm_source=odd' );

		expect( persisted.length ).toBe( 2 );
		expect( persisted[ 1 ] ).toMatchObject( {
			type:        'playlist',
			id:          '37i9dQZF1DXcBWIGoYBM5M',
			originalUrl: 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M',
		} );

		cleanup();
	} );

	it( 'surfaces an error and stays in setup state when input is invalid', () => {
		const def = captured.find( ( d ) => d.id === 'odd/spotify' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );
		def.mount( container, { persist: () => {}, restore: () => null } );

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
		const def = captured.find( ( d ) => d.id === 'odd/spotify' );
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		let stored = {
			type:        'track',
			id:          '4iV5W9uYEdYUVa79Axb7Rh',
			originalUrl: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
			updatedAt:   1,
		};
		def.mount( container, {
			persist: ( v ) => { stored = v; },
			restore: () => stored,
		} );

		const iframe = container.querySelector( 'iframe.odd-spotify__iframe' );
		expect( iframe ).toBeTruthy();
		expect( iframe.getAttribute( 'src' ) )
			.toBe( 'https://open.spotify.com/embed/track/4iV5W9uYEdYUVa79Axb7Rh?utm_source=odd' );

		const clear = container.querySelector( '.odd-spotify__btn[aria-label="Clear Spotify embed"]' );
		expect( clear ).toBeTruthy();
		clear.dispatchEvent( new MouseEvent( 'click', { bubbles: true, cancelable: true } ) );

		expect( stored ).toBeNull();
		expect( container.querySelector( 'iframe.odd-spotify__iframe' ) ).toBeNull();
		expect( container.querySelector( 'input.odd-spotify__input' ) ).toBeTruthy();
	} );
} );
