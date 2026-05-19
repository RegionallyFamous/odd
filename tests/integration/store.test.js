import { describe, expect, it, beforeEach } from 'vitest';
import { loadFoundation } from './harness.js';

describe( 'store — hydration + subscribe + set', () => {
	beforeEach( () => {
		loadFoundation( {
			config: {
				wallpaper: 'flux',
				favorites: [ 'flux' ],
				shuffle:   { enabled: true, minutes: 30 },
				scenes:    [ { slug: 'flux', label: 'Flux' }, { slug: 'aurora', label: 'Aurora' } ],
				iconSets:  [ { slug: 'filament', label: 'Filament' } ],
				schemaVersion: 1,
			},
		} );
	} );

	it( 'hydrates from window.odd into typed slices', () => {
		const store = window.__odd.store;
		expect( store.get( 'user.wallpaper' ) ).toBe( 'flux' );
		expect( store.get( 'user.favorites' ) ).toEqual( [ 'flux' ] );
		expect( store.get( 'user.shuffle.enabled' ) ).toBe( true );
		expect( store.get( 'user.shuffle.minutes' ) ).toBe( 30 );
		expect( store.get( 'user.adminBarHidden' ) ).toBe( true );
		expect( store.get( 'user.schemaVersion' ) ).toBe( 1 );

		const scenes = store.get( 'registries.scenes' );
		expect( scenes ).toHaveLength( 2 );
		expect( scenes[ 0 ].slug ).toBe( 'flux' );
	} );

	it( 'get() supports dotted paths and returns undefined for missing nodes', () => {
		const store = window.__odd.store;
		expect( store.get( 'user.nope' ) ).toBeUndefined();
		expect( store.get( 'runtime.debug' ) ).toBe( false );
	} );

	it( 'set() shallow-merges child objects and broadcasts to subscribers', () => {
		const store = window.__odd.store;
		const seen  = [];
		const unsub = store.subscribe( 'user.wallpaper', ( next, prev ) => seen.push( [ prev, next ] ) );

		store.set( { user: { wallpaper: 'aurora' } } );
		expect( store.get( 'user.wallpaper' ) ).toBe( 'aurora' );
		expect( store.get( 'user.favorites' ) ).toEqual( [ 'flux' ] );
		expect( seen ).toEqual( [ [ 'flux', 'aurora' ] ] );

		unsub();
		store.set( { user: { wallpaper: 'flux' } } );
		expect( seen ).toHaveLength( 1 );
	} );

	it( 'wildcard subscribers receive every change with a source label', () => {
		const store = window.__odd.store;
		const seen  = [];
		store.subscribe( '*', ( after, before, source ) => seen.push( source ) );

		store.set( { runtime: { perfTier: 'low' } }, { source: 'perf' } );
		store.set( { user: { audioReactive: true } } );
		expect( seen ).toEqual( [ 'perf', 'set' ] );
	} );

	it( 'silent writes skip broadcast', () => {
		const store = window.__odd.store;
		let calls = 0;
		store.subscribe( '*', () => { calls++; } );
		store.set( { runtime: { tod: 'dusk' } }, { silent: true } );
		expect( calls ).toBe( 0 );
		expect( store.get( 'runtime.tod' ) ).toBe( 'dusk' );
	} );
} );
