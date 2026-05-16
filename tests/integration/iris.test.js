/**
 * Iris (Cut 3) — muse + motion + rituals on foundation primitives.
 *
 * These tests extend the shared harness by loading the iris modules
 * on top of the foundation. They assert the contract other code
 * relies on: muses register via filter, motion primitives emit
 * `odd.motion.<slug>` bus events, the default Iris lexicon speaks
 * for the primary buckets, and quiet mode suppresses say() while
 * leaving motion intact.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFoundation } from './harness.js';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const IRIS_DIR  = resolve( __dirname, '../../odd/src/iris' );

function execInWindow( src, filename ) {
	const fn = new Function( `${ src }\n//# sourceURL=${ filename }` );
	fn.call( globalThis );
}

function loadIris( modules = [ 'muse.js', 'motion.js' ] ) {
	for ( const file of modules ) {
		const src = readFileSync( resolve( IRIS_DIR, file ), 'utf8' );
		execInWindow( src, file );
	}
}

describe( 'iris — muse lexicon', () => {
	beforeEach( () => {
		loadFoundation();
		loadIris( [ 'muse.js' ] );
	} );

	it( 'registers Iris as the default muse through odd.muses filter', () => {
		const muses = window.wp.hooks.applyFilters( 'odd.muses', [] );
		expect( muses.length ).toBe( 1 );
		expect( muses[ 0 ].slug ).toBe( 'iris' );
		expect( muses[ 0 ].default ).toBe( true );
	} );

	it( 'picks a line from a simple bucket', () => {
		const line = window.__odd.iris.say( 'boot', { silent: true } );
		expect( typeof line ).toBe( 'string' );
		expect( line.length ).toBeGreaterThan( 0 );
	} );

	it( 'picks a line from a nested sceneOpen bucket', () => {
		const line = window.__odd.iris.say( 'sceneOpen.flux', { silent: true } );
		expect( typeof line ).toBe( 'string' );
		expect( line.length ).toBeGreaterThan( 0 );
	} );

	it( 'suppresses say() when user.mascotQuiet is true', () => {
		window.__odd.store.set( { user: { mascotQuiet: true } } );
		const line = window.__odd.iris.say( 'boot', { silent: true } );
		expect( line ).toBe( '' );
	} );

	it( 'honors { force: true } even when quiet', () => {
		window.__odd.store.set( { user: { mascotQuiet: true } } );
		const line = window.__odd.iris.say( 'boot', { silent: true, force: true } );
		expect( typeof line ).toBe( 'string' );
		expect( line.length ).toBeGreaterThan( 0 );
	} );
} );

describe( 'iris — motion primitives', () => {
	beforeEach( () => {
		loadFoundation();
		loadIris( [ 'muse.js', 'motion.js' ] );
	} );

	it( 'registers all five primitives through odd.motionPrimitives filter', () => {
		const list = window.wp.hooks.applyFilters( 'odd.motionPrimitives', [] );
		const slugs = list.map( ( p ) => p.slug );
		expect( slugs.sort() ).toEqual( [ 'blink', 'glance', 'glitch', 'ripple', 'wink' ] );
	} );

	it( 'emits odd.motion.<slug> on the bus when a primitive runs', () => {
		const caught = [];
		window.__odd.events.on( 'odd.motion.blink',  () => caught.push( 'blink' ) );
		window.__odd.events.on( 'odd.motion.ripple', ( p ) => caught.push( [ 'ripple', p ] ) );

		window.__odd.iris.motion.blink();
		window.__odd.iris.motion.ripple( { x: 100, y: 50, intensity: 1 } );

		expect( caught[ 0 ] ).toBe( 'blink' );
		expect( caught[ 1 ][ 0 ] ).toBe( 'ripple' );
		expect( caught[ 1 ][ 1 ] ).toMatchObject( { x: 100, y: 50, intensity: 1 } );
	} );

	it( 'calls the matching hook on the active scene when one is registered', () => {
		const rippleArgs = [];
		window.__odd.runtime = window.__odd.runtime || {};
		window.__odd.runtime.activeScene = {
			slug:  'flux',
			scene: {
				onRipple( opts, state, env ) { rippleArgs.push( [ opts, state, env ] ); },
			},
			state: { marker: 'S' },
			env:   { marker: 'E' },
		};

		window.__odd.iris.motion.ripple( { x: 1, y: 2, intensity: 0.5 } );

		expect( rippleArgs ).toHaveLength( 1 );
		expect( rippleArgs[ 0 ][ 0 ] ).toMatchObject( { x: 1, y: 2, intensity: 0.5 } );
		expect( rippleArgs[ 0 ][ 1 ] ).toEqual( { marker: 'S' } );
		expect( rippleArgs[ 0 ][ 2 ] ).toEqual( { marker: 'E' } );
	} );

	it( 'does not call scene hooks under reduced motion (except glance)', () => {
		const called = [];
		window.__odd.store.set( { runtime: { reducedMotion: true } } );
		window.__odd.runtime = window.__odd.runtime || {};
		window.__odd.runtime.activeScene = {
			slug:  'flux',
			scene: {
				onRipple: () => called.push( 'ripple' ),
				onGlance: () => called.push( 'glance' ),
				onGlitch: () => called.push( 'glitch' ),
			},
			state: {}, env: {},
		};

		window.__odd.iris.motion.ripple( {} );
		window.__odd.iris.motion.glitch( {} );
		window.__odd.iris.motion.glance( { x: 0, y: 0 } );

		expect( called ).toEqual( [ 'glance' ] );
	} );
} );

describe( 'iris — shell error reactivity', () => {
	beforeEach( () => {
		loadFoundation();
		loadIris( [ 'muse.js', 'motion.js', 'reactivity.js' ] );
	} );

	it( 'logs shell problems without showing Iris copy or motion', () => {
		const log = vi.spyOn( window.console, 'log' ).mockImplementation( () => {} );
		const toast = vi.fn();
		const said = [];
		const motions = [];
		window.__odd.api = { toast };
		window.__odd.events.on( 'odd.iris-said', ( payload ) => said.push( payload ) );
		window.__odd.events.on( 'odd.motion.glitch', ( payload ) => motions.push( payload ) );

		window.wp.hooks.doAction( 'desktop-mode.shell.error', { message: 'desktop.min.js 404' } );

		expect( log ).toHaveBeenCalledWith( '[ODD] Shell issue', {
			source:  'desktop-mode.shell.error',
			payload: { message: 'desktop.min.js 404' },
		} );
		expect( toast ).not.toHaveBeenCalled();
		expect( said ).toEqual( [] );
		expect( motions ).toEqual( [] );

		log.mockRestore();
	} );

	it( 'logs iframe problems without visual effects', () => {
		const log = vi.spyOn( window.console, 'log' ).mockImplementation( () => {} );
		const motions = [];
		window.__odd.events.on( 'odd.motion.glitch', ( payload ) => motions.push( payload ) );

		window.__odd.events.emit( 'odd.iframe-error', { slug: 'demo', message: 'iframe load failed' } );

		expect( log ).toHaveBeenCalledWith( '[ODD] Shell issue', {
			source:  'odd.iframe-error',
			payload: { slug: 'demo', message: 'iframe load failed' },
		} );
		expect( motions ).toEqual( [] );

		log.mockRestore();
	} );
} );
