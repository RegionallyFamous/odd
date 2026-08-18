import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync( resolve( '_tools/catalog-sources/apps/revision-room/bundle-src/index.html' ), 'utf8' );
const source = readFileSync( resolve( '_tools/catalog-sources/apps/revision-room/bundle-src/assets/app.js' ), 'utf8' );

function doc( type = 'posts', overrides = {} ) {
	return {
		id: type === 'posts' ? 21 : 31,
		status: 'pending',
		modified: '2026-08-17T10:00:00',
		modified_gmt: '2026-08-17T17:00:00',
		title: { raw: 'Current title', rendered: 'Current title' },
		content: { raw: '<!-- wp:paragraph -->\n<p>Current body</p>\n<!-- /wp:paragraph -->', rendered: '<p>Current body</p>' },
		excerpt: { raw: 'Current excerpt', rendered: '<p>Current excerpt</p>' },
		...overrides,
	};
}

function revision( overrides = {} ) {
	return {
		id: 801,
		date_gmt: '2026-08-16T16:00:00',
		author_name: 'Editor One',
		title: { raw: 'Earlier title', rendered: 'Earlier title' },
		content: { raw: '<script>alert(1)</script>\n<p>Earlier body</p>', rendered: '<p>Earlier body</p>' },
		excerpt: { raw: 'Earlier excerpt', rendered: '<p>Earlier excerpt</p>' },
		...overrides,
	};
}

describe( 'ODD Revision Room', () => {
	let posts;
	let pages;
	let revisions;
	let request;
	let confirm;
	let storage;

	beforeEach( () => {
		posts = [ doc( 'posts' ) ];
		pages = [ doc( 'pages', { title: { raw: 'Current page', rendered: 'Current page' } } ) ];
		revisions = [ revision() ];
		document.documentElement.innerHTML = html.replace( /^.*?<html[^>]*>/s, '' ).replace( /<\/html>.*$/s, '' );
		window.matchMedia = vi.fn( () => ( { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } ) );
		confirm = vi.fn( async () => true );
		storage = { get: vi.fn( async () => null ), set: vi.fn( async ( _key, value ) => value ) };
		request = vi.fn( async ( path, options = {} ) => {
			if ( path.startsWith( 'wp/v2/posts?' ) ) return { body: posts, headers: { 'X-WP-TotalPages': '1' }, status: 200 };
			if ( path.startsWith( 'wp/v2/pages?' ) ) return { body: pages, headers: { 'X-WP-TotalPages': '1' }, status: 200 };
			if ( path.includes( '/revisions?' ) ) return { body: revisions, headers: { 'X-WP-TotalPages': '1' }, status: 200 };
			if ( path === 'wp/v2/posts/21?context=edit' ) return posts[ 0 ];
			if ( path === 'wp/v2/posts/21' && options.method === 'POST' ) {
				posts[ 0 ] = { ...posts[ 0 ], modified_gmt: '2026-08-17T18:00:00', title: { raw: options.body.title }, content: { raw: options.body.content }, excerpt: { raw: options.body.excerpt } };
				return posts[ 0 ];
			}
			throw Object.assign( new Error( `Unexpected request ${ path }` ), { status: 500 } );
		} );
		window.oddApp = { apiVersion: 1, slug: 'revision-room', request, confirm, storage };
	} );

	async function boot( expectedDocuments = 2 ) {
		window.eval( source );
		document.dispatchEvent( new Event( 'DOMContentLoaded' ) );
		await vi.waitFor( () => expect( document.querySelectorAll( '[data-document-key]' ) ).toHaveLength( expectedDocuments ) );
		await vi.waitFor( () => expect( document.querySelectorAll( '[data-revision-id]' ) ).toHaveLength( 1 ) );
	}

	function start() { window.eval( source ); document.dispatchEvent( new Event( 'DOMContentLoaded' ) ); }

	it( 'uses only the injected runtime and namespaced preference storage', async () => {
		await boot();
		expect( source ).not.toContain( 'window.parent' );
		expect( source ).not.toContain( 'localStorage' );
		expect( source ).not.toContain( '_wpnonce' );
		expect( source ).not.toMatch( /\bfetch\s*\(/ );
		expect( storage.get ).toHaveBeenCalledWith( 'preferences' );
		document.querySelector( '#type-filter input[value="pages"]' ).click();
		await vi.waitFor( () => expect( storage.set ).toHaveBeenCalledWith( 'preferences', { typeFilter: 'pages' } ) );
	} );

	it( 'renders raw revision markup only as text in the bounded diff', async () => {
		await boot();
		document.querySelector( '#field-tabs input[value="content"]' ).click();
		expect( document.querySelector( '#diff-output' ).textContent ).toContain( '<script>alert(1)</script>' );
		expect( document.querySelector( '#diff-output script' ) ).toBeNull();
		expect( document.querySelectorAll( '#diff-output .diff-row' ).length ).toBeGreaterThan( 0 );
	} );

	it( 'keeps keyboard focus on the replacement revision option after selecting it', async () => {
		revisions = [ revision(), revision( { id: 800,date_gmt:'2026-08-15T16:00:00' } ) ];
		start();
		await vi.waitFor( () => expect( document.querySelectorAll( '[data-revision-id]' ) ).toHaveLength( 2 ) );
		const option = document.querySelector( '[data-revision-id="800"]' ); option.focus(); option.click();
		expect( document.activeElement ).toBe( document.querySelector( '[data-revision-id="800"]' ) );
		expect( document.activeElement.getAttribute( 'aria-pressed' ) ).toBe( 'true' );
	} );

	it( 'uses ordinary semantic lists with independently keyboard-focusable buttons', async () => {
		await boot();
		for ( const id of [ 'document-list','revision-list' ] ) { const list = document.getElementById( id ); const button = list.querySelector( 'button' ); expect( list.tagName ).toBe( 'UL' ); expect( list.hasAttribute( 'role' ) ).toBe( false ); expect( button.getAttribute( 'role' ) ).toBeNull(); expect( button.tabIndex ).toBe( 0 ); }
	} );

	it( 'treats timezone-less WordPress GMT stamps as UTC when formatting', async () => {
		const previousTimezone = process.env.TZ; process.env.TZ = 'America/Phoenix';
		try {
			posts[ 0 ].modified_gmt = '2026-08-17T00:30:00'; revisions[ 0 ].date_gmt = '2026-08-16T00:30:00';
			await boot();
			const formatter = new Intl.DateTimeFormat( undefined,{ dateStyle:'medium',timeStyle:'short' } );
			expect( document.querySelector( '[data-document-key="posts:21"] small' ).textContent ).toContain( formatter.format( new Date( '2026-08-17T00:30:00Z' ) ) );
			expect( document.querySelector( '[data-revision-id="801"] strong' ).textContent ).toBe( formatter.format( new Date( '2026-08-16T00:30:00Z' ) ) );
		} finally { if ( previousTimezone === undefined ) delete process.env.TZ; else process.env.TZ = previousTimezone; }
	} );

	it.each( [ [ 401,'session has expired' ],[ 403,'denied this action' ],[ 404,'no longer exists' ] ] )( 'maps an inner %i envelope status to the explicit WordPress message', async ( status, message ) => {
		request.mockResolvedValue( { body:{ code:'rest_error',message:'Raw REST error' },headers:[],status } );
		start();
		await vi.waitFor( () => expect( document.querySelector( '#document-error-copy' ).textContent ).toContain( message ) );
	} );

	it( 'prioritizes an inner expired-nonce code over generic permission messaging', async () => {
		request.mockResolvedValue( { body:{ code:'rest_cookie_invalid_nonce',message:'Cookie check failed' },headers:{},status:403 } );
		start();
		await vi.waitFor( () => expect( document.querySelector( '#document-error-copy' ).textContent ).toContain( 'could not verify this request' ) );
		expect( document.querySelector( '#document-error-copy' ).textContent ).not.toContain( 'permission' );
	} );

	it( 'shows a clear too-large state instead of running an unbounded diff', async () => {
		revisions = [ revision( { content: { raw: Array.from( { length: 351 }, ( _, index ) => `line ${ index }` ).join( '\n' ) } } ) ];
		await boot();
		document.querySelector( '#field-tabs input[value="content"]' ).click();
		expect( document.querySelector( '#diff-too-large' ).hidden ).toBe( false );
		expect( document.querySelector( '#diff-output' ).children ).toHaveLength( 0 );
	} );

	it( 'refetches, confirms, and restores only raw title, content, and excerpt', async () => {
		await boot();
		document.querySelector( '#restore-revision' ).click();
		await vi.waitFor( () => expect( request ).toHaveBeenCalledWith( 'wp/v2/posts/21', {
			method: 'POST',
			body: { title: 'Earlier title', content: '<script>alert(1)</script>\n<p>Earlier body</p>', excerpt: 'Earlier excerpt' },
		} ) );
		expect( confirm ).toHaveBeenCalledWith( expect.objectContaining( { title: 'Restore this revision?' } ) );
		await vi.waitFor( () => expect( document.activeElement ).toBe( document.querySelector( '#restore-revision' ) ) );
		expect( document.activeElement ).not.toBe( document.body );
	} );

	it( 'does not send a restore mutation when the document changed elsewhere', async () => {
		request.mockImplementation( async ( path ) => {
			if ( path.startsWith( 'wp/v2/posts?' ) ) return { body: posts, headers: {},status:200 };
			if ( path.startsWith( 'wp/v2/pages?' ) ) return { body: pages, headers: {},status:200 };
			if ( path.includes( '/revisions?' ) ) return { body: revisions, headers: {},status:200 };
			if ( path === 'wp/v2/posts/21?context=edit' ) return { ...posts[ 0 ], modified_gmt: '2026-08-17T19:00:00' };
			throw new Error( `Mutation must not run: ${ path }` );
		} );
		await boot();
		document.querySelector( '#restore-revision' ).click();
		await vi.waitFor( () => expect( document.querySelector( '#global-notice' ).textContent ).toContain( 'changed in WordPress' ) );
		expect( confirm ).not.toHaveBeenCalled();
		expect( request.mock.calls.some( ( [ path, options = {} ] ) => path === 'wp/v2/posts/21' && options.method === 'POST' ) ).toBe( false );
	} );

	it( 'keeps successful page results when posts fail', async () => {
		request.mockImplementation( async ( path ) => {
			if ( path.startsWith( 'wp/v2/posts?' ) ) throw Object.assign( new Error( 'Posts forbidden' ), { status: 403 } );
			if ( path.startsWith( 'wp/v2/pages?' ) ) return { body: pages, headers: {},status:200 };
			if ( path.includes( '/revisions?' ) ) return { body: revisions, headers: {},status:200 };
			throw new Error( `Unexpected request ${ path }` );
		} );
		await boot( 1 );
		expect( document.querySelector( '[data-document-key="pages:31"]' ) ).not.toBeNull();
		expect( document.querySelector( '#partial-warning' ).hidden ).toBe( false );
	} );
} );
