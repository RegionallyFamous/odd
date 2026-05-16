import { describe, expect, it, beforeEach, vi } from 'vitest';
import { loadFoundation } from './harness.js';

describe( 'ODD Desktop Mode adapter', () => {
	beforeEach( () => {
		loadFoundation();
	} );

	it( 'detects Desktop Mode dynamically and registers host surfaces through one boundary', () => {
		const unregister = vi.fn();
		const registerCommand = vi.fn( () => unregister );
		const registerNamespace = vi.fn();
		const registerType = vi.fn();
		const registerOpener = vi.fn();
		const openWindow = vi.fn();
		window.wp.desktop = {
			ready: ( cb ) => cb(),
			isReady: () => true,
			HOOKS: {
				DOCK_ITEM_APPENDED: 'desktop-mode.dock.item-appended',
			},
			registerCommand,
			registerNamespace,
			openWindow,
			files: {
				registerType,
				registerOpener,
			},
		};

		const adapter = window.__odd.desktop;
		expect( adapter.capabilities() ).toMatchObject( {
			active: true,
			ready: true,
			commands: true,
			namespaces: true,
			fileTypes: true,
			fileOpeners: true,
		} );

		expect( adapter.registerCommand( { slug: 'odd-test' } ) ).toBe( unregister );
		expect( registerCommand ).toHaveBeenCalledWith( { slug: 'odd-test' } );

		expect( adapter.registerNamespace( 'odd', { ping: () => true } ) ).toBe( true );
		expect( registerNamespace ).toHaveBeenCalledWith( 'odd', expect.objectContaining( { ping: expect.any( Function ) } ) );

		expect( adapter.registerFileType( { type: 'odd-bundle', label: 'ODD Bundle' } ) ).toBe( true );
		expect( adapter.registerFileOpener( { id: 'odd/open-file', types: [ 'odd-bundle' ] } ) ).toBe( true );
		expect( registerType ).toHaveBeenCalledWith( expect.objectContaining( { type: 'odd-bundle' } ) );
		expect( registerOpener ).toHaveBeenCalledWith( expect.objectContaining( { id: 'odd/open-file' } ) );

		expect( adapter.openWindow( 'odd' ) ).toBe( true );
		expect( openWindow ).toHaveBeenCalledWith( 'odd', undefined );
	} );

	it( 'resolves Desktop Mode hook constants with fallbacks', () => {
		const seen = [];
		window.wp.desktop = {
			HOOKS: {
				DOCK_ITEM_APPENDED: 'desktop-mode.dock.item-removed',
			},
		};
		const adapter = window.__odd.desktop;

		const off = adapter.addActionFor(
			'DOCK_ITEM_APPENDED',
			'desktop-mode.dock.item-appended',
			( payload ) => seen.push( payload.id ),
			'odd.test',
		);

		window.wp.hooks.doAction( 'desktop-mode.dock.item-removed', { id: 'current' } );
		window.wp.hooks.doAction( 'desktop-mode.dock.item-appended', { id: 'fallback' } );
		off();
		window.wp.hooks.doAction( 'desktop-mode.dock.item-removed', { id: 'after' } );

		expect( seen ).toEqual( [ 'current', 'fallback' ] );
	} );
} );
