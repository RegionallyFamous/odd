import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync( resolve( 'odd/assets/odd-browser-api.js' ), 'utf8' );

function response( payload, status = 200 ) {
	return {
		ok: status >= 200 && status < 300,
		status,
		headers: { get: () => 'application/json' },
		json: async () => payload,
		text: async () => status === 204 ? '' : JSON.stringify( payload ),
	};
}

describe( 'window.oddApp v1 runtime', () => {
	beforeEach( () => {
		delete window.oddApp;
		document.head.innerHTML = '<script type="application/json" id="odd-browser-api-config">' + JSON.stringify( {
			slug: 'pantry',
			windowId: 'odd-app-pantry',
			restRoot: window.location.origin + '/wp-json/',
			restNonce: 'nonce-123',
			adminUrl: window.location.origin + '/wp-admin/',
		} ) + '</script>';
		window.wp = { os: { fetch: vi.fn( async () => response( { ok: true } ) ), confirm: vi.fn( async () => true ) } };
		window.eval( source );
	} );

	it( 'publishes one frozen, least-authority API', () => {
		expect( window.oddApp ).toMatchObject( { apiVersion: 1, slug: 'pantry', windowId: 'odd-app-pantry' } );
		expect( Object.isFrozen( window.oddApp ) ).toBe( true );
		expect( Object.isFrozen( window.oddApp.storage ) ).toBe( true );
		expect( window.oddApp ).not.toHaveProperty( 'parent' );
	} );

	it( 'confines authenticated requests beneath the configured REST root', async () => {
		window.wp.os.fetch.mockResolvedValueOnce( response( { id: 7 } ) );
		await expect( window.oddApp.request( 'wp/v2/types' ) ).resolves.toEqual( { id: 7 } );
		const [ url, options ] = window.wp.os.fetch.mock.calls[ 0 ];
		expect( url ).toBe( window.location.origin + '/wp-json/wp/v2/types' );
		expect( options.credentials ).toBe( 'same-origin' );
		expect( options.headers.get( 'X-WP-Nonce' ) ).toBe( 'nonce-123' );
		await expect( window.oddApp.request( 'https://attacker.example/data' ) ).rejects.toThrow( /REST root/ );
		await expect( window.oddApp.request( window.location.origin + '/wp-admin/users.php' ) ).rejects.toThrow( /REST root/ );
	} );

	it( 'serializes plain JSON request bodies without weakening caller headers', async () => {
		window.wp.os.fetch.mockResolvedValueOnce( response( { id: 8 } ) );
		await window.oddApp.request( 'wp/v2/blocks', { method: 'POST', body: { title: 'Pantry test' } } );
		const options = window.wp.os.fetch.mock.calls[ 0 ][ 1 ];
		expect( options.body ).toBe( JSON.stringify( { title: 'Pantry test' } ) );
		expect( options.headers.get( 'Content-Type' ) ).toBe( 'application/json' );
	} );

	it( 'wraps only the current app storage bucket and native confirmation', async () => {
		window.wp.os.fetch.mockResolvedValueOnce( response( { value: [ 1, 2 ] } ) );
		await expect( window.oddApp.storage.set( 'favorites', [ 1, 2 ] ) ).resolves.toEqual( [ 1, 2 ] );
		expect( window.wp.os.fetch.mock.calls[ 0 ][ 0 ] ).toContain( '/wp-json/odd/v1/apps/store/pantry/favorites' );
		await expect( window.oddApp.storage.get( '../other' ) ).rejects.toThrow( /lowercase slug/ );
		await expect( window.oddApp.confirm( { title: 'Remove?' } ) ).resolves.toBe( true );
		expect( window.wp.os.confirm ).toHaveBeenCalledWith( { title: 'Remove?' } );
	} );

	it( 'accepts successful REST responses with no body', async () => {
		window.wp.os.fetch.mockResolvedValueOnce( response( null, 204 ) );
		await expect( window.oddApp.storage.remove( 'favorites' ) ).resolves.toBeNull();
	} );
} );
