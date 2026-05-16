/**
 * @odd/test-harness — unit-test helpers for ODD extensions.
 *
 * Usage:
 *
 *   import { mountScene, mountWidget, createPixiStub } from '@odd/test-harness';
 *
 *   test( 'my-scene registers', async () => {
 *     const scene = await mountScene( { slug: 'my-scene', source: require( 'fs' ).readFileSync( './scene.js', 'utf8' ) } );
 *     expect( scene.setup ).toBeTypeOf( 'function' );
 *     expect( scene.tick ).toBeTypeOf( 'function' );
 *   } );
 *
 * The harness does NOT boot the full ODD plugin — for that, use
 * Playwright against install-smoke's local WP. What it DOES do:
 *
 *   - Install minimal stubs on `window.__odd` (helpers and scene
 *     registries) so scene/widget IIFEs can run without throwing.
 *   - Evaluate the scene/widget source in the jsdom global scope via
 *     `new Function()` (the same pattern ODD's own vitest harness uses).
 *   - Provide a Pixi v8 stub that accepts any method call and returns
 *     more stubs — `new PIXI.Graphics().rect(…).fill({…}).stroke({…})`
 *     works without a real renderer.
 *
 * Everything in this module is synchronous except `mountScene` and
 * `mountWidget` which return promises so they can lazy-load Pixi-heavy
 * scene sources without slowing vitest startup.
 */

export { createPixiStub } from './pixi-stub.js';
import { createPixiStub } from './pixi-stub.js';

function installHelpers( win ) {
	win.__odd = win.__odd || {};
	win.__odd.scenes = win.__odd.scenes || {};
	win.desktopModeWidgets = win.desktopModeWidgets || {};
	win.wp = win.wp || {};
	win.wp.desktop = win.wp.desktop || {};
	win.wp.desktop.ready = win.wp.desktop.ready || function ready( cb ) { cb(); };
	win.__odd.helpers = Object.assign( {
		rand:    ( a, b ) => ( a + b ) / 2,
		irand:   ( a, b ) => Math.floor( ( a + b ) / 2 ),
		choose:  ( arr ) => ( arr && arr[ 0 ] ),
		clamp:   ( v, lo, hi ) => Math.max( lo, Math.min( hi, v ) ),
		tau:     Math.PI * 2,
		lerpColor:       () => 0xffffff,
		paintVGradient:  () => {},
		makeBloomLayer:  ( PIXI ) => { const c = new PIXI.Container(); c.blendMode = 'add'; return c; },
		computeTod:      () => ( { phase: 'day', amount: 0.5 } ),
		computeSeason:   () => 'summer',
	}, win.__odd.helpers || {} );
	return win.__odd;
}

function evalInWindow( source, filename, win ) {
	const fn = new Function( `${ source }\n//# sourceURL=${ filename || 'anonymous' }` );
	fn.call( win );
}

/**
 * Load a scene module and return its registration.
 * @param {{ slug: string, source: string, filename?: string }} opts
 */
export async function mountScene( { slug, source, filename } ) {
	if ( typeof window === 'undefined' ) {
		throw new Error( '@odd/test-harness requires a DOM environment (use `environment: "jsdom"` in your vitest config).' );
	}
	installHelpers( window );
	evalInWindow( source, filename || `scene:${ slug }.js`, window );
	const scene = window.__odd.scenes[ slug ];
	if ( ! scene ) {
		throw new Error( `scene '${ slug }' did not register on window.__odd.scenes` );
	}
	if ( typeof scene.setup !== 'function' || typeof scene.tick !== 'function' ) {
		throw new Error( `scene '${ slug }' must expose setup() and tick()` );
	}
	return scene;
}

/**
 * Build an `env` object suitable for handing to scene.setup / tick.
 * @param {{ tier?: 'high' | 'normal' | 'low', width?: number, height?: number }} [opts]
 */
export function makeEnv( { tier = 'normal', width = 1920, height = 1080 } = {} ) {
	if ( typeof window === 'undefined' ) throw new Error( 'jsdom required' );
	installHelpers( window );
	const PIXI = createPixiStub();
	PIXI.screen = { width, height };
	return {
		app: PIXI, PIXI,
		ctx: { pluginUrl: '', version: 'harness' },
		helpers: window.__odd.helpers,
		dt: 1,
		parallax: { x: 0, y: 0 },
		reducedMotion: false,
		tod: { phase: 'day', amount: 0.5 },
		todPhase: 'day', season: 'summer',
		audio: { enabled: false, level: 0, bass: 0, mid: 0, high: 0 },
		perfTier: tier,
	};
}

/**
 * Load a widget module and return its registration.
 * @param {{ id: string, source: string, filename?: string }} opts
 */
export async function mountWidget( { id, source, filename } ) {
	if ( typeof window === 'undefined' ) throw new Error( 'jsdom required' );
	installHelpers( window );
	evalInWindow( source, filename || `widget:${ id }.js`, window );
	const mount = window.desktopModeWidgets && window.desktopModeWidgets[ id ];
	if ( typeof mount !== 'function' ) {
		throw new Error( `widget '${ id }' did not define window.desktopModeWidgets['${ id }']` );
	}
	return { id, mount };
}

export function reset() {
	if ( typeof window === 'undefined' ) return;
	window.__odd = undefined;
}
