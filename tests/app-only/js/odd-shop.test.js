import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const panelSource = readFileSync( resolve( 'odd/src/panel/index.js' ), 'utf8' );
const panelStyles = readFileSync( resolve( 'odd/src/panel/styles.css' ), 'utf8' );
const registry = JSON.parse( readFileSync( resolve( 'site/catalog/v1/registry.json' ), 'utf8' ) );

describe( 'Apps-only ODD Shop', () => {
	let osSettings;

	beforeEach( () => {
		document.body.innerHTML = '<div data-odd-shop></div>';
		window.openStationNativeWindows = {};
		osSettings = {
			desktopLayout: 'unified',
			dockPlacement: 'bottom',
			itemVisibility: {},
		};
		window.wp = {
			i18n: { __: ( value ) => value },
			hooks: { addFilter: vi.fn(), hasFilter: vi.fn( () => false ) },
			os: {
				HOOKS: { WINDOW_GEOMETRY: 'os.window.geometry' },
				getWindowConfig: vi.fn( () => ( {
					canInstall: true,
					restNonce: 'nonce',
					rest: {
						apps: '/wp-json/odd/v1/apps',
						catalog: '/wp-json/odd/v1/bundles/catalog',
						install: '/wp-json/odd/v1/bundles/install-from-catalog',
						refresh: '/wp-json/odd/v1/bundles/refresh',
						bundles: '/wp-json/odd/v1/bundles/',
					},
					installedApps: [],
					catalogApps: registry.bundles,
				} ) ),
				fetch: vi.fn(),
				confirm: vi.fn( () => Promise.resolve( true ) ),
				openWindow: vi.fn(),
				refreshMenu: vi.fn( () => Promise.resolve() ),
				files: {
					rest: {
						listPlacements: vi.fn( () => Promise.resolve( {
							folderId: 0,
							placements: [],
						} ) ),
					},
					store: {
						setFolderPlacements: vi.fn(),
					},
				},
				getOsSettings: vi.fn( () => ( {
					...osSettings,
					itemVisibility: { ...osSettings.itemVisibility },
				} ) ),
				updateOsSettings: vi.fn( ( patch ) => {
					if ( patch && patch.itemVisibility ) {
						osSettings.itemVisibility = { ...patch.itemVisibility };
					}
				} ),
			},
		};
		window.eval( panelSource );
	} );

	function mountShop() {
		window.openStationNativeWindows.odd( document.body, {} );
		return document.querySelector( '[data-odd-shop]' ) || document.body;
	}

	function response( payload, ok = true ) {
		return Promise.resolve( {
			ok,
			status: ok ? 200 : 500,
			statusText: ok ? 'OK' : 'Error',
			json: () => Promise.resolve( payload ),
		} );
	}

	function catalogRow( slug ) {
		return registry.bundles.find( ( row ) => row.slug === slug );
	}

	function geometryFilter() {
		return window.wp.hooks.addFilter.mock.calls.find(
			( call ) => call[ 0 ] === 'os.window.geometry',
		)[ 2 ];
	}

	it( 'publishes ODD Notes and ODD Workbench in the production catalog', () => {
		expect( registry.bundles.length ).toBeGreaterThanOrEqual( 2 );
		expect( registry.bundles ).toEqual( expect.arrayContaining( [
			expect.objectContaining( { type: 'app', slug: 'odd-notes', name: 'ODD Notes' } ),
			expect.objectContaining( { type: 'app', slug: 'workbench', name: 'ODD Workbench' } ),
		] ) );
	} );

	it( 'registers and renders through the OpenStation native window API', () => {
		const context = { markLoading: vi.fn(), markReady: vi.fn() };
		window.openStationNativeWindows.odd( document.body, context );
		expect( document.body.textContent ).toContain( 'Apps' );
		expect( document.body.textContent ).toContain( 'ODD Notes' );
		expect( document.body.textContent ).toContain( 'ODD Workbench' );
		expect( context.markLoading ).toHaveBeenCalledOnce();
		expect( context.markReady ).toHaveBeenCalledOnce();
	} );

	it( 'registers the ODD geometry guard exactly once across immediate and init paths', () => {
		expect( window.wp.hooks.addFilter ).toHaveBeenCalledWith(
			'os.window.geometry',
			'odd/shop-fit-viewport',
			expect.any( Function ),
		);
		expect( window.wp.hooks.addFilter ).toHaveBeenCalledTimes( 1 );
		document.dispatchEvent( new Event( 'os-init' ) );
		expect( window.wp.hooks.addFilter ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'fits the Shop and app windows inside compact desktop bounds', () => {
		const filter = geometryFilter();
		expect( filter(
			{ x: 40, y: 40, width: 920, height: 640 },
			{ baseId: 'odd', desktopRect: { width: 390, height: 844 } },
		) ).toEqual( { x: 12, y: 40, width: 366, height: 640 } );
		expect( filter(
			{ x: 500, y: 500, width: 1120, height: 720, state: 'normal' },
			{ baseId: 'odd-app-pantry', hasSavedGeometry: true, desktopRect: { width: 1280, height: 720 } },
		) ).toEqual( { x: 148, y: 12, width: 1120, height: 616, state: 'normal' } );
	} );

	it( 'maps every public desktop layout to its documented bottom-dock behavior', () => {
		const filter = geometryFilter();
		const geometry = { x: 12, y: 12, width: 800, height: 696 };
		const context = { baseId: 'odd-app-pantry', desktopRect: { width: 1280, height: 720 } };

		osSettings = { ...osSettings, desktopLayout: 'unified', dockPlacement: 'left' };
		expect( filter( geometry, context ) ).toBe( geometry );

		osSettings = { ...osSettings, desktopLayout: 'unified', dockPlacement: 'bottom' };
		expect( filter( geometry, context ) ).toEqual( { x: 12, y: 12, width: 800, height: 616 } );

		osSettings = { ...osSettings, desktopLayout: 'classic', dockPlacement: 'right' };
		expect( filter( geometry, context ) ).toEqual( { x: 12, y: 12, width: 800, height: 616 } );

		osSettings = { ...osSettings, desktopLayout: 'spatial', dockPlacement: 'bottom' };
		expect( filter( geometry, context ) ).toEqual( { x: 12, y: 12, width: 800, height: 616 } );

		osSettings = { ...osSettings, desktopLayout: 'spatial', dockPlacement: 'right' };
		expect( filter( geometry, context ) ).toBe( geometry );

		osSettings = { ...osSettings, desktopLayout: 'openstation', dockPlacement: 'left' };
		expect( filter( geometry, context ) ).toEqual( { x: 12, y: 12, width: 800, height: 616 } );
	} );

	it( 'preserves safe geometry, window state, non-ODD windows, and incomplete contexts', () => {
		const filter = geometryFilter();
		const safe = { x: 24, y: 24, width: 600, height: 500, state: 'maximized' };
		const desktopRect = { width: 1280, height: 720 };

		expect( filter( safe, { baseId: 'odd-app-workbench', desktopRect } ) ).toBe( safe );
		expect( filter(
			{ x: 40, y: 40, width: 920, height: 640 },
			{ baseId: 'edit-post', desktopRect: { width: 390, height: 844 } },
		) ).toEqual( { x: 40, y: 40, width: 920, height: 640 } );
		expect( filter( safe, null ) ).toBe( safe );
		expect( filter( safe, { baseId: 'odd' } ) ).toBe( safe );
		expect( filter( safe, { baseId: 'oddity', desktopRect } ) ).toBe( safe );
		expect( filter( safe, { baseId: 'odd-app-', desktopRect } ) ).toBe( safe );
	} );

	it( 'degrades to margin-only clamping when public settings are unavailable', () => {
		const filter = geometryFilter();
		window.wp.os.getOsSettings.mockImplementation( () => {
			throw new Error( 'settings unavailable' );
		} );
		expect( filter(
			{ x: -100, y: 500, width: 1120, height: 696, state: 'normal' },
			{ baseId: 'odd-app-pantry', desktopRect: { width: 1280, height: 720 } },
		) ).toEqual( { x: 12, y: 12, width: 1120, height: 696, state: 'normal' } );
	} );

	it( 'renders a compact responsive shelf instead of full-width app features', () => {
		window.openStationNativeWindows.odd( document.body, {} );
		const cards = document.querySelectorAll( '.odd-app-card' );
		const card = cards[ 0 ];

		expect( document.querySelector( '.odd-shop__main' ) ).not.toBeNull();
		expect( document.querySelector( '.odd-shop__intro h1' )?.textContent ).toBe( 'Small tools. Strange polish.' );
		expect( cards ).toHaveLength( registry.bundles.length );
		expect( card?.dataset.state ).toBe( 'available' );
		expect( card?.querySelector( '.odd-app-card__preview' )?.getAttribute( 'src' ) ).toBe( registry.bundles[ 0 ].card_url );
		expect( card?.querySelector( '.odd-app-card__button--primary' )?.textContent ).toContain( 'Install app' );
		expect( card?.querySelector( '.odd-app-card__featured' ) ).toBeNull();
		expect( document.body.textContent ).toContain( 'WordPress' );
		expect( document.body.textContent ).not.toContain( 'Wordpress' );
		expect( panelStyles ).toContain( 'width: min(100%, 1240px);' );
		expect( panelStyles ).toContain( 'grid-template-columns: repeat(auto-fill, minmax(min(100%, 260px), 1fr));' );
		expect( panelStyles ).not.toContain( 'grid-template-columns: minmax(0, 1.22fr)' );
		expect( panelStyles ).toContain( '@container odd-shop (max-width: 840px)' );
	} );

	it( 'blocks incompatible apps with the server compatibility reason while leaving compatible apps installable', () => {
		const reason = 'Requires OpenStation 2.5.0 or newer; detected 2.4.0.';
		const pantry = {
			...catalogRow( 'pantry' ),
			incompatible: true,
			state: 'incompatible',
			incompatibility_reason: reason,
			incompatibility_current: { odd: '1.1.10', openStation: '2.4.0', api: '1.0.0' },
		};
		const notes = catalogRow( 'odd-notes' );
		window.wp.os.getWindowConfig.mockReturnValue( {
			...window.wp.os.getWindowConfig(),
			catalogApps: [ pantry, notes ],
		} );

		const shop = mountShop();
		const pantryCard = shop.querySelector( '.odd-app-card[data-slug="pantry"]' );
		const pantryAction = pantryCard.querySelector( '.odd-app-card__button--primary' );
		const notesCard = shop.querySelector( '.odd-app-card[data-slug="odd-notes"]' );
		const notesAction = notesCard.querySelector( '.odd-app-card__button--primary' );

		expect( pantryCard.dataset.state ).toBe( 'incompatible' );
		expect( pantryCard.querySelector( '.odd-app-card__state' ).textContent ).toContain( 'Update required' );
		expect( pantryCard.querySelector( '.odd-app-card__compatibility' ).textContent ).toBe( reason );
		expect( pantryAction.disabled ).toBe( true );
		expect( pantryAction.textContent ).toContain( 'Update required' );
		expect( pantryAction.textContent ).not.toContain( 'Install app' );
		expect( pantryAction.title ).toBe( reason );

		pantryAction.dispatchEvent( new MouseEvent( 'click', { bubbles: true } ) );
		expect( window.wp.os.fetch ).not.toHaveBeenCalled();

		expect( notesCard.dataset.state ).toBe( 'available' );
		expect( notesAction.disabled ).toBe( false );
		expect( notesAction.textContent ).toContain( 'Install app' );
	} );

	it( 'opens rather than updating an installed app when its newer catalog row is incompatible', async () => {
		const pantryCatalog = {
			...catalogRow( 'pantry' ),
			incompatible: true,
			state: 'incompatible',
			incompatibility_reason: 'Requires OpenStation 2.5.0 or newer; detected 2.4.0.',
			version: '2.0.0',
		};
		const pantryInstalled = {
			...catalogRow( 'pantry' ),
			version: '1.0.0',
			enabled: true,
		};
		window.wp.os.getWindowConfig.mockReturnValue( {
			...window.wp.os.getWindowConfig(),
			installedApps: [ pantryInstalled ],
			catalogApps: [ pantryCatalog ],
		} );
		window.wp.os.openWindow.mockReturnValue( true );

		const shop = mountShop();
		const card = shop.querySelector( '.odd-app-card[data-slug="pantry"]' );
		const primary = card.querySelector( '.odd-app-card__button--primary' );

		expect( card.dataset.state ).toBe( 'installed' );
		expect( primary.textContent ).toContain( 'Open app' );
		expect( primary.textContent ).not.toContain( 'Update app' );
		expect( primary.disabled ).toBe( false );
		expect( card.querySelector( '.odd-app-card__button--remove' ) ).not.toBeNull();
		expect( card.querySelector( '.odd-app-card__compatibility' ) ).toBeNull();

		primary.click();
		await vi.waitFor( () => expect( window.wp.os.openWindow ).toHaveBeenCalledOnce() );
		expect( window.wp.os.fetch ).not.toHaveBeenCalled();
	} );

	it( 'uses the server update flag instead of comparing version strings in the browser', () => {
		const installed = {
			...catalogRow( 'workbench' ),
			version: '2.0.0',
			enabled: true,
		};
		const serverSaysUpdate = {
			...catalogRow( 'workbench' ),
			version: '1.0.0-beta.2',
			update_available: true,
		};
		window.wp.os.getWindowConfig.mockReturnValue( {
			...window.wp.os.getWindowConfig(),
			installedApps: [ installed ],
			catalogApps: [ serverSaysUpdate ],
		} );

		let shop = mountShop();
		expect( shop.querySelector( '.odd-app-card[data-slug="workbench"]' ).dataset.state ).toBe( 'update' );

		document.body.innerHTML = '<div data-odd-shop></div>';
		window.wp.os.getWindowConfig.mockReturnValue( {
			...window.wp.os.getWindowConfig(),
			installedApps: [ { ...installed, version: '1.0.0-beta.1' } ],
			catalogApps: [ { ...serverSaysUpdate, version: '9.0.0', update_available: false } ],
		} );
		shop = mountShop();
		expect( shop.querySelector( '.odd-app-card[data-slug="workbench"]' ).dataset.state ).toBe( 'installed' );
		expect( panelSource ).not.toContain( 'versionNewer' );
	} );

	it( 'contains no retired wp.desktop integration calls', () => {
		expect( panelSource ).not.toContain( 'wp.desktop' );
		expect( panelSource ).not.toContain( 'desktopModeNativeWindows' );
		expect( panelSource ).toContain( 'openStationNativeWindows' );
	} );

	it( 'installs Notes into the live desktop without a page refresh', async () => {
		const notes = catalogRow( 'odd-notes' );
		const installed = {
			...notes,
			enabled: true,
			surfaces: { desktop: true, taskbar: false },
		};
		window.wp.os.fetch.mockImplementation( ( url, options ) => {
			if ( url.includes( 'install-from-catalog' ) && options.method === 'POST' ) {
				return response( {
					installed: true,
					slug: 'odd-notes',
					row: installed,
					manifest: installed,
				} );
			}
			if ( url.includes( '/apps' ) ) {
				return response( { apps: [ installed ] } );
			}
			return response( { bundles: [ notes ] } );
		} );

		const shop = mountShop();
		shop.querySelector( '.odd-app-card[data-slug="odd-notes"] .odd-app-card__button--primary' ).click();

		await vi.waitFor( () => {
			expect( shop.querySelector( '.odd-app-card[data-slug="odd-notes"]' )?.dataset.state ).toBe( 'installed' );
		} );
		expect( window.wp.os.updateOsSettings ).toHaveBeenCalledWith( {
			itemVisibility: { 'odd-app-odd-notes': 'desktop' },
		}, { windowId: 'odd' } );
		expect( window.wp.os.refreshMenu ).toHaveBeenCalledOnce();
		expect( window.wp.os.files.rest.listPlacements ).toHaveBeenCalledWith( 0 );
		expect( window.wp.os.files.store.setFolderPlacements ).toHaveBeenCalledWith( 0, [] );
		expect( shop.textContent ).toContain( 'Everything is up to date.' );
	} );

	it( 'hydrates a newly installed unknown slug into the unified launcher store without a reload', async () => {
		const slug = 'catalog-canary-unit';
		const available = {
			...catalogRow( 'workbench' ),
			slug,
			name: 'Catalog Canary',
			label: 'Catalog Canary',
		};
		const installed = {
			...available,
			enabled: true,
			surfaces: { desktop: true, taskbar: false },
		};
		const placement = {
			id: 8123,
			parentId: 0,
			file: {
				type: 'shortcut',
				ref: `odd-app-${ slug }`,
				shortcutWindow: `odd-app-${ slug }`,
			},
		};
		window.wp.os.getWindowConfig.mockReturnValue( {
			...window.wp.os.getWindowConfig(),
			installedApps: [],
			catalogApps: [ available ],
		} );
		window.wp.os.files.rest.listPlacements.mockResolvedValue( {
			folderId: 0,
			placements: [ placement ],
		} );
		window.wp.os.fetch.mockImplementation( ( url, options ) => {
			if ( url.includes( 'install-from-catalog' ) && options.method === 'POST' ) {
				return response( { installed: true, slug, row: installed, manifest: installed } );
			}
			if ( url.includes( '/apps' ) ) {
				return response( { apps: [ installed ] } );
			}
			return response( { bundles: [ available ] } );
		} );

		const shop = mountShop();
		shop.querySelector( `.odd-app-card[data-slug="${ slug }"] .odd-app-card__button--primary` ).click();

		await vi.waitFor( () => {
			expect( shop.querySelector( `.odd-app-card[data-slug="${ slug }"]` )?.dataset.state ).toBe( 'installed' );
		} );
		expect( window.wp.os.files.rest.listPlacements ).toHaveBeenCalledWith( 0 );
		expect( window.wp.os.files.store.setFolderPlacements ).toHaveBeenCalledWith( 0, [ placement ] );
		expect( window.wp.os.files.rest.listPlacements.mock.invocationCallOrder[ 0 ] )
			.toBeGreaterThan( window.wp.os.refreshMenu.mock.invocationCallOrder[ 0 ] );
		expect( shop.textContent ).toContain( 'Everything is up to date.' );
	} );

	it( 'preserves an existing hidden placement while reinstalling an app', async () => {
		const workbench = catalogRow( 'workbench' );
		const installed = {
			...workbench,
			enabled: true,
			surfaces: { desktop: true, taskbar: false },
		};
		osSettings.itemVisibility[ 'odd-app-workbench' ] = 'hidden';
		window.wp.os.fetch.mockImplementation( ( url, options ) => {
			if ( url.includes( 'install-from-catalog' ) && options.method === 'POST' ) {
				return response( { installed: true, slug: 'workbench', row: installed, manifest: installed } );
			}
			if ( url.includes( '/apps' ) ) {
				return response( { apps: [ installed ] } );
			}
			return response( { bundles: [ workbench ] } );
		} );

		const shop = mountShop();
		shop.querySelector( '.odd-app-card[data-slug="workbench"] .odd-app-card__button--primary' ).click();

		await vi.waitFor( () => {
			expect( shop.querySelector( '.odd-app-card[data-slug="workbench"]' )?.dataset.state ).toBe( 'installed' );
		} );
		expect( window.wp.os.updateOsSettings ).not.toHaveBeenCalled();
		expect( osSettings.itemVisibility[ 'odd-app-workbench' ] ).toBe( 'hidden' );
	} );

	it( 'uses OpenStation confirmation and leaves an app installed when removal is cancelled', async () => {
		const workbench = { ...catalogRow( 'workbench' ), enabled: true, installed: true };
		window.wp.os.getWindowConfig.mockReturnValue( {
			...window.wp.os.getWindowConfig(),
			installedApps: [ workbench ],
			catalogApps: [ workbench ],
		} );
		window.wp.os.confirm.mockResolvedValueOnce( false );

		const shop = mountShop();
		shop.querySelector( '.odd-app-card[data-slug="workbench"] .odd-app-card__button--remove' ).click();
		await vi.waitFor( () => expect( window.wp.os.confirm ).toHaveBeenCalledOnce() );

		expect( window.wp.os.confirm ).toHaveBeenCalledWith( expect.objectContaining( {
			title: 'Remove this app?',
			confirmLabel: 'Remove',
			cancelLabel: 'Keep it',
			danger: true,
		} ) );
		expect( window.wp.os.fetch ).not.toHaveBeenCalled();
		expect( panelSource ).not.toContain( 'window.confirm' );
	} );

	it( 'retries a missing Workbench registration before reporting launch success', async () => {
		const workbench = {
			...catalogRow( 'workbench' ),
			enabled: true,
			surfaces: { desktop: true, taskbar: false },
		};
		window.wp.os.getWindowConfig.mockReturnValue( {
			...window.wp.os.getWindowConfig(),
			installedApps: [ workbench ],
			catalogApps: [ workbench ],
		} );
		window.wp.os.openWindow.mockReturnValueOnce( false ).mockReturnValueOnce( true );

		const shop = mountShop();
		shop.querySelector( '.odd-app-card[data-slug="workbench"] .odd-app-card__button--primary' ).click();

		await vi.waitFor( () => expect( window.wp.os.openWindow ).toHaveBeenCalledTimes( 2 ) );
		expect( window.wp.os.openWindow ).toHaveBeenNthCalledWith( 1, 'odd-app-workbench', {
			source: 'odd/shop',
		} );
		expect( window.wp.os.openWindow ).toHaveBeenNthCalledWith( 2, 'odd-app-workbench', {
			source: 'odd/shop-retry',
		} );
		expect( window.wp.os.refreshMenu ).toHaveBeenCalledOnce();
		expect( shop.textContent ).not.toContain( 'could not open' );
	} );

	it( 'keeps a committed install visible when the live desktop refresh fails', async () => {
		const workbench = catalogRow( 'workbench' );
		const installed = {
			...workbench,
			enabled: true,
			surfaces: { desktop: true, taskbar: false },
		};
		window.wp.os.refreshMenu.mockRejectedValue( new Error( 'probe timed out' ) );
		window.wp.os.fetch.mockImplementation( ( url, options ) => {
			if ( url.includes( 'install-from-catalog' ) && options.method === 'POST' ) {
				return response( { installed: true, slug: 'workbench', row: installed, manifest: installed } );
			}
			if ( url.includes( '/apps' ) ) {
				return response( { apps: [ installed ] } );
			}
			return response( { bundles: [ workbench ] } );
		} );

		const shop = mountShop();
		shop.querySelector( '.odd-app-card[data-slug="workbench"] .odd-app-card__button--primary' ).click();

		await vi.waitFor( () => {
			expect( shop.querySelector( '.odd-app-card[data-slug="workbench"]' )?.dataset.state ).toBe( 'installed' );
			expect( shop.textContent ).toContain( 'installed, but OpenStation could not refresh' );
		} );
		expect( shop.textContent ).toContain( 'Open app' );
		expect( shop.textContent ).not.toContain( 'Everything is up to date.' );
	} );
} );
