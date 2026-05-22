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

	it( 'uses Desktop Mode hook constants without registering fallback hooks', () => {
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

		expect( seen ).toEqual( [ 'current' ] );
	} );

	it( 'uses the current hook string fallback when a host constant is absent', () => {
		const seen = [];
		window.wp.desktop = { HOOKS: {} };
		const adapter = window.__odd.desktop;

		adapter.addActionFor(
			'DOCK_ITEM_APPENDED',
			'desktop-mode.dock.item-appended',
			( payload ) => seen.push( payload.id ),
			'odd.test',
		);

		window.wp.hooks.doAction( 'desktop-mode.dock.item-appended', { id: 'fallback' } );

		expect( seen ).toEqual( [ 'fallback' ] );
	} );

	it( 'redocks widgets only through the public Desktop Mode widget API', () => {
		const publicRedock = vi.fn( () => true );
		const privateRedock = vi.fn( () => true );
		window.wp.desktop = {
			widgets: {
				redock: publicRedock,
			},
			widgetLayer: {
				redock: privateRedock,
			},
		};
		const adapter = window.__odd.desktop;

		expect( adapter.redockWidget( 'odd/weather' ) ).toBe( true );

		expect( publicRedock ).toHaveBeenCalledWith( 'odd/weather' );
		expect( privateRedock ).not.toHaveBeenCalled();
	} );

	it( 'sets dock, taskbar, and desktop icon badges through native host APIs', () => {
		const dockBadge = vi.fn();
		const taskbarBadge = vi.fn();
		const iconBadge = vi.fn();
		const dockAttention = vi.fn();
		const taskbarAttention = vi.fn();
		const compactRailBadge = vi.fn();
		const compactRailAttention = vi.fn();
		window.wp.desktop = {
			dock: {
				setBadge:     dockBadge,
				setAttention: dockAttention,
			},
			taskbar: {
				setBadge:     taskbarBadge,
				setAttention: taskbarAttention,
			},
			icons: {
				setBadge: iconBadge,
			},
		};
		window.__odd.dockRails = [
			{
				setBadge:     compactRailBadge,
				setAttention: compactRailAttention,
			},
		];
		const adapter = window.__odd.desktop;

		expect( adapter.capabilities() ).toMatchObject( {
			badges: true,
			attention: true,
		} );
		expect( adapter.setBadge( 'odd', '3.8' ) ).toBe( true );
		expect( dockBadge ).toHaveBeenCalledWith( 'odd', 3 );
		expect( taskbarBadge ).toHaveBeenCalledWith( 'odd', 3 );
		expect( iconBadge ).toHaveBeenCalledWith( 'odd', 3 );
		expect( compactRailBadge ).toHaveBeenCalledWith( 'odd', 3 );

		expect( adapter.clearBadge( 'odd' ) ).toBe( true );
		expect( dockBadge ).toHaveBeenLastCalledWith( 'odd', 0 );
		expect( taskbarBadge ).toHaveBeenLastCalledWith( 'odd', 0 );
		expect( iconBadge ).toHaveBeenLastCalledWith( 'odd', 0 );

		expect( adapter.setAttention( 'odd', 'pulse', { intensity: 'subtle' } ) ).toBe( true );
		expect( dockAttention ).toHaveBeenCalledWith( 'odd', 'pulse', { intensity: 'subtle' } );
		expect( taskbarAttention ).toHaveBeenCalledWith( 'odd', 'pulse', { intensity: 'subtle' } );
		expect( compactRailAttention ).toHaveBeenCalledWith( 'odd', 'pulse', { intensity: 'subtle' } );
	} );

	it( 'registers sanitized Desktop Mode window notices and falls back to toasts', () => {
		const unregister = vi.fn();
		const registerWindowNotice = vi.fn( () => unregister );
		const dismissWindowNotice = vi.fn();
		const showToast = vi.fn();
		window.wp.desktop = {
			registerWindowNotice,
			dismissWindowNotice,
			showToast,
		};
		const adapter = window.__odd.desktop;

		expect( adapter.notify( 'catalog-error', '<strong>Bad</strong> & worse', {
			windowId: 'odd',
			tone: 'warning',
			icon: 'dashicons-warning',
		} ) ).toBe( true );

		expect( registerWindowNotice ).toHaveBeenCalledWith( expect.objectContaining( {
			id: 'odd/catalog-error',
			message: '&lt;strong&gt;Bad&lt;/strong&gt; &amp; worse',
			tone: 'warning',
			icon: 'dashicons-warning',
			match: { window: 'odd' },
		} ) );

		expect( adapter.dismissWindowNotice( 'catalog-error' ) ).toBe( true );
		expect( dismissWindowNotice ).toHaveBeenCalledWith( 'odd/catalog-error' );

		delete window.wp.desktop.registerWindowNotice;
		expect( adapter.notify( 'fallback', 'Fallback toast' ) ).toBe( true );
		expect( showToast ).toHaveBeenCalledWith( expect.objectContaining( {
			message: 'Fallback toast',
		} ) );
	} );
} );
