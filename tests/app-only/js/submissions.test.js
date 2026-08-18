import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync( resolve( '_tools/catalog-sources/apps/submissions/bundle-src/index.html' ), 'utf8' );
const source = readFileSync( resolve( '_tools/catalog-sources/apps/submissions/bundle-src/assets/app.js' ), 'utf8' );
const css = readFileSync( resolve( '_tools/catalog-sources/apps/submissions/bundle-src/assets/app.css' ), 'utf8' );
const manifest = JSON.parse( readFileSync( resolve( '_tools/catalog-sources/apps/submissions/bundle-src/manifest.json' ), 'utf8' ) );

function pending( overrides = {} ) {
	return {
		id: 41, status:'pending', modified:'2026-08-17T09:00:00', modified_gmt:'2026-08-17T16:00:00',
		title:{ raw:'A pending field guide', rendered:'A pending field guide' }, excerpt:{ raw:'Awaiting a careful review.', rendered:'<p>Awaiting a careful review.</p>' },
		content:{ raw:'<!-- wp:paragraph --><p>Safe words</p><!-- /wp:paragraph -->', rendered:'<h2>Safe heading</h2><p onclick="alert(1)">Safe words</p><script>alert(2)</script><form><input autofocus></form><svg onload="alert(3)"></svg><img src="https://evil.example/tracker.png" onerror="alert(4)"><img src="/same-site.png">' },
		_embedded:{ author:[ { id:7,name:'Mina Editor' } ] },
		...overrides,
	};
}

describe( 'ODD Submissions', () => {
	let posts;
	let pages;
	let request;
	let confirm;
	let storage;
	let mobile;
	let viewportMedia;
	let mediaListeners;

	beforeEach( () => {
		window.dispatchEvent( new Event( 'pagehide' ) );
		posts = [ pending() ]; pages = []; mobile = false;
		document.documentElement.innerHTML = html.replace( /^.*?<html[^>]*>/s, '' ).replace( /<\/html>.*$/s, '' );
		mediaListeners = new Set();
		viewportMedia = {
			media:'(max-width: 780px)',
			get matches() { return mobile; },
			addEventListener:vi.fn( ( name, listener ) => { if ( name === 'change' ) mediaListeners.add( listener ); } ),
			removeEventListener:vi.fn( ( name, listener ) => { if ( name === 'change' ) mediaListeners.delete( listener ); } ),
		};
		window.matchMedia = vi.fn( () => viewportMedia );
		window.open = vi.fn( () => ( {} ) ); confirm = vi.fn( async () => true ); storage = { get:vi.fn( async () => null ), set:vi.fn( async ( _key,value ) => value ) };
		request = vi.fn( async ( path, options = {} ) => {
			if ( path.startsWith( 'wp/v2/posts?' ) ) return { body:posts.filter( ( item ) => item.status === 'pending' ),headers:{ 'X-WP-TotalPages':'1' },status:200 };
			if ( path.startsWith( 'wp/v2/pages?' ) ) return { body:pages.filter( ( item ) => item.status === 'pending' ),headers:{ 'X-WP-TotalPages':'1' },status:200 };
			if ( path === 'wp/v2/posts/41?context=edit' ) return posts[ 0 ];
			if ( path === 'wp/v2/posts/41' && options.method === 'POST' ) { posts[ 0 ] = { ...posts[ 0 ], ...options.body, modified_gmt:'2026-08-17T17:00:00' }; return posts[ 0 ]; }
			throw new Error( `Unexpected request ${ path }` );
		} );
		window.oddApp = { apiVersion:1, slug:'submissions', adminUrl:`${ window.location.origin }/wp-admin/`, request, confirm, storage };
	} );

	async function boot() { window.eval( source ); document.dispatchEvent( new Event( 'DOMContentLoaded' ) ); await vi.waitFor( () => expect( document.querySelectorAll( '[data-submission-key]' ) ).toHaveLength( posts.filter( ( item ) => item.status === 'pending' ).length ) ); }
	async function openFirst() { await boot(); document.querySelector( '[data-submission-key]' ).click(); await vi.waitFor( () => expect( document.querySelector( '#submission-preview iframe' ) ).not.toBeNull() ); }
	function start() { window.eval( source ); document.dispatchEvent( new Event( 'DOMContentLoaded' ) ); }
	function changeViewport( compact ) { mobile = compact; [ ...mediaListeners ].forEach( ( listener ) => listener( { matches:compact,media:viewportMedia.media } ) ); window.dispatchEvent( new Event( 'resize' ) ); }

	it( 'uses only the injected runtime and stores no WordPress content', async () => {
		await boot(); expect( source ).not.toContain( 'window.parent' ); expect( source ).not.toContain( 'localStorage' ); expect( source ).not.toContain( '_wpnonce' ); expect( source ).not.toMatch( /\bfetch\s*\(/ ); expect( storage.get ).toHaveBeenCalledWith( 'preferences' );
		document.querySelector( '#type-filter input[value="pages"]' ).click(); await vi.waitFor( () => expect( storage.set ).toHaveBeenCalledWith( 'preferences',{ typeFilter:'pages' } ) );
	} );

	it( 'keeps hostile REST HTML in a sandboxed, restrictive, sanitized iframe', async () => {
		await openFirst(); const container = document.querySelector( '#submission-preview' ); const frame = container.querySelector( 'iframe' );
		expect( frame.getAttribute( 'sandbox' ) ).toBe( '' ); expect( frame.getAttribute( 'referrerpolicy' ) ).toBe( 'no-referrer' ); expect( frame.getAttribute( 'title' ) ).toBe( 'Preview of A pending field guide' ); expect( frame.srcdoc ).toContain( "default-src 'none'" ); expect( frame.srcdoc ).toContain( `${ window.location.origin }/same-site.png` );
		expect( frame.srcdoc ).not.toMatch( /on(?:click|error|load)=|<script|<form|<input|<svg|evil\.example/i ); expect( container.querySelector( 'p,img,script,form,input,svg' ) ).toBeNull();
	} );

	it( 'uses an explicit author fallback when embedded author data is absent', async () => {
		posts = [ pending( { _embedded:{} } ) ]; await openFirst(); expect( document.querySelector( '#submission-author' ).textContent ).toBe( 'Author unavailable' ); expect( document.querySelector( '.item-meta' ).textContent ).toContain( 'Author unavailable' );
	} );

	it( 'uses ordinary semantic lists with independently keyboard-focusable buttons', async () => {
		await boot(); const list = document.querySelector( '#submission-list' ); const button = list.querySelector( 'button' );
		expect( list.tagName ).toBe( 'UL' ); expect( list.hasAttribute( 'role' ) ).toBe( false ); expect( button.getAttribute( 'role' ) ).toBeNull(); expect( button.tabIndex ).toBe( 0 );
		button.focus(); button.click(); expect( document.querySelector( '[data-submission-key="posts:41"]' ).getAttribute( 'aria-pressed' ) ).toBe( 'true' );
	} );

	it( 'refetches, confirms, and approves with a status-only mutation', async () => {
		await openFirst(); document.querySelector( '#approve-submission' ).click(); await vi.waitFor( () => expect( request ).toHaveBeenCalledWith( 'wp/v2/posts/41',{ method:'POST',body:{ status:'publish' } } ) ); expect( confirm ).toHaveBeenCalledWith( expect.objectContaining( { title:'Approve and publish?' } ) );
	} );

	it( 'returns focus to the inbox heading after a mobile decision empties the inbox', async () => {
		mobile = true; await openFirst(); document.querySelector( '#approve-submission' ).click();
		await vi.waitFor( () => expect( document.activeElement ).toBe( document.querySelector( '#inbox-heading' ) ) );
		expect( document.querySelector( '#submission-inspector' ).getAttribute( 'aria-hidden' ) ).toBe( 'true' ); expect( document.activeElement ).not.toBe( document.body );
	} );

	it( 'returns an item to drafts through the same conflict-safe path', async () => {
		await openFirst(); document.querySelector( '#return-submission' ).click(); await vi.waitFor( () => expect( request ).toHaveBeenCalledWith( 'wp/v2/posts/41',{ method:'POST',body:{ status:'draft' } } ) ); expect( confirm ).toHaveBeenCalledWith( expect.objectContaining( { title:'Return to drafts?',danger:true } ) );
	} );

	it( 'does not mutate or confirm when the pending item changed elsewhere', async () => {
		await openFirst(); request.mockImplementationOnce( async () => ( { ...posts[ 0 ],modified_gmt:'2026-08-17T20:00:00' } ) ); document.querySelector( '#approve-submission' ).click(); await vi.waitFor( () => expect( document.querySelector( '#global-notice' ).textContent ).toContain( 'changed in WordPress' ) ); expect( confirm ).not.toHaveBeenCalled(); expect( request.mock.calls.some( ( [ path,options = {} ] ) => path === 'wp/v2/posts/41' && options.method === 'POST' ) ).toBe( false );
	} );

	it( 'opens the validated same-origin editor URL with opener isolation', async () => {
		await openFirst(); document.querySelector( '#open-submission' ).click(); expect( window.open ).toHaveBeenCalledWith( `${ window.location.origin }/wp-admin/post.php?post=41&action=edit`,'_blank','noopener,noreferrer' );
	} );

	it( 'shows a visible error when the browser blocks the WordPress editor popup', async () => {
		window.open.mockReturnValue( null ); await openFirst(); document.querySelector( '#open-submission' ).click();
		expect( document.querySelector( '#toast' ).textContent ).toContain( 'Allow pop-ups' ); expect( document.querySelector( '#toast' ).classList.contains( 'is-error' ) ).toBe( true );
	} );

	it( 'treats a timezone-less modified_gmt value as UTC in the inbox and inspector', async () => {
		const previousTimezone = process.env.TZ; process.env.TZ = 'America/Phoenix';
		try {
			posts[ 0 ].modified_gmt = '2026-08-17T00:30:00'; await openFirst();
			const expected = new Intl.DateTimeFormat( undefined,{ dateStyle:'medium',timeStyle:'short' } ).format( new Date( '2026-08-17T00:30:00Z' ) );
			expect( document.querySelector( '.item-meta span:last-child' ).textContent ).toBe( expected ); expect( document.querySelector( '#submission-modified' ).textContent ).toBe( expected );
		} finally { if ( previousTimezone === undefined ) delete process.env.TZ; else process.env.TZ = previousTimezone; }
	} );

	it.each( [ [ 401,'session expired' ],[ 403,'denied this action' ],[ 404,'no longer exists' ] ] )( 'maps an inner %i envelope status to the explicit WordPress message', async ( status,message ) => {
		request.mockResolvedValue( { body:{ code:'rest_error',message:'Raw REST error' },headers:[],status } ); start();
		await vi.waitFor( () => expect( document.querySelector( '#submission-error-copy' ).textContent ).toContain( message ) );
	} );

	it( 'prioritizes an inner expired-nonce code over generic permission messaging', async () => {
		request.mockResolvedValue( { body:{ code:'rest_cookie_invalid_nonce',message:'Cookie check failed' },headers:{},status:403 } ); start();
		await vi.waitFor( () => expect( document.querySelector( '#submission-error-copy' ).textContent ).toContain( 'could not verify this request' ) );
		expect( document.querySelector( '#submission-error-copy' ).textContent ).not.toContain( 'permission' );
	} );

	it( 'makes the narrow inspector modal and restores focus when closed', async () => {
		mobile = true; await boot(); const button = document.querySelector( '[data-submission-key]' ); button.focus(); button.click(); expect( document.querySelector( '#submission-inspector' ).getAttribute( 'aria-modal' ) ).toBe( 'true' ); expect( document.querySelector( '#inbox' ).hasAttribute( 'inert' ) ).toBe( true ); document.querySelector( '#close-inspector' ).click(); expect( document.activeElement.matches( '[data-submission-key="posts:41"]' ) ).toBe( true );
	} );

	it( 'keeps all review actions reachable by internal scrolling at the declared minimum viewport', () => {
		expect( manifest.window ).toMatchObject( { minWidth:320,minHeight:240 } );
		expect( css ).toMatch( /@media\(max-width:780px\)[\s\S]*?\.inspector\{[^}]*overflow-y:auto/ );
		expect( css ).toMatch( /@media\(max-width:780px\)\{\.inspector\{background:#[0-9a-f]{6}\}\}/i );
		expect( css ).toMatch( /@media\(forced-colors:active\)\{\.inspector\{background:Canvas;color:CanvasText\}\}/ );
		expect( css ).toMatch( /\.actions\{[^}]*flex:0 0 auto/ );
	} );

	it( 'synchronizes modal semantics, inert state, and focus across live breakpoint changes', async () => {
		await openFirst();
		const inspector = document.querySelector( '#submission-inspector' );
		expect( inspector.hasAttribute( 'role' ) ).toBe( false );
		expect( document.querySelector( '#inbox' ).hasAttribute( 'inert' ) ).toBe( false );

		changeViewport( true );
		expect( inspector.getAttribute( 'role' ) ).toBe( 'dialog' );
		expect( inspector.getAttribute( 'aria-modal' ) ).toBe( 'true' );
		expect( document.querySelector( '#inbox' ).hasAttribute( 'inert' ) ).toBe( true );
		expect( document.querySelector( '#topbar' ).hasAttribute( 'inert' ) ).toBe( true );
		expect( document.activeElement ).toBe( document.querySelector( '#close-inspector' ) );

		changeViewport( false );
		expect( inspector.hasAttribute( 'role' ) ).toBe( false );
		expect( inspector.hasAttribute( 'aria-modal' ) ).toBe( false );
		expect( document.querySelector( '#inbox' ).hasAttribute( 'inert' ) ).toBe( false );
		expect( document.querySelector( '#topbar' ).hasAttribute( 'inert' ) ).toBe( false );
		expect( document.activeElement ).toBe( document.querySelector( '#submission-title' ) );

		window.dispatchEvent( new Event( 'pagehide' ) );
		expect( mediaListeners.size ).toBe( 0 );
		expect( viewportMedia.removeEventListener ).toHaveBeenCalledWith( 'change',expect.any( Function ) );
	} );
} );
