import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync( resolve( '_tools/catalog-sources/apps/airdate/bundle-src/index.html' ), 'utf8' );
const source = readFileSync( resolve( '_tools/catalog-sources/apps/airdate/bundle-src/assets/app.js' ), 'utf8' );
const css = readFileSync( resolve( '_tools/catalog-sources/apps/airdate/bundle-src/assets/app.css' ), 'utf8' );

function wpGmt( date ) { return date.toISOString().replace( /\.\d{3}Z$/, '' ); }
function item( id, status, overrides = {} ) {
	return {
		id, status, modified: '2026-08-17T09:00:00', modified_gmt: '2026-08-17T16:00:00',
		date: '2026-08-18T09:00:00', date_gmt: wpGmt( new Date( Date.now() + 24 * 60 * 60 * 1000 ) ),
		title: { raw: id === 1 ? 'Scheduled dispatch' : 'Draft dispatch', rendered: id === 1 ? 'Scheduled dispatch' : 'Draft dispatch' },
		content: { raw: 'Must stay untouched', rendered: '<p>Must stay untouched</p>' },
		...overrides,
	};
}

function submit( form, submitter ) { form.dispatchEvent( new SubmitEvent( 'submit', { bubbles:true, cancelable:true, submitter } ) ); }

describe( 'ODD Airdate', () => {
	let posts;
	let pages;
	let request;
	let confirm;
	let storage;

	beforeEach( () => {
		posts = [ item( 1, 'future' ), item( 2, 'draft' ) ]; pages = [];
		document.documentElement.innerHTML = html.replace( /^.*?<html[^>]*>/s, '' ).replace( /<\/html>.*$/s, '' );
		HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
		HTMLDialogElement.prototype.close = function close() { this.open = false; };
		confirm = vi.fn( async () => true ); storage = { get:vi.fn( async () => null ), set:vi.fn( async ( _key,value ) => value ) };
		request = vi.fn( async ( path, options = {} ) => {
			if ( path.startsWith( 'wp/v2/posts?' ) ) return { body:posts, headers:{ 'X-WP-TotalPages':'1' },status:200 };
			if ( path.startsWith( 'wp/v2/pages?' ) ) return { body:pages, headers:{ 'X-WP-TotalPages':'1' },status:200 };
			const match = path.match( /^wp\/v2\/(posts|pages)\/(\d+)(?:\?context=edit)?$/ );
			if ( match ) {
				const collection = match[ 1 ] === 'posts' ? posts : pages; const index = collection.findIndex( ( value ) => value.id === Number( match[ 2 ] ) );
				if ( options.method !== 'POST' ) return collection[ index ];
				collection[ index ] = { ...collection[ index ], ...options.body, modified_gmt:'2026-08-17T17:00:00' }; return collection[ index ];
			}
			throw new Error( `Unexpected request ${ path }` );
		} );
		window.oddApp = { apiVersion:1, slug:'airdate', request, confirm, storage };
	} );

	async function boot() {
		window.eval( source ); document.dispatchEvent( new Event( 'DOMContentLoaded' ) );
		await vi.waitFor( () => expect( document.querySelectorAll( '#queue-list [data-schedule-key]' ) ).toHaveLength( 1 ) );
	}
	function start() { window.eval( source ); document.dispatchEvent( new Event( 'DOMContentLoaded' ) ); }

	it( 'uses only oddApp and stores schema-limited view preferences', async () => {
		await boot();
		expect( source ).not.toContain( 'window.parent' ); expect( source ).not.toContain( 'localStorage' ); expect( source ).not.toMatch( /\bfetch\s*\(/ );
		expect( storage.get ).toHaveBeenCalledWith( 'preferences' );
		document.querySelector( '#type-filter' ).value = 'pages'; document.querySelector( '#type-filter' ).dispatchEvent( new Event( 'change', { bubbles:true } ) );
		await vi.waitFor( () => expect( storage.set ).toHaveBeenCalledWith( 'preferences', expect.objectContaining( { view:'calendar', typeFilter:'pages' } ) ) );
		expect( Object.keys( storage.set.mock.calls.at( -1 )[ 1 ] ).sort() ).toEqual( [ 'month','typeFilter','view' ] );
	} );

	it( 'reflows the compact topbar without shrinking controls below 32 pixels', () => {
		expect( css ).toMatch( /@media\(max-width:360px\)\{\.topbar\{[^}]*grid-template-columns:minmax\(0,1fr\) 34px/ );
		expect( css ).toMatch( /\.month-controls button\{min-width:32px;height:32px\}/ );
		expect( css ).toMatch( /\.icon-button\{grid-column:2;width:34px;height:34px\}/ );
	} );

	it( 'converts a device-local air date to the exact canonical UTC instant without content fields', async () => {
		await boot(); document.querySelector( '#queue-list [data-schedule-key="posts:2"]' ).click();
		const local = new Date( Date.now() + 3 * 60 * 60 * 1000 ); const pad = ( value ) => String( value ).padStart( 2,'0' );
		const value = `${ local.getFullYear() }-${ pad( local.getMonth() + 1 ) }-${ pad( local.getDate() ) }T${ pad( local.getHours() ) }:${ pad( local.getMinutes() ) }`;
		document.querySelector( '#airdate-input' ).value = value; submit( document.querySelector( '#schedule-form' ), document.querySelector( '#schedule-submit' ) );
		await vi.waitFor( () => expect( request ).toHaveBeenCalledWith( 'wp/v2/posts/2', { method:'POST', body:{ date_gmt:wpGmt( new Date( value ) ), status:'future' } } ) );
		const payload = request.mock.calls.find( ( [ path, options ] ) => path === 'wp/v2/posts/2' && options.method === 'POST' )[ 1 ].body;
		expect( payload ).not.toHaveProperty( 'content' ); expect( payload ).not.toHaveProperty( 'title' ); expect( payload ).not.toHaveProperty( 'excerpt' );
	} );

	it( 'moves focus to a deterministic control when scheduling removes the queue action and the event is outside the visible month', async () => {
		await boot(); const origin = document.querySelector( '#queue-list [data-schedule-key="posts:2"]' ); origin.focus(); origin.click();
		const target = new Date( Date.now() + 70 * 24 * 60 * 60 * 1000 ); const pad = ( value ) => String( value ).padStart( 2,'0' );
		document.querySelector( '#airdate-input' ).value = `${ target.getFullYear() }-${ pad( target.getMonth() + 1 ) }-${ pad( target.getDate() ) }T${ pad( target.getHours() ) }:${ pad( target.getMinutes() ) }`;
		submit( document.querySelector( '#schedule-form' ),document.querySelector( '#schedule-submit' ) );
		await vi.waitFor( () => expect( document.activeElement ).toBe( document.querySelector( '#refresh-schedule' ) ) );
		expect( document.activeElement ).not.toBe( document.body );
	} );

	it( 'treats a timezone-less queue modified_gmt value as UTC', async () => {
		const previousTimezone = process.env.TZ; process.env.TZ = 'America/Phoenix';
		try {
			posts[ 1 ].modified_gmt = '2026-08-17T00:30:00'; await boot();
			const expected = new Intl.DateTimeFormat( undefined,{ dateStyle:'medium' } ).format( new Date( '2026-08-17T00:30:00Z' ) );
			expect( document.querySelector( '.queue-card p' ).textContent ).toContain( expected );
		} finally { if ( previousTimezone === undefined ) delete process.env.TZ; else process.env.TZ = previousTimezone; }
	} );

	it.each( [ [ 401,'session expired' ],[ 403,'denied this action' ],[ 404,'no longer exists' ] ] )( 'maps an inner %i envelope status to the explicit WordPress message', async ( status,message ) => {
		request.mockResolvedValue( { body:{ code:'rest_error',message:'Raw REST error' },headers:[],status } ); start();
		await vi.waitFor( () => expect( document.querySelector( '#schedule-error-copy' ).textContent ).toContain( message ) );
	} );

	it( 'prioritizes an inner expired-nonce code over generic permission messaging', async () => {
		request.mockResolvedValue( { body:{ code:'rest_cookie_invalid_nonce',message:'Cookie check failed' },headers:{},status:403 } ); start();
		await vi.waitFor( () => expect( document.querySelector( '#schedule-error-copy' ).textContent ).toContain( 'could not verify this request' ) );
		expect( document.querySelector( '#schedule-error-copy' ).textContent ).not.toContain( 'permission' );
	} );

	it( 'rejects a past date before any WordPress refetch or mutation', async () => {
		await boot(); const calls = request.mock.calls.length; document.querySelector( '#queue-list [data-schedule-key="posts:2"]' ).click(); document.querySelector( '#airdate-input' ).value = '2020-01-01T00:00'; submit( document.querySelector( '#schedule-form' ), document.querySelector( '#schedule-submit' ) );
		expect( document.querySelector( '#airdate-error' ).hidden ).toBe( false ); expect( request.mock.calls ).toHaveLength( calls );
	} );

	it( 'stops scheduling when a refetch detects a modified-stamp conflict', async () => {
		await boot(); request.mockImplementationOnce( async () => ( { ...posts[ 1 ], modified_gmt:'2026-08-17T19:00:00' } ) );
		document.querySelector( '#queue-list [data-schedule-key="posts:2"]' ).click(); const target = new Date( Date.now() + 2 * 60 * 60 * 1000 ); document.querySelector( '#airdate-input' ).value = target.toISOString().slice( 0,16 ); submit( document.querySelector( '#schedule-form' ), document.querySelector( '#schedule-submit' ) );
		await vi.waitFor( () => expect( document.querySelector( '#global-notice' ).textContent ).toContain( 'changed in WordPress' ) );
		expect( request.mock.calls.some( ( [ path, options = {} ] ) => path === 'wp/v2/posts/2' && options.method === 'POST' ) ).toBe( false );
	} );

	it( 'cancels an air date only after a conflict check and native confirmation', async () => {
		await boot(); document.querySelector( '#calendar-grid [data-schedule-key="posts:1"]' ).click(); expect( document.querySelector( '#cancel-airdate' ).hidden ).toBe( false ); document.querySelector( '#cancel-airdate' ).click();
		await vi.waitFor( () => expect( request ).toHaveBeenCalledWith( 'wp/v2/posts/1', { method:'POST', body:{ status:'draft' } } ) );
		expect( confirm ).toHaveBeenCalledWith( expect.objectContaining( { title:'Cancel this air date?', danger:true } ) );
	} );

	it( 'keeps successful pages and labels a partial result when posts fail', async () => {
		pages = [ item( 3, 'pending', { title:{ raw:'Page queue item', rendered:'Page queue item' } } ) ];
		request.mockImplementation( async ( path ) => { if ( path.startsWith( 'wp/v2/posts?' ) ) throw Object.assign( new Error( 'Forbidden' ), { status:403 } ); if ( path.startsWith( 'wp/v2/pages?' ) ) return { body:pages,headers:{},status:200 }; throw new Error( `Unexpected ${ path }` ); } );
		await boot(); expect( document.querySelector( '[data-schedule-key="pages:3"]' ) ).not.toBeNull(); expect( document.querySelector( '#partial-warning' ).hidden ).toBe( false );
	} );
} );
