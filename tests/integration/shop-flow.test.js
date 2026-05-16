import { describe, expect, it, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const SHOP_FLOW_JS = resolve( __dirname, '../../odd/src/panel/shop-flow.js' );

function loadShopFlow() {
	window.__odd = {};
	const src = readFileSync( SHOP_FLOW_JS, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=panel/shop-flow.js` );
	fn.call( globalThis );
	return window.__odd.shopFlow;
}

describe( 'ODD Shop flow module', () => {
	beforeEach( () => {
		delete window.__odd;
	} );

	it( 'derives durable card state without depending on panel DOM', () => {
		const flow = loadShopFlow();
		const row = { type: 'scene', slug: 'aurora', installed: true };
		const state = flow.cardState( row, { isActive: false, t: ( s ) => s } );

		expect( state.id ).toBe( 'ready' );
		expect( state.phase ).toBe( 'ready' );
		expect( state.action ).toEqual( { label: 'Apply', kind: 'apply', disabled: false } );
	} );

	it( 'distinguishes visual bundles from code-running bundles', () => {
		const flow = loadShopFlow();

		expect( flow.trustProfile( { type: 'icon-set' }, { t: ( s ) => s } ) ).toMatchObject( {
			id: 'static-images',
			label: 'Static images',
		} );
		expect( flow.trustProfile( { type: 'scene' }, { t: ( s ) => s } ) ).toMatchObject( {
			id: 'local-code',
			label: 'Runs locally',
		} );
		expect( flow.trustProfile( { type: 'app' }, { t: ( s ) => s } ) ).toMatchObject( {
			id: 'sandboxed-app',
			label: 'Sandboxed app',
		} );
	} );
} );
