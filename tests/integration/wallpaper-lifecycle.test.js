import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFoundation } from './harness.js';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const WALLPAPER_JS = resolve( __dirname, '../../odd/src/wallpaper/index.js' );

function deferred() {
	let resolvePromise;
	let rejectPromise;
	const promise = new Promise( ( resolve, reject ) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	} );
	return { promise, resolve: resolvePromise, reject: rejectPromise };
}

function chainStub() {
	const fn = function () { return fn; };
	fn.children = [];
	fn.style = {};
	fn.position = { set: vi.fn(), x: 0, y: 0 };
	fn.scale = { set: vi.fn(), x: 1, y: 1 };
	fn.anchor = { set: vi.fn(), x: 0, y: 0 };
	fn.addChild = vi.fn();
	fn.removeChildren = vi.fn();
	return new Proxy( fn, {
		get( target, prop ) {
			if ( prop in target ) return target[ prop ];
			if ( prop === 'then' ) return undefined;
			if ( typeof prop === 'symbol' ) return undefined;
			return chainStub();
		},
		apply() { return chainStub(); },
		construct() { return chainStub(); },
	} );
}

function installPixiStub( options = {} ) {
	const apps = [];
	const initDeferred = options.initDeferred || null;
	class Application {
		constructor() {
			this.canvas = document.createElement( 'canvas' );
			this.stage = { addChild: vi.fn(), removeChildren: vi.fn() };
			this.renderer = {
				width:  800,
				height: 600,
				on:    vi.fn(),
				off:   vi.fn(),
			};
			this.ticker = {
				add:    vi.fn(),
				remove: vi.fn(),
				start:  vi.fn(),
				stop:   vi.fn(),
				maxFPS: 0,
			};
			this.destroy = vi.fn( () => {
				if ( this.canvas.parentNode ) this.canvas.parentNode.removeChild( this.canvas );
			} );
			apps.push( this );
		}

		init() {
			return initDeferred ? initDeferred.promise : Promise.resolve();
		}
	}

	function StubCtor() {
		return chainStub();
	}

	window.PIXI = {
		Application,
		Graphics: StubCtor,
		Container: StubCtor,
		Sprite: StubCtor,
		Texture: { from: vi.fn( () => chainStub() ) },
		BlurFilter: StubCtor,
	};

	return { apps, initDeferred };
}

function loadWallpaper( config = {} ) {
	let wallpaperDef = null;
	loadFoundation( {
		config: Object.assign( {
			pluginUrl: '',
			version:   'test',
			scene:     'first',
			wallpaper: 'first',
			scenes: [
				{ slug: 'first', label: 'First', installed: true, fallbackColor: '#111111' },
				{ slug: 'second', label: 'Second', installed: true, fallbackColor: '#222222' },
			],
			audioReactive: false,
		}, config ),
	} );
	window.wp.desktop = {
		ready:             ( cb ) => cb(),
		registerWallpaper: vi.fn( ( def ) => {
			wallpaperDef = def;
		} ),
	};
	const src = readFileSync( WALLPAPER_JS, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=wallpaper/index.js` );
	fn.call( globalThis );
	return { wallpaperDef };
}

async function settle( count = 3 ) {
	for ( let i = 0; i < count; i++ ) {
		await Promise.resolve();
		await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );
	}
}

describe( 'ODD wallpaper lifecycle', () => {
	beforeEach( () => {
		document.body.innerHTML = '';
		delete window.PIXI;
		vi.spyOn( window.HTMLCanvasElement.prototype, 'getContext' ).mockReturnValue( {
			drawImage: vi.fn(),
			getImageData: vi.fn( () => ( { data: new Uint8ClampedArray( 32 * 32 * 4 ) } ) ),
		} );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
	} );

	it( 'returns a teardown function synchronously from the Desktop Mode mount contract', () => {
		installPixiStub();
		const { wallpaperDef } = loadWallpaper();
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const teardown = wallpaperDef.mount( container, { id: 'odd', prefersReducedMotion: false } );

		expect( typeof teardown ).toBe( 'function' );
		teardown();
	} );

	it( 'destroys a late Pixi app when teardown runs before async init resolves', async () => {
		const initDeferred = deferred();
		const pixi = installPixiStub( { initDeferred } );
		const { wallpaperDef } = loadWallpaper();
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const teardown = wallpaperDef.mount( container, { id: 'odd', prefersReducedMotion: false } );
		teardown( 'test-before-init' );
		initDeferred.resolve();
		await settle();

		expect( pixi.apps ).toHaveLength( 1 );
		expect( pixi.apps[ 0 ].destroy ).toHaveBeenCalledTimes( 1 );
		expect( container.querySelectorAll( 'canvas' ) ).toHaveLength( 0 );
		expect( container.querySelector( '[data-odd-firstpaint]' ) ).toBeNull();
	} );

	it( 'tears down the active wallpaper when Desktop Mode emits wallpaper.unmounting', async () => {
		const pixi = installPixiStub();
		const { wallpaperDef } = loadWallpaper();
		window.__odd.scenes.first = {
			setup: vi.fn( () => ( {} ) ),
			tick:  vi.fn(),
			cleanup: vi.fn(),
		};
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const teardown = wallpaperDef.mount( container, { id: 'odd', prefersReducedMotion: false } );
		await settle();
		window.wp.hooks.doAction( 'desktop-mode.wallpaper.unmounting', { id: 'odd' } );
		window.wp.hooks.doAction( 'desktop-mode.wallpaper.unmounting', { id: 'odd' } );
		teardown( 'desktop-mode-fallback' );

		expect( pixi.apps[ 0 ].destroy ).toHaveBeenCalledTimes( 1 );
		expect( window.__odd.wallpaperRuntime.active ).toBeNull();
	} );

	it( 'tears down the active wallpaper and audio on odd.teardown', async () => {
		const pixi = installPixiStub();
		const { wallpaperDef } = loadWallpaper();
		const disable = vi.fn();
		window.__odd.audio = { disable };
		window.__odd.scenes.first = {
			setup: vi.fn( () => ( {} ) ),
			tick:  vi.fn(),
			cleanup: vi.fn(),
		};
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const teardown = wallpaperDef.mount( container, { id: 'odd', prefersReducedMotion: false } );
		await settle();
		window.__odd.events.emit( 'odd.teardown' );
		teardown( 'fallback' );

		expect( pixi.apps[ 0 ].destroy ).toHaveBeenCalledTimes( 1 );
		expect( disable ).toHaveBeenCalled();
		expect( window.__odd.wallpaperRuntime.active ).toBeNull();
	} );

	it( 'removes the previous scene tick and calls cleanup during scene swaps', async () => {
		const pixi = installPixiStub();
		const firstCleanup = vi.fn();
		const secondCleanup = vi.fn();
		const { wallpaperDef } = loadWallpaper();
		window.__odd.scenes.first = {
			setup: vi.fn( () => ( { name: 'first-state' } ) ),
			tick:  vi.fn(),
			cleanup: firstCleanup,
		};
		window.__odd.scenes.second = {
			setup: vi.fn( () => ( { name: 'second-state' } ) ),
			tick:  vi.fn(),
			cleanup: secondCleanup,
		};
		const container = document.createElement( 'div' );
		document.body.appendChild( container );

		const teardown = wallpaperDef.mount( container, { id: 'odd', prefersReducedMotion: false } );
		await settle();
		const firstTick = pixi.apps[ 0 ].ticker.add.mock.calls[ 0 ][ 0 ];

		window.wp.hooks.doAction( 'odd.pickScene', 'second' );
		await settle();

		expect( pixi.apps[ 0 ].ticker.remove ).toHaveBeenCalledWith( firstTick );
		expect( firstCleanup ).toHaveBeenCalledTimes( 1 );
		expect( secondCleanup ).not.toHaveBeenCalled();

		teardown();
		expect( secondCleanup ).toHaveBeenCalledTimes( 1 );
		expect( pixi.apps[ 0 ].destroy ).toHaveBeenCalledTimes( 1 );
	} );
} );
