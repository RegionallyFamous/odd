import { describe, expect, it, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFoundation } from './harness.js';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const SRC = resolve( __dirname, '../../odd/src/commands/index.js' );

function loadCommands() {
	const src = readFileSync( SRC, 'utf8' );
	const fn = new Function( `${ src }\n//# sourceURL=commands/index.js` );
	fn.call( globalThis );
}

describe( 'ODD Desktop Mode palette', () => {
	let paletteDef;
	let api;

	beforeEach( () => {
		document.body.innerHTML = '';
		loadFoundation( {
			config: {
				scenes: [
					{ slug: 'first', label: 'First Scene', category: 'Test' },
					{ slug: 'second', label: 'Second Scene', category: 'Test' },
				],
				iconSets: [
					{ slug: 'soft', label: 'Soft Icons', category: 'Test' },
				],
				cursorSets: [
					{ slug: 'spark', label: 'Spark Cursor', category: 'Test' },
				],
				installedWidgets: [
					{ id: 'odd/sticky', slug: 'sticky', label: 'Sticky Note', category: 'ODD Originals' },
				],
				apps: [
					{ slug: 'timer', name: 'Timer' },
				],
			},
		} );

		api = {
			scenes: () => window.odd.scenes,
			iconSets: () => window.odd.iconSets,
			cursorSets: () => window.odd.cursorSets,
			installedWidgets: () => window.odd.installedWidgets,
			apps: () => window.odd.apps,
			openPanel: vi.fn(),
			shuffle: vi.fn(),
			setScene: vi.fn(),
			setIconSet: vi.fn(),
			setCursorSet: vi.fn(),
			mountWidget: vi.fn(),
			openApp: vi.fn(),
			openOsSettings: vi.fn(),
			resetDecorations: vi.fn(),
		};
		window.__odd.api = api;

		window.wp.desktop = {
			ready: ( cb ) => cb(),
			registerCommand: vi.fn(),
			registerPalette: vi.fn( ( def ) => {
				paletteDef = def;
				return vi.fn();
			} ),
		};
	} );

	it( 'registers an ODD palette with Desktop Mode', () => {
		loadCommands();

		expect( window.wp.desktop.registerPalette ).toHaveBeenCalledTimes( 1 );
		expect( paletteDef ).toMatchObject( {
			id: 'odd',
			label: 'ODD',
		} );
		expect( typeof paletteDef.open ).toBe( 'function' );
		expect( typeof paletteDef.close ).toBe( 'function' );
		expect( typeof paletteDef.isOpen ).toBe( 'function' );
	} );

	it( 'opens, filters, and runs scene actions', () => {
		loadCommands();

		paletteDef.open();
		const dialog = document.querySelector( '.odd-command-palette' );
		const input = document.querySelector( '.odd-command-palette__input' );
		expect( dialog.hidden ).toBe( false );
		expect( paletteDef.isOpen() ).toBe( true );

		input.value = 'second';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		document.querySelector( '.odd-command-palette__item' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );

		expect( api.setScene ).toHaveBeenCalledWith( 'second' );
		expect( dialog.hidden ).toBe( true );
	} );

	it( 'can run installed widget actions', () => {
		loadCommands();

		paletteDef.open();
		const input = document.querySelector( '.odd-command-palette__input' );
		input.value = 'sticky';
		input.dispatchEvent( new Event( 'input', { bubbles: true } ) );
		document.querySelector( '.odd-command-palette__item' )
			.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );

		expect( api.mountWidget ).toHaveBeenCalledWith( 'odd/sticky' );
	} );
} );
