import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html = readFileSync(
	resolve( '_tools/catalog-sources/apps/pantry/bundle-src/index.html' ),
	'utf8',
);
const source = readFileSync(
	resolve( '_tools/catalog-sources/apps/pantry/bundle-src/assets/app.js' ),
	'utf8',
);

function pattern( id = 101, overrides = {} ) {
	return {
		id,
		date: '2026-08-09T14:30:00',
		modified: '2026-08-15T16:45:00',
		status: 'publish',
		title: { raw: 'Announcement bar', rendered: 'Announcement bar' },
		content: {
			raw: '<!-- wp:paragraph --><p>A useful announcement.</p><!-- /wp:paragraph -->',
			rendered: '<p>A useful announcement.</p>',
		},
		...overrides,
	};
}

function submit( form, submitter ) {
	form.dispatchEvent( new SubmitEvent( 'submit', {
		bubbles: true,
		cancelable: true,
		submitter,
	} ) );
}

describe( 'ODD Pantry runtime and pattern safety', () => {
	let patterns;
	let request;
	let storage;
	let mobileViewport;

	beforeEach( () => {
		mobileViewport = false;
		patterns = [ pattern() ];
		document.documentElement.innerHTML = html
			.replace( /^.*?<html[^>]*>/s, '' )
			.replace( /<\/html>.*$/s, '' );
		window.matchMedia = vi.fn( ( query ) => ( {
			matches: query.includes( 'max-width: 920px' )
				? mobileViewport
				: query.includes( 'min-width: 921px' ) && ! mobileViewport,
			media: query,
			addEventListener: vi.fn(),
			removeEventListener: vi.fn(),
		} ) );
		HTMLDialogElement.prototype.showModal = function showModal() {
			this.open = true;
		};
		HTMLDialogElement.prototype.close = function close() {
			this.open = false;
		};
		Object.defineProperty( navigator, 'clipboard', {
			configurable: true,
			value: { writeText: vi.fn( () => Promise.resolve() ) },
		} );
		window.open = vi.fn( () => ( {} ) );

		request = vi.fn( async ( path, options = {} ) => {
			const method = String( options.method || 'GET' ).toUpperCase();
			if ( path.startsWith( 'wp/v2/blocks?' ) ) {
				return {
					body: [ ...patterns ],
					headers: { 'X-WP-TotalPages': '1' },
					status: 200,
				};
			}
			if ( path === 'wp/v2/blocks' && method === 'POST' ) {
				const created = pattern( Math.max( ...patterns.map( ( item ) => item.id ) ) + 1, {
					title: { raw: options.body.title, rendered: options.body.title },
					content: { raw: options.body.content, rendered: '<p>New reusable content.</p>' },
				} );
				patterns.unshift( created );
				return created;
			}
			const match = path.match( /^wp\/v2\/blocks\/(\d+)(?:\?.*)?$/ );
			if ( match && method === 'POST' ) {
				const id = Number( match[ 1 ] );
				const index = patterns.findIndex( ( item ) => item.id === id );
				patterns[ index ] = {
					...patterns[ index ],
					title: { raw: options.body.title, rendered: options.body.title },
				};
				return patterns[ index ];
			}
			if ( match && method === 'DELETE' ) {
				const id = Number( match[ 1 ] );
				patterns = patterns.filter( ( item ) => item.id !== id );
				return { deleted: true };
			}
			throw Object.assign( new Error( `Unexpected Pantry request: ${ method } ${ path }` ), { status: 500 } );
		} );
		storage = {
			get: vi.fn( () => Promise.resolve( null ) ),
			set: vi.fn( ( _key, value ) => Promise.resolve( value ) ),
			list: vi.fn( () => Promise.resolve( [] ) ),
			remove: vi.fn( () => Promise.resolve() ),
			clear: vi.fn( () => Promise.resolve() ),
		};
		window.oddApp = {
			apiVersion: 1,
			slug: 'pantry',
			adminUrl: `${ window.location.origin }/wp-admin/`,
			request,
			storage,
		};
	} );

	async function boot() {
		window.eval( source );
		document.dispatchEvent( new Event( 'DOMContentLoaded' ) );
		await vi.waitFor( () => {
			expect( document.querySelector( '#pattern-total' ).textContent ).toBe( String( patterns.length ) );
		} );
	}

	it( 'uses only the injected ODD app runtime for data and preferences', async () => {
		await boot();
		expect( source ).not.toContain( 'window.parent' );
		expect( source ).not.toContain( 'localStorage' );
		expect( source ).not.toContain( '_wpnonce' );
		expect( source ).not.toContain( '/odd/v1/apps/store' );
		expect( source ).not.toMatch( /\bfetch\s*\(/ );
		expect( request ).toHaveBeenCalledWith( expect.stringContaining( 'wp/v2/blocks?' ), {} );
		expect( storage.get ).toHaveBeenCalledWith( 'preferences' );
	} );

	it( 'fails closed with a visible update message when runtime v1 is unavailable', async () => {
		delete window.oddApp;
		window.eval( source );
		document.dispatchEvent( new Event( 'DOMContentLoaded' ) );
		await vi.waitFor( () => {
			expect( document.querySelector( '#error-state' ).hidden ).toBe( false );
			expect( document.querySelector( '#error-copy' ).textContent ).toContain( 'ODD app runtime v1' );
		} );
		expect( document.querySelector( '#result-count' ).textContent ).toBe( 'ODD update required' );
		expect( document.querySelector( '#error-retry' ).hidden ).toBe( true );
		expect( request ).not.toHaveBeenCalled();
	} );

	it( 'keeps a failed shelf actionable and recovers on retry', async () => {
		request.mockRejectedValueOnce( Object.assign( new Error( 'Forbidden' ), { status: 403 } ) );
		window.eval( source );
		document.dispatchEvent( new Event( 'DOMContentLoaded' ) );

		await vi.waitFor( () => {
			expect( document.querySelector( '#error-state' ).hidden ).toBe( false );
			expect( document.querySelector( '#empty-state' ).hidden ).toBe( true );
		} );
		document.querySelector( '#error-retry' ).click();
		await vi.waitFor( () => {
			expect( document.querySelector( '#error-state' ).hidden ).toBe( true );
			expect( document.querySelector( '#pattern-total' ).textContent ).toBe( '1' );
		} );
		expect( document.activeElement.matches( '.pattern-card[data-pattern-id="101"] .pattern-card__open' ) ).toBe( true );
		expect( request ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'keeps hostile WordPress markup outside the Pantry document', async () => {
		patterns = [ pattern( 101, {
			content: {
				raw: '<!-- wp:html --><p>Safe words</p><!-- /wp:html -->',
				rendered: '<p class="wp-block-paragraph" onclick="alert(1)">Safe words</p><script>alert(2)</script><svg onload="alert(3)"><circle></circle></svg><math><mtext>math</mtext></math><form><input autofocus></form><img src="/safe.png" onerror="alert(4)"><img src="https://evil.example/tracker.png"><img src="data:image/svg+xml,<svg onload=alert(5)>"><img src="data:image/png;base64,iVBORw0KGgo=">',
			},
		} ) ];
		await boot();

		const container = document.querySelector( '#pattern-preview' );
		const frame = container.querySelector( 'iframe' );
		expect( frame ).not.toBeNull();
		expect( container.children ).toHaveLength( 1 );
		expect( frame.getAttribute( 'sandbox' ) ).toBe( '' );
		expect( frame.getAttribute( 'referrerpolicy' ) ).toBe( 'no-referrer' );
		expect( frame.getAttribute( 'title' ) ).toBe( 'Preview of Announcement bar' );
		expect( frame.srcdoc ).toContain( "default-src 'none'" );
		expect( frame.srcdoc ).toContain( `${ window.location.origin }/safe.png` );
		expect( frame.srcdoc ).toContain( 'data:image/png;base64,iVBORw0KGgo=' );
		expect( frame.srcdoc ).not.toMatch( /on(?:click|error|load)=|<script|<svg|<math|<form|<input|evil\.example|image\/svg\+xml/i );
		expect( container.querySelector( 'p, img, svg, math, form, input, script' ) ).toBeNull();
	} );

	it( 'uses named sibling buttons for keyboard-accessible card actions', async () => {
		mobileViewport = true;
		await boot();
		const card = document.querySelector( '.pattern-card[data-pattern-id="101"]' );
		const open = card.querySelector( ':scope > .pattern-card__open' );
		const favorite = card.querySelector( ':scope > .card-favorite' );

		expect( card.getAttribute( 'role' ) ).toBe( 'listitem' );
		expect( card.hasAttribute( 'tabindex' ) ).toBe( false );
		expect( open ).toBeInstanceOf( HTMLButtonElement );
		expect( open.type ).toBe( 'button' );
		expect( open.tabIndex ).toBe( 0 );
		expect( open.getAttribute( 'aria-label' ) ).toBe( 'Open details for Announcement bar' );
		expect( favorite ).toBeInstanceOf( HTMLButtonElement );
		expect( favorite.getAttribute( 'aria-label' ) ).toBe( 'Add to favorites' );
		expect( open.contains( favorite ) ).toBe( false );

		open.focus();
		expect( document.activeElement ).toBe( open );
		open.click();
		expect( document.querySelector( '#pattern-inspector' ).getAttribute( 'aria-hidden' ) ).toBe( 'false' );
		expect( document.querySelector( '#pattern-title' ).textContent ).toBe( 'Announcement bar' );
	} );

	it( 'creates, renames, duplicates, and trashes through oddApp.request', async () => {
		await boot();

		document.querySelector( '#new-pattern' ).click();
		document.querySelector( '#new-pattern-title' ).value = 'Release banner';
		submit( document.querySelector( '#create-form' ), document.querySelector( '#create-submit' ) );
		await vi.waitFor( () => expect( document.body.textContent ).toContain( 'Release banner' ) );

		document.querySelector( '#rename-pattern' ).click();
		document.querySelector( '#rename-input' ).value = 'Launch banner';
		submit( document.querySelector( '#title-editor' ), document.querySelector( '#title-editor [type="submit"]' ) );
		await vi.waitFor( () => expect( document.querySelector( '#pattern-title' ).textContent ).toBe( 'Launch banner' ) );

		document.querySelector( '#duplicate-pattern' ).click();
		await vi.waitFor( () => expect( document.querySelector( '#pattern-title' ).textContent ).toBe( 'Launch banner copy' ) );

		document.querySelector( '#trash-pattern' ).click();
		submit( document.querySelector( '#trash-form' ), document.querySelector( '#trash-form [value="trash"]' ) );
		await vi.waitFor( () => expect( document.querySelector( '#pattern-total' ).textContent ).toBe( '2' ) );

		expect( request ).toHaveBeenCalledWith( 'wp/v2/blocks', expect.objectContaining( { method: 'POST' } ) );
		expect( request ).toHaveBeenCalledWith( expect.stringMatching( /^wp\/v2\/blocks\/\d+$/ ), expect.objectContaining( { method: 'POST' } ) );
		expect( request ).toHaveBeenCalledWith( expect.stringMatching( /^wp\/v2\/blocks\/\d+\?force=false$/ ), { method: 'DELETE' } );
	} );

	it( 'keeps a created pattern when an earlier refresh response arrives late', async () => {
		await boot();
		let resolveRefresh;
		const stalePatterns = [ ...patterns ];
		request.mockImplementationOnce( () => new Promise( ( resolve ) => {
			resolveRefresh = resolve;
		} ) );

		document.querySelector( '#refresh-patterns' ).click();
		await vi.waitFor( () => expect( resolveRefresh ).toBeTypeOf( 'function' ) );
		document.querySelector( '#new-pattern' ).click();
		document.querySelector( '#new-pattern-title' ).value = 'Queued release banner';
		submit( document.querySelector( '#create-form' ), document.querySelector( '#create-submit' ) );

		expect( document.querySelector( '#create-submit' ).disabled ).toBe( true );
		expect( request.mock.calls.filter( ( [ path, options = {} ] ) =>
			path === 'wp/v2/blocks' && options.method === 'POST'
		) ).toHaveLength( 0 );

		resolveRefresh( {
			body: stalePatterns,
			headers: { 'X-WP-TotalPages': '1' },
			status: 200,
		} );
		await vi.waitFor( () => {
			expect( document.querySelector( '#pattern-total' ).textContent ).toBe( '2' );
			expect( document.body.textContent ).toContain( 'Queued release banner' );
		} );
		expect( request.mock.calls.filter( ( [ path, options = {} ] ) =>
			path === 'wp/v2/blocks' && options.method === 'POST'
		) ).toHaveLength( 1 );
	} );

	it( 'does not resurrect a trashed pattern when an earlier refresh response arrives late', async () => {
		await boot();
		let resolveRefresh;
		const stalePatterns = [ ...patterns ];
		request.mockImplementationOnce( () => new Promise( ( resolve ) => {
			resolveRefresh = resolve;
		} ) );

		document.querySelector( '#refresh-patterns' ).click();
		await vi.waitFor( () => expect( resolveRefresh ).toBeTypeOf( 'function' ) );
		document.querySelector( '#trash-pattern' ).click();
		submit( document.querySelector( '#trash-form' ), document.querySelector( '#trash-form [value="trash"]' ) );

		expect( document.querySelector( '#trash-form [value="trash"]' ).disabled ).toBe( true );
		expect( request.mock.calls.filter( ( [ path, options = {} ] ) =>
			path === 'wp/v2/blocks/101?force=false' && options.method === 'DELETE'
		) ).toHaveLength( 0 );

		resolveRefresh( {
			body: stalePatterns,
			headers: { 'X-WP-TotalPages': '1' },
			status: 200,
		} );
		await vi.waitFor( () => {
			expect( document.querySelector( '#pattern-total' ).textContent ).toBe( '0' );
			expect( document.querySelector( '.pattern-card[data-pattern-id="101"]' ) ).toBeNull();
		} );
		expect( request.mock.calls.filter( ( [ path, options = {} ] ) =>
			path === 'wp/v2/blocks/101?force=false' && options.method === 'DELETE'
		) ).toHaveLength( 1 );
	} );

	it( 'keeps favorites in memory and shows a persistence error when storage fails', async () => {
		storage.get.mockRejectedValue( new Error( 'storage offline' ) );
		storage.set.mockRejectedValue( new Error( 'storage offline' ) );
		await boot();

		document.querySelector( '.card-favorite' ).click();
		await vi.waitFor( () => {
			expect( document.querySelector( '#count-favorites' ).textContent ).toBe( '1' );
			expect( document.querySelector( '#toast' ).textContent ).toContain( 'could not save' );
		} );
		expect( localStorage ).toHaveLength( 0 );
	} );

	it( 'merges an early favorite over preferences that finish loading later', async () => {
		let resolvePreferences;
		storage.get.mockImplementationOnce( () => new Promise( ( resolve ) => {
			resolvePreferences = resolve;
		} ) );
		window.eval( source );
		document.dispatchEvent( new Event( 'DOMContentLoaded' ) );
		await vi.waitFor( () => {
			expect( document.querySelector( '.pattern-card[data-pattern-id="101"]' ) ).not.toBeNull();
		} );

		document.querySelector( '.pattern-card[data-pattern-id="101"] .card-favorite' ).click();
		expect( document.querySelector( '#count-favorites' ).textContent ).toBe( '1' );
		expect( storage.set ).not.toHaveBeenCalled();

		resolvePreferences( { favorites: [] } );
		await vi.waitFor( () => {
			expect( storage.set ).toHaveBeenCalledWith( 'preferences', { favorites: [ 101 ] } );
			expect( document.querySelector( '#count-favorites' ).textContent ).toBe( '1' );
			expect( document.querySelector( '.pattern-card[data-pattern-id="101"] .card-favorite' ).getAttribute( 'aria-label' ) ).toBe( 'Remove from favorites' );
		} );
	} );

	it( 'preserves card-control focus when favorite state rerenders the grid', async () => {
		await boot();
		const favorite = document.querySelector( '.pattern-card[data-pattern-id="101"] .card-favorite' );
		favorite.focus();
		favorite.click();

		const restored = document.activeElement;
		expect( restored ).not.toBe( favorite );
		expect( restored.matches( '.pattern-card[data-pattern-id="101"] .card-favorite' ) ).toBe( true );
		expect( restored.getAttribute( 'aria-label' ) ).toBe( 'Remove from favorites' );
	} );

	it( 'treats mobile details as a modal overlay and returns focus on close', async () => {
		mobileViewport = true;
		await boot();
		const open = document.querySelector( '.pattern-card[data-pattern-id="101"] .pattern-card__open' );
		open.focus();
		open.click();

		const inspector = document.querySelector( '#pattern-inspector' );
		expect( document.activeElement ).toBe( document.querySelector( '#close-inspector' ) );
		expect( inspector.getAttribute( 'role' ) ).toBe( 'dialog' );
		expect( inspector.getAttribute( 'aria-modal' ) ).toBe( 'true' );
		expect( inspector.getAttribute( 'aria-labelledby' ) ).toBe( 'pattern-title' );
		[ '.topbar', '.side-panel', '.library' ].forEach( ( selector ) => {
			expect( document.querySelector( selector ).hasAttribute( 'inert' ) ).toBe( true );
		} );

		document.querySelector( '#close-inspector' ).click();
		expect( inspector.getAttribute( 'aria-hidden' ) ).toBe( 'true' );
		expect( inspector.hasAttribute( 'aria-modal' ) ).toBe( false );
		expect( document.activeElement.matches( '.pattern-card[data-pattern-id="101"] .pattern-card__open' ) ).toBe( true );
		[ '.topbar', '.side-panel', '.library' ].forEach( ( selector ) => {
			expect( document.querySelector( selector ).hasAttribute( 'inert' ) ).toBe( false );
		} );
		} );

	it( 'lets Escape cancel the mobile trash dialog without closing pattern details', async () => {
		mobileViewport = true;
		await boot();
		document.querySelector( '.pattern-card[data-pattern-id="101"] .pattern-card__open' ).click();
		const inspector = document.querySelector( '#pattern-inspector' );
		const dialog = document.querySelector( '#trash-dialog' );
		document.querySelector( '#trash-pattern' ).click();
		expect( dialog.open ).toBe( true );

		document.dispatchEvent( new KeyboardEvent( 'keydown', {
			key: 'Escape',
			bubbles: true,
			cancelable: true,
		} ) );
		dialog.close();

		expect( dialog.open ).toBe( false );
		expect( inspector.getAttribute( 'aria-hidden' ) ).toBe( 'false' );
		expect( inspector.getAttribute( 'aria-modal' ) ).toBe( 'true' );
		expect( document.querySelector( '#pattern-title' ).textContent ).toBe( 'Announcement bar' );
	} );

	it( 'enters mobile modality on resize and after creating a pattern', async () => {
		await boot();
		mobileViewport = true;
		window.dispatchEvent( new Event( 'resize' ) );
		expect( document.activeElement ).toBe( document.querySelector( '#close-inspector' ) );
		expect( document.querySelector( '#pattern-inspector' ).getAttribute( 'aria-modal' ) ).toBe( 'true' );

		document.querySelector( '#close-inspector' ).click();
		document.querySelector( '#new-pattern' ).click();
		await vi.waitFor( () => expect( document.activeElement ).toBe( document.querySelector( '#new-pattern-title' ) ) );
		document.querySelector( '#new-pattern-title' ).value = 'Mobile pattern';
		submit( document.querySelector( '#create-form' ), document.querySelector( '#create-submit' ) );
		await vi.waitFor( () => {
			expect( document.querySelector( '#pattern-title' ).textContent ).toBe( 'Mobile pattern' );
			expect( document.activeElement ).toBe( document.querySelector( '#close-inspector' ) );
		} );
		expect( document.querySelector( '#pattern-inspector' ).getAttribute( 'aria-modal' ) ).toBe( 'true' );
	} );

	it( 'moves focus to the visible inspector title when leaving mobile modality', async () => {
		await boot();
		mobileViewport = true;
		window.dispatchEvent( new Event( 'resize' ) );
		expect( document.activeElement ).toBe( document.querySelector( '#close-inspector' ) );

		mobileViewport = false;
		window.dispatchEvent( new Event( 'resize' ) );
		expect( document.activeElement ).toBe( document.querySelector( '#pattern-title' ) );
		expect( document.querySelector( '#pattern-inspector' ).hasAttribute( 'aria-modal' ) ).toBe( false );
		[ '.topbar', '.side-panel', '.library' ].forEach( ( selector ) => {
			expect( document.querySelector( selector ).hasAttribute( 'inert' ) ).toBe( false );
		} );
	} );

	it( 'serializes rapid favorite writes and continues after a failed write', async () => {
		let rejectFirstWrite;
		storage.set
			.mockImplementationOnce( () => new Promise( ( _resolve, reject ) => {
				rejectFirstWrite = reject;
			} ) )
			.mockResolvedValueOnce( { favorites: [] } );
		await boot();

		const favorite = document.querySelector( '.pattern-card[data-pattern-id="101"] .card-favorite' );
		favorite.focus();
		favorite.click();
		document.activeElement.click();
		await vi.waitFor( () => expect( storage.set ).toHaveBeenCalledTimes( 1 ) );
		expect( storage.set.mock.calls[ 0 ][ 1 ] ).toEqual( { favorites: [ 101 ] } );

		rejectFirstWrite( new Error( 'first write failed' ) );
		await vi.waitFor( () => {
			expect( storage.set ).toHaveBeenCalledTimes( 2 );
			expect( document.querySelector( '#toast' ).textContent ).toContain( 'could not save' );
		} );
		expect( storage.set.mock.calls[ 1 ][ 1 ] ).toEqual( { favorites: [] } );
		expect( document.querySelector( '#count-favorites' ).textContent ).toBe( '0' );
	} );

	it( 'provides mobile-stable names and opens only a scoped relative editor URL', async () => {
		await boot();
		expect( document.querySelector( '#pattern-search' ).getAttribute( 'aria-label' ) ).toBe( 'Search synced patterns' );
		expect( document.querySelector( '#new-pattern' ).getAttribute( 'aria-label' ) ).toBe( 'New pattern' );

		document.querySelector( '#open-pattern' ).click();
		expect( window.open ).toHaveBeenCalledWith(
			`${ window.location.origin }/wp-admin/post.php?post=101&action=edit`,
			'_blank',
			'noopener,noreferrer',
		);
	} );
} );
