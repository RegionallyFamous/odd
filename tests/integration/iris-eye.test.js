import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFoundation } from './harness.js';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const EYE_JS = resolve( __dirname, '../../odd/src/iris/eye.js' );

function loadEye() {
	const src = readFileSync( EYE_JS, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=iris/eye.js` );
	fn.call( globalThis );
}

describe( 'Iris eye teardown', () => {
	let disconnect;
	let removeSpy;
	let addSpy;

	beforeEach( () => {
		document.body.innerHTML = '';
		loadFoundation();
		disconnect = vi.fn();
		class MockMutationObserver {
			constructor() {}
			observe = vi.fn();
			disconnect = disconnect;
		}
		vi.stubGlobal( 'MutationObserver', MockMutationObserver );
		window.MutationObserver = MockMutationObserver;
		addSpy = vi.spyOn( document, 'addEventListener' );
		removeSpy = vi.spyOn( document, 'removeEventListener' );
	} );

	afterEach( () => {
		vi.restoreAllMocks();
		vi.unstubAllGlobals();
	} );

	it( 'removes document observers, timers, DOM, and event subscriptions on odd.teardown', () => {
		loadEye();

		expect( addSpy ).toHaveBeenCalledWith( 'pointermove', expect.any( Function ), { passive: true } );

		window.__odd.events.emit( 'odd.motion.blink' );
		expect( document.querySelector( '[data-odd-iris]' ) ).not.toBeNull();

		window.__odd.events.emit( 'odd.teardown' );

		expect( disconnect ).toHaveBeenCalledTimes( 1 );
		expect( removeSpy ).toHaveBeenCalledWith( 'pointermove', expect.any( Function ) );
		expect( document.querySelector( '[data-odd-iris]' ) ).toBeNull();

		window.__odd.events.emit( 'odd.motion.blink' );
		expect( document.querySelector( '[data-odd-iris]' ) ).toBeNull();
		window.__odd.iris.eye.blink();
		expect( document.querySelector( '[data-odd-iris]' ) ).toBeNull();
	} );
} );
