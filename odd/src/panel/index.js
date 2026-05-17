/**
 * ODD Shop — native-window render callback.
 * ---------------------------------------------------------------
 * Registered on Desktop Mode's `window.desktopModeNativeWindows.odd`
 * callback registry. The shell invokes this when the window opens and
 * re-invokes it every time the user re-opens a previously-closed
 * instance. The returned function is the teardown, called on close.
 *
 * Layout: Mac App Store–style shop with a top bar, a left
 * department rail (Wallpapers / Icon Sets / Apps / About), and
 * a right content pane that groups items into category
 * "shelves". All state still flows through the same REST
 * endpoint used by ODD's runtime — wallpaper via WP Desktop Mode's
 * per-user settings, icons via Desktop Mode's dock/icon registries.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	var wpI18nOdd = window.wp && window.wp.i18n;
	function __( s ) {
		return ( wpI18nOdd && typeof wpI18nOdd.__ === 'function' ) ? wpI18nOdd.__( s, 'odd-outlandish-desktop-decorator' ) : s;
	}

	window.desktopModeNativeWindows = window.desktopModeNativeWindows || {};

	function desktopHookName( key, fallback ) {
		var d = window.wp && window.wp.desktop;
		return key && d && d.HOOKS && d.HOOKS[ key ] ? d.HOOKS[ key ] : fallback;
	}

	var _safeCall = ( window.__odd && window.__odd.safeCall ) || function ( fn ) { try { return fn(); } catch ( e ) {} };
	var _events   = window.__odd && window.__odd.events;
	function reportError( source, err ) {
		if ( _events ) {
			try {
				_events.emit( 'odd.error', {
					source:   source,
					err:      err,
					severity: 'error',
					message:  err && err.message,
					stack:    err && err.stack,
				} );
			} catch ( e ) {}
		}
	}
	function diagnostics() {
		return window.__odd && window.__odd.diagnostics;
	}
	function diagTime( name, meta ) {
		var d = diagnostics();
		return d && typeof d.time === 'function' ? d.time( name, meta ) : function () {};
	}
	function diagCount( name, by ) {
		var d = diagnostics();
		if ( d && typeof d.count === 'function' ) d.count( name, by );
	}
	function hostOddWindow() {
		var d = window.wp && window.wp.desktop;
		return d && d.windowManager && typeof d.windowManager.getById === 'function'
			? d.windowManager.getById( 'odd' )
			: null;
	}
	function markShopLoading( win ) {
		if ( win && typeof win.markContentLoading === 'function' ) {
			win.markContentLoading();
		}
	}
	function markShopLoaded( win ) {
		if ( ! win || typeof win.markContentLoaded !== 'function' ) return;
		if ( typeof window.requestAnimationFrame === 'function' ) {
			window.requestAnimationFrame( function () { win.markContentLoaded(); } );
		} else {
			win.markContentLoaded();
		}
	}

	// Mac App Store–style "departments". The ids are unchanged so
	// localized config (`appsEnabled`), slash commands, and tests
	// keep working; only the user-facing labels + icons moved.
	var SECTIONS = [
		{ id: 'wallpaper', label: __( 'Wallpapers' ), icon: '🖼', glyph: 'g-wallpaper', group: 'decorate', tint: 'var(--odd-shop-tint-wallpaper)', tagline: __( 'Living desktop weather' ) },
		{ id: 'icons',     label: __( 'Icon Sets' ),  icon: '🧩', glyph: 'g-icons',     group: 'decorate', tint: 'var(--odd-shop-tint-icons)',     tagline: __( 'Native disguises' ) },
		{ id: 'cursors',   label: __( 'Cursors' ),    icon: '➹', glyph: 'g-cursors',   group: 'decorate', tint: 'var(--odd-shop-tint-cursors)',   tagline: __( 'Living pointer auras' ) },
		{ id: 'widgets',   label: __( 'Widgets' ),    icon: '🧷', glyph: 'g-widgets',   group: 'more',     tint: 'var(--odd-shop-tint-widgets)',   tagline: __( 'Tiny desktop creatures' ) },
		{ id: 'apps',      label: __( 'Apps' ),       icon: '📦', glyph: 'g-apps',      group: 'more',     tint: 'var(--odd-shop-tint-apps)',      tagline: __( 'Little tools, big portals' ), gated: 'appsEnabled' },
		{ id: 'install',   label: __( 'Install' ),    icon: '⇪', glyph: 'g-install',   group: 'you',      tint: 'var(--odd-shop-accent)',         tagline: __( 'Feed it files' ),           gated: 'canInstall' },
		{ id: 'settings',  label: __( 'Settings' ),   icon: '⚙', glyph: 'g-settings',  group: 'you',      tint: 'var(--odd-shop-accent-2)',       tagline: __( 'Tune the strange' ) },
		{ id: 'about',     label: __( 'About' ),      icon: '👁', glyph: 'g-about',     group: 'you',      tint: 'var(--odd-shop-tint-wallpaper)', tagline: __( 'Lore & blinking' ) },
	];

	var renderPanel = function ( body ) {
		var stopPanelTimer = diagTime( 'panel.render', { window: 'odd' } );
		// Bundle-install lookup tables. Hoisted so nested
		// render functions can use them regardless of file order.
		var DEPT_FOR_TYPE = {
			'app':      'apps',
			'cursor-set': 'cursors',
			'icon-set': 'icons',
			'scene':    'wallpaper',
			'widget':   'widgets',
		};
		var cleanupFns = [];
		var sectionCleanupFns = [];
		var flowToastTimer = 0;
		var flowToastNode = null;

		function addSectionCleanup( clean ) {
			if ( typeof clean === 'function' ) sectionCleanupFns.push( clean );
		}

		function cleanupSection() {
			while ( sectionCleanupFns.length ) {
				var clean = sectionCleanupFns.pop();
				try { clean(); } catch ( e ) {}
			}
		}

		function isAbsoluteUrl( url ) {
			return /^(?:https?:)?\/\//i.test( String( url || '' ) ) || /^data:/i.test( String( url || '' ) );
		}

		function normaliseCatalogAssetUrl( url, rowType, slug ) {
			url = String( url || '' );
			if ( ! url ) return '';
			if ( isAbsoluteUrl( url ) || url.charAt( 0 ) === '/' ) return url;
			// Scene rows may carry a bare preview filename. The runtime zip does
			// not ship catalog art, but the configured catalog publishes the
			// matching scene thumbnail.
			if ( rowType === 'scene' && slug && /\.webp(?:[?#].*)?$/i.test( url ) ) {
				var catalogBase = String( state.cfg.catalogBaseUrl || '' ).replace( /\/+$/, '' );
				if ( catalogBase ) {
					return catalogBase + '/icons/scene-' + encodeURIComponent( slug ) + '.webp';
				}
			}
			return url;
		}

		function shopGlyph( id, label ) {
			var svg = document.createElementNS( 'http://www.w3.org/2000/svg', 'svg' );
			svg.setAttribute( 'class', 'odd-shop__rail-icon' );
			svg.setAttribute( 'viewBox', '0 0 24 24' );
			svg.setAttribute( 'role', 'img' );
			svg.setAttribute( 'aria-label', label || id );
			var use = document.createElementNS( 'http://www.w3.org/2000/svg', 'use' );
			use.setAttributeNS( 'http://www.w3.org/1999/xlink', 'href', ( ( window.odd && window.odd.pluginUrl ) || '' ) + '/assets/shop/glyphs.svg#' + id );
			use.setAttribute( 'href', ( ( window.odd && window.odd.pluginUrl ) || '' ) + '/assets/shop/glyphs.svg#' + id );
			svg.appendChild( use );
			return svg;
		}

		body.innerHTML = '';
		injectStyles();
		body.classList.add( 'odd-panel', 'odd-shop' );
		body.setAttribute( 'data-odd-shop-v2', ( ! window.odd || window.odd.shopV2 !== false ) ? '1' : '0' );
		body.style.cssText = [
			'display:grid',
			'grid-template-rows:auto 1fr',
			'grid-template-columns:clamp(64px, 22cqw, 260px) minmax(0, 1fr)',
			'height:100%',
			'min-height:0',
			'font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
			'color:var(--odd-shop-ink)',
			'background:var(--odd-shop-bg)',
		].join( ';' );

		// Top bar — window-wide chrome band that frames the whole
		// store. Spans both columns and gives the sidebar + content
		// a shared ceiling like the macOS App Store window.
		var topbar = el( 'header', { 'data-odd-topbar': '1', class: 'odd-shop__topbar' } );
		var brandWrap = el( 'div', { class: 'odd-shop__brand' } );
		var brandMark = el( 'span', { class: 'odd-shop__brand-mark', 'aria-hidden': 'true' } );
		var brandImg = el( 'img', {
			src: ( ( window.odd && window.odd.pluginUrl ) || '' ) + '/assets/shop/brand-mark.svg',
			alt: '',
			loading: 'eager',
			decoding: 'async',
		} );
		brandMark.appendChild( brandImg );
		installBrandGaze( body, brandMark );
		var brandText = el( 'div', { class: 'odd-shop__brand-text' } );
		var brandTitle = el( 'strong' );
		brandTitle.textContent = __( 'ODD Shop' );
		var brandSub = el( 'span' );
		brandSub.textContent = __( 'Desktop decor with a wink' );
		brandText.appendChild( brandTitle );
		brandText.appendChild( brandSub );
		brandWrap.appendChild( brandMark );
		brandWrap.appendChild( brandText );
		topbar.appendChild( brandWrap );

		var commandWrap = el( 'div', { class: 'odd-shop__command' } );

		// Search field — global client-side search across every Shop
		// department. It merges installed content and catalog rows into
		// one result surface so the user doesn't have to guess which tab
		// owns a scene, app, icon set, or widget.
		var searchWrap = el( 'label', { class: 'odd-shop__search', 'aria-label': __( 'Search' ) } );
		var searchGlyph = el( 'span', { class: 'odd-shop__search-glyph', 'aria-hidden': 'true' } );
		searchGlyph.textContent = '⌕';
		var searchInput = el( 'input', {
			type: 'search',
			class: 'odd-shop__search-input',
			placeholder: __( 'Search the Shop' ),
			'data-odd-search': '1',
		} );
		searchInput.addEventListener( 'input', function () {
			state.query = searchInput.value || '';
			if ( state.query ) playShopSound( 'search' );
			renderSection( state.active, { keepQuery: true } );
		} );
		searchInput.addEventListener( 'keydown', function ( e ) {
			if ( e.key === 'Enter' ) saveRecentSearch( searchInput.value );
		} );
		searchInput.addEventListener( 'blur', function () {
			saveRecentSearch( searchInput.value );
		} );
		searchWrap.appendChild( searchGlyph );
		searchWrap.appendChild( searchInput );
		var searchHint = el( 'span', { class: 'odd-shop__search-kbd', 'aria-hidden': 'true' } );
		searchHint.textContent = '⌘K';
		searchWrap.appendChild( searchHint );
		commandWrap.appendChild( searchWrap );

		var searchTools = el( 'div', { class: 'odd-shop__search-tools', 'data-odd-search-tools': '1' } );
		var scopeToggle = el( 'button', { type: 'button', class: 'odd-shop__search-scope' } );
		scopeToggle.setAttribute( 'aria-pressed', 'true' );
		scopeToggle.textContent = __( 'All departments' );
		scopeToggle.addEventListener( 'click', function () {
			state.searchScope = state.searchScope === 'all' ? 'current' : 'all';
			scopeToggle.textContent = state.searchScope === 'all' ? __( 'All departments' ) : __( 'This department' );
			scopeToggle.setAttribute( 'aria-pressed', state.searchScope === 'all' ? 'true' : 'false' );
			renderSection( state.active, { keepQuery: true } );
		} );
		searchTools.appendChild( scopeToggle );
		var categoryChips = {};
		var allStylesChip = el( 'button', { type: 'button', class: 'odd-shop__search-chip odd-shop__search-chip--all is-active' } );
		allStylesChip.textContent = __( 'All styles' );
		allStylesChip.setAttribute( 'aria-pressed', 'true' );
		allStylesChip.addEventListener( 'click', function () {
			state.categoryFilter = '';
			updateSearchToolState();
			renderSection( state.active, { keepQuery: true } );
		} );
		searchTools.appendChild( allStylesChip );
		var chipLabels = [ 'Generative', 'Atmosphere', 'Paper', 'ODD Originals', 'Community' ];
		chipLabels.forEach( function ( label ) {
			var chip = el( 'button', { type: 'button', class: 'odd-shop__search-chip' } );
			chip.textContent = label;
			chip.setAttribute( 'aria-pressed', 'false' );
			chip.addEventListener( 'click', function () {
				state.categoryFilter = state.categoryFilter === label ? '' : label;
				updateSearchToolState();
				renderSection( state.active, { keepQuery: true } );
			} );
			categoryChips[ label ] = chip;
			searchTools.appendChild( chip );
		} );
		try {
			var recentSearches = JSON.parse( window.localStorage.getItem( 'odd.shop.recent-searches' ) || '[]' );
			if ( Array.isArray( recentSearches ) && recentSearches.length ) {
				recentSearches.slice( 0, 6 ).forEach( function ( label ) {
					var recent = el( 'button', { type: 'button', class: 'odd-shop__search-chip odd-shop__search-chip--recent' } );
					recent.textContent = label;
					recent.addEventListener( 'click', function () {
						state.query = String( label || '' );
						state.categoryFilter = '';
						searchInput.value = state.query;
						updateSearchToolState();
						renderSection( state.active, { keepQuery: true } );
					} );
					searchTools.appendChild( recent );
				} );
			}
		} catch ( e ) {}
		commandWrap.appendChild( searchTools );
		topbar.appendChild( commandWrap );
		var onSearchShortcut = function ( e ) {
			if ( ( e.metaKey || e.ctrlKey ) && String( e.key || '' ).toLowerCase() === 'k' ) {
				e.preventDefault();
				searchInput.focus();
				searchInput.select();
			}
		};
		document.addEventListener( 'keydown', onSearchShortcut );
		cleanupFns.push( function () {
			document.removeEventListener( 'keydown', onSearchShortcut );
		} );

		// The Shop used to render a dedicated "Install" pill in the
		// topbar next to the search field, but it duplicated the
		// dedicated Install tab (which has the same uploader with
		// proper explanatory copy) and the shop-wide drop overlay.
		// Removed to tighten the topbar; installBundle() is still
		// reachable via both surfaces.

		var sidebar = el( 'nav', {
			'data-odd-sidebar': '1',
			class: 'odd-shop__rail',
		} );
		var railTooltip = el( 'div', {
			class: 'odd-shop__rail-tooltip-popover',
			role: 'tooltip',
			'aria-hidden': 'true',
		} );
		document.body.appendChild( railTooltip );
		cleanupFns.push( function () {
			if ( railTooltip && railTooltip.parentNode ) railTooltip.parentNode.removeChild( railTooltip );
		} );
		function sectionTooltipText( section ) {
			return section.label + ( section.tagline ? ' - ' + section.tagline : '' );
		}
		function showRailTooltip( btn, section, labelWrap ) {
			if ( labelWrap && window.getComputedStyle && window.getComputedStyle( labelWrap ).display !== 'none' ) {
				return;
			}
			var rect = btn.getBoundingClientRect ? btn.getBoundingClientRect() : null;
			if ( ! rect ) return;
			railTooltip.textContent = sectionTooltipText( section );
			railTooltip.style.left = Math.round( rect.right + 10 ) + 'px';
			railTooltip.style.top = Math.round( rect.top + ( rect.height / 2 ) ) + 'px';
			railTooltip.setAttribute( 'aria-hidden', 'false' );
			railTooltip.classList.add( 'is-visible' );
		}
		function hideRailTooltip() {
			railTooltip.classList.remove( 'is-visible' );
			railTooltip.setAttribute( 'aria-hidden', 'true' );
		}
		var railGroups = {
			decorate: { label: __( 'Decorate' ), node: null },
			more:     { label: __( 'Do more' ),  node: null },
			you:      { label: __( 'You' ),      node: null },
		};
		Object.keys( railGroups ).forEach( function ( key ) {
			var headingId = 'odd-shop-rail-' + key;
			var group = el( 'div', { class: 'odd-shop__rail-group', role: 'group', 'aria-labelledby': headingId } );
			var heading = el( 'div', { class: 'odd-shop__rail-group-heading', id: headingId } );
			heading.textContent = railGroups[ key ].label;
			group.appendChild( heading );
			railGroups[ key ].node = group;
			sidebar.appendChild( group );
		} );

		var content = el( 'section', {
			'data-odd-content': '1',
			'data-testid': 'odd-shop-content',
			class: 'odd-shop__content',
		} );

		var state = {
			active:        'wallpaper',
			cfg:           clone( window.odd || {} ),
			posting:       false,
			// Live global search query. Cleared on department switch
			// unless the caller passes `keepQuery: true` (e.g. the
			// search field re-rendering its result surface).
			query:         '',
			categoryFilter: '',
			searchScope:   'all',
			storeView:     'all',
			sortMode:      'featured',
			shopSounds:    loadShopSoundsSetting(),
			widgetHookNames: null,
			catalogUpdateCheck: { checked: false, pending: false, disposed: false },
			// When set, the Shop scheduled a full admin reload fallback.
			// Catalog tiles show "Applying..." for the matching slug.
			pendingAdminReload: null,
			installing: Object.create( null ),
		};
		var STORE_VIEWS = [
			{ id: 'all',       label: 'All' },
			{ id: 'installed', label: 'Installed' },
			{ id: 'available', label: 'Available' },
			{ id: 'updates',   label: 'Updates' },
			{ id: 'active',    label: 'Active' },
		];
		var STORE_SORTS = [
			{ id: 'featured', label: 'Featured' },
			{ id: 'newest',   label: 'Newest' },
			{ id: 'updated',  label: 'Recently updated' },
			{ id: 'az',       label: 'A-Z' },
		];
		state.cfg.shopV2 = state.cfg.shopV2 !== false;
		body.setAttribute( 'data-odd-shop-v2', state.cfg.shopV2 ? '1' : '0' );
		var shopRowCache = {};
		var buttons = {};
		var productSheetClose = null;
		cleanupFns.push( function () {
			if ( productSheetClose ) productSheetClose();
		} );
		var shopSfx = { ctx: null, last: {} };
		var pendingAdminReloadTimer = null;
		var migratedCoreAppSurfaces = {};
		var migratedCoreShopTaskbar = false;

		var ODD_RELOAD_DELAY_MS_DEFAULT = 400;
		var ODD_RELOAD_DELAY_MS_NATIVE_SURFACE = 360;

		function clearPendingAdminReload() {
			if ( pendingAdminReloadTimer ) {
				clearTimeout( pendingAdminReloadTimer );
				pendingAdminReloadTimer = null;
			}
			state.pendingAdminReload = null;
		}

		/**
		 * One deduped full-page reload gate. Call only after REST/save success.
		 */
		function scheduleAdminReload( opts ) {
			opts            = opts || {};
			var delayMs     = typeof opts.delayMs === 'number' ? opts.delayMs : ODD_RELOAD_DELAY_MS_DEFAULT;
			var slug        = opts.slug || '';
			var type        = opts.type || 'bundle';
			var name        = opts.name || slug || '';
			var toastMsg    = opts.toastMessage;
			clearPendingAdminReload();
			state.pendingAdminReload = { slug: slug || '*', type: type, at: Date.now() };
			try {
				rememberJustInstalled( { type: type, slug: slug, name: name } );
			} catch ( eReloadMeta ) {}
			if ( toastMsg ) {
				toast( toastMsg );
			}
			pendingAdminReloadTimer = setTimeout( function () {
				pendingAdminReloadTimer = null;
				state.pendingAdminReload = null;
				try {
					if ( document.visibilityState !== 'visible' ) {
						return;
					}
					window.location.reload();
				} catch ( eDoReload ) {}
			}, delayMs );
		}

		function refreshDesktopModeMenu( source ) {
			var desktop = window.wp && window.wp.desktop;
			if ( ! desktop || typeof desktop.refreshMenu !== 'function' ) {
				diagCount( 'desktop.refreshMenu.missing' );
				return Promise.resolve( false );
			}
			try {
				return Promise.resolve( desktop.refreshMenu() ).then(
					function () {
						diagCount( 'desktop.refreshMenu.ok' );
						return true;
					},
					function ( err ) {
						reportError( source || 'desktop.refreshMenu', err );
						return false;
					}
				);
			} catch ( errRefresh ) {
				reportError( source || 'desktop.refreshMenu', errRefresh );
				return Promise.resolve( false );
			}
		}

		function refreshDesktopModeRootPlacements( source ) {
			var desktop = window.wp && window.wp.desktop;
			var files   = desktop && desktop.files;
			var rest    = files && files.rest;
			var store   = files && files.store;
			source = source || 'desktop.files.rootPlacements';
			if (
				! rest ||
				typeof rest.listPlacements !== 'function' ||
				! store ||
				typeof store.setFolderPlacements !== 'function'
			) {
				diagCount( 'desktop.files.rootPlacements.missing' );
				return Promise.resolve( false );
			}
			try {
				return Promise.resolve( rest.listPlacements( 0 ) ).then(
					function ( res ) {
						if ( ! res || ! Array.isArray( res.placements ) ) {
							return false;
						}
						store.setFolderPlacements(
							Number( res.folderId ) || 0,
							res.placements
						);
						diagCount( 'desktop.files.rootPlacements.ok' );
						return true;
					},
					function ( err ) {
						reportError( source, err );
						return false;
					}
				);
			} catch ( errRoot ) {
				reportError( source, errRoot );
				return Promise.resolve( false );
			}
		}

		function refreshDesktopModeAppSurfaces( source ) {
			return refreshDesktopModeMenu( source ).then( function ( refreshed ) {
				if ( ! refreshed ) {
					return { refreshed: false, placements: false };
				}
				return refreshDesktopModeRootPlacements(
					( source || 'app.surfaces' ) + '.placements'
				).then( function ( placements ) {
					return { refreshed: true, placements: !! placements };
				} );
			} );
		}

		function refreshAppsNativeSurfaces( wrap, source, okMessage, opts ) {
			opts = opts || {};
			if ( opts.scheduleReload ) {
				setAppsStatus( wrap, __( 'Saved. Reloading Desktop Mode…' ), '' );
				scheduleAdminReload( {
					delayMs:      typeof opts.delayMs === 'number' ? opts.delayMs : ODD_RELOAD_DELAY_MS_NATIVE_SURFACE,
					slug:         opts.slug || '',
					type:         opts.type || 'app',
					name:         opts.name || opts.slug || '',
					toastMessage: opts.toastMessage || __( 'Reloading Desktop Mode to apply app surfaces…' ),
				} );
				return;
			}
			setAppsStatus( wrap, __( 'Updating Desktop Mode…' ), '' );
			refreshDesktopModeAppSurfaces( source ).then( function ( result ) {
				setAppsStatus(
					wrap,
					result.refreshed ? okMessage : __( 'Saved. Desktop Mode will update shortly.' ),
					result.refreshed ? 'ok' : ''
				);
			} );
		}

		function appSurfaceItemId( slug ) {
			return 'odd-app-' + String( slug || '' );
		}

		function normalizeAppSurfaces( surfaces ) {
			surfaces = surfaces && typeof surfaces === 'object' ? surfaces : {};
			return {
				desktop: Object.prototype.hasOwnProperty.call( surfaces, 'desktop' ) ? !! surfaces.desktop : true,
				taskbar: Object.prototype.hasOwnProperty.call( surfaces, 'taskbar' ) ? !! surfaces.taskbar : false,
			};
		}

		function appSurfacesToCorePlacement( surfaces ) {
			surfaces = normalizeAppSurfaces( surfaces );
			if ( surfaces.desktop && surfaces.taskbar ) return 'both';
			if ( surfaces.taskbar ) return 'dock';
			if ( surfaces.desktop ) return 'desktop';
			return 'hidden';
		}

		function corePlacementToAppSurfaces( placement, fallback ) {
			if ( placement === 'both' ) return { desktop: true, taskbar: true };
			if ( placement === 'dock' ) return { desktop: false, taskbar: true };
			if ( placement === 'desktop' ) return { desktop: true, taskbar: false };
			if ( placement === 'hidden' ) return { desktop: false, taskbar: false };
			return normalizeAppSurfaces( fallback );
		}

		function readCoreItemVisibility() {
			var desktop = window.wp && window.wp.desktop;
			if ( ! desktop || typeof desktop.getOsSettings !== 'function' ) {
				return null;
			}
			try {
				var snap = desktop.getOsSettings() || {};
				return ( snap.itemVisibility && typeof snap.itemVisibility === 'object' ) ? snap.itemVisibility : {};
			} catch ( err ) {
				reportError( 'desktop.itemVisibility.read', err );
				return null;
			}
		}

		function writeCoreItemVisibilityPlacement( itemId, placement, diagName ) {
			var desktop = window.wp && window.wp.desktop;
			diagName = diagName || 'desktop.itemVisibility';
			if (
				! itemId ||
				! desktop ||
				typeof desktop.getOsSettings !== 'function' ||
				typeof desktop.updateOsSettings !== 'function'
			) {
				return Promise.resolve( false );
			}
			try {
				var snap = desktop.getOsSettings() || {};
				var next = Object.assign( {}, snap.itemVisibility || {} );
				next[ itemId ] = placement;
				return Promise.resolve( desktop.updateOsSettings( { itemVisibility: next } ) ).then(
					function () {
						diagCount( diagName + '.ok' );
						return true;
					},
					function ( err ) {
						reportError( diagName, err );
						return false;
					}
				);
			} catch ( errWrite ) {
				reportError( diagName, errWrite );
				return Promise.resolve( false );
			}
		}

		function removeCoreItemVisibilityPlacement( itemId, diagName ) {
			var desktop = window.wp && window.wp.desktop;
			diagName = diagName || 'desktop.itemVisibility.remove';
			if (
				! itemId ||
				! desktop ||
				typeof desktop.getOsSettings !== 'function' ||
				typeof desktop.updateOsSettings !== 'function'
			) {
				return;
			}
			try {
				var snap = desktop.getOsSettings() || {};
				var next = Object.assign( {}, snap.itemVisibility || {} );
				delete next[ itemId ];
				desktop.updateOsSettings( { itemVisibility: next } );
			} catch ( errRemove ) {
				reportError( diagName, errRemove );
			}
		}

		function readAppSurfaceState( app ) {
			var fallback = normalizeAppSurfaces( app && app.surfaces );
			var visibility = readCoreItemVisibility();
			if ( visibility && app && app.slug ) {
				var id = appSurfaceItemId( app.slug );
				if ( Object.prototype.hasOwnProperty.call( visibility, id ) ) {
					return corePlacementToAppSurfaces( visibility[ id ], fallback );
				}
				if ( app.enabled !== false && ! migratedCoreAppSurfaces[ id ] ) {
					migratedCoreAppSurfaces[ id ] = true;
					writeCoreAppSurfaceState( app.slug, fallback );
				}
			}
			return fallback;
		}

		function writeCoreAppSurfaceState( slug, surfaces ) {
			if ( ! slug ) {
				return Promise.resolve( null );
			}
			var nextSurfaces = normalizeAppSurfaces( surfaces );
			return writeCoreItemVisibilityPlacement(
				appSurfaceItemId( slug ),
				appSurfacesToCorePlacement( nextSurfaces ),
				'desktop.itemVisibility.app'
			).then( function ( ok ) {
				return ok ? nextSurfaces : null;
			} );
		}

			function appSurfaceSummary( surfaces ) {
				surfaces = normalizeAppSurfaces( surfaces );
				if ( surfaces.desktop && surfaces.taskbar ) return __( 'Both' );
				if ( surfaces.taskbar ) return __( 'Taskbar' );
				if ( surfaces.desktop ) return __( 'Desktop' );
				return __( 'Hidden' );
			}

		function removeCoreAppSurfaceState( slug ) {
			removeCoreItemVisibilityPlacement( appSurfaceItemId( slug ), 'desktop.itemVisibility.app.remove' );
		}

		function shopTaskbarFromCorePlacement( placement, fallback ) {
			if ( placement === 'both' || placement === 'dock' ) return true;
			if ( placement === 'desktop' || placement === 'hidden' ) return false;
			return !! fallback;
		}

		function readShopTaskbarState() {
			var fallback = !! state.cfg.shopTaskbar;
			var visibility = readCoreItemVisibility();
			if ( visibility ) {
				if ( Object.prototype.hasOwnProperty.call( visibility, 'odd' ) ) {
					return shopTaskbarFromCorePlacement( visibility.odd, fallback );
				}
				if ( ! migratedCoreShopTaskbar ) {
					migratedCoreShopTaskbar = true;
					writeCoreShopTaskbarState( fallback );
				}
			}
			return fallback;
		}

		function writeCoreShopTaskbarState( enabled ) {
			return writeCoreItemVisibilityPlacement(
				'odd',
				enabled ? 'both' : 'desktop',
				'desktop.itemVisibility.shop'
			);
		}

		function captureShopScrollTops() {
			var snaps = [];
			function pushIfScrollable( el ) {
				if ( ! el || typeof el.scrollTop !== 'number' ) {
					return;
				}
				if ( el.scrollHeight > el.clientHeight + 2 ) {
					snaps.push( { el: el, top: el.scrollTop } );
				}
			}
			pushIfScrollable( content );
			pushIfScrollable( document.documentElement );
			if ( document.body ) {
				pushIfScrollable( document.body );
			}
			return snaps;
		}

		function restoreShopScrollTops( snaps ) {
			if ( ! snaps || ! snaps.length ) return;
			requestAnimationFrame( function () {
				snaps.forEach( function ( s ) {
					try {
						s.el.scrollTop = s.top;
					} catch ( e1 ) {}
				} );
				requestAnimationFrame( function () {
					snaps.forEach( function ( s ) {
						try {
							s.el.scrollTop = s.top;
						} catch ( e2 ) {}
					} );
				} );
			} );
		}

		function updateSearchToolState() {
			var active = String( state.categoryFilter || '' );
			allStylesChip.classList.toggle( 'is-active', ! active );
			allStylesChip.setAttribute( 'aria-pressed', active ? 'false' : 'true' );
			Object.keys( categoryChips ).forEach( function ( label ) {
				var chip = categoryChips[ label ];
				var isActive = active === label;
				chip.classList.toggle( 'is-active', isActive );
				chip.setAttribute( 'aria-pressed', isActive ? 'true' : 'false' );
			} );
		}

		function playShopSound( kind ) {
			try {
				if ( ! state.shopSounds ) return;
				var AudioCtor = window.AudioContext || window.webkitAudioContext;
				if ( ! AudioCtor ) return;
				var nowMs = Date.now();
				var minGap = kind === 'search' ? 85 : 45;
				if ( shopSfx.last[ kind ] && nowMs - shopSfx.last[ kind ] < minGap ) return;
				shopSfx.last[ kind ] = nowMs;

				var ctx = shopSfx.ctx || ( shopSfx.ctx = new AudioCtor() );
				if ( ctx.state === 'suspended' && typeof ctx.resume === 'function' ) {
					ctx.resume();
				}

				var t = ctx.currentTime;
				var master = ctx.createGain();
				master.gain.setValueAtTime( 0.0001, t );
				master.gain.exponentialRampToValueAtTime( soundVolume( kind ), t + 0.012 );
				master.gain.exponentialRampToValueAtTime( 0.0001, t + soundDuration( kind ) );
				master.connect( ctx.destination );

				soundNotes( kind ).forEach( function ( note ) {
					var osc = ctx.createOscillator();
					var gain = ctx.createGain();
					var start = t + ( note.delay || 0 );
					var end = start + ( note.length || 0.07 );
					osc.type = note.type || 'sine';
					osc.frequency.setValueAtTime( note.freq, start );
					if ( note.to ) osc.frequency.exponentialRampToValueAtTime( note.to, end );
					gain.gain.setValueAtTime( 0.0001, start );
					gain.gain.exponentialRampToValueAtTime( note.level || 0.75, start + 0.01 );
					gain.gain.exponentialRampToValueAtTime( 0.0001, end );
					osc.connect( gain );
					gain.connect( master );
					osc.start( start );
					osc.stop( end + 0.02 );
				} );
			} catch ( e ) {}
		}

		function loadShopSoundsSetting() {
			try {
				return window.localStorage.getItem( 'odd.shopSounds' ) !== '0';
			} catch ( e ) {
				return true;
			}
		}

		function saveShopSoundsSetting( enabled ) {
			state.shopSounds = !! enabled;
			try {
				window.localStorage.setItem( 'odd.shopSounds', enabled ? '1' : '0' );
			} catch ( e ) {}
		}

		function saveRecentSearch( value ) {
			value = String( value || '' ).trim();
			if ( ! value ) return;
			try {
				var key = 'odd.shop.recent-searches';
				var list = JSON.parse( window.localStorage.getItem( key ) || '[]' );
				if ( ! Array.isArray( list ) ) list = [];
				list = list.filter( function ( item ) { return String( item || '' ).toLowerCase() !== value.toLowerCase(); } );
				list.unshift( value );
				window.localStorage.setItem( key, JSON.stringify( list.slice( 0, 6 ) ) );
			} catch ( e ) {}
		}

		function installBrandGaze( root, mark ) {
			if ( ! root || ! mark || ! window.matchMedia || window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) {
				return;
			}
			var raf = 0;
			function onMove( ev ) {
				if ( raf ) return;
				raf = window.requestAnimationFrame( function () {
					raf = 0;
					var rect = mark.getBoundingClientRect();
					if ( ! rect.width || ! rect.height ) return;
					var dx = ( ev.clientX - ( rect.left + rect.width / 2 ) ) / rect.width;
					var dy = ( ev.clientY - ( rect.top + rect.height / 2 ) ) / rect.height;
					var rx = Math.max( -12, Math.min( 12, dy * -12 ) );
					var ry = Math.max( -12, Math.min( 12, dx * 12 ) );
					mark.style.transform = 'perspective(80px) rotateX(' + rx.toFixed( 2 ) + 'deg) rotateY(' + ry.toFixed( 2 ) + 'deg)';
				} );
			}
			function onLeave() {
				mark.style.transform = '';
			}
			root.addEventListener( 'pointermove', onMove, { passive: true } );
			root.addEventListener( 'pointerleave', onLeave );
			cleanupFns.push( function () {
				root.removeEventListener( 'pointermove', onMove );
				root.removeEventListener( 'pointerleave', onLeave );
				if ( raf ) window.cancelAnimationFrame( raf );
				mark.style.transform = '';
			} );
		}

		function installCardMotion( root ) {
			if ( ! root || ! window.matchMedia || window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ) return;
			var raf = 0;
			var active = null;
			function onMove( ev ) {
				var card = ev.target && ev.target.closest ? ev.target.closest( '.odd-shop__card' ) : null;
				if ( ! card || ! root.contains( card ) ) return;
				active = { card: card, x: ev.clientX, y: ev.clientY };
				if ( raf ) return;
				raf = window.requestAnimationFrame( function () {
					raf = 0;
					if ( ! active || ! active.card ) return;
					var rect = active.card.getBoundingClientRect();
					if ( ! rect.width || ! rect.height ) return;
					var dx = ( active.x - ( rect.left + rect.width / 2 ) ) / rect.width;
					var dy = ( active.y - ( rect.top + rect.height / 2 ) ) / rect.height;
					var rx = Math.max( -3, Math.min( 3, dy * -6 ) );
					var ry = Math.max( -3, Math.min( 3, dx * 6 ) );
					active.card.style.transform = 'perspective(700px) rotateX(' + rx.toFixed( 2 ) + 'deg) rotateY(' + ry.toFixed( 2 ) + 'deg) translateY(-2px)';
				} );
			}
			function onOut( ev ) {
				var card = ev.target && ev.target.closest ? ev.target.closest( '.odd-shop__card' ) : null;
				if ( card && ( ! ev.relatedTarget || ! card.contains( ev.relatedTarget ) ) ) {
					card.style.transform = '';
					active = null;
				}
			}
			root.addEventListener( 'pointermove', onMove, { passive: true } );
			root.addEventListener( 'pointerout', onOut );
			cleanupFns.push( function () {
				root.removeEventListener( 'pointermove', onMove );
				root.removeEventListener( 'pointerout', onOut );
				if ( raf ) window.cancelAnimationFrame( raf );
			} );
		}

		function installResponsiveState( root ) {
			if ( ! root ) return;

			function pickSize( width ) {
				if ( width < 520 ) return 'xs';
				if ( width < 720 ) return 's';
				if ( width < 960 ) return 'm';
				if ( width < 1280 ) return 'l';
				return 'xl';
			}

			// Pointer-mode detection — coarse means touchscreen-first
			// device (phone, tablet). Independent of native-window
			// width because the user's device class drives ergonomics
			// (tap targets, hover-only affordances, swipe hints) even
			// when the shell happens to give us a wide window.
			var coarseMq = window.matchMedia ? window.matchMedia( '(pointer: coarse)' ) : null;
			var hoverMq  = window.matchMedia ? window.matchMedia( '(hover: hover)' ) : null;

			function hostWindow() {
				var d = window.wp && window.wp.desktop;
				return d && d.windowManager && typeof d.windowManager.getById === 'function'
					? d.windowManager.getById( 'odd' )
					: null;
			}

			function hostWindowState() {
				var win = hostWindow();
				return win && typeof win.state === 'string' ? win.state : 'normal';
			}

			function hostFullscreenActive() {
				return !! ( document && document.body && document.body.classList && document.body.classList.contains( 'desktop-mode-has-fullscreen-window' ) );
			}

			function panelWindowId( payload ) {
				return String( payload && ( payload.windowId || payload.id || payload.baseId ) || '' );
			}

			function applyState() {
				var rect = root.getBoundingClientRect ? root.getBoundingClientRect() : null;
				var width = rect ? rect.width : 0;
				var size = pickSize( width );

				var vw = ( window.innerWidth || document.documentElement.clientWidth || 0 );
				var vSize = pickSize( vw );

				var coarse = !! ( coarseMq && coarseMq.matches );
				var canHover = !! ( hoverMq && hoverMq.matches );
				var pointer = coarse && ! canHover ? 'coarse' : 'fine';

				function isPhoneSize( value ) {
					return value === 'xs' || value === 's';
				}
				function isCompactSize( value ) {
					return value === 'm';
				}

				var layout = 'desktop';
				if ( isPhoneSize( vSize ) ) {
					layout = 'mobile';
				} else if ( isPhoneSize( size ) || isCompactSize( size ) || isCompactSize( vSize ) ) {
					layout = 'compact';
				}

				root.setAttribute( 'data-odd-size', size );
				root.setAttribute( 'data-odd-viewport', vSize );
				root.setAttribute( 'data-odd-layout', layout );
				root.setAttribute( 'data-odd-pointer', pointer );
				root.setAttribute( 'data-odd-host-state', hostWindowState() );
				root.setAttribute( 'data-odd-host-fullscreen', hostFullscreenActive() ? 'true' : 'false' );
			}

			applyState();
			if ( typeof ResizeObserver !== 'undefined' ) {
				var ro = new ResizeObserver( applyState );
				ro.observe( root );
				cleanupFns.push( function () { ro.disconnect(); } );
			}
			window.addEventListener( 'resize', applyState );
			window.addEventListener( 'orientationchange', applyState );
			cleanupFns.push( function () {
				window.removeEventListener( 'resize', applyState );
				window.removeEventListener( 'orientationchange', applyState );
			} );

			// matchMedia listeners fire when the user plugs/unplugs a
			// mouse on a Chrome OS device, rotates a tablet into a
			// docked mode, etc.
			function attachMq( mq ) {
				if ( ! mq || typeof mq.addEventListener !== 'function' ) return;
				mq.addEventListener( 'change', applyState );
				cleanupFns.push( function () { mq.removeEventListener( 'change', applyState ); } );
			}
			attachMq( coarseMq );
			attachMq( hoverMq );

			if ( window.wp && window.wp.hooks && typeof window.wp.hooks.addAction === 'function' ) {
				var ns = 'odd.panel-responsive-' + Math.random().toString( 36 ).slice( 2 );
				[
					[ 'WINDOW_BOUNDS_CHANGED', 'desktop-mode.window.bounds-changed' ],
					[ 'WINDOW_BODY_RESIZED', 'desktop-mode.window.body-resized' ],
					[ 'NATIVE_WINDOW_AFTER_RENDER', 'desktop-mode.native-window.after-render' ],
					[ 'WINDOW_MAXIMIZED', 'desktop-mode.window.maximized' ],
					[ 'WINDOW_UNMAXIMIZED', 'desktop-mode.window.unmaximized' ],
					[ 'WINDOW_FULLSCREEN_ENTERED', 'desktop-mode.window.fullscreen-entered' ],
					[ 'WINDOW_FULLSCREEN_EXITED', 'desktop-mode.window.fullscreen-exited' ],
				].forEach( function ( row ) {
					var hookName = desktopHookName( row[ 0 ], row[ 1 ] );
					var cb = function ( payload ) {
						if ( panelWindowId( payload ) === 'odd' ) applyState();
					};
					window.wp.hooks.addAction( hookName, ns, cb );
					cleanupFns.push( function () {
						window.wp.hooks.removeAction( hookName, ns );
					} );
				} );
			}
		}

		function closeOddNativeWindow() {
			var d = window.wp && window.wp.desktop;
			var win = d && d.windowManager && typeof d.windowManager.getById === 'function'
				? d.windowManager.getById( 'odd' )
				: null;
			if ( win && typeof win.close === 'function' ) win.close();
		}

		function soundVolume( kind ) {
			switch ( kind ) {
				case 'error':   return 0.020;
				case 'success': return 0.026;
				case 'install': return 0.020;
				default:        return 0.016;
			}
		}

		function soundDuration( kind ) {
			switch ( kind ) {
				case 'success': return 0.32;
				case 'error':   return 0.24;
				case 'install': return 0.22;
				default:        return 0.16;
			}
		}

		function soundNotes( kind ) {
			switch ( kind ) {
				case 'nav':     return [ { freq: 420, to: 560, length: 0.055, type: 'triangle' } ];
				case 'search':  return [ { freq: 760, to: 910, length: 0.035, type: 'sine', level: 0.45 } ];
				case 'install': return [ { freq: 260, to: 390, length: 0.12, type: 'triangle' }, { freq: 520, delay: 0.07, length: 0.09, type: 'sine', level: 0.45 } ];
				case 'success': return [ { freq: 523.25, length: 0.08, type: 'sine' }, { freq: 659.25, delay: 0.07, length: 0.08, type: 'sine' }, { freq: 880, delay: 0.14, length: 0.12, type: 'sine', level: 0.6 } ];
				case 'error':   return [ { freq: 220, to: 164.81, length: 0.13, type: 'triangle' }, { freq: 185, delay: 0.07, length: 0.11, type: 'triangle', level: 0.5 } ];
				default:        return [ { freq: 480, length: 0.055, type: 'sine' } ];
			}
		}

		function sectionById( id ) {
			for ( var i = 0; i < SECTIONS.length; i++ ) {
				if ( SECTIONS[ i ] && SECTIONS[ i ].id === id ) return SECTIONS[ i ];
			}
			return null;
		}

		function installedSummary( cfg ) {
			cfg = cfg || {};
			var installed = 0;
			var active = 0;
			[ 'scenes', 'iconSets', 'cursorSets', 'installedWidgets', 'apps' ].forEach( function ( key ) {
				var list = Array.isArray( cfg[ key ] ) ? cfg[ key ] : [];
				installed += list.length;
			} );
			if ( cfg.wallpaper || cfg.scene ) active++;
			if ( cfg.iconSet && cfg.iconSet !== 'none' ) active++;
			if ( cfg.cursorSet && cfg.cursorSet !== 'none' ) active++;
			return installed + ' ' + __( 'installed' ) + ' · ' + active + ' ' + __( 'active' );
		}

		SECTIONS.forEach( function ( section ) {
			// Skip gated sections (e.g. Apps) until their feature flag
			// comes in from the localized config.
			if ( section.gated && ! state.cfg[ section.gated ] ) {
				return;
			}
			var btn = el( 'button', {
				type: 'button',
				'data-section': section.id,
				'data-testid': 'odd-shop-nav-' + section.id,
				'aria-label': sectionTooltipText( section ),
				title: sectionTooltipText( section ),
			} );
			btn.className = 'odd-panel__nav odd-shop__rail-item';
			btn.style.setProperty( '--odd-shop-active-tint', section.tint || 'var(--odd-shop-accent)' );
			var glyph = el( 'span', { class: 'odd-shop__rail-glyph' } );
			if ( section.glyph ) {
				glyph.appendChild( shopGlyph( section.glyph, section.label ) );
			} else {
				glyph.textContent = section.icon || '•';
			}
			var labelWrap = el( 'span', { class: 'odd-shop__rail-label' } );
			var label = el( 'strong' );
			label.textContent = section.label;
			labelWrap.appendChild( label );
			if ( section.tagline ) {
				var tag = el( 'span' );
				tag.textContent = section.tagline;
				labelWrap.appendChild( tag );
			}
			btn.appendChild( glyph );
			btn.appendChild( labelWrap );
			btn.addEventListener( 'mouseenter', function () {
				showRailTooltip( btn, section, labelWrap );
			} );
			btn.addEventListener( 'mouseleave', hideRailTooltip );
			btn.addEventListener( 'focus', function () {
				showRailTooltip( btn, section, labelWrap );
			} );
			btn.addEventListener( 'blur', hideRailTooltip );
			btn.addEventListener( 'click', function () {
				hideRailTooltip();
				if ( state.active !== section.id ) playShopSound( 'nav' );
				renderSection( section.id );
			} );
			buttons[ section.id ] = btn;
			var group = railGroups[ section.group || 'decorate' ];
			( group && group.node ? group.node : sidebar ).appendChild( btn );
		} );

		// Footer caption in the rail — mimics the App Store's small
		// account/region line. Version bumps at runtime from cfg so
		// a new release surfaces immediately in the chrome.
		var railFoot = el( 'div', { class: 'odd-shop__rail-foot' } );
		railFoot.textContent = installedSummary( state.cfg );
		sidebar.appendChild( railFoot );

		body.appendChild( topbar );
		body.appendChild( sidebar );
		body.appendChild( content );
		if ( window.__odd && window.__odd.shopCast && typeof window.__odd.shopCast.run === 'function' ) {
			window.__odd.shopCast.run( body, {
				chaos: false,
				pluginUrl: state.cfg.pluginUrl || '',
			} );
		}

		installDropAnywhere( body );
		installShopKeyboard( body, sidebar, buttons, renderSection );
		installCardMotion( body );
		installResponsiveState( body );

		// Post-reload landing: if the previous navigation just
		// installed a bundle, switch to its department and flash
		// the new tile. Consumed once so a subsequent unrelated
		// reload doesn't replay it.
		var justInstalled = consumeJustInstalled();
		if ( justInstalled ) {
			state.justInstalled = justInstalled;
			var dept = DEPT_FOR_TYPE[ justInstalled.type ] || state.active;
			state.active = dept;
		}

		renderSection( state.active );
		maybeCheckCatalogUpdates();
		stopPanelTimer( {
			sections: SECTIONS.length,
			cards:    content.querySelectorAll ? content.querySelectorAll( '[data-odd-shop-card]' ).length : 0,
		} );

		return function teardown() {
			state.catalogUpdateCheck.disposed = true;
			clearPendingAdminReload();
			clearShopFlowToast();
			body.classList.remove( 'odd-panel', 'odd-shop' );
			cleanupSection();
			while ( cleanupFns.length ) {
				var clean = cleanupFns.pop();
				try { clean(); } catch ( e ) {}
			}
			// Pull the widget-layer subscriptions so a reopen doesn't
			// stack duplicate listeners that each re-render the
			// section on every widget add/remove.
			try {
				if ( window.wp && window.wp.hooks ) {
					( state.widgetHookNames || [
						desktopHookName( 'WIDGET_ADDED', 'desktop-mode.widget.added' ),
						desktopHookName( 'WIDGET_REMOVED', 'desktop-mode.widget.removed' ),
					] ).forEach( function ( hookName ) {
						if ( typeof window.wp.hooks.removeAction === 'function' ) {
							window.wp.hooks.removeAction( hookName, 'odd.widgets' );
						}
					} );
				}
			} catch ( e ) {}
		};

		/* --- routing --- */

		function renderSection( id, opts ) {
			var stopSectionTimer = diagTime( 'panel.renderSection', { section: id || '' } );
			opts = opts || {};
			var scrollSnap = opts.skipScrollPreserve ? null : captureShopScrollTops();

			// Department switch resets the search query so hopping
			// into Icons after filtering Wallpapers doesn't greet
			// the user with a stale "no results" state.
			if ( state.active !== id && ! opts.keepQuery ) {
				state.query = '';
				var input = document.querySelector( '[data-odd-search]' );
				if ( input && input.value ) input.value = '';
			}

			state.active = id;
			cleanupSection();
			for ( var k in buttons ) {
				if ( Object.prototype.hasOwnProperty.call( buttons, k ) ) {
					buttons[ k ].classList.toggle( 'is-active', k === id );
				}
			}
			var activeSection = sectionById( id );
			body.style.setProperty( '--odd-shop-active-tint', ( activeSection && activeSection.tint ) || 'var(--odd-shop-accent)' );
			content.innerHTML = '';
			if ( state.query && String( state.query ).trim() ) {
				content.appendChild( renderGlobalSearch() );
			} else if ( id === 'wallpaper' ) {
				content.appendChild( renderWallpaper() );
			} else if ( id === 'icons' ) {
				content.appendChild( renderIcons() );
			} else if ( id === 'cursors' ) {
				content.appendChild( renderCursors() );
			} else if ( id === 'widgets' ) {
				content.appendChild( renderWidgets() );
			} else if ( id === 'apps' ) {
				content.appendChild( renderApps() );
			} else if ( id === 'install' ) {
				content.appendChild( renderInstall() );
			} else if ( id === 'settings' ) {
				content.appendChild( renderSettings() );
			} else {
				content.appendChild( renderAbout() );
			}
			if ( scrollSnap ) {
				requestAnimationFrame( function () {
					requestAnimationFrame( function () {
						restoreShopScrollTops( scrollSnap );
					} );
				} );
			}

			// Flash-highlight the just-installed tile, if we owe
			// the user one from a bundle install that landed on
			// this department.
			highlightJustInstalled();
			stopSectionTimer( {
				cards: content.querySelectorAll ? content.querySelectorAll( '[data-odd-shop-card]' ).length : 0,
			} );
		}

		/* --- Apps section --- */

		function renderApps() {
			var wrap = el( 'div', { 'data-odd-apps': '1', class: 'odd-shop__dept odd-shop__dept--apps' } );
			wrap.appendChild( sectionHeader(
				'Apps',
				'Install pocket-sized tools that open in their own desktop windows. Pin them, park them, and launch them like tiny native portals.',
				{ eyebrow: 'ODD · Mini Apps' }
			) );
			appendCatalogNotice( wrap, 'app' );

			var appRows = shopRowsFor( 'app' );
			wrap.appendChild( renderStoreControls( 'app', appRows, applyStoreControls( appRows, 'app' ) ) );

			// Status rail. Populated by installBundle() / deletions.
			var status = el( 'div', { class: 'odd-apps-status', 'data-odd-apps-status': '1' } );
			wrap.appendChild( status );

			// Unified grid — one tile per slug, merged across
			// installed + catalog. `data-odd-apps-gallery` is kept so
			// existing selectors (e.g. bulk refresh via
			// `refreshAppsGallery`) still find the container.
			var gallery = el( 'div', { class: 'odd-grid odd-grid--apps odd-shop__grid odd-shop__grid--apps', 'data-odd-apps-gallery': '1' } );
			wrap.appendChild( gallery );
			// Prefer the server-baked catalog (hydrated into
			// window.odd.bundleCatalog) for first paint; then merge
			// the live /apps list on top so local-only installed apps
			// still appear even when the catalog is empty.
			renderAppsUnifiedGrid( gallery, wrap );

			return wrap;
		}

		function renderAppsUnifiedGrid( gallery, wrap ) {
			gallery.innerHTML = '';
			// Catalog first (from the server-baked snapshot, then the
			// live REST response) so first paint works offline and a
			// later refresh can still pick up changed catalog metadata.
			var embeddedCatalogRows = catalogRowsFor( 'app' );
			fetchCatalog().then( function ( catalogRows ) {
				fetchApps().then( function ( installedApps ) {
					var bySlug = {};
					( embeddedCatalogRows || [] ).forEach( function ( row ) {
						if ( ! row || ! row.slug ) return;
						bySlug[ row.slug ] = Object.assign( {}, row );
					} );
					( catalogRows || [] ).forEach( function ( row ) {
						if ( ! row || ! row.slug ) return;
						bySlug[ row.slug ] = Object.assign( {}, row );
					} );
					( installedApps || [] ).forEach( function ( app ) {
						if ( ! app || ! app.slug ) return;
						var cat = bySlug[ app.slug ] || {};
						bySlug[ app.slug ] = Object.assign( {}, cat, app, { installed: true } );
					} );
					( Array.isArray( state.cfg.apps ) ? state.cfg.apps : [] ).forEach( function ( app ) {
						if ( ! app || ! app.slug ) return;
						var cur = bySlug[ app.slug ] || {};
						bySlug[ app.slug ] = Object.assign( {}, cur, app, { installed: true } );
					} );

					var rows = [];
					for ( var k in bySlug ) {
						if ( Object.prototype.hasOwnProperty.call( bySlug, k ) ) rows.push( bySlug[ k ] );
					}
					rows = rows.map( function ( row ) {
						var normalised = normaliseShopRow( row, 'app' );
						if ( normalised ) {
							normalised.installed = !! row.installed;
							normalised.raw = row;
						}
						return normalised;
					} ).filter( Boolean );
					rows = applyStoreControls( rows, 'app' );

					if ( ! rows.length ) {
						var empty = el( 'div', { class: 'odd-apps-empty' } );
						empty.textContent = 'No apps have wandered in yet — refresh the catalog or feed ODD a .wp bundle.';
						gallery.appendChild( empty );
						return;
					}
					rows.forEach( function ( row ) {
						gallery.appendChild( renderCatalogCard( row, wrap ) );
					} );
				} );
			} );
		}

		function renderCatalogGallery( gallery, rows, wrap ) {
			gallery.innerHTML = '';
			gallery.classList.remove( 'odd-grid', 'odd-grid--apps' );
			gallery.classList.add( 'odd-catalog-list' );
			if ( ! rows || ! rows.length ) {
				var empty = el( 'div', { class: 'odd-apps-empty' } );
				empty.textContent = 'The catalog shelf is empty right now.';
				gallery.appendChild( empty );
				return;
			}
			rows.forEach( function ( row ) {
				gallery.appendChild( renderCatalogCard( row, wrap ) );
			} );
		}

		// Apps catalog card — one unified tile for every row, whether
		// it came from the remote catalog (uninstalled) or from the
		// local /apps registry (installed). Installed rows grow the
		// additional app-management controls (surfaces toggles, Open
		// / Enable / Delete) below the tile so the Apps department
		// keeps its full manageability without double-rendering
		// between an "Installed" gallery and a "Catalog" list.
		function renderAppSurfaceControls( app, wrap, extraClass ) {
			var rowSurfaces = readAppSurfaceState( app );
			var isEnabled = app.enabled !== false;
			var buttons = {};
			var pending = false;
			var surfacesRow = el( 'div', {
				class: 'odd-card__surfaces' + ( extraClass ? ' ' + extraClass : '' ),
				'aria-label': __( 'App launcher placement' ),
			} );
			if ( ! isEnabled ) {
				surfacesRow.setAttribute( 'aria-disabled', 'true' );
				surfacesRow.classList.add( 'is-disabled' );
			}

			var head = el( 'div', { class: 'odd-card__surfaces-head' } );
			var title = el( 'div', { class: 'odd-card__surfaces-title' } );
			title.textContent = __( 'Launcher' );
			var stateText = el( 'div', { class: 'odd-card__surfaces-state' } );
			head.appendChild( title );
			head.appendChild( stateText );
			surfacesRow.appendChild( head );

			var grid = el( 'div', { class: 'odd-card__surface-grid' } );

			function syncSwitches() {
				stateText.textContent = appSurfaceSummary( rowSurfaces );
				[ 'desktop', 'taskbar' ].forEach( function ( key ) {
					var btn = buttons[ key ];
					if ( ! btn ) return;
					var on = !! rowSurfaces[ key ];
					btn.classList.toggle( 'is-on', on );
					btn.setAttribute( 'aria-checked', on ? 'true' : 'false' );
					btn.disabled = pending || ! isEnabled;
				} );
			}

			function setPending( nextPending ) {
				pending = !! nextPending;
				surfacesRow.classList.toggle( 'is-saving', pending );
				syncSwitches();
			}

			function makeSurfaceSwitch( key, label, hint, glyph ) {
				var btn = el( 'button', {
					type: 'button',
					class: 'odd-card__surface-switch',
					role: 'switch',
					'data-surface-key': key,
					'aria-label': label + '. ' + hint,
				} );
				var icon = el( 'span', { class: 'odd-card__surface-icon', 'aria-hidden': 'true' } );
				icon.textContent = glyph;
				var copy = el( 'span', { class: 'odd-card__surface-copy' } );
				var name = el( 'strong' );
				name.textContent = label;
				var tail = el( 'span', { class: 'odd-card__surface-hint' } );
				tail.textContent = hint;
				copy.appendChild( name );
				copy.appendChild( tail );
				btn.appendChild( icon );
				btn.appendChild( copy );
				btn.addEventListener( 'click', function () {
					if ( ! isEnabled || pending ) return;
					var previous = Object.assign( {}, rowSurfaces );
					var payload = {};
					payload[ key ] = ! rowSurfaces[ key ];
					rowSurfaces = Object.assign( {}, rowSurfaces, payload );
					setPending( true );
					saveAppSurfaceState( app.slug, rowSurfaces, payload ).then( function ( res ) {
						setPending( false );
						if ( res && res.surfaces ) {
							rowSurfaces = normalizeAppSurfaces( res.surfaces );
							mirrorAppSurfacesInCfg( app.slug, rowSurfaces );
							syncSwitches();
							if ( res.native ) {
								setAppsStatus( wrap, __( 'App placement updated.' ), 'ok' );
							} else {
								refreshAppsNativeSurfaces(
									wrap,
									'app.surfaces',
									__( 'App placement updated.' ),
									{
										scheduleReload: true,
										slug: app.slug,
										type: 'app',
										name: app.name || app.slug,
									}
								);
							}
							return;
						}
						rowSurfaces = previous;
						syncSwitches();
						setAppsStatus(
							wrap,
							__( 'Could not update app placement.' ),
							'error'
						);
					} );
				} );
				buttons[ key ] = btn;
				return btn;
			}

			grid.appendChild(
				makeSurfaceSwitch(
					'desktop',
					__( 'Desktop' ),
					__( 'Adds a shortcut to the wallpaper.' ),
					'⌂'
				)
			);
			grid.appendChild(
				makeSurfaceSwitch(
					'taskbar',
					__( 'Taskbar' ),
					__( 'Keeps a launcher in the dock.' ),
					'⌞'
				)
			);
			surfacesRow.appendChild( grid );
			syncSwitches();
			return surfacesRow;
		}

		function renderCatalogCard( row, wrap ) {
			var normalised = normaliseShopRow( row, 'app' );
			if ( ! normalised ) return el( 'div' );
			normalised.installed = !! row.installed;
			var cardWrap = renderShopCard( normalised );
			if ( ! cardWrap ) return el( 'div' );

				// Stable selectors used by tests and the app-management controls.
			cardWrap.classList.add( 'odd-card--app' );
			cardWrap.setAttribute( 'data-app-slug', row.slug );

			if ( row.installed ) {
				cardWrap.appendChild( renderAppCardManagement( row, wrap ) );
			}

			return cardWrap;
		}

		function renderAppCardManagement( app, wrap ) {
			var manage = el( 'div', { class: 'odd-shop__card-manage' } );

			manage.appendChild( renderAppSurfaceControls( app, wrap, 'odd-shop__card-surfaces' ) );

			var actions = el( 'div', { class: 'odd-shop__card-manage-actions' } );
			var toggle = el( 'button', { type: 'button', class: 'odd-apps-btn' } );
			toggle.textContent = app.enabled ? 'Disable' : 'Enable';
			toggle.addEventListener( 'click', function () {
				toggle.disabled = true;
				toggleApp( app.slug, ! app.enabled ).then( function ( ok ) {
					toggle.disabled = false;
					if ( ok ) {
						refreshAppsGallery( wrap );
						refreshAppsNativeSurfaces(
							wrap,
							'app.toggle',
							__( 'App surfaces updated.' )
						);
					}
				} );
			} );
			var del = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--danger' } );
			del.textContent = 'Delete';
			del.addEventListener( 'click', function () {
				if ( ! window.confirm( 'Uninstall "' + ( app.name || app.slug ) + '"?' ) ) return;
				deleteApp( app.slug ).then( function ( ok ) {
					if ( ok ) {
						var ev = window.__odd && window.__odd.events;
						if ( ev ) ev.emit( 'odd.app-uninstalled', { slug: app.slug } );
						removeCoreAppSurfaceState( app.slug );
						refreshAppsGallery( wrap );
						refreshAppsNativeSurfaces(
							wrap,
							'app.delete',
							__( 'App removed from Desktop Mode.' )
						);
					}
				} );
			} );
			actions.appendChild( toggle );
			actions.appendChild( del );
			manage.appendChild( actions );
			return manage;
		}

		function fetchCatalog() {
			var stopFetchTimer = diagTime( 'catalog.fetch.apps' );
			var url = ( state.cfg.bundleCatalogUrl || '' ) ||
				( ( state.cfg.restUrl || '' ).replace( /\/prefs\/?$/, '' ) + '/bundles/catalog' );
			return fetch( url, {
				credentials: 'same-origin',
				headers: { 'X-WP-Nonce': state.cfg.restNonce || '' },
			} ).then( function ( r ) { return r.ok ? r.json() : { apps: [] }; } )
			  .then( function ( d ) {
				var rows = [];
				if ( d && Array.isArray( d.apps ) ) rows = d.apps;
				else if ( d && Array.isArray( d.items ) ) rows = d.items.filter( function ( item ) { return item && item.type === 'app'; } );
				else if ( d && d.items && Array.isArray( d.items.apps ) ) rows = d.items.apps;
				else if ( d && Array.isArray( d.bundles ) ) rows = d.bundles.filter( function ( item ) { return item && item.type === 'app'; } );
				stopFetchTimer( { rows: rows.length } );
				diagCount( 'catalog.fetch.apps.ok' );
				return rows;
			} )
			  .catch( function ( err ) {
				reportError( 'bundles.catalog.apps', err );
				stopFetchTimer( { status: 'error' } );
				diagCount( 'catalog.fetch.apps.error' );
				return [];
			} );
		}
		function installFromCatalog( slug, opts ) {
			var stopInstallTimer = diagTime( 'catalog.install', { slug: slug || '' } );
			opts = opts || {};
			var body = { slug: slug };
			if ( opts.allowUpdate ) body.allow_update = 1;
			var url = ( state.cfg.bundleInstallUrl || '' ) ||
				( ( state.cfg.restUrl || '' ).replace( /\/prefs\/?$/, '' ) + '/bundles/install-from-catalog' );
			return fetch( url, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce':   state.cfg.restNonce || '',
				},
				body: JSON.stringify( body ),
			} ).then( function ( r ) {
				return r.json().then( function ( data ) {
					stopInstallTimer( { status: r.status, ok: !! r.ok } );
					diagCount( r.ok ? 'catalog.install.ok' : 'catalog.install.error' );
					return { ok: r.ok, status: r.status, data: data };
				} ).catch( function () {
					stopInstallTimer( { status: r.status, ok: false } );
					diagCount( 'catalog.install.error' );
					return { ok: false, status: r.status, message: 'HTTP ' + r.status };
				} );
			} ).catch( function ( err ) {
				reportError( 'bundles.install-from-catalog.app', err );
				stopInstallTimer( { status: 'network-error', ok: false } );
				diagCount( 'catalog.install.error' );
				return { ok: false, message: ( err && err.message ) || 'Network error while installing.' };
			} );
		}

		function catalogInstallErrorCode( res ) {
			var data = ( res && res.data ) || {};
			return data.code || ( data.data && data.data.code ) || '';
		}

		function catalogDownloadUrl( row ) {
			var raw = row && row.raw && typeof row.raw === 'object' ? row.raw : {};
			var url = ( row && ( row.downloadUrl || row.download_url ) ) || raw.download_url || raw.downloadUrl || '';
			return typeof url === 'string' ? url : '';
		}

		function catalogExpectedSha( row ) {
			var raw = row && row.raw && typeof row.raw === 'object' ? row.raw : {};
			var sha = ( row && row.sha256 ) || raw.sha256 || '';
			sha = typeof sha === 'string' ? sha.toLowerCase() : '';
			return /^[a-f0-9]{64}$/.test( sha ) ? sha : '';
		}

		function catalogExpectedSize( row ) {
			var raw = row && row.raw && typeof row.raw === 'object' ? row.raw : {};
			var size = Number( ( row && row.size ) || raw.size || 0 );
			return Number.isFinite( size ) && size > 0 ? size : 0;
		}

		function catalogBundleFilename( row, url ) {
			var path = '';
			try { path = new URL( url, window.location.href ).pathname || ''; } catch ( e ) {}
			var fromUrl = path ? path.split( '/' ).pop() : '';
			if ( fromUrl && /\.wp$/i.test( fromUrl ) ) return fromUrl;
			return ( ( row && row.slug ) || 'catalog-bundle' ) + '.wp';
		}

		function browserCatalogError( code, message, status ) {
			return {
				ok: false,
				status: status || 0,
				data: {
					code: code,
					message: message,
					data: { status: status || 0 },
				},
			};
		}

		function catalogIntegrityError( res ) {
			var code = catalogInstallErrorCode( res );
			return code === 'size_mismatch' ||
				code === 'sha256_mismatch' ||
				code === 'browser_size_mismatch' ||
				code === 'browser_sha256_mismatch';
		}

		function catalogBundleType( row ) {
			var raw = row && row.raw && typeof row.raw === 'object' ? row.raw : {};
			var type = ( row && row.type ) || raw.type || '';
			return typeof type === 'string' ? type : '';
		}

		function currentCatalogRowForInstall( row ) {
			var slug = row && row.slug;
			if ( ! slug ) return null;
			var type = catalogBundleType( row );
			var candidates = [];
			if ( type ) {
				candidates = catalogRowsFor( type );
			} else {
				[ 'scene', 'icon-set', 'cursor-set', 'widget', 'app' ].forEach( function ( key ) {
					candidates = candidates.concat( catalogRowsFor( key ) );
				} );
			}
			for ( var i = 0; i < candidates.length; i++ ) {
				if ( candidates[ i ] && candidates[ i ].slug === slug ) {
					return candidates[ i ].raw || candidates[ i ];
				}
			}
			return null;
		}

		function shouldBrowserInstallCatalogBundle( row, res, opts ) {
			opts = opts || {};
			if ( ! row || ! row.slug || ! catalogDownloadUrl( row ) ) return false;
			var code = catalogInstallErrorCode( res );
			var dataStatus = res && res.data && res.data.data && res.data.data.status;
			var status = ( res && res.status ) || dataStatus || 0;
			var retryable = {
				download_failed: true,
				not_a_zip:       true,
				size_mismatch:   true,
				sha256_mismatch: true,
			};
			return Number( status ) === 502 || !! retryable[ code ];
		}

		function sha256HexForBlob( blob ) {
			if (
				! window.crypto ||
				! window.crypto.subtle ||
				typeof window.crypto.subtle.digest !== 'function' ||
				! blob ||
				typeof blob.arrayBuffer !== 'function'
			) {
				return Promise.reject( browserCatalogError( 'browser_sha_unavailable', 'Could not verify the catalog bundle in this browser.' ) );
			}
			return blob.arrayBuffer().then( function ( buffer ) {
				return window.crypto.subtle.digest( 'SHA-256', buffer );
			} ).then( function ( digest ) {
				var bytes = new Uint8Array( digest );
				var out = '';
				for ( var i = 0; i < bytes.length; i++ ) {
					out += bytes[ i ].toString( 16 ).padStart( 2, '0' );
				}
				return out;
			} );
		}

		function verifyCatalogBundleBlob( row, blob ) {
			var expectedSha = catalogExpectedSha( row );
			var expectedSize = catalogExpectedSize( row );
			if ( expectedSha ) {
				return sha256HexForBlob( blob ).then( function ( actualSha ) {
					if ( actualSha !== expectedSha ) {
						return Promise.reject( browserCatalogError(
							'browser_sha256_mismatch',
							'Catalog bundle sha256 mismatch. Try refreshing the catalog and installing again.',
							502
						) );
					}
				} );
			}
			if ( expectedSize && blob && typeof blob.size === 'number' && blob.size !== expectedSize ) {
				return Promise.reject( browserCatalogError(
					'browser_size_mismatch',
					'Catalog bundle size mismatch. Try refreshing the catalog and installing again.',
					502
				) );
			}
			return Promise.resolve();
		}

		function fetchCatalogBundleInBrowser( row ) {
			var url = catalogDownloadUrl( row );
			var parsed;
			try {
				parsed = new URL( url, window.location.href );
			} catch ( e ) {
				return Promise.reject( browserCatalogError( 'invalid_download_url', 'Catalog entry has an invalid download URL.' ) );
			}
			if ( parsed.protocol !== 'https:' && parsed.origin !== window.location.origin ) {
				return Promise.reject( browserCatalogError( 'insecure_download', 'Catalog downloads must use HTTPS.' ) );
			}
			return fetch( parsed.href, {
				credentials: parsed.origin === window.location.origin ? 'same-origin' : 'omit',
			} ).then( function ( r ) {
				if ( ! r.ok ) {
					return Promise.reject( browserCatalogError( 'browser_download_failed', 'Could not download bundle in the browser. HTTP ' + r.status + '.', r.status ) );
				}
				if ( typeof r.blob !== 'function' ) {
					return Promise.reject( browserCatalogError( 'browser_download_failed', 'Browser download did not return a bundle file.' ) );
				}
				return r.blob().then( function ( blob ) {
					return verifyCatalogBundleBlob( row, blob ).then( function () {
						return {
							blob: blob,
							url:  parsed.href,
						};
					} );
				} );
			} );
		}

		function installCatalogBundleViaBrowser( row, opts ) {
			opts = opts || {};
			diagCount( 'catalog.install.browserFallback' );
			toast( 'Server download hiccuped. Retrying from your browser...' );
			return fetchCatalogBundleInBrowser( row ).then( function ( bundle ) {
				return uploadBundleBlob( bundle.blob, catalogBundleFilename( row, bundle.url ), { allowUpdate: !! opts.allowUpdate } );
			} ).then( function ( res ) {
				if ( res && res.ok && res.data && res.data.installed ) {
					return res.data;
				}
				throw res;
			} );
		}

		function retryCatalogInstallAfterRefresh( row, opts ) {
			diagCount( 'catalog.install.refreshRetry' );
			toast( 'Catalog changed. Refreshing the shelf and trying again...' );
			return refreshCatalog( null, null, { silent: true } ).then( function () {
				var freshRow = currentCatalogRowForInstall( row ) || row;
				return installCatalogRowData( freshRow, Object.assign( {}, opts, { catalogRefreshed: true } ) );
			} );
		}

		function installCatalogRowData( row, opts ) {
			row = row || {};
			opts = opts || {};
			return installFromCatalog( row.slug, opts ).then( function ( res ) {
				if ( res && res.ok && res.data && res.data.installed ) {
					return res.data;
				}
				if ( catalogIntegrityError( res ) && ! opts.catalogRefreshed ) {
					return retryCatalogInstallAfterRefresh( row, opts );
				}
				if ( shouldBrowserInstallCatalogBundle( row, res, opts ) ) {
					return installCatalogBundleViaBrowser( row, opts ).catch( function ( err ) {
						if ( catalogIntegrityError( err ) && ! opts.catalogRefreshed ) {
							return retryCatalogInstallAfterRefresh( row, opts );
						}
						throw err;
					} );
				}
				throw res;
			} );
		}

		function renderAppsGallery( gallery, apps, wrap ) {
			gallery.innerHTML = '';
			if ( ! apps || ! apps.length ) {
				var empty = el( 'div', { class: 'odd-apps-empty' } );
				empty.textContent = 'No apps live here yet — grab one from the catalog, or upload a .wp bundle and give it a room.';
				gallery.appendChild( empty );
				return;
			}
			apps.forEach( function ( app ) {
				gallery.appendChild( renderAppCard( app, wrap ) );
			} );
		}

		function renderAppCard( app, wrap ) {
			var card = el( 'div', { class: 'odd-card odd-card--app', 'data-app-slug': app.slug } );
			if ( ! app.enabled ) card.classList.add( 'is-disabled' );

			var thumb = el( 'div', { class: 'odd-card__thumb' } );
			if ( app.icon ) {
				// The /apps/icon/{slug} route is public (no X-WP-Nonce)
				// so <img> can fetch it; /apps/serve/... would 401
				// because img tags can't send custom headers.
				var src = ( app.icon.indexOf( 'data:' ) === 0 || app.icon.indexOf( 'http' ) === 0 )
					? app.icon
					: ( ( state.cfg.restUrl || '' ).replace( /\/prefs\/?$/, '' ) + '/apps/icon/' + app.slug );
				var img = el( 'img', { src: src, alt: app.name, loading: 'lazy' } );
				thumb.appendChild( img );
			} else {
				thumb.textContent = ( app.name || app.slug ).slice( 0, 2 ).toUpperCase();
				thumb.classList.add( 'odd-card__thumb--badge' );
			}
			card.appendChild( thumb );

			var meta = el( 'div', { class: 'odd-card__meta' } );
			var title = el( 'div', { class: 'odd-card__title' } );
			title.textContent = app.name || app.slug;
			var sub = el( 'div', { class: 'odd-card__sub' } );
			sub.textContent = ( app.version ? 'v' + app.version : '' ) + ( app.description ? ( app.version ? ' — ' : '' ) + app.description : '' );
			meta.appendChild( title );
			meta.appendChild( sub );
			card.appendChild( meta );

			card.appendChild( renderAppSurfaceControls( app, wrap, '' ) );

			var actions = el( 'div', { class: 'odd-card__actions' } );

			var open = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--primary' } );
			open.textContent = 'Open';
			open.addEventListener( 'click', function () { openAppWindow( app.slug ); } );

			var toggle = el( 'button', { type: 'button', class: 'odd-apps-btn' } );
			toggle.textContent = app.enabled ? 'Disable' : 'Enable';
			toggle.addEventListener( 'click', function () {
				toggle.disabled = true;
				toggleApp( app.slug, ! app.enabled ).then( function ( ok ) {
					toggle.disabled = false;
					if ( ok ) {
						refreshAppsGallery( wrap );
						refreshAppsNativeSurfaces(
							wrap,
							'app.toggle',
							__( 'App surfaces updated.' )
						);
					}
				} );
			} );

			var del = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--danger' } );
			del.textContent = 'Delete';
			del.addEventListener( 'click', function () {
				if ( ! window.confirm( 'Uninstall "' + ( app.name || app.slug ) + '"?' ) ) return;
				deleteApp( app.slug ).then( function ( ok ) {
					if ( ok ) {
						var ev = window.__odd && window.__odd.events;
						if ( ev ) ev.emit( 'odd.app-uninstalled', { slug: app.slug } );
						removeCoreAppSurfaceState( app.slug );
						refreshAppsGallery( wrap );
						refreshAppsNativeSurfaces(
							wrap,
							'app.delete',
							__( 'App removed from Desktop Mode.' )
						);
					}
				} );
			} );

			actions.appendChild( open );
			actions.appendChild( toggle );
			actions.appendChild( del );
			card.appendChild( actions );

			return card;
		}

		function refreshAppsGallery( wrap ) {
			var gallery = wrap.querySelector( '[data-odd-apps-gallery]' );
			if ( ! gallery ) return;
			renderAppsUnifiedGrid( gallery, wrap );
		}

		function setAppsStatus( wrap, msg, kind ) {
			var rail = wrap.querySelector( '[data-odd-apps-status]' );
			if ( ! rail ) return;
			rail.textContent = msg || '';
			rail.className = 'odd-apps-status' + ( kind ? ' is-' + kind : '' );
			if ( kind === 'ok' ) playShopSound( 'success' );
			if ( kind === 'error' ) playShopSound( 'error' );
		}

		function installFile( file, wrap ) {
			if ( ! file ) return;
			setAppsStatus( wrap, 'Installing ' + file.name + '…', 'busy' );
			uploadApp( file ).then( function ( data ) {
				if ( data && data.installed && data.manifest ) {
					setAppsStatus( wrap, 'Installed ' + ( data.manifest.name || data.manifest.label || data.manifest.slug ) + '.', 'ok' );
					handleInstallSuccess( data );
				} else {
					var msg = ( data && data.message ) || ( data && data.code ) || 'Install failed.';
					setAppsStatus( wrap, msg, 'error' );
				}
			} );
		}

		// ----------------------------------------------------------
		// Universal bundle install.
		//
		// Accepts a .wp of any type, routes through the universal
		// /odd/v1/bundles/upload endpoint, surfaces progress + errors
		// through both the topbar pill and window.__odd.api.toast,
		// and on success auto-switches to the landing department +
		// flash-highlights the new tile for the user.
		//
		// DEPT_FOR_TYPE is hoisted up top so inner helpers
		// (status messaging, routing, etc.) resolve it even
		// when renderSection runs before this block is evaluated.
		// ----------------------------------------------------------

		function bundlesUploadUrl() {
			var cfg = state.cfg || {};
			if ( cfg.bundlesUploadUrl ) return cfg.bundlesUploadUrl;
			var base = cfg.restUrl || '';
			return base.replace( /\/prefs\/?$/, '/bundles/upload' );
		}

		function toast( msg ) {
			try {
				if ( window.__odd && window.__odd.api && typeof window.__odd.api.toast === 'function' ) {
					window.__odd.api.toast( msg );
					return;
				}
			} catch ( e ) {}
			// Fallback — the plain WP Desktop notice channel.
			try {
				if ( window.wp && window.wp.desktop && typeof window.wp.desktop.showToast === 'function' ) {
					window.wp.desktop.showToast( { message: msg, source: 'odd' } );
				}
			} catch ( e2 ) {}
		}

		function clearShopFlowToast() {
			if ( flowToastTimer ) {
				clearTimeout( flowToastTimer );
				flowToastTimer = 0;
			}
			if ( flowToastNode && flowToastNode.parentNode ) {
				flowToastNode.parentNode.removeChild( flowToastNode );
			}
			flowToastNode = null;
		}

		function showShopFlowToast( message, opts ) {
			opts = opts || {};
			clearShopFlowToast();
			var node = el( 'div', {
				class: 'odd-shop__flow-toast',
				role: 'status',
				'aria-live': 'polite',
			} );
			var text = el( 'span', { class: 'odd-shop__flow-toast-text' } );
			text.textContent = message || '';
			node.appendChild( text );
			if ( opts.actionLabel && typeof opts.onAction === 'function' ) {
				var action = el( 'button', {
					type: 'button',
					class: 'odd-shop__flow-toast-action',
					'data-odd-cursor': 'pointer',
				} );
				action.textContent = opts.actionLabel;
				action.addEventListener( 'click', function () {
					clearShopFlowToast();
					opts.onAction();
				} );
				node.appendChild( action );
			}
			body.appendChild( node );
			flowToastNode = node;
			flowToastTimer = setTimeout( clearShopFlowToast, opts.duration || 5200 );
		}

		function shopInstallKey( row ) {
			if ( ! row || ! row.slug ) return '';
			return ( row.type || 'bundle' ) + ':' + row.slug;
		}

		function isShopInstalling( row ) {
			var key = shopInstallKey( row );
			return !! ( key && state.installing && state.installing[ key ] );
		}

		function shopInstallMode( row ) {
			var key = shopInstallKey( row );
			var flow = key && state.installing ? state.installing[ key ] : null;
			if ( flow && typeof flow === 'object' && flow.mode ) return flow.mode;
			return flow ? 'install' : '';
		}

		function setShopInstalling( row, installing, mode ) {
			var key = shopInstallKey( row );
			if ( ! key ) return;
			if ( installing ) state.installing[ key ] = { mode: mode || 'install', at: Date.now() };
			else delete state.installing[ key ];
		}

		function clearInstallFlow( type, slug ) {
			if ( ! type || ! slug ) return;
			delete state.installing[ type + ':' + slug ];
		}

		function itemDisplayName( row, fallback ) {
			return ( row && ( row.name || row.label || row.slug ) ) || fallback || 'item';
		}

		function actionProgressCopy( mode ) {
			if ( mode === 'update' ) return { label: __( 'Working…' ), status: __( 'Working' ), verb: __( 'Updating' ) };
			if ( mode === 'repair' ) return { label: __( 'Working…' ), status: __( 'Working' ), verb: __( 'Repairing' ) };
			return { label: __( 'Working…' ), status: __( 'Working' ), verb: __( 'Installing' ) };
		}

		function installTypeLabel( type ) {
			if ( type === 'scene' ) return __( 'scene' );
			if ( type === 'icon-set' ) return __( 'icon set' );
			if ( type === 'cursor-set' ) return __( 'cursor set' );
			if ( type === 'widget' ) return __( 'widget' );
			if ( type === 'app' ) return __( 'app' );
			return __( 'bundle' );
		}

		function installSuccessMessage( type, name, scheduleReload ) {
			var label = name || __( 'item' );
			if ( scheduleReload ) {
				return __( 'Installed ' ) + installTypeLabel( type ) + ' "' + label + __( '". Reloading to finish setup…' );
			}
			if ( type === 'app' ) {
				return __( 'Installed app "' ) + label + __( '". Ready to open.' );
			}
			return __( 'Installed ' ) + installTypeLabel( type ) + ' "' + label + __( '". Ready.' );
		}

		function errorCopy( code, fallback ) {
			switch ( code ) {
				case 'invalid_extension':    return __( 'That file isn\u2019t a .wp bundle.' );
				case 'invalid_zip':          return __( 'That file isn\u2019t a valid ZIP archive.' );
				case 'zip_unavailable':     return __( 'This site is missing the PHP ZipArchive extension \u2014 ask the host to enable it.' );
				case 'too_many_files':      return __( 'Bundle has too many files. The limit is 2000.' );
				case 'too_large':           return __( 'Bundle is too large. Keep it under 25 MB uncompressed.' );
				case 'zip_bomb':            return __( 'Bundle contains a suspicious compression ratio and was rejected.' );
				case 'path_traversal':      return __( 'Bundle contains a path-traversal entry and was rejected.' );
				case 'symlink_in_archive': return __( 'Bundle contains a symlink and was rejected.' );
				case 'forbidden_file_type': return __( 'Bundle contains a server-executable file and was rejected.' );
				case 'missing_manifest':    return __( 'Bundle is missing a manifest.json at the root.' );
				case 'invalid_manifest':    return __( 'Bundle\u2019s manifest.json is not valid JSON.' );
				case 'missing_manifest_field': return __( 'Bundle\u2019s manifest.json is missing a required field.' );
				case 'invalid_slug':        return __( 'Bundle slug must be lowercase letters, numbers, and hyphens.' );
				case 'slug_exists':         return __( 'A bundle with that slug is already installed. Remove the existing one first.' );
				case 'unsupported_type':   return __( 'This ODD version doesn\u2019t know how to install that bundle type.' );
				case 'install_in_progress': return __( 'Another install of this bundle is already in progress.' );
				case 'missing_entry':       return __( 'Bundle is missing the entry file declared in manifest.json.' );
				case 'invalid_entry':       return __( 'Bundle\u2019s entry path is invalid.' );
				case 'missing_preview':     return __( 'Bundle is missing preview.webp.' );
				case 'missing_wallpaper':   return __( 'Bundle is missing wallpaper.webp.' );
				case 'missing_icon':        return __( 'Bundle is missing one of the image files it declared.' );
				case 'invalid_icon_ext':    return __( 'Icon set images must be PNG or WebP files.' );
				case 'invalid_icon_image':  return __( 'One of the icon set images is malformed or the wrong size.' );
				case 'icon_too_large':      return __( 'One of the icon set images is too large.' );
				case 'empty_icon':          return __( 'One of the icon set images is empty.' );
				case 'missing_required_icons': return fallback ? __( fallback ) : __( 'Icon set is missing required keys.' );
				case 'invalid_svg':         return __( 'An SVG in this bundle isn\u2019t well-formed.' );
				case 'rest_too_many_requests': return __( 'Too many requests. Please wait a minute and try again.' );
				case 'extract_mkdir_failed':
				case 'extract_rename_failed':
					return __( 'ODD couldn\u2019t finalise the install. Check wp-content permissions and try again.' );
				default: return fallback ? __( fallback ) : __( 'Install failed.' );
			}
		}

		function jsConfirmAlreadyGiven() {
			var store = window.__odd && window.__odd.store;
			try {
				if ( store && typeof store.get === 'function' && store.get( 'bundles.jsConfirmed' ) ) {
					return true;
				}
			} catch ( e ) {}
			return false;
		}

		function jsConfirmRemember() {
			var store = window.__odd && window.__odd.store;
			try {
				if ( store && typeof store.set === 'function' ) {
					store.set( 'bundles.jsConfirmed', true );
				}
			} catch ( e ) {}
		}

		// Non-modal inline confirmation banner injected at the top
		// of the Shop body. Resolves the supplied callback with true
		// (Install) or false (Cancel). The banner auto-dismisses when
		// clicked outside (treated as Cancel) so there's no trapped
		// state if the user walks away. One-time per session via
		// jsConfirmRemember().
		function confirmJavaScriptInline( type, done ) {
			if ( 'scene' !== type && 'widget' !== type ) { done( true ); return; }
			if ( jsConfirmAlreadyGiven() ) { done( true ); return; }

			var root = document.querySelector( '.odd-shop' ) || document.body;
			// Avoid stacking multiple banners if the user clicks fast.
			var existing = root.querySelector( '.odd-shop__js-confirm' );
			if ( existing ) existing.parentNode.removeChild( existing );

			var banner = el( 'div', { class: 'odd-shop__js-confirm', role: 'alertdialog', 'aria-live': 'polite' } );
			banner.appendChild( el( 'strong', {}, [ 'Run JavaScript from this package?' ] ) );
			banner.appendChild( el( 'p', {}, [
				'This ',
				type,
				' bundle ships JavaScript that will run in your admin session. Install only from trusted sources.',
			] ) );

			var actions = el( 'div', { class: 'odd-shop__js-confirm-actions' } );
			var cancel  = el( 'button', { type: 'button', class: 'odd-shop__js-confirm-btn' }, [ 'Cancel' ] );
			var install = el( 'button', { type: 'button', class: 'odd-shop__js-confirm-btn is-primary' }, [ 'Install' ] );

			var settled = false;
			function finish( ok ) {
				if ( settled ) return;
				settled = true;
				if ( ok ) jsConfirmRemember();
				try { banner.parentNode.removeChild( banner ); } catch ( e ) {}
				done( ok );
			}
			cancel.addEventListener( 'click', function () { finish( false ); } );
			install.addEventListener( 'click', function () { finish( true ); } );
			actions.appendChild( cancel );
			actions.appendChild( install );
			banner.appendChild( actions );

			root.insertBefore( banner, root.firstChild );
			// Focus the affirmative action so keyboard users can
			// confirm with Return immediately.
			setTimeout( function () { try { install.focus(); } catch ( e ) {} }, 10 );
		}

		function setInstallPillState( installing, progressText ) {
			var pill = document.querySelector( '[data-odd-install-pill]' );
			if ( ! pill ) return;
			if ( installing ) {
				pill.classList.add( 'is-busy' );
				pill.setAttribute( 'aria-busy', 'true' );
				if ( progressText ) pill.setAttribute( 'title', progressText );
			} else {
				pill.classList.remove( 'is-busy' );
				pill.removeAttribute( 'aria-busy' );
				pill.removeAttribute( 'title' );
			}
		}

		function handleInstallSuccess( data ) {
			var type  = ( data && data.type ) || ( data && data.manifest && data.manifest.type ) || 'app';
			var slug  = ( data && data.slug ) || ( data && data.manifest && data.manifest.slug ) || '';
			var name  = ( data && data.manifest && ( data.manifest.name || data.manifest.label ) ) || slug;

			// Mark the catalog row as installed so any still-rendered
			// Discover strip flips the tile from "Install" to the
			// installed affordance. Otherwise the server-pre-baked
			// catalog on `window.odd.bundleCatalog` would still
			// advertise the slug as uninstalled and a second click
			// on the same tile would 409 with already_installed.
			markCatalogRowInstalled( type, slug );
			emitInstalledEvent( data, type, slug );

			if ( 'widget' === type ) {
				return onInstallSuccessWidget( data, slug, name );
			}
			if ( 'scene' === type ) {
				return onInstallSuccessScene( data, slug, name );
			}
			return onInstallSuccessInPanel( data, type, slug, name );
		}

		function emitInstalledEvent( data, type, slug ) {
			var ev = window.__odd && window.__odd.events;
			if ( ! ev ) return;
			try { ev.emit( 'odd.bundle-installed', { slug: slug, type: type, manifest: data && data.manifest } ); } catch ( e ) {}
			// Keep the app-specific event as a convenience alias for
			// consumers that only care about app installs.
			if ( 'app' === type ) {
				try { ev.emit( 'odd.app-installed', { slug: slug, manifest: data && data.manifest } ); } catch ( e2 ) {}
			}
		}

		// Manual fallback for rows that explicitly ask for a full reload.
		function onEscapeHatchReload( row ) {
			if ( ! row || ! row.slug ) return;
			scheduleAdminReload( {
				delayMs:      ODD_RELOAD_DELAY_MS_DEFAULT,
				slug:         row.slug,
				type:         row.type || 'bundle',
				name:         row.name || row.slug,
				toastMessage: __( 'Refreshing admin…' ),
			} );
			playShopSound( 'success' );
		}

		function onInstallSuccessScene( data, slug, name ) {
			var entryUrl = data && data.entry_url;
			if ( ! entryUrl ) {
				return onInstallSuccessInPanel(
					data,
					'scene',
					slug,
					name,
					installSuccessMessage( 'scene', name, true ),
					{ scheduleReload: true, delayMs: ODD_RELOAD_DELAY_MS_DEFAULT }
				);
			}
			loadBundleScript( 'scene', slug, entryUrl ).then( function () {
				onInstallSuccessInPanel(
					data,
					'scene',
					slug,
					name,
					installSuccessMessage( 'scene', name, false )
				);
			} ).catch( function () {
				onInstallSuccessInPanel(
					data,
					'scene',
					slug,
					name,
					installSuccessMessage( 'scene', name, true ),
					{ scheduleReload: true, delayMs: ODD_RELOAD_DELAY_MS_DEFAULT }
				);
			} );
		}

		function onInstallSuccessInPanel( data, type, slug, name, message, reloadOpts ) {
			reloadOpts       = reloadOpts || {};
			var scheduleReload = !! reloadOpts.scheduleReload;
			var reloadDelayMs = typeof reloadOpts.delayMs === 'number' ? reloadOpts.delayMs : ODD_RELOAD_DELAY_MS_DEFAULT;
			var row          = data && data.row;
			var appSurfaces  = null;
			var appSurfaceWrite = null;
			clearInstallFlow( type, slug );
			if ( 'app' === type ) {
				appSurfaces = ( row && row.surfaces ) || ( data && data.manifest && data.manifest.surfaces ) || null;
				row = Object.assign(
					{},
					row || {},
					{
						slug: slug,
						name: ( row && row.name ) || name || slug,
						installed: true,
						requiresReload: false,
					}
				);
				message = message || installSuccessMessage( 'app', name, false );
			}
			spliceInstalledRow( type, slug, row, data && data.manifest );
			if ( 'app' === type ) {
				appSurfaceWrite = writeCoreAppSurfaceState( slug, appSurfaces || { desktop: true, taskbar: false } );
			}
			if ( 'app' === type && data && data.serve_url ) {
				syncWindowOddAfterAppInstall( slug, data.serve_url );
			}
			state.justInstalled = { type: type, slug: slug, name: name, at: Date.now() };
			playShopSound( 'success' );
			if ( scheduleReload ) {
				scheduleAdminReload( {
					delayMs:       reloadDelayMs,
					slug:          slug,
					type:          type,
					name:          name || slug,
					toastMessage:  message ||
						installSuccessMessage( type, name, true ),
				} );
			} else {
				showShopFlowToast(
					message || installSuccessMessage( type, name, false ),
					{ duration: 4200 }
				);
				if ( 'app' === type ) {
					Promise.resolve( appSurfaceWrite ).then( function () {
						refreshDesktopModeAppSurfaces( 'app.install' );
					} );
				}
			}
			renderSection( DEPT_FOR_TYPE[ type ] || state.active, { keepQuery: true } );
		}

		// Widget install flow: no reload needed. Dynamically inject
		// the widget's CSS + entry script, register the mount callback
		// exposed on `window.desktopModeWidgets[id]`, splice a panel-shaped row
		// into `state.cfg.installedWidgets`, re-render the Widgets
		// department, and flash the new tile. If the script fails to
		// load, we keep a deferred admin reload as an explicit fallback.
		function onInstallSuccessWidget( data, slug, name ) {
			var entryUrl = data && data.entry_url;
			var row      = data && data.row;
			function fallback() {
				var fallbackRow = row
					? Object.assign( {}, row )
					: { id: 'odd/' + slug, slug: slug, label: name, installed: true };
				onInstallSuccessInPanel(
					Object.assign( {}, data || {}, { row: fallbackRow } ),
					'widget',
					slug,
					name,
					installSuccessMessage( 'widget', name, true ),
					{ scheduleReload: true, delayMs: ODD_RELOAD_DELAY_MS_DEFAULT }
				);
			}
			if ( ! entryUrl ) { fallback(); return; }

			loadBundleStyles( 'widget', slug, data && data.style_urls );
			loadBundleScript( 'widget', slug, entryUrl ).then( function () {
				clearInstallFlow( 'widget', slug );
				if ( ! registerHotLoadedWidget( data, slug, name ) ) {
					fallback();
					return;
				}
				spliceInstalledRow( 'widget', slug, row || { id: 'odd/' + slug, slug: slug, label: name, installed: true }, data && data.manifest );
				state.justInstalled = { type: 'widget', slug: slug, name: name, at: Date.now() };
				playShopSound( 'success' );
				showShopFlowToast( installSuccessMessage( 'widget', name, false ), { duration: 4200 } );
				renderSection( 'widgets', { keepQuery: true } );
			} ).catch( function () {
				fallback();
			} );
		}

		function registerHotLoadedWidget( data, slug, name ) {
			var manifest = data && data.manifest || {};
			var row      = data && data.row || {};
			var id       = row.id || manifest.id || ( 'odd/' + slug );
			var mounts   = window.desktopModeWidgets || {};
			var mount    = mounts[ id ];
			if ( typeof mount !== 'function' ) {
				return false;
			}
			var desk = window.wp && window.wp.desktop;
			if ( ! desk || typeof desk.registerWidget !== 'function' ) {
				return true;
			}
			try {
				desk.registerWidget( {
					id:            id,
					label:         manifest.label || row.label || name || slug,
					description:   manifest.description || row.description || '',
					icon:          manifest.icon || 'dashicons-screenoptions',
					movable:       manifest.movable !== false,
					resizable:     manifest.resizable !== false,
					minWidth:      manifest.minWidth || undefined,
					minHeight:     manifest.minHeight || undefined,
					maxWidth:      manifest.maxWidth || undefined,
					maxHeight:     manifest.maxHeight || undefined,
					defaultWidth:  manifest.defaultWidth || undefined,
					defaultHeight: manifest.defaultHeight || undefined,
					mount:         mount,
				} );
			} catch ( e ) {
				return false;
			}
			return true;
		}

		/**
		 * Flip the `installed` flag on the matching catalog row so the
		 * next render of the Discover shelf for that type shows
		 * "Installed" instead of "Install". Tolerant of the catalog
		 * shape being partially populated — no-op if we can't find
		 * the slice.
		 */
		function markCatalogRowInstalled( type, slug ) {
			if ( ! slug ) return;
			var cfg = state.cfg;
			if ( ! cfg || ! cfg.bundleCatalog ) return;
			var key = ( type === 'icon-set' ) ? 'iconSet' : ( type === 'cursor-set' ? 'cursorSet' : type );
			var rows = cfg.bundleCatalog[ key ];
			if ( ! Array.isArray( rows ) ) return;
			for ( var i = 0; i < rows.length; i++ ) {
				if ( rows[ i ] && rows[ i ].slug === slug ) {
					rows[ i ].installed = true;
					return;
				}
			}
		}

		/**
		 * After catalog/upload install, `window.odd` was frozen at first paint
		 * but `registerWpdmCallbacks()` only reads `userApps.installed` +
		 * `appServeUrls` from `window.odd`. Mirror server state and re-run
		 * registration so `openWindow('odd-app-*')` can hydrate the iframe
		 * without a full reload.
		 */
		function syncWindowOddAfterAppInstall( slug, serveUrl ) {
			if ( ! slug ) return;
			if ( window.odd ) {
				window.odd.appServeUrls = window.odd.appServeUrls || {};
				window.odd.appServeUrls[ slug ] = serveUrl;
				window.odd.userApps = window.odd.userApps || { installed: [], pinned: [] };
				if ( state.cfg.userApps && Array.isArray( state.cfg.userApps.installed ) ) {
					window.odd.userApps.installed = state.cfg.userApps.installed.slice();
				}
				if ( state.cfg.userApps && Array.isArray( state.cfg.userApps.pinned ) ) {
					window.odd.userApps.pinned = state.cfg.userApps.pinned.slice();
				}
				if ( Array.isArray( state.cfg.apps ) ) {
					window.odd.apps = state.cfg.apps.map( function ( r ) {
						return r && typeof r === 'object' ? Object.assign( {}, r ) : r;
					} );
				}
			}
			var reg = window.__odd && window.__odd.apps && window.__odd.apps.registerWpdmCallbacks;
			if ( typeof reg === 'function' ) {
				try { reg(); } catch ( e ) {}
			}
		}

		function syncWindowOddCursorState( slug, stylesheet ) {
			var cleanSlug = ( typeof slug === 'string' && slug !== 'none' ) ? slug : '';
			var href = typeof stylesheet === 'string' ? stylesheet : '';
			var rows = Array.isArray( state.cfg.cursorSets )
				? state.cfg.cursorSets.map( function ( row ) {
					return row && typeof row === 'object' ? Object.assign( {}, row ) : row;
				} )
				: [];
			[ window.odd, window.oddout ].forEach( function ( target ) {
				if ( ! target || typeof target !== 'object' ) return;
				target.cursorSet = cleanSlug;
				target.cursorStylesheet = href;
				target.cursorSets = rows.slice();
			} );
		}

		function spliceInstalledRow( type, slug, row, manifest ) {
			if ( ! slug ) return;
			row = row && typeof row === 'object' ? Object.assign( {}, row ) : {};
			row.slug = row.slug || slug;
			row.installed = true;

			if ( 'scene' === type ) {
				row.label = row.label || ( manifest && ( manifest.label || manifest.name ) ) || slug;
				var scenes = Array.isArray( state.cfg.scenes ) ? state.cfg.scenes.slice() : [];
				scenes = scenes.filter( function ( s ) { return s && s.slug !== slug; } );
				scenes.push( row );
				state.cfg.scenes = scenes;
				state.cfg.sceneMap = state.cfg.sceneMap || {};
				state.cfg.sceneMap[ slug ] = row;
				if ( window.odd && window.odd.sceneMap ) window.odd.sceneMap[ slug ] = row;
				return;
			}

			if ( 'icon-set' === type ) {
				row.label = row.label || ( manifest && ( manifest.label || manifest.name ) ) || slug;
				var sets = Array.isArray( state.cfg.iconSets ) ? state.cfg.iconSets.slice() : [];
				sets = sets.filter( function ( s ) { return s && s.slug !== slug; } );
				sets.push( row );
				state.cfg.iconSets = sets;
				return;
			}

			if ( 'cursor-set' === type ) {
				row.label = row.label || ( manifest && ( manifest.label || manifest.name ) ) || slug;
				var cursorSets = Array.isArray( state.cfg.cursorSets ) ? state.cfg.cursorSets.slice() : [];
				cursorSets = cursorSets.filter( function ( s ) { return s && s.slug !== slug; } );
				cursorSets.push( row );
				state.cfg.cursorSets = cursorSets;
				syncWindowOddCursorState( state.cfg.cursorSet, state.cfg.cursorStylesheet );
				return;
			}

			if ( 'widget' === type ) {
				row.id = row.id || ( 'odd/' + slug );
				row.label = row.label || ( manifest && ( manifest.label || manifest.name ) ) || slug;
				var widgets = Array.isArray( state.cfg.installedWidgets ) ? state.cfg.installedWidgets.slice() : [];
				widgets = widgets.filter( function ( w ) { return w && w.slug !== slug; } );
				widgets.push( row );
				state.cfg.installedWidgets = widgets;
				return;
			}

			if ( 'app' === type ) {
				row.name = row.name || ( manifest && ( manifest.name || manifest.label ) ) || slug;
				row.enabled = row.enabled !== false;
				var apps = Array.isArray( state.cfg.apps ) ? state.cfg.apps.slice() : [];
				apps = apps.filter( function ( a ) { return a && a.slug !== slug; } );
				apps.push( row );
				state.cfg.apps = apps;
				state.cfg.userApps = state.cfg.userApps || { installed: [], pinned: [] };
				state.cfg.userApps.installed = Array.isArray( state.cfg.userApps.installed ) ? state.cfg.userApps.installed.slice() : [];
				if ( state.cfg.userApps.installed.indexOf( slug ) === -1 ) state.cfg.userApps.installed.push( slug );
			}
		}

		function highlightJustInstalled() {
			if ( ! state.justInstalled ) return;
			var slug = state.justInstalled.slug;
			if ( ! slug ) { state.justInstalled = null; return; }
			setTimeout( function () {
				if ( typeof window === 'undefined' || typeof document === 'undefined' ) return;
				var selectors = [
					'[data-odd-shop-card][data-slug="' + slug + '"]',
					'[data-slug="' + slug + '"]',
					'[data-scene-slug="' + slug + '"]',
					'[data-set-slug="' + slug + '"]',
					'[data-cursor-set-slug="' + slug + '"]',
					'[data-widget-id="odd/' + slug + '"]',
					'[data-catalog-slug="' + slug + '"]',
				];
				var tile = null;
				for ( var i = 0; i < selectors.length && ! tile; i++ ) {
					tile = document.querySelector( '.odd-shop ' + selectors[ i ] );
				}
				if ( tile ) {
					tile.classList.add( 'is-just-installed' );
					var motionReduce =
						typeof window.matchMedia === 'function' &&
						window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
					var scrollBehavior = motionReduce ? 'instant' : 'smooth';
					var inset = 12;
					function tileIntersectsMainScroller() {
						var tb = tile.getBoundingClientRect();
						var roots = [ content, document.documentElement ];
						for ( var ri = 0; ri < roots.length; ri++ ) {
							var rootEl = roots[ ri ];
							if ( ! rootEl ) continue;
							var scrollH = rootEl.scrollHeight || 0;
							var clientH = rootEl.clientHeight || 0;
							if ( scrollH <= clientH + 2 ) continue;
							var rb = rootEl.getBoundingClientRect();
							var visibleTop = rb.top + inset;
							var visibleBottom = rb.bottom - inset;
							if ( tb.bottom > visibleTop && tb.top < visibleBottom ) return true;
						}
						var vbH = window.innerHeight || 0;
						if ( vbH > inset * 2 ) {
							var vTop = inset;
							var vBottom = vbH - inset;
							if ( tb.bottom > vTop && tb.top < vBottom ) return true;
						}
						return false;
					}
					if ( ! tileIntersectsMainScroller() ) {
						try {
							tile.scrollIntoView(
								scrollBehavior === 'instant'
									? { block: 'nearest', inline: 'nearest' }
									: { behavior: 'smooth', block: 'nearest', inline: 'nearest' }
							);
						} catch ( eScroll ) {
							try {
								tile.scrollIntoView( motionReduce ? false : true );
							} catch ( e2 ) {}
						}
					}
					setTimeout( function () { tile.classList.remove( 'is-just-installed' ); }, 4000 );
				}
				state.justInstalled = null;
			}, 80 );
		}

		function uploadBundleBlob( blob, filename, opts ) {
			opts = opts || {};
			var fd = new FormData();
			fd.append( 'file', blob, filename || ( blob && blob.name ) || 'bundle.wp' );
			if ( opts.allowUpdate ) fd.append( 'allow_update', '1' );
			return fetch( bundlesUploadUrl(), {
				method:      'POST',
				credentials: 'same-origin',
				headers:     { 'X-WP-Nonce': ( state.cfg || {} ).restNonce || '' },
				body:        fd,
			} ).then( function ( r ) {
				return r.json().then( function ( data ) {
					return { ok: r.ok, status: r.status, data: data };
				}, function () {
					return { ok: r.ok, status: r.status, data: null };
				} );
			} ).catch( function () {
				return { ok: false, status: 0, data: null };
			} );
		}

		function uploadBundle( file ) {
			return uploadBundleBlob( file, file && file.name );
		}

		function isWorkspaceFile( file ) {
			return !! ( file && /\.odd$/i.test( file.name || '' ) );
		}

		function isBundleFile( file ) {
			return !! ( file && /\.wp$/i.test( file.name || '' ) );
		}

		function handleLocalInstallFile( file, statusNode ) {
			if ( ! file ) return;
			if ( isWorkspaceFile( file ) ) {
				importWorkspaceFile( file, statusNode );
				return;
			}
			if ( isBundleFile( file ) ) {
				installBundle( file );
				return;
			}
			playShopSound( 'error' );
			toast( 'Choose a .wp bundle or .odd workspace file.' );
			setWorkspaceStatus( statusNode, 'Choose a .wp bundle or .odd workspace file.', true );
		}

		function installBundle( file ) {
			if ( ! file ) return;
			if ( state.posting ) return;

			// Early type sniff from the filename: we don't know the
			// manifest.type until the server parses the archive, so
			// the JS confirmation is conservative — ask whenever the
			// file might be a scene/widget. Authors name type
			// manifests in a consistent way (…-scene.wp / …-widget.wp)
			// via the documented naming convention; the safe default
			// is to ask. The server still does the real type routing.
			var lower       = ( file.name || '' ).toLowerCase();
			var mightExecJs = /scene|widget/.test( lower );

			function proceed() {
				state.posting = true;
				setInstallPillState( true, 'Installing ' + file.name + '…' );
				playShopSound( 'install' );
				toast( 'Installing ' + file.name + '…' );

				uploadBundle( file ).then( function ( res ) {
					state.posting = false;
					setInstallPillState( false );

					if ( res.ok && res.data && res.data.installed ) {
						// Second-chance JS confirm for when the
						// filename didn't tip us off but the
						// manifest did. The install has already
						// happened; this just arms the store for
						// any follow-up JS install in the session.
						if ( ( 'scene' === res.data.type || 'widget' === res.data.type ) && ! mightExecJs ) {
							jsConfirmRemember();
						}
						handleInstallSuccess( res.data );
						return;
					}
					onInstallFailure( res );
				} );
			}

			if ( mightExecJs ) {
				confirmJavaScriptInline( 'scene', function ( ok ) {
					if ( ! ok ) { playShopSound( 'error' ); toast( 'Install cancelled.' ); return; }
					proceed();
				} );
				return;
			}
			proceed();
		}

		function onInstallFailure( res ) {
			var data    = ( res && res.data ) || {};
			var code    = data.code || ( data.data && data.data.code ) || 'install_failed';
			if ( typeof data.message === 'string' && ! data.code && data.status ) {
				code = 'install_failed';
			}
			var message = errorCopy( code, data.message || ( res && res.message ) );
			playShopSound( 'error' );
			toast( message );

			// Leave a breadcrumb on the Apps status rail when the
			// user is on that department, so the message doesn't
			// disappear with the toast.
			var statusWrap = document.querySelector( '[data-odd-apps-status]' );
			if ( statusWrap ) {
				statusWrap.textContent = message;
				statusWrap.setAttribute( 'data-odd-status', 'error' );
			}

			showInstallTroubleshoot( res, message, code, data );
		}

		function workspaceApi() {
			return window.__odd && window.__odd.workspace;
		}

		function setWorkspaceStatus( node, message, isError ) {
			if ( ! node ) return;
			node.textContent = message || '';
			if ( message ) {
				node.setAttribute( 'data-odd-workspace-status', isError ? 'error' : 'ok' );
			} else {
				node.removeAttribute( 'data-odd-workspace-status' );
			}
		}

		function exportWorkspaceFile( statusNode ) {
			var workspace = workspaceApi();
			if ( ! workspace || typeof workspace.exportData !== 'function' || typeof workspace.download !== 'function' ) {
				playShopSound( 'error' );
				toast( 'Workspace export is not available.' );
				setWorkspaceStatus( statusNode, 'Workspace export is not available.', true );
				return;
			}
			try {
				workspace.download( workspace.exportData( { name: 'ODD Workspace' } ) );
				playShopSound( 'success' );
				toast( 'Exported your .odd workspace.' );
				setWorkspaceStatus( statusNode, 'Exported your .odd workspace.', false );
			} catch ( err ) {
				reportError( 'workspace.export', err );
				playShopSound( 'error' );
				toast( ( err && err.message ) || 'Workspace export failed.' );
				setWorkspaceStatus( statusNode, ( err && err.message ) || 'Workspace export failed.', true );
			}
		}

		function importWorkspaceFile( file, statusNode ) {
			if ( state.workspaceImporting ) return;
			var workspace = workspaceApi();
			if ( ! workspace || typeof workspace.readFile !== 'function' ) {
				playShopSound( 'error' );
				toast( 'Workspace import is not available.' );
				setWorkspaceStatus( statusNode, 'Workspace import is not available.', true );
				return;
			}
			state.workspaceImporting = true;
			setInstallPillState( true, 'Importing ' + ( file && file.name ? file.name : '.odd workspace' ) + '...' );
			setWorkspaceStatus( statusNode, 'Reading workspace...', false );
			workspace.readFile( file ).then( function ( payload ) {
				return applyWorkspacePayload( payload, statusNode );
			} ).then( function () {
				state.workspaceImporting = false;
				setInstallPillState( false );
			} ).catch( function ( err ) {
				state.workspaceImporting = false;
				setInstallPillState( false );
				reportError( 'workspace.import', err );
				playShopSound( 'error' );
				var message = ( err && err.message ) || 'Workspace import failed.';
				toast( message );
				setWorkspaceStatus( statusNode, message, true );
			} );
		}

		function workspaceTypeLabel( type ) {
			if ( type === 'scene' ) return 'wallpaper';
			if ( type === 'icon-set' ) return 'icon set';
			if ( type === 'cursor-set' ) return 'cursor set';
			return type || 'item';
		}

		function isWorkspaceContentInstalled( type, slug ) {
			var rows = [];
			if ( type === 'scene' ) rows = state.cfg.scenes || [];
			else if ( type === 'icon-set' ) rows = state.cfg.iconSets || state.cfg.sets || [];
			else if ( type === 'cursor-set' ) rows = state.cfg.cursorSets || [];
			else if ( type === 'widget' ) rows = state.cfg.installedWidgets || [];
			else if ( type === 'app' ) rows = state.cfg.apps || [];
			if ( ! Array.isArray( rows ) ) return false;
			for ( var i = 0; i < rows.length; i++ ) {
				if ( rows[ i ] && ( rows[ i ].slug === slug || rows[ i ].id === slug || rows[ i ].id === ( 'odd/' + slug ) ) ) {
					return true;
				}
			}
			return false;
		}

		function hasCatalogWorkspaceContent( type, slug ) {
			return !! catalogWorkspaceRow( type, slug );
		}

		function catalogWorkspaceRow( type, slug ) {
			var rows = catalogRowsFor( type );
			for ( var i = 0; i < rows.length; i++ ) {
				if ( rows[ i ] && rows[ i ].slug === slug ) return rows[ i ];
			}
			return null;
		}

		function saveWorkspacePrefs( patch ) {
			return new Promise( function ( resolve ) {
				if ( ! patch || ! Object.keys( patch ).length ) {
					resolve( null );
					return;
				}
				savePrefs( patch, function ( data ) {
					resolve( data || null );
				} );
			} );
		}

		function syncWorkspacePrefsIntoPanel( patch, data ) {
			var source = data && typeof data === 'object' ? data : patch;
			var prevWallpaper = state.cfg.wallpaper || state.cfg.scene || '';
			var prevIconSet = state.cfg.iconSet || '';
			if ( Object.prototype.hasOwnProperty.call( source, 'wallpaper' ) ) {
				state.cfg.wallpaper = source.wallpaper || '';
				state.cfg.scene = state.cfg.wallpaper;
			}
			if ( Object.prototype.hasOwnProperty.call( source, 'iconSet' ) ) {
				state.cfg.iconSet = source.iconSet || '';
			}
			if ( Object.prototype.hasOwnProperty.call( source, 'cursorSet' ) ) {
				state.cfg.cursorSet = source.cursorSet || '';
			}
			if ( Object.prototype.hasOwnProperty.call( source, 'cursorStylesheet' ) ) {
				state.cfg.cursorStylesheet = source.cursorStylesheet || '';
			}
			[ 'favorites', 'recents', 'shuffle', 'screensaver', 'audioReactive', 'shopTaskbar' ].forEach( function ( key ) {
				if ( Object.prototype.hasOwnProperty.call( source, key ) ) state.cfg[ key ] = source[ key ];
			} );
			if ( Object.prototype.hasOwnProperty.call( source, 'appsPinned' ) ) {
				state.cfg.userApps = state.cfg.userApps || { installed: [], pinned: [] };
				state.cfg.userApps.pinned = Array.isArray( source.appsPinned ) ? source.appsPinned.slice() : [];
			}
			if ( window.odd && typeof window.odd === 'object' ) {
				[ 'wallpaper', 'scene', 'iconSet', 'cursorSet', 'cursorStylesheet', 'shuffle', 'screensaver', 'audioReactive', 'shopTaskbar' ].forEach( function ( key ) {
					if ( Object.prototype.hasOwnProperty.call( state.cfg, key ) ) window.odd[ key ] = state.cfg[ key ];
				} );
				if ( state.cfg.userApps ) window.odd.userApps = clone( state.cfg.userApps );
			}
			if ( state.cfg.wallpaper && state.cfg.wallpaper !== prevWallpaper ) {
				try {
					if ( window.wp && window.wp.hooks && typeof window.wp.hooks.doAction === 'function' ) {
						window.wp.hooks.doAction( 'odd.pickScene', state.cfg.wallpaper );
					}
				} catch ( e ) {}
			}
			if ( Object.prototype.hasOwnProperty.call( source, 'cursorSet' ) ) {
				syncWindowOddCursorState( state.cfg.cursorSet, state.cfg.cursorStylesheet );
				try {
					if ( window.__odd && window.__odd.cursors && typeof window.__odd.cursors.apply === 'function' ) {
						window.__odd.cursors.apply( state.cfg.cursorStylesheet, state.cfg.cursorSet );
					}
				} catch ( e2 ) {}
			}
			if ( state.cfg.iconSet !== prevIconSet ) {
				refreshDesktopModeMenu( 'workspace.iconSet' );
			}
		}

		function enableWorkspaceWidgets( payload ) {
			var workspace = workspaceApi();
			if ( ! workspace || typeof workspace.widgetIds !== 'function' ) return 0;
			var ids = workspace.widgetIds( payload );
			var enabled = 0;
			for ( var i = 0; i < ids.length; i++ ) {
				if ( ! isWorkspaceContentInstalled( 'widget', ids[ i ] ) ) continue;
				toggleWidget( 'odd/' + ids[ i ], true );
				enabled++;
			}
			return enabled;
		}

		function applyWorkspacePayload( payload, statusNode ) {
			var workspace = workspaceApi();
			if ( ! workspace ) return Promise.reject( new Error( 'Workspace import is not available.' ) );
			var safe = workspace.validate( payload );
			var needed = workspace.requiredContent( safe );
			var missing = [];
			var unavailable = [];
			for ( var i = 0; i < needed.length; i++ ) {
				var item = needed[ i ];
				if ( isWorkspaceContentInstalled( item.type, item.slug ) ) continue;
				if ( hasCatalogWorkspaceContent( item.type, item.slug ) ) {
					missing.push( item );
				} else {
					unavailable.push( item );
				}
			}
			if ( unavailable.length ) {
				var first = unavailable[ 0 ];
				return Promise.reject( new Error(
					'Missing ' + workspaceTypeLabel( first.type ) + ' "' + first.slug + '" from the catalog.'
				) );
			}
			var installed = 0;
			var chain = Promise.resolve();
			missing.forEach( function ( item ) {
				chain = chain.then( function () {
					setWorkspaceStatus( statusNode, 'Installing ' + workspaceTypeLabel( item.type ) + ' "' + item.slug + '"...', false );
					return installCatalogRowData( catalogWorkspaceRow( item.type, item.slug ) || { slug: item.slug } ).then( function ( data ) {
						installed++;
						handleInstallSuccess( data );
					} );
				} );
			} );
			return chain.then( function () {
				setWorkspaceStatus( statusNode, 'Applying workspace preferences...', false );
				var patch = workspace.buildPrefsPatch( safe );
				return saveWorkspacePrefs( patch ).then( function ( data ) {
					syncWorkspacePrefsIntoPanel( patch, data );
					var widgets = enableWorkspaceWidgets( safe );
					renderSection( state.active, { keepQuery: true } );
					playShopSound( 'success' );
					var detail = [];
					if ( installed ) detail.push( installed + ' installed' );
					if ( widgets ) detail.push( widgets + ' widget' + ( widgets === 1 ? '' : 's' ) + ' enabled' );
					var suffix = detail.length ? ' (' + detail.join( ', ' ) + ')' : '';
					toast( 'Workspace imported.' + suffix );
					setWorkspaceStatus(
						document.querySelector( '.odd-shop__dropzone-status' ) || statusNode,
						'Workspace imported.' + suffix,
						false
					);
				} );
			} );
		}

		/**
		 * Non-blocking recovery UI: structured server payload + one-click
		 * diagnostics for GitHub issues.
		 */
		function showInstallTroubleshoot( res, message, code, data ) {
			var root = document.querySelector( '.odd-shop' ) || document.body;
			var old = root.querySelector( '.odd-install-trouble' );
			if ( old ) {
				try { old.parentNode.removeChild( old ); } catch ( e0 ) {}
			}

			var backdrop = el( 'div', {
				class:                 'odd-install-trouble',
				role:                  'dialog',
				'aria-modal':          'true',
				'aria-labelledby':     'odd-trouble-title',
				'data-odd-troubleshoot': '1',
			} );
			var card = el( 'div', { class: 'odd-install-trouble__card' } );
			var title = el( 'h2', { class: 'odd-install-trouble__title', id: 'odd-trouble-title' } );
			title.textContent = __( 'Install failed' );
			var sub = el( 'p', { class: 'odd-install-trouble__lede' } );
			sub.textContent = message;

			var pre = el( 'pre', { class: 'odd-install-trouble__pre' } );
			var payload = {
				code:    code,
				status:  res && res.status,
				message: message,
				body:    data,
			};
			try {
				pre.textContent = JSON.stringify( payload, null, 2 );
			} catch ( e1 ) {
				pre.textContent = String( message );
			}

			var row = el( 'div', { class: 'odd-install-trouble__row' } );
			var closeBtn = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--pill' } );
			closeBtn.textContent = __( 'Close' );
			closeBtn.addEventListener( 'click', function () {
				try { backdrop.parentNode.removeChild( backdrop ); } catch ( e2 ) {}
			} );
			var copyBtn = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--primary odd-apps-btn--pill' } );
			copyBtn.textContent = __( 'Copy diagnostics' );
			copyBtn.addEventListener( 'click', function () {
				var d = window.__odd && window.__odd.diagnostics;
				if ( d && typeof d.copy === 'function' ) {
					copyBtn.disabled = true;
					d.copy().then( function ( ok ) {
						copyBtn.textContent = ok ? __( 'Copied' ) : __( 'Copy failed' );
						setTimeout( function () {
							copyBtn.disabled = false;
							copyBtn.textContent = __( 'Copy diagnostics' );
						}, 2000 );
					} );
					return;
				}
				try {
					navigator.clipboard.writeText( pre.textContent );
					copyBtn.textContent = __( 'Copied' );
				} catch ( e3 ) {
					copyBtn.textContent = __( 'Copy failed' );
				}
			} );
			row.appendChild( closeBtn );
			row.appendChild( copyBtn );

			card.appendChild( title );
			card.appendChild( sub );
			card.appendChild( pre );
			var hintP = el( 'p', { class: 'odd-install-trouble__hint' } );
			hintP.textContent = __( 'Full environment + log ring buffer is copied when diagnostics are available.' );
			card.appendChild( hintP );
			card.appendChild( row );
			backdrop.appendChild( card );
			root.appendChild( backdrop );
			setTimeout( function () { try { closeBtn.focus(); } catch ( e4 ) {} }, 10 );
		}

		/** Keyboard help overlay (/) search focus, ? shortcuts, rail arrows (plan item 20). */
		function installShopKeyboard( body, rail, buttons, renderSection ) {
			var helpOpen = null;
			function isTypingTarget( t ) {
				if ( ! t || ! t.tagName ) return false;
				var tag = t.tagName;
				if ( tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ) return true;
				if ( t.isContentEditable ) return true;
				return false;
			}
			function closeHelp() {
				if ( helpOpen && helpOpen.parentNode ) {
					try { helpOpen.parentNode.removeChild( helpOpen ); } catch ( e ) {}
				}
				helpOpen = null;
			}
			function openHelp() {
				closeHelp();
				var layer = el( 'div', { class: 'odd-kbd-help', role: 'dialog', 'aria-modal': 'true', 'aria-label': __( 'Keyboard shortcuts' ) } );
				var inner = el( 'div', { class: 'odd-kbd-help__card' } );
				var h2t = el( 'h2', { class: 'odd-kbd-help__title' } );
				h2t.textContent = __( 'Keyboard shortcuts' );
				inner.appendChild( h2t );
				var list = el( 'ul', { class: 'odd-kbd-help__list' } );
				var rows = [
					[ '/ ', __( 'Focus search' ) ],
					[ '? ', __( 'Show this help' ) ],
					[ __( 'Escape' ), __( 'Close' ) ],
					[ '\u2191 / \u2193', __( 'Move in the sidebar' ) ],
				];
				for ( var r = 0; r < rows.length; r++ ) {
					var li = el( 'li' );
					var k  = el( 'kbd', { class: 'odd-kbd-help__key' } );
					k.textContent = rows[ r ][ 0 ];
					li.appendChild( k );
					li.appendChild( document.createTextNode( ' ' + rows[ r ][ 1 ] ) );
					list.appendChild( li );
				}
				inner.appendChild( list );
				var done = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--primary odd-apps-btn--pill' } );
				done.textContent = __( 'Got it' );
				done.addEventListener( 'click', closeHelp );
				inner.appendChild( done );
				layer.appendChild( inner );
				layer.addEventListener( 'click', function ( ev ) { if ( ev.target === layer ) closeHelp(); } );
				body.appendChild( layer );
				helpOpen = layer;
				setTimeout( function () { try { done.focus(); } catch ( e2 ) {} }, 10 );
			}

			body.addEventListener( 'keydown', function ( ev ) {
				if ( ev.key === 'Escape' ) {
					closeHelp();
					return;
				}
				if ( isTypingTarget( ev.target ) && ev.key !== 'Escape' ) {
					return;
				}
				if ( ev.key === '?' || ( ev.key === '/' && ev.shiftKey ) ) {
					ev.preventDefault();
					if ( helpOpen ) closeHelp();
					else openHelp();
					return;
				}
				if ( ev.key === '/' ) {
					var sea = document.querySelector( '[data-odd-search]' );
					if ( sea && ev.target !== sea ) {
						ev.preventDefault();
						try { sea.focus(); } catch ( e3 ) {}
					}
					return;
				}
			} );

			rail.setAttribute( 'role', 'navigation' );
			rail.setAttribute( 'aria-label', __( 'Store sections' ) );
			rail.addEventListener( 'keydown', function ( ev ) {
				if ( ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' ) return;
				var items = rail.querySelectorAll( '.odd-shop__rail-item' );
				if ( ! items || ! items.length ) return;
				var list = Array.prototype.slice.call( items );
				var ix   = list.indexOf( document.activeElement );
				if ( ix < 0 ) return;
				ev.preventDefault();
				var next = ev.key === 'ArrowDown' ? Math.min( list.length - 1, ix + 1 ) : Math.max( 0, ix - 1 );
				try { list[ next ].focus(); } catch ( e4 ) {}
			} );
		}

		// Shop-wide drag-and-drop overlay — accept a .wp bundle or
		// .odd workspace dropped anywhere inside the panel.
		function installDropAnywhere( body ) {
			if ( ! ( window.odd || {} ).canInstall ) return;
			if ( body.__oddDropInstalled ) return;
			body.__oddDropInstalled = true;
			body.addEventListener( 'dragover', function ( e ) {
				if ( ! e.dataTransfer || ! e.dataTransfer.types ) return;
				var types = Array.prototype.slice.call( e.dataTransfer.types );
				if ( types.indexOf( 'Files' ) === -1 ) return;
				e.preventDefault();
				body.classList.add( 'is-dropping' );
			} );
			body.addEventListener( 'dragleave', function ( e ) {
				if ( e.target === body ) body.classList.remove( 'is-dropping' );
			} );
			body.addEventListener( 'drop', function ( e ) {
				body.classList.remove( 'is-dropping' );
				var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[ 0 ];
				if ( ! f ) return;
				if ( ! isBundleFile( f ) && ! isWorkspaceFile( f ) ) return;
				e.preventDefault();
				handleLocalInstallFile( f );
			} );
		}

		/**
		 * Render a "Discover" shelf for a content type (scene,
		 * icon-set, widget). Pulls from the server-provided
		 * bundleCatalog pre-baked into window.odd, so first paint
		 * doesn't wait on a REST round-trip. Returns null when the
		 * catalog is empty for that type so the caller can skip
		 * appending an empty header.
		 *
		 * Per-card layout reuses the list-row pattern from the Apps
		 * catalog (avatar + name + description + action pill) since
		 * remote entries ship URLs and descriptions rather than
		 * painted previews.
		 */
		// Discover shelf — now a curation strip above the unified
		// department grid rather than a parallel catalog list. Shows
		// featured / new catalog rows using the same `renderShopCard`
		// as everything else, so the visual language is consistent.
		function renderDiscoverShelf( type ) {
			var catalog = ( state.cfg.bundleCatalog || {} );
			var key = ( type === 'icon-set' ) ? 'iconSet' : ( type === 'cursor-set' ? 'cursorSet' : type );
			var raw = Array.isArray( catalog[ key ] ) ? catalog[ key ] : [];
			if ( ! raw.length ) return null;

			// Prefer featured + uninstalled rows; if the catalog doesn't
			// advertise any featured entries, fall back to the first few
			// uninstalled rows so the strip still has something to show.
			var uninstalled = raw.filter( function ( r ) { return r && ! r.installed; } );
			if ( ! uninstalled.length ) return null;
			var featured = uninstalled.filter( function ( r ) { return r && ( r.featured || r.is_new ); } );
			var rows = featured.length ? featured : uninstalled.slice( 0, 8 );

			var shelf = el( 'section', { class: 'odd-shop__shelf odd-shop__shelf--discover', 'data-shelf-anchor': 'Discover' } );
			var head  = el( 'div', { class: 'odd-shop__shelf-head' } );
			var title = el( 'h3', { class: 'odd-shop__shelf-title' } );
			title.textContent = featured.length ? 'Featured in the catalog' : 'From the catalog';
			var count = el( 'span', { class: 'odd-shop__shelf-count' } );
			count.textContent = rows.length + ( rows.length === 1 ? ' pick' : ' picks' );
			head.appendChild( title );
			head.appendChild( count );
			shelf.appendChild( head );

			var track = el( 'div', { class: 'odd-shop__shelf-track odd-shop__shelf-track--tiles' } );
			rows.forEach( function ( raw ) {
				var row = normaliseShopRow( raw, type );
				if ( ! row ) return;
				row.installed = !! raw.installed;
				var card = renderShopCard( row, { variant: 'discover' } );
				if ( card ) track.appendChild( card );
			} );
			shelf.appendChild( track );
			return shelf;
		}

			// Thin adapter: single-row render paths pass through the unified card too.
		function renderDiscoverRow( raw ) {
			var type = 'scene';
			// Best-effort type detection from the source row.
			if ( raw && raw.widget ) type = 'widget';
			else if ( raw && raw.icons ) type = 'icon-set';
			else if ( raw && raw.cursors ) type = 'cursor-set';
			else if ( raw && raw.app )   type = 'app';
			var row = normaliseShopRow( raw, type );
			if ( ! row ) return el( 'div' );
			row.installed = !! ( raw && raw.installed );
			return renderShopCard( row );
		}

		function installFromBundleCatalog( row, btn ) {
			return startShopInstall( row, btn );
		}

		function startShopInstall( row, btn, opts ) {
			opts = opts || {};
			row = row || {};
			if ( ! row.slug ) return Promise.resolve( null );
			if ( isShopInstalling( row ) ) return Promise.resolve( null );
			var mode = opts.mode || ( row.installed && row.updateAvailable ? 'update' : ( row.broken ? 'repair' : 'install' ) );
			var progress = actionProgressCopy( mode );
			playShopSound( 'install' );
			setShopInstalling( row, true, mode );
			if ( btn ) {
				btn.disabled = true;
				btn.classList.add( 'odd-shop__card-btn--installing', 'is-disabled' );
				btn.setAttribute( 'aria-busy', 'true' );
				btn.textContent = progress.label;
			}
			showShopFlowToast( progress.verb + ' ' + itemDisplayName( row ) + '…', { duration: 2400 } );
			renderSection( state.active, { keepQuery: true } );
			return installCatalogRowData( row.raw || row, opts ).then( function ( data ) {
				handleInstallSuccess( data );
				return data;
			} ).catch( function ( err ) {
				setShopInstalling( row, false );
				renderSection( state.active, { keepQuery: true } );
				if ( err && err.data ) {
					onInstallFailure( err );
				} else {
					reportError( 'bundles.install-from-catalog', err );
					playShopSound( 'error' );
					toast( ( err && err.message ) || 'Network error while installing.' );
				}
				return null;
			} );
		}

		/**
		 * Dedicated "Install" department — one canonical surface
		 * for dropping a .wp archive of any type (app, icon set,
		 * cursor set, scene, widget) or a .odd workspace preset.
		 * The Shop-wide drop overlay still works from anywhere; this
		 * tab just makes the action a first-class destination with
		 * room to explain the formats.
		 */
		function renderInstall() {
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--install' } );
			wrap.appendChild( sectionHeader(
				'Install or share',
				'Drop a .wp bundle to add new decor, or use a .odd workspace to carry your whole desktop mood to another site.',
				{ eyebrow: 'ODD · Universal Installer' }
			) );

			// Primary drop zone. Clicking anywhere inside it fires
			// the hidden local <input type="file">, which routes
			// through the same handler as drag-and-drop.
			var zone = el( 'div', {
				class: 'odd-shop__dropzone',
				'data-odd-install-zone': '1',
				role: 'button',
				tabindex: '0',
				'aria-label': 'Install a .wp bundle or .odd workspace',
			} );
			var zoneGlyph = el( 'div', { class: 'odd-shop__dropzone-glyph', 'aria-hidden': 'true' } );
			zoneGlyph.textContent = '⇪';
			var zoneTitle = el( 'div', { class: 'odd-shop__dropzone-title' } );
			zoneTitle.textContent = 'Drop a .wp bundle or .odd workspace here';
			var zoneSub = el( 'div', { class: 'odd-shop__dropzone-sub' } );
			zoneSub.textContent = '.wp adds new stuff. .odd brings back a whole arrangement.';
			var zoneBtn = el( 'button', {
				type: 'button',
				class: 'odd-shop__dropzone-btn',
				'data-odd-install-choose': '1',
			} );
			zoneBtn.textContent = 'Choose .wp or .odd file...';
			var zoneStatus = el( 'div', {
				class: 'odd-shop__dropzone-status',
				'aria-live': 'polite',
			} );
			var fileInput = el( 'input', {
				type: 'file',
				accept: '.wp,.odd',
				class: 'odd-shop__file-input',
				'data-odd-install-file-input': '1',
			} );
			fileInput.addEventListener( 'change', function () {
				var f = fileInput.files && fileInput.files[ 0 ];
				if ( f ) handleLocalInstallFile( f, zoneStatus );
				fileInput.value = '';
			} );
			zone.appendChild( zoneGlyph );
			zone.appendChild( zoneTitle );
			zone.appendChild( zoneSub );
			zone.appendChild( zoneBtn );
			zone.appendChild( zoneStatus );
			zone.appendChild( fileInput );

			function triggerPicker() {
				fileInput.click();
			}
			zone.addEventListener( 'click', triggerPicker );
			zone.addEventListener( 'keydown', function ( e ) {
				if ( e.key === 'Enter' || e.key === ' ' ) {
					e.preventDefault();
					triggerPicker();
				}
			} );

			// Local drag highlight — tighter than the Shop-wide
			// overlay so the target is unambiguous when the user
			// is already on this tab.
			zone.addEventListener( 'dragover', function ( e ) {
				if ( ! e.dataTransfer || ! e.dataTransfer.types ) return;
				var types = Array.prototype.slice.call( e.dataTransfer.types );
				if ( types.indexOf( 'Files' ) === -1 ) return;
				e.preventDefault();
				zone.classList.add( 'is-hover' );
			} );
			zone.addEventListener( 'dragleave', function () {
				zone.classList.remove( 'is-hover' );
			} );
			zone.addEventListener( 'drop', function ( e ) {
				zone.classList.remove( 'is-hover' );
				var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[ 0 ];
				if ( ! f ) return;
				if ( ! isBundleFile( f ) && ! isWorkspaceFile( f ) ) return;
				e.preventDefault();
				handleLocalInstallFile( f, zoneStatus );
			} );
			wrap.appendChild( zone );

			var workspaceCard = el( 'div', { class: 'odd-shop__workspace-card' } );
			var workspaceText = el( 'div', { class: 'odd-shop__workspace-copy' } );
			var workspaceTitle = el( 'strong' );
			workspaceTitle.textContent = 'Share this desktop as .odd';
			var workspaceHint = el( 'span' );
			workspaceHint.textContent = 'Exports wallpaper, icon set, cursor set, enabled widgets, pinned apps, and preference switches as a tiny preset file.';
			workspaceText.appendChild( workspaceTitle );
			workspaceText.appendChild( workspaceHint );
			var workspaceActions = el( 'div', { class: 'odd-shop__workspace-actions' } );
			var exportBtn = el( 'button', {
				type: 'button',
				class: 'odd-apps-btn odd-apps-btn--primary odd-apps-btn--pill',
				'data-odd-export-workspace': '1',
			} );
			exportBtn.textContent = 'Export .odd';
			exportBtn.addEventListener( 'click', function () {
				exportWorkspaceFile( zoneStatus );
			} );
			var importBtn = el( 'button', {
				type: 'button',
				class: 'odd-apps-btn odd-apps-btn--pill',
				'data-odd-import-workspace': '1',
			} );
			importBtn.textContent = 'Import file...';
			importBtn.addEventListener( 'click', triggerPicker );
			workspaceActions.appendChild( exportBtn );
			workspaceActions.appendChild( importBtn );
			workspaceCard.appendChild( workspaceText );
			workspaceCard.appendChild( workspaceActions );
			wrap.appendChild( workspaceCard );

			// "What can I install?" — four cards that describe
			// each content type. These aren't actions, they're
			// affordance cues so the user knows the .wp format
			// carries more than just apps. Each card ships a
			// tinted glyph badge + a one-line description trimmed
			// so all four feel parallel at a glance.
			var types = [
				{
					type: 'app',
					label: 'Apps',
					tint: '#0071e3',
					desc: 'Sandboxed mini apps with their own dock icon and little window.',
					glyph: '<rect x="3" y="6" width="14" height="11" rx="2"/><path d="M3 9h14"/><circle cx="6" cy="7.5" r=".6" fill="currentColor"/><circle cx="8" cy="7.5" r=".6" fill="currentColor"/>',
				},
				{
					type: 'scene',
					label: 'Scenes',
					tint: '#8a5cff',
					desc: 'Live generative wallpaper weather for the whole desktop.',
					glyph: '<rect x="3" y="4" width="14" height="12" rx="2"/><circle cx="13.5" cy="7.5" r="1.2" fill="currentColor"/><path d="M3 13l3-3 3 2 4-4 4 4"/>',
				},
				{
					type: 'icon-set',
					label: 'Icon Sets',
					tint: '#00a693',
					desc: 'PNG and WebP image feeds for Desktop Mode desktop shortcuts.',
					glyph: '<rect x="3" y="3" width="6" height="6" rx="1.4"/><rect x="11" y="3" width="6" height="6" rx="1.4"/><rect x="3" y="11" width="6" height="6" rx="1.4"/><rect x="11" y="11" width="6" height="6" rx="1.4"/>',
				},
				{
					type: 'cursor-set',
					label: 'Cursors',
					tint: '#38e8ff',
					desc: 'Pointer wardrobes that follow you through Desktop Mode and wp-admin.',
					glyph: '<path d="M4 3l10 7-4 1.2 2.5 4.5-2.4 1.3-2.5-4.6L4 16z"/><path d="M13.5 4.5l2-2M16 8h2.5M12 2V.5"/>',
				},
				{
					type: 'widget',
					label: 'Widgets',
					tint: '#ff8c1a',
					desc: 'Draggable desk pets that perch right on the desktop surface.',
					glyph: '<path d="M4 4h9l3 3v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z"/><path d="M13 4v3h3"/>',
				},
				{
					type: 'workspace',
					label: 'Workspaces',
					tint: '#ff3d9a',
					desc: '.odd files remember a desktop setup without carrying code.',
					glyph: '<path d="M4 4h12v12H4z"/><path d="M7 7h3v3H7zM11 7h2v2h-2zM7 11h6"/>',
				},
			];
			var grid = el( 'div', { class: 'odd-shop__install-types' } );
			types.forEach( function ( t ) {
				var card = el( 'div', {
					class: 'odd-shop__install-type',
					style: '--odd-itype-tint:' + t.tint,
				} );
				var g = el( 'span', {
					class: 'odd-shop__install-type-glyph',
					'aria-hidden': 'true',
				} );
				g.innerHTML = (
					'<svg viewBox="0 0 20 20" width="20" height="20"'
					+ ' fill="none" stroke="currentColor"'
					+ ' stroke-width="1.6" stroke-linecap="round"'
					+ ' stroke-linejoin="round">' + t.glyph + '</svg>'
				);
				var body = el( 'div', { class: 'odd-shop__install-type-body' } );
				var l = el( 'strong' );
				l.textContent = t.label;
				var d = el( 'span', { class: 'odd-shop__install-type-desc' } );
				d.textContent = t.desc;
				body.appendChild( l );
				body.appendChild( d );
				card.appendChild( g );
				card.appendChild( body );
				grid.appendChild( card );
			} );
			wrap.appendChild( grid );

			return wrap;
		}

		/**
		 * Dedicated Settings department.
		 *
		 * Keep this intentionally tiny: placement belongs to Desktop Mode,
		 * and the only Shop-local preference is whether the panel chirps.
		 */
		function renderSettings() {
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--settings' } );
			wrap.appendChild( sectionHeader(
				'Settings',
				'Two small switches for how ODD lives in Desktop Mode.',
				{ eyebrow: 'ODD · Preferences' }
			) );

			var settings = el( 'div', { class: 'odd-wallpaper-settings odd-wallpaper-settings--compact' } );

			// Shop sound effects — local browser preference for the
			// tiny UI chimes generated by this panel. It intentionally
			// does not touch the wallpaper audio-reactive setting above.
			var sfxRow = el( 'label', { class: 'odd-setting-card odd-setting-card--shop-sounds odd-switch-row' } );
			var sfxBox = el( 'input', { type: 'checkbox' } );
			sfxBox.checked = !! state.shopSounds;
			var sfxKnob = el( 'span', { class: 'odd-switch' } );
			var sfxText = el( 'span', { class: 'odd-setting-card__text' } );
			var sfxLbl = el( 'strong' );
			sfxLbl.textContent = __( 'Sound effects' );
			var sfxHint = el( 'span' );
			sfxHint.textContent = __( 'Play tiny clicks and velvet chimes while browsing.' );
			sfxText.appendChild( sfxLbl );
			sfxText.appendChild( sfxHint );
			sfxRow.appendChild( sfxBox );
			sfxRow.appendChild( sfxKnob );
			sfxRow.appendChild( sfxText );
			settings.appendChild( sfxRow );
			sfxBox.addEventListener( 'change', function () {
				saveShopSoundsSetting( sfxBox.checked );
				if ( sfxBox.checked ) playShopSound( 'success' );
			} );

			// ODD Shop taskbar launcher. Desktop Mode owns live placement
			// through itemVisibility; the ODD preference is a server-side
			// default mirror for hosts that cannot write OS settings.
			var dockRow = el( 'label', { class: 'odd-setting-card odd-setting-card--shop-taskbar odd-switch-row' } );
			var dockBox = el( 'input', { type: 'checkbox' } );
			dockBox.checked = readShopTaskbarState();
			var dockKnob = el( 'span', { class: 'odd-switch' } );
			var dockText = el( 'span', { class: 'odd-setting-card__text' } );
			var dockLbl = el( 'strong' );
			dockLbl.textContent = __( 'Keep in taskbar' );
			var dockHint = el( 'span' );
			dockHint.textContent = __( 'Keep a quick ODD Shop portal in the Desktop Mode taskbar.' );
			dockText.appendChild( dockLbl );
			dockText.appendChild( dockHint );
			dockRow.appendChild( dockBox );
			dockRow.appendChild( dockKnob );
			dockRow.appendChild( dockText );
			settings.appendChild( dockRow );
			dockBox.addEventListener( 'change', function () {
				var nextTaskbar = !! dockBox.checked;
				writeCoreShopTaskbarState( nextTaskbar ).then( function ( coreSaved ) {
					if ( coreSaved ) {
						state.cfg.shopTaskbar = nextTaskbar;
						savePrefs( { shopTaskbar: nextTaskbar }, function ( data ) {
							if ( data && Object.prototype.hasOwnProperty.call( data, 'shopTaskbar' ) ) {
								state.cfg.shopTaskbar = !! data.shopTaskbar;
								dockBox.checked = state.cfg.shopTaskbar;
							}
						} );
						toast( __( 'Updated ODD taskbar setting.' ) );
						return;
					}
					savePrefs( { shopTaskbar: nextTaskbar }, function ( data ) {
						if ( data && Object.prototype.hasOwnProperty.call( data, 'shopTaskbar' ) ) {
							state.cfg.shopTaskbar = !! data.shopTaskbar;
							dockBox.checked = state.cfg.shopTaskbar;
						}
						scheduleAdminReload( {
							delayMs: ODD_RELOAD_DELAY_MS_NATIVE_SURFACE,
							slug: 'odd',
							type: 'setting',
							name: 'ODD taskbar setting',
							toastMessage: __( 'Reloading Desktop Mode to update ODD taskbar setting…' ),
						} );
					} );
				} );
			} );

			wrap.appendChild( settings );

			return wrap;
		}

		function appsBaseUrl() {
			// cfg.restUrl is the /odd/v1/prefs endpoint; swap the tail
			// for /apps to get the apps namespace.
			var base = state.cfg.restUrl || '';
			return base.replace( /\/prefs\/?$/, '/apps' );
		}
		function fetchApps() {
			return fetch( appsBaseUrl(), {
				credentials: 'same-origin',
				headers: { 'X-WP-Nonce': state.cfg.restNonce || '' },
			} ).then( function ( r ) { return r.ok ? r.json() : { apps: [] }; } )
			  .then( function ( data ) { return ( data && Array.isArray( data.apps ) ) ? data.apps : []; } )
			  .catch( function ( err ) {
				reportError( 'apps.list', err );
				return [];
			} );
		}
		function toggleApp( slug, enabled ) {
			return fetch( appsBaseUrl() + '/' + encodeURIComponent( slug ) + '/toggle', {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce':   state.cfg.restNonce || '',
				},
				body: JSON.stringify( { enabled: !! enabled } ),
			} ).then( function ( r ) { return r.ok; } ).catch( function () { return false; } );
		}
		/**
		 * Fallback for hosts without Desktop Mode itemVisibility. Current
		 * Desktop Mode owns placement via `updateOsSettings`; this keeps the
		 * older ODD REST contract alive for incomplete host environments.
		 *
		 * Accepts a partial surfaces update (one or both of
		 * { desktop, taskbar }) and returns the server-normalized shape.
		 */
		function setAppSurfaces( slug, surfaces ) {
			return fetch( appsBaseUrl() + '/' + encodeURIComponent( slug ) + '/toggle', {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce':   state.cfg.restNonce || '',
				},
					body: JSON.stringify( { surfaces: surfaces } ),
				} ).then( function ( r ) {
					return r.ok ? r.json() : null;
				} ).catch( function () { return null; } );
		}
		function saveAppSurfaceState( slug, fullSurfaces, partialSurfaces ) {
			return writeCoreAppSurfaceState( slug, fullSurfaces ).then( function ( coreSurfaces ) {
				if ( coreSurfaces ) {
					return refreshDesktopModeAppSurfaces( 'app.surfaces.native' )
						.then( function ( result ) {
							return {
								native: true,
								refreshed: result.refreshed,
								placements: result.placements,
								surfaces: coreSurfaces,
							};
						} );
				}
				return setAppSurfaces( slug, partialSurfaces ).then( function ( res ) {
					if ( res && res.surfaces ) {
						return { native: false, surfaces: res.surfaces };
					}
					return null;
				} );
			} );
		}
		/**
		 * Mirror the normalized `surfaces` shape onto the cfg.apps row so
		 * this panel stays consistent with the host-owned itemVisibility
		 * placement or the fallback REST response.
		 */
		function mirrorAppSurfacesInCfg( slug, surfaces ) {
			if ( ! slug || ! surfaces || typeof surfaces !== 'object' ) return;
			var cfg = state.cfg || {};
			var apps = Array.isArray( cfg.apps ) ? cfg.apps : [];
			for ( var i = 0; i < apps.length; i++ ) {
				var row = apps[ i ];
				if ( ! row || row.slug !== slug ) continue;
				row.surfaces = Object.assign( {}, row.surfaces || {}, surfaces );
				delete row.requiresReload;
			}
		}

		function deleteApp( slug ) {
			return fetch( appsBaseUrl() + '/' + encodeURIComponent( slug ), {
				method: 'DELETE',
				credentials: 'same-origin',
				headers: { 'X-WP-Nonce': state.cfg.restNonce || '' },
			} ).then( function ( r ) { return r.ok; } ).catch( function () { return false; } );
		}
		function uploadApp( file ) {
			var fd = new FormData();
			fd.append( 'file', file, file.name );
			return fetch( appsBaseUrl() + '/upload', {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'X-WP-Nonce': state.cfg.restNonce || '' },
				body: fd,
			} ).then( function ( r ) { return r.json(); } )
			  .catch( function () { return null; } );
		}
		function openAppWindow( slug ) {
			playShopSound( 'nav' );
			// Single-window contract: open through the host's window
			// registry so re-clicks raise the existing window instead
			// of spawning duplicates.
			var api = window.__odd && window.__odd.api;
			if ( api && typeof api.openApp === 'function' ) {
				try {
					if ( api.openApp( slug ) ) return;
				} catch ( e ) {}
			}
			var wpd = window.wp && window.wp.desktop;
			if ( wpd && typeof wpd.openWindow === 'function' ) {
				try { wpd.openWindow( 'odd-app-' + slug ); return; } catch ( e ) {}
			}
			if ( wpd && typeof wpd.registerWindow === 'function' ) {
				try { wpd.registerWindow( { id: 'odd-app-' + slug } ); return; } catch ( e ) {}
			}
		}

		/* --- Wallpaper section --- */

		function renderWallpaper() {
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--wallpaper' } );
			wrap.appendChild( sectionHeader(
				'Wallpapers',
				'Living generative scenes for your WordPress desktop. Audition the weather before you let it move in.',
				{ eyebrow: 'ODD · Living Art' }
			) );
			appendCatalogNotice( wrap, 'scene' );

			var installedScenes = ( Array.isArray( state.cfg.scenes ) ? state.cfg.scenes : [] )
				.filter( function ( s ) { return s && s.slug && s.slug !== 'odd-pending'; } );
			var allRows = shopRowsFor( 'scene' );
			var rows = applyStoreControls( allRows, 'scene' );
			wrap.appendChild( renderStoreControls( 'scene', allRows, rows ) );

			// Category quilt — gradient category tiles that jump
			// to their shelf when clicked. Hidden while searching so
			// the result-focused view stays tight.
			if ( ! state.query ) {
				wrap.appendChild( renderCategoryQuilt( rows, 'wallpaper' ) );
			}

			if ( ! rows.length ) {
				if ( activeFilterLabel() ) {
					wrap.appendChild( renderEmptyResults( 'No scenes match "' + activeFilterLabel() + '" yet.' ) );
					return wrap;
				}
				wrap.appendChild( renderEmptyDept(
					'scenes',
					'Install one from the catalog below, or give ODD a moment to finish unpacking its first scene.',
					'🎨'
				) );
				return wrap;
			}

			// Personal shelves — "Recents" (last 12 scenes the user
			// switched to) and "Favorites" (starred by the user).
			// Rendered above Discover so the most-personal content
			// stays near the top. Hidden while searching so the
			// result-focused view stays tight.
			if ( ! state.query ) {
				var recentsShelf = renderPersonalShelf( 'Recents', state.cfg.recents, installedScenes, 'wallpaper' );
				if ( recentsShelf ) wrap.appendChild( recentsShelf );
				var favShelf = renderPersonalShelf( 'Favorites', state.cfg.favorites, installedScenes, 'wallpaper' );
				if ( favShelf ) wrap.appendChild( favShelf );
			}

			var shelves = groupByCategory( rows, 'wallpaper', 'More' );
			shelves.forEach( function ( shelf ) {
				wrap.appendChild( renderShelf( shelf.category, shelf.items, renderSceneCard, { scope: 'wallpaper' } ) );
			} );

			return wrap;
		}

		function renderEmptyResults( message ) {
			var wrap = el( 'div', { class: 'odd-shop__empty' } );
			var icon = el( 'div', { class: 'odd-shop__empty-icon', 'aria-hidden': 'true' } );
			icon.textContent = '🔍';
			var big = el( 'div', { class: 'odd-shop__empty-title' } );
			big.textContent = 'No weirdness found';
			var sub = el( 'div', { class: 'odd-shop__empty-sub' } );
			sub.textContent = message || 'Try another search term and rattle the shelves again.';
			wrap.appendChild( icon );
			wrap.appendChild( big );
			wrap.appendChild( sub );
			return wrap;
		}

		function catalogMeta() {
			var health = state.cfg.systemHealth || {};
			return health.catalog || {};
		}

		function catalogSignatureIsBad( status ) {
			return [ 'invalid', 'missing', 'mismatch', 'no_key', 'unavailable' ].indexOf( String( status || '' ) ) !== -1;
		}

		function catalogSourceLabel( source ) {
			source = String( source || 'unknown' );
			var map = {
				remote: 'Remote catalog',
				transient: 'Cached remote catalog',
				stale_option: 'Saved catalog',
				fallback_file: 'Bundled fallback catalog',
				rollback_option: 'Restored catalog',
				empty: 'Empty catalog',
			};
			return map[ source ] || source.replace( /_/g, ' ' );
		}

		function catalogSignatureLabel( status ) {
			status = String( status || 'unknown' );
			var map = {
				valid: 'Valid signature',
				skipped: 'Signature skipped',
				unknown: 'Unknown signature',
				missing: 'Missing signature',
				invalid: 'Invalid signature',
				mismatch: 'Signature mismatch',
				no_key: 'No trusted key',
				unavailable: 'Verifier unavailable',
			};
			return map[ status ] || status.replace( /_/g, ' ' );
		}

		function formatShortHash( value ) {
			value = String( value || '' );
			return value ? value.slice( 0, 12 ) : 'none';
		}

		function formatBytes( value ) {
			var n = parseInt( value || 0, 10 ) || 0;
			if ( n >= 1024 * 1024 ) return ( n / ( 1024 * 1024 ) ).toFixed( 1 ) + ' MB';
			if ( n >= 1024 ) return Math.round( n / 1024 ) + ' KB';
			return n ? n + ' B' : '0 B';
		}

		function formatAge( seconds ) {
			var n = Math.max( 0, parseInt( seconds || 0, 10 ) || 0 );
			if ( n < 60 ) return 'fresh';
			if ( n < 3600 ) return Math.round( n / 60 ) + 'm';
			if ( n < 86400 ) return Math.round( n / 3600 ) + 'h';
			return Math.round( n / 86400 ) + 'd';
		}

		function catalogTotalRows() {
			var catalog = ( state.cfg && state.cfg.bundleCatalog ) || {};
			var total = 0;
			[ 'scene', 'iconSet', 'cursorSet', 'widget', 'app' ].forEach( function ( key ) {
				total += Array.isArray( catalog[ key ] ) ? catalog[ key ].length : 0;
			} );
			return total;
		}

		function catalogIssue( type ) {
			var catalog = catalogMeta();
			var source = String( catalog.source || 'unknown' );
			var sig = String( catalog.signature_status || 'unknown' );
			var total = catalogTotalRows();
			var effective = parseInt( catalog.effective_bundle_count || catalog.bundle_count || total || 0, 10 ) || 0;
			var typeRows = type ? catalogRowsFor( type ).length : total;
			var lastError = String( catalog.last_error_message || '' );
			var badSig = catalogSignatureIsBad( sig );

			if ( badSig ) {
				return {
					level: 'warning',
					title: 'Catalog signature needs attention',
					copy: catalogSignatureLabel( sig ) + '. ODD keeps install safety checks on and will not trust changed bundles blindly.',
				};
			}
			if ( source === 'empty' || ( effective <= 0 && total <= 0 ) ) {
				return {
					level: 'empty',
					title: typeRows ? 'The catalog is thin right now' : 'The catalog shelf is empty',
					copy: lastError || 'Installed items still work, but ODD could not load new catalog rows yet.',
				};
			}
			if ( source === 'fallback_file' || source === 'stale_option' || source === 'rollback_option' ) {
				return {
					level: 'warning',
					title: source === 'fallback_file' ? 'Showing the bundled fallback shelf' : 'Showing a saved catalog shelf',
					copy: lastError || 'ODD could not verify the newest catalog, so it is using a known local snapshot instead.',
				};
			}
			if ( catalog.remote_update_available || catalog.update_available ) {
				var checkedAt = parseInt( catalog.last_update_check || 0, 10 ) || 0;
				return {
					level: 'info',
					title: 'New ODD stuff is available',
					copy: checkedAt
						? 'The remote shelf changed since this site last refreshed. Refresh catalog to pull the newest verified rows.'
						: 'The remote shelf has newer verified rows. Refresh catalog to pull them into the Shop.',
				};
			}
			if ( lastError ) {
				return {
					level: 'info',
					title: 'Catalog refreshed with a note',
					copy: lastError,
				};
			}
			return null;
		}

		function catalogEndpoint( suffix ) {
			var base = ( state.cfg.bundleCatalogUrl || '' ) ||
				( ( state.cfg.restUrl || '' ).replace( /\/prefs\/?$/, '' ) + '/bundles/catalog' );
			return base.replace( /\/catalog\/?$/, suffix );
		}

		function catalogFetch() {
			if ( typeof window !== 'undefined' && typeof window.fetch === 'function' ) {
				return window.fetch.bind( window );
			}
			if ( typeof fetch === 'function' ) return fetch;
			return null;
		}

		function catalogKeyForType( type ) {
			return type === 'icon-set' ? 'iconSet'
				: ( type === 'cursor-set' ? 'cursorSet' : type );
		}

		function replaceBundleCatalogRows( rows ) {
			if ( ! Array.isArray( rows ) ) return false;
			var next = {
				scene: [],
				iconSet: [],
				cursorSet: [],
				widget: [],
				app: [],
			};
			rows.forEach( function ( row ) {
				if ( ! row || ! row.type ) return;
				var key = catalogKeyForType( row.type );
				if ( ! Object.prototype.hasOwnProperty.call( next, key ) ) return;
				next[ key ].push( row );
			} );
			state.cfg.bundleCatalog = next;
			if ( window.odd ) {
				window.odd.bundleCatalog = clone( next );
			}
			return true;
		}

		function refreshCatalog( button, onDone, opts ) {
			opts = opts || {};
			var fetchFn = catalogFetch();
			if ( ! fetchFn ) return Promise.resolve( null );
			if ( button ) {
				button.disabled = true;
				button.textContent = __( 'Refreshing…' );
			}
			return fetchFn( catalogEndpoint( '/refresh' ), {
				method: 'POST',
				credentials: 'same-origin',
				headers: { 'X-WP-Nonce': state.cfg.restNonce || '' },
			} ).then( function ( res ) {
				return res.ok ? res.json() : null;
			} ).then( function ( res ) {
				if ( res && res.meta ) {
					state.cfg.systemHealth = state.cfg.systemHealth || {};
					state.cfg.systemHealth.catalog = res.meta;
					if ( window.odd ) {
						window.odd.systemHealth = window.odd.systemHealth || {};
						window.odd.systemHealth.catalog = clone( res.meta );
					}
				}
				if ( res && Array.isArray( res.bundles ) ) {
					replaceBundleCatalogRows( res.bundles );
				}
				if ( ! opts.silent ) toast( __( 'Catalog refreshed.' ) );
				if ( typeof onDone === 'function' ) onDone( res );
				return res;
			} ).catch( function ( err ) {
				reportError( 'bundles.refresh', err );
				if ( ! opts.silent ) toast( __( 'Catalog refresh failed.' ), 'error' );
				return null;
			} ).finally( function () {
				if ( button ) {
					button.disabled = false;
					button.textContent = __( 'Refresh catalog' );
				}
			} );
		}

		function checkCatalogUpdates( opts ) {
			opts = opts || {};
			if ( ! state.cfg.canInstall ) return Promise.resolve( null );
			var fetchFn = catalogFetch();
			if ( ! fetchFn ) return Promise.resolve( null );
			state.catalogUpdateCheck.pending = true;
			return fetchFn( catalogEndpoint( '/catalog-check' ), {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': state.cfg.restNonce || '',
				},
				body: JSON.stringify( { force: !! opts.force } ),
			} ).then( function ( res ) {
				return res.ok ? res.json() : null;
			} ).then( function ( res ) {
				if ( res && res.meta ) {
					state.cfg.systemHealth = state.cfg.systemHealth || {};
					state.cfg.systemHealth.catalog = res.meta;
					if ( window.odd ) {
						window.odd.systemHealth = window.odd.systemHealth || {};
						window.odd.systemHealth.catalog = clone( res.meta );
					}
				}
				if ( res && res.update_available && ! opts.silent ) {
					toast( __( 'New Shop content is available.' ) );
				}
				return res;
			} ).catch( function ( err ) {
				reportError( 'bundles.catalog-check', err );
				if ( ! opts.silent ) toast( __( 'Catalog update check failed.' ), 'error' );
				return null;
			} ).finally( function () {
				state.catalogUpdateCheck.pending = false;
			} );
		}

		function maybeCheckCatalogUpdates() {
			if ( ! state.cfg.canInstall || ! catalogFetch() ) return;
			if ( state.catalogUpdateCheck.checked || state.catalogUpdateCheck.pending ) return;
			state.catalogUpdateCheck.checked = true;
			var timer = window.setTimeout( function () {
				timer = 0;
				if ( state.catalogUpdateCheck.disposed ) return;
				checkCatalogUpdates( { silent: true } ).then( function ( res ) {
					if ( state.catalogUpdateCheck.disposed ) return;
					if ( res && res.update_available ) {
						renderSection( state.active, { keepQuery: true } );
					}
				} );
			}, 800 );
			cleanupFns.push( function () {
				if ( timer ) window.clearTimeout( timer );
			} );
		}

		function appendCatalogNotice( wrap, type ) {
			var issue = catalogIssue( type );
			if ( ! issue ) return;
			var notice = el( 'div', {
				class: 'odd-shop__catalog-notice odd-shop__catalog-notice--' + issue.level,
				role: issue.level === 'warning' || issue.level === 'empty' ? 'status' : null,
			} );
			var body = el( 'div', { class: 'odd-shop__catalog-notice-body' } );
			var title = el( 'strong' );
			title.textContent = __( issue.title );
			var copy = el( 'span' );
			copy.textContent = __( issue.copy );
			body.appendChild( title );
			body.appendChild( copy );
			notice.appendChild( body );
			var actions = el( 'div', { class: 'odd-shop__catalog-notice-actions' } );
			if ( state.cfg.canInstall ) {
				var refresh = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--pill' } );
				refresh.textContent = __( 'Refresh catalog' );
				refresh.addEventListener( 'click', function () {
					refreshCatalog( refresh, function () {
						renderSection( state.active, { keepQuery: true } );
					} );
				} );
				actions.appendChild( refresh );
			}
			var settings = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--pill' } );
			settings.textContent = __( 'View health' );
			settings.addEventListener( 'click', function () {
				renderSection( 'settings', { keepQuery: true } );
			} );
			actions.appendChild( settings );
			notice.appendChild( actions );
			wrap.appendChild( notice );
		}

		function renderGlobalSearch() {
			var query = String( state.query || '' ).trim();
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--search' } );
			wrap.appendChild( sectionHeader(
				'Search',
				query
					? 'Matches from every department, gathered into one tray.'
					: 'Search wallpapers, icon sets, cursors, widgets, and apps from one little command nest.',
				{ eyebrow: 'ODD · All Departments' }
			) );
			appendCatalogNotice( wrap, 'all' );

			var allRows = collectSearchRows();
			var matches = applyStoreControls( allRows, 'all' );
			wrap.appendChild( renderStoreControls( 'all', allRows, matches ) );

			if ( ! matches.length ) {
				wrap.appendChild( renderEmptyResults( 'No Shop results match "' + query + '" yet.' ) );
				return wrap;
			}

			var summary = el( 'div', { class: 'odd-shop__search-summary', role: 'status' } );
			summary.textContent = matches.length + ' result' + ( matches.length === 1 ? '' : 's' ) + ' for "' + query + '"';
			wrap.appendChild( summary );

			searchGroups().forEach( function ( group ) {
				var rows = matches.filter( function ( row ) { return row.type === group.type; } );
				if ( ! rows.length ) return;
				var shelf = el( 'section', { class: 'odd-shop__shelf odd-shop__shelf--search' } );
				var head = el( 'div', { class: 'odd-shop__shelf-head' } );
				var title = el( 'h3', { class: 'odd-shop__shelf-title' } );
				title.textContent = group.label;
				var count = el( 'span', { class: 'odd-shop__shelf-count' } );
				count.textContent = rows.length + ' ' + ( rows.length === 1 ? group.singular : group.plural );
				head.appendChild( title );
				head.appendChild( count );
				shelf.appendChild( head );

				var grid = el( 'div', { class: 'odd-shop__grid odd-shop__grid--search odd-shop__grid--' + group.type } );
				rows.forEach( function ( row ) {
					var card = renderSearchResultCard( row );
					if ( card ) grid.appendChild( card );
				} );
				shelf.appendChild( grid );
				wrap.appendChild( shelf );
			} );

			return wrap;
		}

		function searchGroups() {
			return [
				{ type: 'scene',    label: 'Wallpapers', singular: 'scene',    plural: 'scenes' },
				{ type: 'icon-set', label: 'Icon Sets',  singular: 'set',      plural: 'sets' },
				{ type: 'cursor-set', label: 'Cursors',  singular: 'set',      plural: 'sets' },
				{ type: 'widget',   label: 'Widgets',    singular: 'widget',   plural: 'widgets' },
				{ type: 'app',      label: 'Apps',       singular: 'app',      plural: 'apps' },
			];
		}

		function collectSearchRows() {
			var rows = [];
			searchGroups().forEach( function ( group ) {
				if ( state.searchScope === 'current' && DEPT_FOR_TYPE[ group.type ] !== state.active ) return;
				rows = rows.concat( shopRowsFor( group.type ) );
			} );
			return rows;
		}

		function renderSearchResultCard( row ) {
			var card = renderShopCard( row );
			if ( ! card ) return null;
			if ( row.type === 'icon-set' ) {
				var inner = card.querySelector( '.odd-shop__card' );
				if ( inner ) {
					inner.classList.add( 'odd-catalog-row--iconset' );
					inner.setAttribute( 'data-slug', row.slug );
				}
				card.classList.add( 'odd-catalog-row--iconset-wrap' );
			}
			if ( row.type === 'cursor-set' ) {
				var cursorInner = card.querySelector( '.odd-shop__card' );
				if ( cursorInner ) {
					cursorInner.classList.add( 'odd-catalog-row--cursorset' );
					cursorInner.setAttribute( 'data-slug', row.slug );
					cursorInner.setAttribute( 'data-cursor-set-slug', row.slug );
				}
				card.classList.add( 'odd-catalog-row--cursorset-wrap' );
			}
			if ( row.type === 'app' ) {
				card.classList.add( 'odd-card--app' );
				card.setAttribute( 'data-app-slug', row.slug );
			}
			return card;
		}

		/**
		 * Empty-state card shown at the top of a department when the
		 * user has zero bundles of that type installed. On a fresh
		 * site this is common — the starter pack is still downloading
		 * in the background, and the Discover shelf below renders
		 * remote catalog entries so the user can install manually or
		 * wait for the inline starter-pack installer to finish.
		 *
		 * @param {string} kind  Friendly plural ("scenes", "icon sets", etc.).
		 * @param {string} hint  Second-line microcopy.
		 * @param {string} glyph Emoji or unicode for the decorative badge.
		 * @return {HTMLElement}
		 */
		function renderEmptyDept( kind, hint, glyph ) {
			var wrap = el( 'div', { class: 'odd-shop__empty odd-shop__empty--dept' } );
			var icon = el( 'div', { class: 'odd-shop__empty-icon', 'aria-hidden': 'true' } );
			icon.textContent = glyph || '✨';
			var big  = el( 'div', { class: 'odd-shop__empty-title' } );
			big.textContent = 'No ' + kind + ' installed yet';
			var sub  = el( 'div', { class: 'odd-shop__empty-sub' } );
			sub.textContent = hint || 'Browse the Discover shelf below to add some.';
			wrap.appendChild( icon );
			wrap.appendChild( big );
			wrap.appendChild( sub );
			return wrap;
		}

		function activeFilterLabel() {
			return String( state.query || state.categoryFilter || '' ).trim();
		}

		function rowTypeLabel( type, plural ) {
			var map = {
				scene:      [ 'wallpaper', 'wallpapers' ],
				'icon-set': [ 'icon set', 'icon sets' ],
				'cursor-set': [ 'cursor set', 'cursor sets' ],
				widget:     [ 'widget', 'widgets' ],
				app:        [ 'app', 'apps' ],
				all:        [ 'item', 'items' ],
			};
			var pair = map[ type ] || map.all;
			return plural ? pair[ 1 ] : pair[ 0 ];
		}

		function rowTimestamp( row, mode ) {
			var raw = ( row && row.raw ) || {};
			var keys = mode === 'newest'
				? [ 'published_at', 'created_at', 'createdAt', 'date', 'installed_at', 'installed' ]
				: [ 'updated_at', 'updatedAt', 'modified_at', 'modified', 'last_updated', 'version_date', 'installed_at', 'installed' ];
			for ( var i = 0; i < keys.length; i++ ) {
				var value = raw[ keys[ i ] ];
				if ( value === undefined || value === null || value === false || value === true || value === '' ) continue;
				if ( typeof value === 'number' ) return value > 100000000000 ? value : value * 1000;
				var parsed = Date.parse( String( value ) );
				if ( ! Number.isNaN( parsed ) ) return parsed;
			}
			return 0;
		}

		function storeViewAllows( row ) {
			var view = state.storeView || 'all';
			if ( view === 'installed' ) return !! ( row && row.installed );
			if ( view === 'available' ) return !! ( row && ! row.installed );
			if ( view === 'updates' ) return !! ( row && row.updateAvailable );
			if ( view === 'active' ) return !! shopCardIsActive( row );
			return true;
		}

		function compareShopRows( a, b ) {
			var mode = state.sortMode || 'featured';
			if ( mode === 'az' ) return ( a.name || a.slug || '' ).localeCompare( b.name || b.slug || '' );
			if ( mode === 'newest' || mode === 'updated' ) {
				var at = rowTimestamp( a, mode );
				var bt = rowTimestamp( b, mode );
				if ( at !== bt ) return bt - at;
				return ( a.name || a.slug || '' ).localeCompare( b.name || b.slug || '' );
			}
			if ( !! a.updateAvailable !== !! b.updateAvailable ) return a.updateAvailable ? -1 : 1;
			if ( !! a.featured !== !! b.featured ) return a.featured ? -1 : 1;
			if ( !! a.installed !== !! b.installed ) return a.installed ? -1 : 1;
			return ( a.name || a.slug || '' ).localeCompare( b.name || b.slug || '' );
		}

		function applyStoreControls( rows, type ) {
			var list = filterByQuery( rows || [], state.query );
			list = list.filter( storeViewAllows );
			list.sort( compareShopRows );
			return list;
		}

		function storeCounts( rows ) {
			var counts = { total: 0, installed: 0, available: 0, updates: 0, active: 0 };
			( rows || [] ).forEach( function ( row ) {
				if ( ! row ) return;
				counts.total++;
				if ( row.installed ) counts.installed++;
				else counts.available++;
				if ( row.updateAvailable ) counts.updates++;
				if ( shopCardIsActive( row ) ) counts.active++;
			} );
			return counts;
		}

		function renderStoreControls( type, baseRows, shownRows ) {
			var counts = storeCounts( baseRows || [] );
			var shown = shownRows || applyStoreControls( baseRows || [], type );
			var wrap = el( 'div', {
				class: 'odd-shop__storebar',
				'data-odd-storebar': '1',
			} );
			var summary = el( 'div', { class: 'odd-shop__storebar-summary', role: 'status' } );
			var totalLabel = counts.total + ' ' + rowTypeLabel( type, counts.total !== 1 );
			var bits = [
				totalLabel,
				counts.installed + ' installed',
			];
			if ( counts.available ) bits.push( counts.available + ' available' );
			if ( counts.updates ) bits.push( counts.updates + ' update' + ( counts.updates === 1 ? '' : 's' ) );
			if ( counts.active ) bits.push( counts.active + ' active' );
			if ( shown.length !== counts.total ) bits.unshift( shown.length + ' showing' );
			var statusText = el( 'span', { class: 'odd-sr-only' } );
			statusText.textContent = bits.join( ' · ' );
			summary.appendChild( statusText );
			var metrics = el( 'div', { class: 'odd-shop__storebar-metrics', 'aria-hidden': 'true' } );
			function addMetric( value, label, kind ) {
				var metric = el( 'span', { class: 'odd-shop__storebar-metric odd-shop__storebar-metric--' + kind } );
				var number = el( 'b', { class: 'odd-shop__storebar-metric-value' } );
				number.textContent = String( value );
				var text = el( 'span', { class: 'odd-shop__storebar-metric-label' } );
				text.textContent = label;
				metric.appendChild( number );
				metric.appendChild( text );
				metrics.appendChild( metric );
			}
			if ( shown.length !== counts.total ) addMetric( shown.length, 'showing', 'showing' );
			addMetric( counts.total, rowTypeLabel( type, counts.total !== 1 ), 'total' );
			addMetric( counts.installed, 'installed', 'installed' );
			if ( counts.available ) addMetric( counts.available, 'available', 'available' );
			if ( counts.updates ) addMetric( counts.updates, counts.updates === 1 ? 'update' : 'updates', 'updates' );
			if ( counts.active ) addMetric( counts.active, 'active', 'active' );
			summary.appendChild( metrics );
			wrap.appendChild( summary );

			var controls = el( 'div', { class: 'odd-shop__storebar-controls' } );
			var views = el( 'div', {
				class: 'odd-shop__store-views',
				role: 'group',
				'aria-label': 'Filter items',
			} );
			STORE_VIEWS.forEach( function ( view ) {
				var btn = el( 'button', {
					type: 'button',
					class: 'odd-shop__store-view' + ( ( state.storeView || 'all' ) === view.id ? ' is-active' : '' ),
					'aria-pressed': ( state.storeView || 'all' ) === view.id ? 'true' : 'false',
					'data-odd-store-view': view.id,
				} );
				btn.textContent = view.label;
				btn.addEventListener( 'click', function () {
					state.storeView = view.id;
					renderSection( state.active, { keepQuery: true } );
				} );
				views.appendChild( btn );
			} );
			controls.appendChild( views );

			var sortLabel = el( 'label', { class: 'odd-shop__sort' } );
			var sortText = el( 'span' );
			sortText.textContent = 'Sort';
			var sort = el( 'select', { class: 'odd-shop__sort-select', 'data-odd-store-sort': '1' } );
			STORE_SORTS.forEach( function ( option ) {
				var opt = el( 'option', { value: option.id } );
				opt.textContent = option.label;
				if ( ( state.sortMode || 'featured' ) === option.id ) opt.selected = true;
				sort.appendChild( opt );
			} );
			sort.addEventListener( 'change', function () {
				state.sortMode = sort.value || 'featured';
				renderSection( state.active, { keepQuery: true } );
			} );
			sortLabel.appendChild( sortText );
			sortLabel.appendChild( sort );
			controls.appendChild( sortLabel );

			if ( state.query || state.categoryFilter || state.storeView !== 'all' || state.sortMode !== 'featured' ) {
				var clear = el( 'button', { type: 'button', class: 'odd-shop__clear-filters' } );
				clear.textContent = 'Clear';
				clear.addEventListener( 'click', function () {
					state.query = '';
					state.categoryFilter = '';
					state.storeView = 'all';
					state.sortMode = 'featured';
					searchInput.value = '';
					updateSearchToolState();
					renderSection( state.active, { keepQuery: true } );
				} );
				controls.appendChild( clear );
			}

			wrap.appendChild( controls );
			return wrap;
		}

		/**
		 * Client-side filter used by the top-bar search pill. Matches
		 * against label, slug, category, and any tag — everything the
		 * user can actually see on a card.
		 */
		function filterByQuery( items, query ) {
			var category = String( state.categoryFilter || '' ).toLowerCase().trim();
			if ( ! query && ! category ) return items;
			var q = String( query ).toLowerCase().trim();
			if ( ! q && ! category ) return items;
			return items.filter( function ( item ) {
				if ( ! item ) return false;
				if ( category ) {
					var itemCategory = String( item.category || ( item.raw && item.raw.category ) || '' ).toLowerCase();
					var tags = Array.isArray( item.tags ) ? item.tags : [];
					var tagMatch = tags.some( function ( tag ) {
						return String( tag || '' ).toLowerCase() === category;
					} );
					if ( itemCategory !== category && ! tagMatch ) return false;
				}
				if ( ! q ) return true;
				var hay = [
					item.label,
					item.name,
					item.slug,
					item.type,
					item.subtitle,
					item.category,
					item.description,
					item.version,
					item.raw && item.raw.label,
					item.raw && item.raw.name,
					item.raw && item.raw.type,
					item.raw && item.raw.description,
				].filter( Boolean ).join( ' ' ).toLowerCase();
				if ( hay.indexOf( q ) >= 0 ) return true;
				if ( Array.isArray( item.tags ) ) {
					for ( var i = 0; i < item.tags.length; i++ ) {
						if ( String( item.tags[ i ] || '' ).toLowerCase().indexOf( q ) >= 0 ) return true;
					}
				}
				return false;
			} );
		}

		/**
		 * Deterministic gradient for each category tile. Looks
		 * colorful + editorial without pulling in a palette library,
		 * and a string hash makes new categories pick a stable color
		 * without hand-tuning this list every time. Palette tables
		 * live inside the function so they survive the `var`-hoist
		 * ordering — `categoryGradient` gets called during initial
		 * render before sibling `var`-decl palettes would be assigned.
		 *
		 * Category names flow through it now (Skies / Wilds / Places / Forms /
		 * Playful / Crafted / Technical / Cool / Default), with fallbacks for
		 * any new catalog grouping.
		 */
		/**
		 * SVG artwork for each category tile. Each returns a compact
		 * <svg> string sized to the tile's 240×120 viewbox, positioned
		 * absolute by `.odd-shop__quilt-art`. Artwork is white-on-
		 * gradient at low-ish opacity so it reads as decoration behind
		 * the category name + count, and crops cleanly on either side
		 * via preserveAspectRatio="xMaxYMid slice".
		 *
		 * Unknown categories fall back to a concentric-dots default,
		 * so new categories always get *something* visual.
		 */
		function categoryArtwork( name ) {
			var SVG_OPEN = '<svg viewBox="0 0 240 120" xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMaxYMid slice" aria-hidden="true">';
			var SVG_CLOSE = '</svg>';
			var ART = {
				'Skies':
					'<circle cx="196" cy="32" r="22" fill="#fff" opacity=".55"/>' +
					'<circle cx="196" cy="32" r="13" fill="#fff" opacity=".55"/>' +
					'<ellipse cx="158" cy="58" rx="42" ry="12" fill="#fff" opacity=".55"/>' +
					'<ellipse cx="130" cy="48" rx="26" ry="8" fill="#fff" opacity=".38"/>',
				'Wilds':
					'<circle cx="210" cy="28" r="10" fill="#fff" opacity=".6"/>' +
					'<path d="M140 98 L172 44 L192 72 L212 38 L244 98 Z" fill="#fff" opacity=".58"/>' +
					'<path d="M108 98 L134 56 L150 82 L170 60 L198 98 Z" fill="#fff" opacity=".38"/>',
				'Places':
					'<circle cx="200" cy="28" r="8" fill="#fff" opacity=".7"/>' +
					'<rect x="138" y="60" width="22" height="42" fill="#fff" opacity=".5"/>' +
					'<rect x="164" y="40" width="18" height="62" fill="#fff" opacity=".72"/>' +
					'<rect x="186" y="52" width="24" height="50" fill="#fff" opacity=".48"/>' +
					'<rect x="214" y="66" width="20" height="36" fill="#fff" opacity=".4"/>',
				'Forms':
					'<circle cx="180" cy="52" r="34" fill="#fff" opacity=".34"/>' +
					'<rect x="150" y="46" width="48" height="48" rx="4" fill="#fff" opacity=".48" transform="rotate(12 174 70)"/>' +
					'<path d="M204 30 L236 92 L172 92 Z" fill="#fff" opacity=".58"/>',
				'Playful':
					'<path d="M194 20 L198 34 L212 34 L201 43 L206 58 L194 50 L182 58 L187 43 L176 34 L190 34 Z" fill="#fff" opacity=".75"/>' +
					'<circle cx="148" cy="40" r="4" fill="#fff" opacity=".75"/>' +
					'<circle cx="228" cy="58" r="5" fill="#fff" opacity=".7"/>' +
					'<rect x="166" y="70" width="9" height="9" fill="#fff" opacity=".55" transform="rotate(20 170 74)"/>' +
					'<rect x="214" y="88" width="7" height="7" fill="#fff" opacity=".65" transform="rotate(30 217 91)"/>' +
					'<path d="M134 86 L138 94 L146 90 L142 82 Z" fill="#fff" opacity=".55"/>',
				'Crafted':
					'<path d="M148 94 L192 22 L236 94 Z" fill="#fff" opacity=".6"/>' +
					'<path d="M192 22 L192 94 L148 94 Z" fill="#fff" opacity=".32"/>' +
					'<path d="M192 22 L236 94 L192 94 Z" fill="#000" opacity=".12"/>',
				'Technical':
					'<path d="M138 40 L170 40 L170 60 L200 60 L200 80 L234 80" stroke="#fff" stroke-width="2.5" fill="none" opacity=".7"/>' +
					'<path d="M138 80 L160 80 L160 64 L186 64 L186 44 L224 44" stroke="#fff" stroke-width="2.5" fill="none" opacity=".42"/>' +
					'<circle cx="170" cy="40" r="5" fill="#fff" opacity=".85"/>' +
					'<circle cx="200" cy="60" r="5" fill="#fff" opacity=".85"/>' +
					'<circle cx="186" cy="64" r="4" fill="#fff" opacity=".65"/>',
				'Cool':
					'<circle cx="200" cy="60" r="46" fill="none" stroke="#fff" stroke-width="2" opacity=".38"/>' +
					'<circle cx="200" cy="60" r="30" fill="none" stroke="#fff" stroke-width="2" opacity=".6"/>' +
					'<circle cx="200" cy="60" r="13" fill="#fff" opacity=".75"/>',
				'Generative':
					'<path d="M124 96 Q160 36 202 70 Q232 96 244 44" fill="none" stroke="#fff" stroke-width="2.5" opacity=".7"/>' +
					'<path d="M128 78 Q162 26 204 56 Q234 80 244 28" fill="none" stroke="#fff" stroke-width="2" opacity=".45"/>' +
					'<circle cx="202" cy="70" r="4" fill="#fff" opacity=".85"/>' +
					'<circle cx="168" cy="62" r="3" fill="#fff" opacity=".7"/>',
				'Atmosphere':
					'<path d="M110 32 Q150 16 190 32 T280 32" fill="none" stroke="#fff" stroke-width="3" opacity=".45"/>' +
					'<path d="M100 58 Q140 42 180 58 T270 58" fill="none" stroke="#fff" stroke-width="3" opacity=".65"/>' +
					'<path d="M110 84 Q150 68 190 84 T280 84" fill="none" stroke="#fff" stroke-width="3" opacity=".4"/>',
				'Paper':
					'<path d="M150 24 L222 24 L222 96 L150 96 Z" fill="#fff" opacity=".55"/>' +
					'<path d="M222 24 L222 96 L162 96 Z" fill="#000" opacity=".18"/>' +
					'<path d="M150 24 L222 24 L182 62 Z" fill="#fff" opacity=".7"/>',
				'ODD Originals':
					'<ellipse cx="196" cy="60" rx="42" ry="24" fill="#fff" opacity=".7"/>' +
					'<circle cx="196" cy="60" r="14" fill="#0c0a1d"/>' +
					'<circle cx="200" cy="56" r="4" fill="#fff"/>',
				'WP Desktop Mode':
					'<rect x="136" y="26" width="98" height="72" rx="6" fill="#fff" opacity=".5"/>' +
					'<rect x="136" y="26" width="98" height="14" rx="6" fill="#fff" opacity=".32"/>' +
					'<circle cx="146" cy="33" r="2.5" fill="#fff" opacity=".9"/>' +
					'<circle cx="154" cy="33" r="2.5" fill="#fff" opacity=".78"/>' +
					'<circle cx="162" cy="33" r="2.5" fill="#fff" opacity=".66"/>' +
					'<rect x="148" y="52" width="74" height="8" rx="2" fill="#fff" opacity=".3"/>' +
					'<rect x="148" y="66" width="52" height="8" rx="2" fill="#fff" opacity=".25"/>',
				'Default':
					'<circle cx="200" cy="60" r="38" fill="#fff" opacity=".35"/>' +
					'<circle cx="200" cy="60" r="22" fill="#fff" opacity=".55"/>' +
					'<circle cx="200" cy="60" r="8" fill="#fff" opacity=".85"/>',
			};
			var inner = ART[ name ];
			if ( ! inner ) {
				// Deterministic pick from a few "safe" fallbacks so new
				// categories still get a distinct illustration.
				var FALLBACKS = [ 'Cool', 'Forms', 'Generative', 'Default' ];
				var hash = 0;
				var key = String( name || '' );
				for ( var i = 0; i < key.length; i++ ) {
					hash = ( ( hash << 5 ) - hash + key.charCodeAt( i ) ) | 0;
				}
				inner = ART[ FALLBACKS[ Math.abs( hash ) % FALLBACKS.length ] ];
			}
			return SVG_OPEN + inner + SVG_CLOSE;
		}

		function categoryGradient( name ) {
			var PALETTE = {
				'Skies':            'linear-gradient(135deg,#1a4b8e 0%,#5dadec 60%,#a3d8f4 100%)',
				'Wilds':            'linear-gradient(135deg,#0f6b3a 0%,#2fa970 60%,#a8dca0 100%)',
				'Places':           'linear-gradient(135deg,#b94a3b 0%,#f08e5b 60%,#ffd9a8 100%)',
				'Forms':            'linear-gradient(135deg,#3a1a72 0%,#8a3fc8 60%,#e89cf0 100%)',
				'Playful':          'linear-gradient(135deg,#d6266d 0%,#ff7a3c 60%,#ffd56a 100%)',
				'Crafted':          'linear-gradient(135deg,#a04a18 0%,#e0964c 60%,#f4dca4 100%)',
				'Technical':        'linear-gradient(135deg,#0a3a4a 0%,#2596be 60%,#9ee0f0 100%)',
				'Cool':             'linear-gradient(135deg,#5d6470 0%,#9aa3b1 60%,#dde2ea 100%)',
				'Default':          'linear-gradient(135deg,#1d1d1f 0%,#4a4a52 60%,#9a9aa6 100%)',
				'Generative':       'linear-gradient(135deg,#b84df1 0%,#ff68b3 100%)',
				'Atmosphere':       'linear-gradient(135deg,#00b4db 0%,#2c9afe 100%)',
				'Paper':            'linear-gradient(135deg,#f6d365 0%,#fda085 100%)',
				'ODD Originals':    'linear-gradient(135deg,#0c0a1d 0%,#ff1c6a 100%)',
				'WP Desktop Mode':  'linear-gradient(135deg,#2c3e50 0%,#4ca1af 100%)',
			};
			var FALLBACK = [
				'linear-gradient(135deg,#8e2de2 0%,#4a00e0 100%)',
				'linear-gradient(135deg,#11998e 0%,#38ef7d 100%)',
				'linear-gradient(135deg,#fc5c7d 0%,#6a82fb 100%)',
				'linear-gradient(135deg,#f7971e 0%,#ffd200 100%)',
				'linear-gradient(135deg,#667eea 0%,#764ba2 100%)',
			];
			if ( PALETTE[ name ] ) return PALETTE[ name ];
			var hash = 0;
			var key = String( name || '' );
			for ( var i = 0; i < key.length; i++ ) {
				hash = ( ( hash << 5 ) - hash + key.charCodeAt( i ) ) | 0;
			}
			return FALLBACK[ Math.abs( hash ) % FALLBACK.length ];
		}

		/**
		 * Resolve an item to its display category. Each manifest
		 * declares a narrow `category` string (one per item, more
		 * or less); shelving by category produced one-row shelves
		 * everywhere. The slug → category tables below roll those
		 * up into broader buckets so each shelf has real siblings.
		 * Items that aren't curated yet fall back to their declared
		 * category so nothing disappears — they'll just appear on
		 * their own shelf at the bottom until the table catches up.
		 *
		 * Tables live inside the function so they survive `var`-
		 * hoist ordering: `categoryOf` is hoisted as a function
		 * declaration and gets called during initial render before
		 * any sibling `var` blocks have actually run their RHS.
		 */
		function categoryOf( item, kind ) {
			var SCENE_CATEGORY = {
				'flux':                'Forms',
				'origami':             'Forms',
				'terrazzo':            'Forms',
				'aurora':              'Skies',
				'rainfall':            'Skies',
				'big-sky':             'Skies',
				'cloud-city':          'Skies',
				'weather-factory':     'Skies',
				'circuit-garden':      'Wilds',
				'tropical-greenhouse': 'Wilds',
				'wildflower-meadow':   'Wilds',
				'tide-pool':           'Wilds',
				'abyssal-aquarium':    'Wilds',
				'sun-print':           'Wilds',
				'iris-observatory':    'Places',
				'pocket-dimension':    'Places',
				'balcony-noon':        'Places',
				'mercado':             'Places',
				'beach-umbrellas':     'Places',
			};
			var ICON_SET_CATEGORY = {
				'none':              'Default',
				'arcade-tokens':     'Playful',
				'lemonade-stand':    'Playful',
				'tiki':              'Playful',
				'stadium':           'Playful',
				'eyeball-avenue':    'Playful',
				'claymation':        'Crafted',
				'cross-stitch':      'Crafted',
				'botanical-plate':   'Crafted',
				'fold':              'Crafted',
				'risograph':         'Crafted',
				'blueprint':         'Technical',
				'circuit-bend':      'Technical',
				'hologram':          'Technical',
				'monoline':          'Technical',
				'filament':          'Technical',
				'arctic':            'Cool',
				'brutalist-stencil': 'Cool',
			};
			if ( ! item ) return 'More';
			var table = kind === 'icons' ? ICON_SET_CATEGORY : SCENE_CATEGORY;
			if ( item.slug && table[ item.slug ] ) return table[ item.slug ];
			return ( item.category && String( item.category ) ) || 'More';
		}

		/**
		 * Stable display order for the bucketed shelves. Listed in
		 * descending breadth so the densest categories surface
		 * first; uncategorized categories fall to the bottom.
		 */
		function compareCategoryNames( a, b ) {
			var CATEGORY_ORDER = [
				'Skies', 'Wilds', 'Places', 'Forms',
				'Default', 'Playful', 'Crafted', 'Technical', 'Cool',
			];
			var ai = CATEGORY_ORDER.indexOf( a );
			var bi = CATEGORY_ORDER.indexOf( b );
			if ( ai === -1 && bi === -1 ) return a.localeCompare( b );
			if ( ai === -1 ) return 1;
			if ( bi === -1 ) return -1;
			return ai - bi;
		}

		/**
		 * Category quilt — a 2-col grid of gradient category tiles
		 * that scroll the content pane to the matching shelf when
		 * clicked. Purely navigational; no state changes.
		 */
		function renderCategoryQuilt( items, scope ) {
			var kind = scope === 'icons' ? 'icons' : 'wallpaper';
			var counts = {};
			var seen = {};
			items.forEach( function ( it ) {
				var cat = categoryOf( it, kind );
				if ( ! cat ) return;
				if ( ! Object.prototype.hasOwnProperty.call( counts, cat ) ) {
					counts[ cat ] = 0;
					seen[ cat ] = true;
				}
				counts[ cat ]++;
			} );
			var order = Object.keys( seen ).sort( compareCategoryNames );
			var wrap = el( 'div', { class: 'odd-shop__quilt' } );
			var head = el( 'div', { class: 'odd-shop__shelf-head' } );
			var title = el( 'h3', { class: 'odd-shop__shelf-title' } );
			title.textContent = 'Browse by category';
			head.appendChild( title );
			wrap.appendChild( head );
			var grid = el( 'div', { class: 'odd-shop__quilt-grid' } );
			order.forEach( function ( category ) {
				var tile = el( 'button', {
					type: 'button',
					class: 'odd-shop__quilt-tile',
					style: 'background:' + categoryGradient( category ),
					'data-category-jump': category,
					'data-scope': scope,
				} );
				var art = el( 'span', {
					class: 'odd-shop__quilt-art',
					'aria-hidden': 'true',
				} );
				art.innerHTML = categoryArtwork( category );
				var name = el( 'span', { class: 'odd-shop__quilt-name' } );
				name.textContent = category;
				var count = el( 'span', { class: 'odd-shop__quilt-count' } );
				count.textContent = counts[ category ] + ( counts[ category ] === 1
					? ( scope === 'wallpaper' ? ' scene' : ' set' )
					: ( scope === 'wallpaper' ? ' scenes' : ' sets' ) );
				tile.appendChild( art );
				tile.appendChild( name );
				tile.appendChild( count );
				tile.addEventListener( 'click', function () {
					var target = content.querySelector( '[data-shelf-anchor="' + cssEscape( category ) + '"]' );
					if ( target && typeof target.scrollIntoView === 'function' ) {
						target.scrollIntoView( { behavior: 'smooth', block: 'start' } );
					}
				} );
				grid.appendChild( tile );
			} );
			wrap.appendChild( grid );
			return wrap;
		}

		// Narrow CSS.escape shim — jsdom doesn't have it and the
		// category strings we anchor by contain spaces + apostrophes.
		function cssEscape( s ) {
			return String( s ).replace( /[^a-zA-Z0-9_-]/g, function ( c ) {
				return '\\' + c.charCodeAt( 0 ).toString( 16 ) + ' ';
			} );
		}

		/**
		 * Group an array of items by their resolved category. Items
		 * without a slug-table entry collapse into their `category`
		 * (or `fallback`) so nothing disappears. Categories are then
		 * sorted by `CATEGORY_ORDER` so curated buckets come first
		 * and uncategorized stragglers fall to the bottom.
		 */
		function groupByCategory( items, kind, fallback ) {
			var order = [];
			var bag = {};
			items.forEach( function ( item ) {
				if ( ! item ) return;
				var c = categoryOf( item, kind ) || fallback || 'More';
				if ( ! Object.prototype.hasOwnProperty.call( bag, c ) ) {
					bag[ c ] = [];
					order.push( c );
				}
				bag[ c ].push( item );
			} );
			order.sort( compareCategoryNames );
			return order.map( function ( c ) {
				return { category: c, items: bag[ c ] };
			} );
		}

		/**
		 * Render a MAS-style shelf: category title + count anchor
		 * over a horizontally-scrolling row of cards built by
		 * `cardFn`. `opts.scope` ("wallpaper" | "icons") swaps the
		 * card track class so wallpapers get wide preview cards
		 * while icon sets get list rows that still wrap on
		 * narrow widths.
		 */
		/**
		 * Render a personal shelf ("Recents" / "Favorites") for the
		 * wallpaper department. Maps a slug list (from state.cfg) to
		 * full scene objects from `allScenes`, preserving the slug-
		 * list ordering so "Recents" reads newest-first and
		 * "Favorites" reads in insertion order. Returns null when
		 * the list resolves to zero scenes so the caller can skip a
		 * visually-empty shelf.
		 */
		function renderPersonalShelf( title, slugs, allScenes, scope ) {
			if ( ! Array.isArray( slugs ) || ! slugs.length ) return null;
			var bySlug = {};
			( allScenes || [] ).forEach( function ( s ) {
				if ( s && s.slug ) bySlug[ s.slug ] = s;
			} );
			var items = [];
			for ( var i = 0; i < slugs.length; i++ ) {
				if ( bySlug[ slugs[ i ] ] ) items.push( bySlug[ slugs[ i ] ] );
			}
			if ( ! items.length ) return null;
			return renderShelf( title, items, renderSceneCard, { scope: scope || 'wallpaper' } );
		}

		function appendShelfCards( track, items, cardFn ) {
			var frag = document.createDocumentFragment();
			( items || [] ).forEach( function ( item ) {
				var card = cardFn( item );
				if ( card ) frag.appendChild( card );
			} );
			track.appendChild( frag );
		}

		function deferShopWork( fn, delay ) {
			var done = false;
			function run() {
				if ( done ) return;
				done = true;
				fn();
			}
			if ( typeof delay === 'number' && delay > 0 && typeof window.setTimeout === 'function' ) {
				var timer = window.setTimeout( run, delay );
				addSectionCleanup( function () {
					done = true;
					window.clearTimeout( timer );
				} );
				return;
			}
			if ( typeof window.requestIdleCallback === 'function' ) {
				var idle = window.requestIdleCallback( run, { timeout: 180 } );
				addSectionCleanup( function () {
					done = true;
					if ( typeof window.cancelIdleCallback === 'function' ) window.cancelIdleCallback( idle );
				} );
				return;
			}
			if ( typeof window.requestAnimationFrame === 'function' ) {
				var raf = window.requestAnimationFrame( run );
				addSectionCleanup( function () {
					done = true;
					window.cancelAnimationFrame( raf );
				} );
				return;
			}
			var fallback = window.setTimeout( run, 0 );
			addSectionCleanup( function () {
				done = true;
				window.clearTimeout( fallback );
			} );
		}

		function renderShelf( category, items, cardFn, opts ) {
			opts = opts || {};
			var scope = opts.scope || 'wallpaper';
			var shelf = el( 'section', {
				class: 'odd-shop__shelf',
				'data-shelf-anchor': category,
			} );
			var head = el( 'div', { class: 'odd-shop__shelf-head' } );
			var title = el( 'h3', { class: 'odd-shop__shelf-title' } );
			title.textContent = category;
			var count = el( 'span', { class: 'odd-shop__shelf-count' } );
			var noun;
			if ( scope === 'wallpaper' ) {
				noun = items.length === 1 ? 'scene' : 'scenes';
			} else if ( scope === 'widgets' ) {
				noun = items.length === 1 ? 'widget' : 'widgets';
			} else {
				noun = items.length === 1 ? 'set' : 'sets';
			}
			count.textContent = items.length + ' ' + noun;
			head.appendChild( title );
			head.appendChild( count );
			shelf.appendChild( head );

			// Tiles layout for wallpapers + widgets (both have a big
			// visual preview panel); list rows for icon sets (which
			// want text-heavy metadata alongside their mini-grid).
			var trackClass = ( scope === 'wallpaper' || scope === 'widgets' )
				? 'odd-shop__shelf-track odd-shop__shelf-track--tiles'
				: 'odd-shop__shelf-track odd-shop__shelf-track--list';
			var track = el( 'div', { class: trackClass } );
			appendShelfCards( track, items, cardFn );

			// Wrap the track in a slider shell so we can overlay
			// prev/next pills. The native scroll still works for
			// touch, wheel, and keyboard — buttons are a convenience
			// layer that nudge by roughly-one-card-width on click.
			var slider = el( 'div', { class: 'odd-shop__slider' } );
			var prev = el( 'button', {
				type: 'button',
				class: 'odd-shop__slider-btn odd-shop__slider-btn--prev',
				'aria-label': 'Scroll ' + category + ' back',
			} );
			prev.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 4 L7 12 L15 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
			var next = el( 'button', {
				type: 'button',
				class: 'odd-shop__slider-btn odd-shop__slider-btn--next',
				'aria-label': 'Scroll ' + category + ' forward',
			} );
			next.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M9 4 L17 12 L9 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
			slider.appendChild( prev );
			slider.appendChild( track );
			slider.appendChild( next );
			shelf.appendChild( slider );

			// Scroll by roughly one card's worth of width, clamped so
			// a narrow pane still advances a meaningful distance.
			function step( dir ) {
				var amt = Math.max( 260, Math.round( track.clientWidth * 0.85 ) );
				if ( typeof track.scrollBy === 'function' ) {
					track.scrollBy( { left: dir * amt, behavior: 'smooth' } );
				} else {
					track.scrollLeft += dir * amt;
				}
			}
			prev.addEventListener( 'click', function () { step( -1 ); } );
			next.addEventListener( 'click', function () { step( 1 ); } );

			// Fade the buttons in/out depending on whether there's
			// content to scroll toward. Called on scroll, on resize,
			// and once after mount (images arriving later can change
			// scrollWidth). `is-overflowing` gates visibility entirely
			// so short shelves don't show buttons at all.
			function updateButtons() {
				var canPrev = track.scrollLeft > 2;
				var canNext = track.scrollLeft + track.clientWidth < track.scrollWidth - 2;
				slider.classList.toggle( 'is-start', ! canPrev );
				slider.classList.toggle( 'is-end', ! canNext );
				slider.classList.toggle( 'is-overflowing', track.scrollWidth > track.clientWidth + 2 );
			}
			track.addEventListener( 'scroll', updateButtons, { passive: true } );
			deferShopWork( updateButtons );
			deferShopWork( updateButtons, 400 );
			if ( typeof ResizeObserver !== 'undefined' ) {
				try {
					var ro = new ResizeObserver( updateButtons );
					ro.observe( track );
					addSectionCleanup( function () { try { ro.disconnect(); } catch ( _e2 ) {} } );
				} catch ( _e ) {}
			}

			return shelf;
		}

		// Thin adapter — every shelf that used to render a bespoke
		// scene card now routes through the unified shop card so the
		// tile visuals are identical with Icons / Widgets / Apps.
		// Kept as a named function so `renderShelf( ..., renderSceneCard, ... )`
		// call sites don't need to change.
		function renderSceneCard( scene ) {
			var row  = normaliseShopRow( scene, 'scene' );
			if ( ! row ) return el( 'div' );
			var wrap = renderShopCard( row );
			// Scene cards get one extra active-state flourish that the
			// generic renderer does not know about: Iris watches from the
			// currently active wallpaper tile.
			if ( wrap && row.installed ) decorateSceneCard( wrap, scene );
			return wrap;
		}

		function decorateSceneCard( wrap, scene ) {
			var card = wrap.querySelector( '.odd-shop__card' );
			if ( ! card ) return;
			var currentSlug = state.cfg.wallpaper || state.cfg.scene;
			var active = scene.slug === currentSlug;
			if ( active ) {
				var art = wrap.querySelector( '.odd-shop__card-art' );
				if ( art && ! art.querySelector( '.odd-shop__iris-sticker' ) ) {
					var iris = el( 'span', { class: 'odd-shop__iris-sticker', 'aria-hidden': 'true', title: 'Iris is watching' } );
					iris.innerHTML =
						'<svg viewBox="0 0 64 64" width="36" height="36" aria-hidden="true">'
							+ '<defs>'
								+ '<linearGradient id="oddIrisBg' + scene.slug + '" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">'
									+ '<stop offset="0%" stop-color="#ff4fa8"/>'
									+ '<stop offset="55%" stop-color="#9d6bff"/>'
									+ '<stop offset="100%" stop-color="#5a35d6"/>'
								+ '</linearGradient>'
								+ '<radialGradient id="oddIrisIris' + scene.slug + '" cx="42%" cy="38%" r="68%">'
									+ '<stop offset="0%" stop-color="#c6fbff"/>'
									+ '<stop offset="45%" stop-color="#70f5ff"/>'
									+ '<stop offset="100%" stop-color="#1e7ac9"/>'
								+ '</radialGradient>'
							+ '</defs>'
							+ '<rect x="0" y="0" width="64" height="64" rx="14" ry="14" fill="url(#oddIrisBg' + scene.slug + ')"/>'
							+ '<g class="odd-shop__iris-blinker">'
								+ '<circle cx="32" cy="32" r="20" fill="#fdfaf2" stroke="#130826" stroke-width="3"/>'
								+ '<circle cx="32" cy="32" r="13" fill="url(#oddIrisIris' + scene.slug + ')"/>'
								+ '<circle cx="32" cy="32" r="6" fill="#091425"/>'
								+ '<circle cx="29" cy="29" r="2.4" fill="#ffffff"/>'
							+ '</g>'
						+ '</svg>';
					art.appendChild( iris );
				}
			}
		}

		function isFavorite( slug ) {
			var list = Array.isArray( state.cfg.favorites ) ? state.cfg.favorites : [];
			for ( var i = 0; i < list.length; i++ ) {
				if ( list[ i ] === slug ) return true;
			}
			return false;
		}

		/**
		 * Toggle a slug in the user's favorites list and persist to
		 * REST. Mutates state.cfg.favorites optimistically so the
		 * next re-render reflects the change even before the POST
		 * settles; if REST returns an authoritative list we overwrite
		 * with that.
		 */
		function toggleFavorite( slug ) {
			var list = Array.isArray( state.cfg.favorites ) ? state.cfg.favorites.slice() : [];
			var idx = list.indexOf( slug );
			if ( idx >= 0 ) {
				list.splice( idx, 1 );
			} else {
				list.unshift( slug );
				if ( list.length > 50 ) list = list.slice( 0, 50 );
			}
			state.cfg.favorites = list;
			savePrefs( { favorites: list }, function ( data ) {
				if ( data && Array.isArray( data.favorites ) ) {
					state.cfg.favorites = data.favorites;
				}
				redecorateSceneGrid();
			} );
			redecorateSceneGrid();
		}

		function pickSceneLive( slug ) {
			if ( window.wp && window.wp.hooks && typeof window.wp.hooks.doAction === 'function' ) {
				try { window.wp.hooks.doAction( 'odd.pickScene', slug ); } catch ( e ) {}
			}
		}

		function redecorateSceneGrid() {
			var cards = content.querySelectorAll( '.odd-card[data-slug]' );
			var currentSlug = state.cfg.wallpaper || state.cfg.scene;
			for ( var i = 0; i < cards.length; i++ ) {
				var c = cards[ i ];
				var slug = c.getAttribute( 'data-slug' );
				c.classList.remove( 'is-active' );
				if ( slug === currentSlug ) c.classList.add( 'is-active' );
				var cardWrap = c.closest ? c.closest( '.odd-shop__card-wrap' ) : null;
				if ( cardWrap ) {
					cardWrap.classList.toggle( 'is-active', slug === currentSlug );
				}

				if ( cardWrap ) {
					var sceneRow = shopRowByTypeAndSlug( 'scene', slug );
					if ( sceneRow ) {
						syncShopCardElement( cardWrap, sceneRow, {
							isActive: slug === currentSlug,
						} );
					}
				}
				// Sync the favorite star's on-state so flipping a
				// favorite on one tile updates that tile without a
				// full re-render. The star lives as a *sibling* of
				// the card (nested interactive = axe violation), so
				// hop up to the tile-wrap to find it.
				var tileWrap = c.closest( '.odd-shop__tile-wrap' );
				var star = ( tileWrap || c ).querySelector( '.odd-shop__fav' );
				if ( star ) {
					var favOn = isFavorite( slug );
					var starName = ( c.querySelector( '.odd-shop__card-title' ) || {} ).textContent || slug;
					star.classList.toggle( 'is-on', favOn );
					star.setAttribute( 'aria-pressed', favOn ? 'true' : 'false' );
					star.setAttribute( 'aria-label', favOn ? 'Remove ' + starName + ' from favorites' : 'Add ' + starName + ' to favorites' );
					star.setAttribute( 'title', favOn ? 'Unfavorite' : 'Favorite' );
				}

				var thumb = c.querySelector( '.odd-shop__tile-thumb' );
				if ( thumb ) {
					var existingBadge = thumb.querySelector( '.odd-shop__tile-badge' );
					var shouldBadge   = slug === currentSlug;
					if ( shouldBadge && ! existingBadge ) {
						var b = document.createElement( 'span' );
						b.className = 'odd-shop__tile-badge';
						b.textContent = '✓ Active';
						thumb.appendChild( b );
					} else if ( ! shouldBadge && existingBadge ) {
						existingBadge.remove();
					}
				}
			}
		}

		function labelForInstalledRow( type, slug ) {
			if ( ! slug || slug === 'none' ) return 'Default';
			var rows;
			if ( type === 'scene' ) rows = state.cfg.scenes;
			else if ( type === 'icon-set' ) rows = state.cfg.iconSets;
			else if ( type === 'cursor-set' ) rows = state.cfg.cursorSets;
			else rows = [];
			rows = Array.isArray( rows ) ? rows : [];
			for ( var i = 0; i < rows.length; i++ ) {
				if ( rows[ i ] && rows[ i ].slug === slug ) {
					return rows[ i ].label || rows[ i ].name || slug;
				}
			}
			return slug || 'Default';
		}

		function showAppliedUndoToast( type, slug, originalSlug ) {
			var label = labelForInstalledRow( type, slug );
			var canUndo = originalSlug !== undefined && originalSlug !== null && originalSlug !== slug;
			var opts = { duration: canUndo ? 7600 : 4200 };
			if ( canUndo && ( type === 'scene' || type === 'cursor-set' || type === 'icon-set' ) ) {
				opts.actionLabel = 'Undo';
				opts.onAction = function () {
					if ( type === 'scene' ) applyScene( originalSlug || '' );
					else if ( type === 'icon-set' ) applyIconSet( originalSlug || '' );
					else if ( type === 'cursor-set' ) applyCursorSet( originalSlug || 'none' );
				};
			}
			showShopFlowToast( 'Applied ' + label + '.', opts );
		}

		function applyScene( slug ) {
			if ( state.posting ) return;
			state.posting = true;
			var originalSlug = state.cfg.wallpaper || state.cfg.scene;
			pickSceneLive( slug );
			savePrefs( { wallpaper: slug }, function ( data ) {
				state.posting = false;
				if ( data && typeof data.wallpaper === 'string' ) {
					state.cfg.wallpaper = data.wallpaper;
					state.cfg.scene    = data.wallpaper;
					pickSceneLive( data.wallpaper );
				}
				playShopSound( 'success' );
				redecorateSceneGrid();
				showAppliedUndoToast( 'scene', slug, originalSlug );
			} );
		}

		/* --- Icons section --- */

		function renderIcons() {
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--icons' } );
			wrap.appendChild( sectionHeader(
				'Icon Sets',
				'Dress Desktop Mode desktop shortcuts in a new costume while the rail and taskbar stay native.',
				{ eyebrow: 'ODD · Icon Couture' }
			) );
			appendCatalogNotice( wrap, 'icon-set' );

			var sets = Array.isArray( state.cfg.iconSets ) ? state.cfg.iconSets.slice() : [];
			var rows = shopRowsFor( 'icon-set' ).filter( function ( s ) {
				return s && s.slug && s.slug !== 'none';
			} );

			var filtered = applyStoreControls( rows, 'icon-set' );
			wrap.appendChild( renderStoreControls( 'icon-set', rows, filtered ) );

			if ( ! state.query ) {
				wrap.appendChild( renderCategoryQuilt( rows, 'icons' ) );
			}

			if ( ! filtered.length ) {
				if ( activeFilterLabel() ) {
					wrap.appendChild( renderEmptyResults( 'No icon costumes match "' + activeFilterLabel() + '" yet.' ) );
					return wrap;
				}
				wrap.appendChild( renderEmptyDept(
					'icon sets',
					'Install one from the catalog below and give Desktop Mode a fresh disguise.',
					'🎛️'
				) );
				return wrap;
			}

			var shelves = groupByCategory( filtered, 'icons', 'More' );
			shelves.forEach( function ( shelf ) {
				wrap.appendChild( renderShelf( shelf.category, shelf.items, renderIconSetCard, { scope: 'icons' } ) );
			} );

			return wrap;
		}

		// Icon-set card adapter — same unified tile as scenes, with an
		// extra `odd-catalog-row--iconset` marker so `redecorateIconGrid`
		// can still sync previously-built rows after Apply.
		function renderIconSetCard( set ) {
			var row = normaliseShopRow( set, 'icon-set' );
			if ( ! row ) return el( 'div' );
			var wrap = renderShopCard( row );
			if ( wrap ) {
				// Stable marker + data-slug on the inner card so the in-place
				// preview decorator finds its tiles after a selection changes.
				var inner = wrap.querySelector( '.odd-shop__card' );
				if ( inner ) {
					inner.classList.add( 'odd-catalog-row--iconset' );
					inner.setAttribute( 'data-slug', set.slug );
				}
				wrap.classList.add( 'odd-catalog-row--iconset-wrap' );
			}
			return wrap;
		}

		/* --- Cursors section --- */

		function renderCursors() {
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--cursors' } );
			wrap.appendChild( sectionHeader(
				'Cursors',
				'Keep the native pointer, then give it a living aura. Apply once and the effect follows you through Desktop Mode and classic wp-admin.',
				{ eyebrow: 'ODD · Cursor Effects' }
			) );
			appendCatalogNotice( wrap, 'cursor-set' );

			var rows = shopRowsFor( 'cursor-set' ).filter( function ( s ) { return s && s.slug && s.slug !== 'none'; } );
			var filtered = applyStoreControls( rows, 'cursor-set' );
			wrap.appendChild( renderStoreControls( 'cursor-set', rows, filtered ) );

			if ( state.cfg.cursorSet && state.cfg.cursorSet !== 'none' && ! state.query ) {
				var resetRow = el( 'div', { class: 'odd-shop__reset-row' } );
				var resetLeft = el( 'div', { class: 'odd-shop__reset-left' } );
				var resetIcon = el( 'span', { class: 'odd-shop__reset-icon', 'aria-hidden': 'true' } );
				resetIcon.textContent = '↺';
				var resetText = el( 'span', { class: 'odd-shop__reset-text' } );
				resetText.textContent = 'Want the native pointer without an aura?';
				resetLeft.appendChild( resetIcon );
				resetLeft.appendChild( resetText );
				var resetBtn = el( 'button', { type: 'button', class: 'odd-shop__reset-btn' } );
				resetBtn.textContent = 'Reset to default';
				resetBtn.addEventListener( 'click', function () { applyCursorSet( 'none' ); } );
				resetRow.appendChild( resetLeft );
				resetRow.appendChild( resetBtn );
				wrap.appendChild( resetRow );
			}

			if ( ! state.query ) {
				wrap.appendChild( renderCategoryQuilt( rows, 'cursors' ) );
			}

			if ( ! filtered.length ) {
				if ( activeFilterLabel() ) {
					wrap.appendChild( renderEmptyResults( 'No pointer personalities match "' + activeFilterLabel() + '" yet.' ) );
					return wrap;
				}
				wrap.appendChild( renderEmptyDept(
					'cursor sets',
					'Install one from the catalog below and teach the pointer a new strut.',
					'➹'
				) );
				return wrap;
			}

			var shelves = groupByCategory( filtered, 'cursors', 'More' );
			shelves.forEach( function ( shelf ) {
				wrap.appendChild( renderShelf( shelf.category, shelf.items, renderCursorSetCard, { scope: 'cursors' } ) );
			} );
			return wrap;
		}

		function renderCursorSetCard( set ) {
			var row = normaliseShopRow( set, 'cursor-set' );
			if ( ! row ) return el( 'div' );
			var wrap = renderShopCard( row );
			if ( wrap ) {
				var inner = wrap.querySelector( '.odd-shop__card' );
				if ( inner ) {
					inner.classList.add( 'odd-catalog-row--cursorset' );
					inner.setAttribute( 'data-slug', set.slug );
					inner.setAttribute( 'data-cursor-set-slug', set.slug );
				}
				wrap.classList.add( 'odd-catalog-row--cursorset-wrap' );
			}
			return wrap;
		}

		function cursorStylesheetUrl( slug ) {
			var base = ( state.cfg.restUrl || '' ).replace( /\/prefs\/?$/, '' ) + '/cursors/active.css';
			var version = encodeURIComponent( ( state.cfg.version || '0' ) + '-' + ( slug || 'none' ) + '-' + Date.now() );
			if ( ! slug || slug === 'none' ) return base + '?set=none&v=' + version;
			return base + '?set=' + encodeURIComponent( slug ) + '&v=' + version;
		}

		function setActiveCursorLink( slug ) {
			var href = cursorStylesheetUrl( slug );
			if ( slug === 'none' || slug === '' ) {
				state.cfg.cursorStylesheet = '';
			} else {
				state.cfg.cursorStylesheet = href;
			}
			syncWindowOddCursorState( slug, state.cfg.cursorStylesheet );
			var cursors = window.__odd && window.__odd.cursors;
			if ( cursors && typeof cursors.apply === 'function' && typeof cursors.clear === 'function' ) {
				if ( slug === 'none' || slug === '' ) cursors.clear();
				else cursors.apply( href, slug );
			} else {
				var link = document.getElementById( 'odd-cursors-css' ) || document.querySelector( 'link[href*="/odd/v1/cursors/active.css"]' );
				if ( slug === 'none' || slug === '' ) {
					if ( link && link.parentNode ) link.parentNode.removeChild( link );
				} else {
					if ( ! link ) {
						link = document.createElement( 'link' );
						link.id = 'odd-cursors-css';
						link.rel = 'stylesheet';
						document.head.appendChild( link );
					}
					link.setAttribute( 'href', href );
				}
			}
			if ( window.wp && window.wp.hooks && typeof window.wp.hooks.doAction === 'function' ) {
				try { window.wp.hooks.doAction( 'odd.cursorSet', slug, state.cfg.cursorStylesheet ); } catch ( e ) {}
			}
		}

		function redecorateCursorGrid() {
			var rows = content.querySelectorAll( '.odd-catalog-row--cursorset' );
			var currentSlug = state.cfg.cursorSet || '';
			for ( var i = 0; i < rows.length; i++ ) {
				var row = rows[ i ];
				var slug = row.getAttribute( 'data-slug' );
				var isActive = ( slug === 'none' && ! currentSlug ) || ( slug !== 'none' && slug === currentSlug );
				row.classList.toggle( 'is-active', !! isActive );
				var wrap = row.closest ? row.closest( '.odd-shop__card-wrap' ) : null;
				if ( wrap ) {
					wrap.classList.toggle( 'is-active', !! isActive );
				}
				if ( wrap ) {
					var cursorRow = shopRowByTypeAndSlug( 'cursor-set', slug );
					if ( cursorRow ) {
						syncShopCardElement( wrap, cursorRow, {
							isActive: isActive,
						} );
					}
				}
			}
		}

		function applyCursorSet( slug ) {
			if ( state.posting ) return;
			state.posting = true;
			var originalSlug = state.cfg.cursorSet || '';
			setActiveCursorLink( slug );
			savePrefs( { cursorSet: slug }, function ( data ) {
				state.posting = false;
				if ( data && typeof data.cursorSet === 'string' ) {
					state.cfg.cursorSet = data.cursorSet;
				} else {
					state.cfg.cursorSet = slug === 'none' ? '' : slug;
				}
				if ( data && typeof data.cursorStylesheet === 'string' ) {
					state.cfg.cursorStylesheet = data.cursorStylesheet;
				}
				syncWindowOddCursorState( state.cfg.cursorSet, state.cfg.cursorStylesheet );
				if ( window.__odd && window.__odd.cursors && typeof window.__odd.cursors.apply === 'function' ) {
					if ( state.cfg.cursorSet ) {
						window.__odd.cursors.apply( state.cfg.cursorStylesheet, state.cfg.cursorSet );
					} else if ( typeof window.__odd.cursors.clear === 'function' ) {
						window.__odd.cursors.clear();
					}
				}
				playShopSound( 'success' );
				redecorateCursorGrid();
				showAppliedUndoToast( 'cursor-set', slug, originalSlug );
			} );
		}

		function redecorateIconGrid() {
			var rows = content.querySelectorAll( '.odd-catalog-row--iconset' );
			var currentSlug = state.cfg.iconSet || '';
			for ( var i = 0; i < rows.length; i++ ) {
				var row = rows[ i ];
				var slug = row.getAttribute( 'data-slug' );
				var isActive     = ( slug === 'none' && ! currentSlug ) || ( slug !== 'none' && slug === currentSlug );
				row.classList.toggle( 'is-active',     !! isActive );
				var wrap = row.closest ? row.closest( '.odd-shop__card-wrap' ) : null;
				if ( wrap ) {
					wrap.classList.toggle( 'is-active',     !! isActive );
				}

				if ( wrap ) {
					var iconRow = shopRowByTypeAndSlug( 'icon-set', slug );
					if ( iconRow ) {
						syncShopCardElement( wrap, iconRow, {
							isActive: isActive,
						} );
					}
				}
			}
		}

		function applyIconSet( slug ) {
			if ( state.posting ) return;
			state.posting = true;
			var originalSlug = state.cfg.iconSet || '';

			savePrefs( { iconSet: slug }, function ( data ) {
				state.posting = false;
				if ( data && typeof data.iconSet === 'string' ) {
					state.cfg.iconSet = data.iconSet;
				}
				playShopSound( 'success' );
				redecorateIconGrid();
				showAppliedUndoToast( 'icon-set', slug, originalSlug );
				refreshDesktopModeMenu( 'icon-set.apply' );
			} );
		}

		/* --- Widgets section ---------------------------------------
		 *
		 * Widgets are small, self-contained cards that live in the
		 * right-side column (or anywhere the user drags them) on the
		 * desktop itself — not inside the ODD window. WP Desktop
		 * Mode persists enabled widget ids to localStorage and
		 * exposes `wp.desktop.widgetLayer.add(id)` / `.remove(id)` /
		 * `.getEnabledIds()` for programmatic wiring. Everything in
		 * this tab is a thin UI over those three calls plus the
		 * `desktop-mode.widget.added` / `.removed` hooks for the case
		 * where the user dismisses a widget from its own × button
		 * while the Shop is open.
		 */

		function enabledWidgetIds() {
			try {
				if ( window.wp && window.wp.desktop && window.wp.desktop.widgetLayer ) {
					var layer = window.wp.desktop.widgetLayer;
					if ( typeof layer.getEnabledIds === 'function' ) {
						return layer.getEnabledIds() || [];
					}
				}
			} catch ( e ) {}
			// Fallback — read the same localStorage key the desktop
			// layer writes to. Keeps the Shop functional even if the
			// desktop layer object is temporarily unavailable (e.g.
				// during boot races).
			try {
				var raw = window.localStorage.getItem( 'desktop-mode-widgets' );
				if ( ! raw ) return [];
				var parsed = JSON.parse( raw );
				return Array.isArray( parsed ) ? parsed.filter( function ( x ) { return typeof x === 'string'; } ) : [];
			} catch ( e2 ) { return []; }
		}

		function normalizeWidgetLayerId( id ) {
			if ( typeof id !== 'string' || id === '' ) {
				return id;
			}
			return id.indexOf( 'odd/' ) === 0 ? id : ( 'odd/' + id.replace( /^odd\/?/, '' ) );
		}

		function toggleWidget( id, shouldAdd ) {
			function notify( msg ) {
				try {
					if ( window.__odd && window.__odd.api && typeof window.__odd.api.toast === 'function' ) {
						window.__odd.api.toast( msg );
					}
				} catch ( e ) {}
			}
			if ( ! window.wp || ! window.wp.desktop || ! window.wp.desktop.widgetLayer ) {
				notify( 'Widgets need WP Desktop Mode 0.8+.' );
				return;
			}
			var layer = window.wp.desktop.widgetLayer;
			var wid = normalizeWidgetLayerId( id );
			try {
				if ( shouldAdd ) {
					if ( window.__odd && window.__odd.api && typeof window.__odd.api.mountWidget === 'function' ) {
						window.__odd.api.mountWidget( wid, { quiet: true } );
					} else if ( typeof layer.ensureMounted === 'function' ) {
						if ( layer.ensureMounted( wid ) && typeof layer.mountIfEnabled === 'function' ) {
							layer.mountIfEnabled( wid );
						}
					} else if ( typeof layer.add === 'function' ) {
						layer.add( wid );
					}
				} else if ( ! shouldAdd && typeof layer.remove === 'function' ) {
					layer.remove( wid );
				}
			} catch ( e ) {
				notify( 'Couldn\'t toggle that widget.' );
				return;
			}
			// The widgetLayer fires the `desktop-mode.widget.added` /
			// `.removed` hooks we're listening to below, but re-render
			// synchronously too so the Shop doesn't flicker with a
			// stale "Add" state while the hook propagates.
			if ( state.active === 'widgets' ) {
				renderSection( 'widgets', { keepQuery: true } );
			}
		}

		// Widget hooks are installed once per panel mount. Re-entering
		// the Widgets tab reuses the single subscription; teardown
		// isn't needed because a panel close re-runs the mount path.
		if ( ! state.widgetHooksInstalled ) {
			state.widgetHooksInstalled = true;
			try {
				if ( window.wp && window.wp.hooks ) {
					var widgetAddedHook = desktopHookName( 'WIDGET_ADDED', 'desktop-mode.widget.added' );
					var widgetRemovedHook = desktopHookName( 'WIDGET_REMOVED', 'desktop-mode.widget.removed' );
					state.widgetHookNames = [ widgetAddedHook, widgetRemovedHook ];
					window.wp.hooks.addAction( widgetAddedHook, 'odd.widgets', function () {
						if ( state.active === 'widgets' ) renderSection( 'widgets', { keepQuery: true } );
					} );
					window.wp.hooks.addAction( widgetRemovedHook, 'odd.widgets', function () {
						if ( state.active === 'widgets' ) renderSection( 'widgets', { keepQuery: true } );
					} );
				}
			} catch ( e ) {}
		}

		function renderWidgets() {
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--widgets' } );
			wrap.appendChild( sectionHeader(
				'Widgets',
				'Widgets appear on your desktop — drag one by its title bar to park it wherever you like.',
				{ eyebrow: 'ODD · Desktop Companions' }
			) );
			appendCatalogNotice( wrap, 'widget' );

			var allRows = shopRowsFor( 'widget' );
			var rows = applyStoreControls( allRows, 'widget' );
			wrap.appendChild( renderStoreControls( 'widget', allRows, rows ) );

			if ( ! rows.length ) {
				wrap.appendChild( renderEmptyDept(
					'widgets',
					state.query
						? 'Nothing matched "' + state.query + '".'
						: 'Install one from the catalog below, or drop a .wp widget bundle to add one.',
					'🧷'
				) );
				return wrap;
			}

			var grid = el( 'div', { class: 'odd-shop__grid odd-shop__grid--widgets' } );
			rows.forEach( function ( row ) {
				var card = renderShopCard( row );
				if ( card ) grid.appendChild( card );
			} );
			wrap.appendChild( grid );

			if ( ! state.query ) {
				var tip = el( 'div', { class: 'odd-shop__tip' } );
				var tipIcon = el( 'span', { class: 'odd-shop__tip-icon', 'aria-hidden': 'true' } );
				tipIcon.textContent = '💡';
				var tipText = el( 'span', { class: 'odd-shop__tip-text' } );
				tipText.textContent = 'Added widgets land on the desktop — grab the title bar and park them wherever your dashboard wants them.';
				tip.appendChild( tipIcon );
				tip.appendChild( tipText );
				wrap.appendChild( tip );
			}

			return wrap;
		}

		/* --- About section ---------------------------------------
		 *
		 * This is the one place in the panel that breaks the admin-style
		 * discipline of every other tab. Everything else is a macOS-ish
		 * two-pane; this is a self-indulgent title card. The big ODD
		 * wordmark also doubles as a chaos button: clicking it fires
		 * a random scene commit — same live-swap + REST write the
		 * wallpaper grid's Keep button uses — so it's a "real"
		 * affordance and not a decorative div.
		 */

		function renderAbout() {
			var cfg = state.cfg;

			// Pull accent colors from installed icon sets so the About
			// palette ties into whatever set is currently loaded. Fall
			// back to a neon rainbow if no manifests are readable.
			var accents = [];
			if ( Array.isArray( cfg.iconSets ) ) {
				cfg.iconSets.forEach( function ( s ) {
					if ( s && typeof s.accent === 'string' && /^#[0-9a-f]{3,8}$/i.test( s.accent ) ) {
						accents.push( s.accent );
					}
				} );
			}
			if ( accents.length < 3 ) {
				accents = [ '#ff3d9a', '#ffd23f', '#00d1b2', '#6a5cff', '#ff6d00' ];
			}

			var wrap = el( 'div', { class: 'odd-about', 'data-odd-about': '1' } );

			/* hero */
			var hero = el( 'div', { class: 'odd-about__hero' } );

			var word = el( 'button', {
				type:        'button',
				class:       'odd-about__word',
				'aria-label':'ODD — tap for chaos',
				title:       'tap for chaos',
			} );
			[ 'O', 'D', 'D' ].forEach( function ( letter, i ) {
				var a1 = accents[ i % accents.length ];
				var a2 = accents[ ( i + 1 ) % accents.length ];
				var sp = el( 'span', {
					class: 'odd-about__letter',
					style: '--odd-accent:' + a1 + ';--odd-accent2:' + a2 + ';animation-delay:' + ( i * -0.4 ) + 's',
				} );
				sp.textContent = letter;
				word.appendChild( sp );
			} );
			word.addEventListener( 'click', function () {
				// Random scene swap — direct apply.
				// Fires through the same live-swap + REST path the
				// wallpaper grid uses, so the
				// active card elsewhere stays in sync.
				if ( state.posting ) return;
				var scenes = Array.isArray( cfg.scenes ) ? cfg.scenes : [];
				var current = cfg.wallpaper || cfg.scene;
				var choices = scenes.filter( function ( s ) { return s && s.slug && s.slug !== current; } );
				if ( choices.length ) {
					var next = choices[ Math.floor( Math.random() * choices.length ) ];
					state.posting = true;
					pickSceneLive( next.slug );
					savePrefs( { wallpaper: next.slug }, function ( data ) {
						state.posting = false;
						if ( data && typeof data.wallpaper === 'string' ) {
							state.cfg.wallpaper = data.wallpaper;
							state.cfg.scene    = data.wallpaper;
							cfg.wallpaper      = data.wallpaper;
							cfg.scene          = data.wallpaper;
						}
					} );
				}
				word.classList.remove( 'is-whee' );
				// Force reflow so the animation restarts even on
				// back-to-back clicks.
				void word.offsetWidth;
				word.classList.add( 'is-whee' );
			} );
			hero.appendChild( word );

			var byline = el( 'div', { class: 'odd-about__byline' } );
			byline.textContent = 'Outlandish Desktop Decorator';
			hero.appendChild( byline );

			var taglines = [
				'Generative wallpapers. Unserious icons. Apps that just run.',
				'A plugin that decorates your WordPress like nothing matters.',
				'Pixi on the canvas. Personality in the icons. Perils in the apps.',
				'The only WordPress plugin with a chaos cast and a shuffle timer.',
				'Server-canonical icons. Client-chaotic everything else.',
				'Built on WP Desktop Mode. Decorated beyond recognition.',
				'Every scene is a vibe. Every vibe has a ticker.',
				'Outlandish by default. Opinionated by necessity.',
				'Your admin panel called. It wants its dignity back.',
			];
			var tag = el( 'p', { class: 'odd-about__tag' } );
			var tagIdx = Math.floor( Math.random() * taglines.length );
			tag.textContent = taglines[ tagIdx ];
			hero.appendChild( tag );

			// Rotate tagline every ~5s with a soft crossfade. Self-clears
			// the interval as soon as the node leaves the DOM (which
			// happens on section swap because renderSection clobbers
			// `content.innerHTML`).
			var tagTimer = setInterval( function () {
				if ( ! document.contains( tag ) ) {
					clearInterval( tagTimer );
					return;
				}
				tagIdx = ( tagIdx + 1 ) % taglines.length;
				tag.style.opacity = '0';
				setTimeout( function () {
					if ( ! document.contains( tag ) ) return;
					tag.textContent = taglines[ tagIdx ];
					tag.style.opacity = '1';
				}, 260 );
			}, 5200 );

			wrap.appendChild( hero );

			/* stats */
			var stats = el( 'div', { class: 'odd-about__stats' } );
			var items = [
				{ k: 'Version',   v: cfg.version || '—' },
				{ k: 'Scenes',    v: Array.isArray( cfg.scenes )   ? cfg.scenes.length   : 0 },
				{ k: 'Icon sets', v: Array.isArray( cfg.iconSets ) ? cfg.iconSets.length : 0 },
			];
			if ( cfg.appsEnabled ) {
				items.push( { k: 'Apps', v: Array.isArray( cfg.apps ) ? cfg.apps.length : 0 } );
			}
			items.forEach( function ( it, i ) {
				var tint = accents[ i % accents.length ];
				var card = el( 'div', {
					class: 'odd-about__stat',
					style: '--odd-tint:' + tint,
				} );
				var v = el( 'div', { class: 'odd-about__stat-v' } );
				v.textContent = String( it.v );
				var k = el( 'div', { class: 'odd-about__stat-k' } );
				k.textContent = it.k;
				card.appendChild( v );
				card.appendChild( k );
				stats.appendChild( card );
			} );
			wrap.appendChild( stats );

			/* foot */
			var foot = el( 'div', { class: 'odd-about__foot' } );
			var link = el( 'a', {
				href:   'https://github.com/RegionallyFamous/odd',
				target: '_blank',
				rel:    'noopener noreferrer',
				class:  'odd-about__link',
			} );
			link.innerHTML = '<span aria-hidden="true">★</span> github.com/RegionallyFamous/odd';
			foot.appendChild( link );

			var credit = el( 'p', { class: 'odd-about__credit' } );
			credit.textContent = 'Painted backdrops, scripted motion, mini apps that mind their business. Built on WP Desktop Mode. Use responsibly. Or don\'t.';
			foot.appendChild( credit );

			// Diagnostics: bundle environment + recent log entries into
			// the clipboard for bug reports. Zero server-side telemetry;
			// the entire payload is assembled on this machine and only
			// leaves the browser when the user pastes it somewhere.
			var diagRow = el( 'div', { class: 'odd-about__diag' } );
			var diagBtn = el( 'button', {
				type: 'button',
				class: 'odd-apps-btn odd-apps-btn--pill',
				'data-odd-copy-diagnostics': '1',
			} );
			diagBtn.textContent = 'Copy diagnostics';
			diagBtn.addEventListener( 'click', function () {
				var d = window.__odd && window.__odd.diagnostics;
				if ( ! d || typeof d.copy !== 'function' ) {
					diagBtn.textContent = 'Diagnostics unavailable';
					return;
				}
				diagBtn.disabled = true;
				d.copy().then( function ( ok ) {
					diagBtn.textContent = ok ? 'Copied — paste into GitHub' : 'Copy failed';
					setTimeout( function () {
						diagBtn.disabled = false;
						diagBtn.textContent = 'Copy diagnostics';
					}, 2400 );
				} );
			} );
			diagRow.appendChild( diagBtn );

			var diagHint = el( 'p', { class: 'odd-about__diag-hint' } );
			diagHint.textContent = 'Assembles ODD version, environment, recent errors, and registry counts into the clipboard. Nothing is sent anywhere — paste it into an issue if something\'s broken.';
			diagRow.appendChild( diagHint );
			foot.appendChild( diagRow );

			wrap.appendChild( foot );

			return wrap;
		}

		/* --- shared helpers --- */

		function sectionHeader( title, sub, opts ) {
			opts = opts || {};
			var h = el( 'header', { class: 'odd-section-header odd-shop__dept-header' } );
			if ( opts.eyebrow ) {
				var eb = el( 'div', { class: 'odd-shop__dept-eyebrow' } );
				eb.textContent = opts.eyebrow;
				h.appendChild( eb );
			}
			var hh = el( 'h2' );
			hh.textContent = title;
			var p = el( 'p' );
			p.textContent = sub;
			h.appendChild( hh );
			h.appendChild( p );
			return h;
		}

		/* --- Unified shop card ---------------------------------- */

		// Normalises a row from any of the four installed-registry
		// shapes (`scenes` / `iconSets` / `installedWidgets` / apps)
		// or from a not-installed `bundleCatalog` entry into the
		// common shape `renderShopCard` consumes. Keeps the card
		// renderer free of per-type branching beyond the preview art.
		function shopCardSubtitle( raw, type ) {
			if ( type === 'scene' ) {
				return ( categoryOf( raw, 'wallpaper' ) || raw.category || 'Scene' ) + ' · Scene';
			}
			if ( type === 'icon-set' ) {
				return ( raw.category || 'Icon set' ) + ' · Icon set';
			}
			if ( type === 'cursor-set' ) {
				return ( raw.category || 'Cursor set' ) + ' · Cursor set';
			}
			if ( type === 'widget' ) {
				return ( raw.category || 'Widget' ) + ' · Widget';
			}
			if ( type === 'app' ) {
				return ( raw.category || 'Little tools' ) + ' · App';
			}
			return '';
		}

		function normaliseShopRow( raw, type ) {
			if ( ! raw ) return null;
			var slug = raw.slug || ( raw.id ? String( raw.id ).replace( /^odd\//, '' ) : '' );
			if ( ! slug ) return null;
				var cacheKey = [
					type,
					slug,
					raw.label || raw.name || '',
					raw.category || '',
					raw.description || '',
					raw.version || '',
					raw.installed === undefined ? 'u' : ( raw.installed ? '1' : '0' ),
					raw.enabled === false ? '0' : '1',
					raw.state || '',
					raw.status || '',
					raw.updateAvailable || raw.update_available ? 'u' : '',
					raw.requiresReload ? 'r' : '',
					raw.surfaces && typeof raw.surfaces === 'object' ? JSON.stringify( raw.surfaces ) : '',
					raw.card_url || raw.cardUrl || '',
				raw.icon_url || raw.iconUrl || raw.icon || '',
				raw.previewUrl || raw.preview_url || raw.preview || '',
				raw.download_url || raw.downloadUrl || '',
				raw.sha256 || '',
				raw.size || '',
				raw.icons && typeof raw.icons === 'object' ? JSON.stringify( raw.icons ) : '',
				raw.cursors && typeof raw.cursors === 'object' ? JSON.stringify( raw.cursors ) : '',
				raw.effects && typeof raw.effects === 'object' ? JSON.stringify( raw.effects ) : '',
			].join( '|' );
			if ( shopRowCache[ cacheKey ] ) {
				diagCount( 'panel.normalise.cacheHit' );
				return Object.assign( {}, shopRowCache[ cacheKey ], { raw: raw } );
			}
			var name = raw.label || raw.name || slug;
			var subtitle = shopCardSubtitle( raw, type );

			var row = {
				slug:          slug,
				type:          type,
				name:          name,
				subtitle:      subtitle,
				description:   raw.description || '',
				version:       raw.version || '',
				category:     raw.category || '',
				tags:          Array.isArray( raw.tags ) ? raw.tags : [],
				previewUrl:    normaliseCatalogAssetUrl( raw.previewUrl || raw.preview_url || raw.preview || '', type, slug ),
				wallpaperUrl:  normaliseCatalogAssetUrl( raw.wallpaperUrl || raw.wallpaper_url || raw.wallpaper || '', type, slug ),
				iconUrl:       normaliseCatalogAssetUrl( raw.icon_url || raw.iconUrl || raw.icon || '', type, slug ),
				cardUrl:       normaliseCatalogAssetUrl( raw.card_url || raw.cardUrl || '', type, slug ),
				downloadUrl:   raw.download_url || raw.downloadUrl || '',
				sha256:        raw.sha256 || '',
				size:          raw.size || 0,
				icons:         raw.icons && typeof raw.icons === 'object' ? raw.icons : null,
				cursors:       raw.cursors && typeof raw.cursors === 'object' ? raw.cursors : null,
				effects:       raw.effects && typeof raw.effects === 'object' ? raw.effects : null,
				preview:       raw.preview || '',
				accent:        raw.accent || '',
				fallbackColor: raw.fallbackColor || '',
				featured:      !! raw.featured,
				builtin:       !! raw.builtin,
				broken:        !! raw.broken || raw.state === 'broken' || raw.status === 'broken',
				incompatible:  !! raw.incompatible || raw.state === 'incompatible' || raw.status === 'incompatible',
				incompatibilityReason: raw.incompatibility_reason || raw.incompatibilityReason || '',
					updateAvailable: !! raw.updateAvailable || !! raw.update_available || raw.state === 'updateAvailable',
					requiresReload: !! raw.requiresReload,
					installed:     raw.installed === undefined ? true : !! raw.installed,
					enabled:       raw.enabled !== false,
					surfaces:      raw.surfaces && typeof raw.surfaces === 'object' ? Object.assign( {}, raw.surfaces ) : null,
					raw:           raw,
				};
			shopRowCache[ cacheKey ] = Object.assign( {}, row, { raw: null } );
			return row;
		}

		// Return the list of installed rows for a type, normalised to
		// the unified row shape. Apps come from `state.cfg.apps` (the
		// extension-registry snapshot); the REST /apps list powers installed app
		// management, but the unified grid does not need it here.
		function installedRowsFor( type ) {
			var cfg = state.cfg || {};
			var src;
			if ( type === 'scene' ) {
				src = Array.isArray( cfg.scenes ) ? cfg.scenes : [];
				src = src.filter( function ( s ) { return s && s.slug && s.slug !== 'odd-pending'; } );
			} else if ( type === 'icon-set' ) {
				src = Array.isArray( cfg.iconSets ) ? cfg.iconSets : [];
				src = src.filter( function ( s ) { return s && s.slug && s.slug !== 'none'; } );
			} else if ( type === 'cursor-set' ) {
				src = Array.isArray( cfg.cursorSets ) ? cfg.cursorSets : [];
				src = src.filter( function ( s ) { return s && s.slug && s.slug !== 'none'; } );
			} else if ( type === 'widget' ) {
				src = Array.isArray( cfg.installedWidgets ) ? cfg.installedWidgets : [];
			} else if ( type === 'app' ) {
				src = Array.isArray( cfg.apps ) ? cfg.apps : [];
			} else {
				src = [];
			}
			var out = [];
			for ( var i = 0; i < src.length; i++ ) {
				var row = normaliseShopRow( src[ i ], type );
				if ( row ) { row.installed = true; out.push( row ); }
			}
			return out;
		}

		function catalogRowsFor( type ) {
			var catalog = ( state.cfg && state.cfg.bundleCatalog ) || {};
			var key = catalogKeyForType( type );
			var src = Array.isArray( catalog[ key ] ) ? catalog[ key ] : [];
			var out = [];
			for ( var i = 0; i < src.length; i++ ) {
				var row = normaliseShopRow( src[ i ], type );
				if ( row ) { row.installed = !! src[ i ].installed; out.push( row ); }
			}
			return out;
		}

		// Merge installed + catalog rows into one list keyed by slug.
		// When both lists name the same slug, the installed row wins
		// (enabled state, version from disk, REST snapshot) — but catalog
		// carries the storefront artwork URLs (`icon_url`, scene previews,
		// icon-set grids). Those MUST layer in when the thin installed
		// row lacks them — otherwise widgets lose their thumbnails, apps lose
		// catalogue icons, and icon-set grid data never appears.
		// Preserve a stable shelf order: installed alphabetical, then
		// not-installed alphabetical. Active state is rendered in-place
		// so applying a row never makes the target jump to the front.
		function mergeCatalogOntoInstalled( ins, cat ) {
			if ( ! ins || ! cat ) return;
			function isEmptyIcons( obj ) {
				return ! obj || typeof obj !== 'object' || ! Object.keys( obj ).length;
			}
			function isEmptyTags( arr ) {
				return ! arr || ! Array.isArray( arr ) || ! arr.length;
			}
			function takeIfEmpty( prop ) {
				var cv = cat[ prop ];
				if ( cv === undefined || cv === null || cv === '' ) return;
				if ( ins[ prop ] === undefined || ins[ prop ] === null || ins[ prop ] === '' ) ins[ prop ] = cv;
			}
			takeIfEmpty( 'iconUrl' );
			takeIfEmpty( 'cardUrl' );
			takeIfEmpty( 'previewUrl' );
			takeIfEmpty( 'wallpaperUrl' );
			takeIfEmpty( 'preview' );
			takeIfEmpty( 'downloadUrl' );
			takeIfEmpty( 'sha256' );
			takeIfEmpty( 'size' );
			takeIfEmpty( 'category' );
			takeIfEmpty( 'accent' );
			takeIfEmpty( 'fallbackColor' );
			takeIfEmpty( 'version' );
			if ( cat.tags && Array.isArray( cat.tags ) && cat.tags.length && isEmptyTags( ins.tags ) ) {
				ins.tags = cat.tags.slice();
			}
			if ( cat.icons && typeof cat.icons === 'object' && ! isEmptyIcons( cat.icons ) && isEmptyIcons( ins.icons ) ) {
				ins.icons = cat.icons;
			}
			if ( cat.cursors && typeof cat.cursors === 'object' && ! isEmptyIcons( cat.cursors ) && isEmptyIcons( ins.cursors ) ) {
				ins.cursors = cat.cursors;
			}
			if ( cat.effects && typeof cat.effects === 'object' && ! isEmptyIcons( cat.effects ) && isEmptyIcons( ins.effects ) ) {
				ins.effects = cat.effects;
			}
			if ( cat.description && ! ins.description ) ins.description = cat.description;
			if ( cat.updateAvailable || cat.update_available || cat.state === 'updateAvailable' ) {
				ins.updateAvailable = true;
			}

			// Refresh subline copy when category arrives from catalog.
			ins.subtitle = shopCardSubtitle( ins, ins.type );
		}

		function shopRowsFor( type ) {
			var installed = installedRowsFor( type );
			var catalog   = catalogRowsFor( type );
			var bySlug    = {};
			for ( var i = 0; i < installed.length; i++ ) {
				bySlug[ installed[ i ].slug ] = installed[ i ];
			}
			for ( var j = 0; j < catalog.length; j++ ) {
				var row = catalog[ j ];
				if ( bySlug[ row.slug ] ) {
					if ( row.description && ! bySlug[ row.slug ].description ) {
						bySlug[ row.slug ].description = row.description;
					}
					if ( row.featured ) bySlug[ row.slug ].featured = true;
					mergeCatalogOntoInstalled( bySlug[ row.slug ], row );
					continue;
				}
				bySlug[ row.slug ] = row;
			}
			var list = [];
			for ( var k in bySlug ) {
				if ( Object.prototype.hasOwnProperty.call( bySlug, k ) ) list.push( bySlug[ k ] );
			}
			list.sort( function ( a, b ) {
				if ( a.installed !== b.installed ) return a.installed ? -1 : 1;
				return ( a.name || '' ).localeCompare( b.name || '' );
			} );
			return list;
		}

		function shopCardIsActive( row ) {
			if ( ! row || ! row.installed ) return false;
			if ( row.type === 'scene' ) {
				var current = state.cfg.wallpaper || state.cfg.scene;
				return row.slug === current;
			}
			if ( row.type === 'icon-set' ) {
				return row.slug === ( state.cfg.iconSet || '' );
			}
			if ( row.type === 'cursor-set' ) {
				return row.slug === ( state.cfg.cursorSet || '' );
			}
			if ( row.type === 'widget' ) {
				try {
					var ids = enabledWidgetIds();
					for ( var i = 0; i < ids.length; i++ ) {
						if ( ids[ i ] === ( 'odd/' + row.slug ) || ids[ i ] === row.slug ) return true;
					}
				} catch ( e ) {}
				return false;
			}
			// Apps don't have a single-active state — the plan keeps
			// the button clickable as `Open` forever.
			return false;
		}

		function shopCardState( row, opts ) {
			opts = opts || {};
			var hasActive = Object.prototype.hasOwnProperty.call( opts, 'isActive' );
			var isActive = hasActive ? !! opts.isActive : shopCardIsActive( row );
			var flow = window.__odd && window.__odd.shopFlow;
			if ( ! flow || typeof flow.cardState !== 'function' ) {
				throw new Error( 'ODD Shop flow helper did not load before the panel.' );
			}
			return flow.cardState( row, {
				isActive: isActive,
				isInstalling: isShopInstalling( row ),
				installMode: shopInstallMode( row ),
				progress: actionProgressCopy( shopInstallMode( row ) ),
				pendingReload: state.pendingAdminReload,
				t: __,
			} );
		}

		// Primary action label + kind derived from state. The kind is
		// routed through `dispatchShopAction` below; the label is what
		// the user actually sees on the tile's pill button.
		function shopCardAction( row ) {
			return shopCardState( row ).action;
		}

		function shopRowByTypeAndSlug( type, slug ) {
			if ( ! type || ! slug ) return null;
			var rows = shopRowsFor( type );
			for ( var i = 0; i < rows.length; i++ ) {
				if ( rows[ i ] && rows[ i ].slug === slug ) return rows[ i ];
			}
			return null;
		}

		function paintShopButtonState( btn, row, cardState ) {
			if ( ! btn || ! row || ! cardState || ! cardState.action ) return;
			var action = cardState.action;
			var kind = action.kind;
			btn.className = 'odd-shop__card-btn odd-shop__tile-btn odd-shop__card-btn--' + kind
				+ ( action.disabled ? ' is-disabled' : ' odd-shop__tile-btn--primary' )
				+ ( kind === 'install' ? ' odd-shop__card-btn--install' : '' );
			btn.setAttribute( 'data-odd-card-action', kind );
			btn.setAttribute( 'aria-label', action.label + ' ' + row.name + ' - ' + cardState.statusLabel );
			btn.setAttribute( 'data-odd-cursor', action.disabled ? 'not-allowed' : 'pointer' );
			btn.disabled = !! action.disabled;
			if ( action.disabled ) {
				btn.setAttribute( 'aria-disabled', 'true' );
			} else {
				btn.removeAttribute( 'aria-disabled' );
			}
			btn.removeAttribute( 'aria-busy' );
			btn.textContent = '';
			if ( action.progress ) {
				btn.appendChild( el( 'span', { class: 'odd-shop__btn-spinner', 'aria-hidden': 'true' } ) );
				var label = el( 'span', { class: 'odd-shop__btn-label' } );
				label.textContent = action.label;
				btn.appendChild( label );
				btn.setAttribute( 'aria-busy', 'true' );
			} else {
				btn.textContent = action.label;
			}
		}

		function syncShopCardElement( wrap, row, opts ) {
			if ( ! wrap || ! row ) return;
			var cardState = shopCardState( row, opts || {} );
			var action = cardState.action;
			var oldState = wrap.getAttribute( 'data-odd-card-state' );
			if ( oldState ) wrap.classList.remove( 'is-state-' + oldState );
			wrap.classList.add( 'is-state-' + cardState.id );
			wrap.classList.toggle( 'is-active', !! cardState.isActive );
			wrap.classList.toggle( 'is-installing', !! action.progress );
			wrap.setAttribute( 'data-odd-card-state', cardState.id );
			wrap.setAttribute( 'data-odd-card-phase', cardState.phase );
			wrap.setAttribute( 'data-odd-card-status', cardState.statusLabel );
			wrap.setAttribute( 'data-odd-card-action', action.kind );

			var card = wrap.querySelector( '.odd-shop__card' );
			if ( card ) {
				card.classList.toggle( 'is-active', !! cardState.isActive );
				card.setAttribute( 'aria-label', row.name + ' - ' + cardState.statusLabel );
			}

			var stateLine = wrap.querySelector( '.odd-shop__card-state' );
			if ( stateLine ) {
				stateLine.className = 'odd-shop__card-state odd-shop__card-state--' + cardState.id;
				stateLine.textContent = cardState.statusLabel;
			}

			paintShopButtonState( wrap.querySelector( '.odd-shop__card-btn' ), row, cardState );
		}

		function dispatchShopAction( row, kind, btn ) {
			switch ( kind ) {
				case 'install':
					startShopInstall( row, btn );
					break;
				case 'repair':
				case 'update':
					startShopInstall( row, btn, { allowUpdate: true, mode: kind } );
					break;
				case 'apply':
					if ( btn ) { btn.disabled = true; btn.textContent = 'Working…'; }
					if ( row.type === 'scene' ) { applyScene( row.slug ); break; }
					if ( row.type === 'icon-set' ) { applyIconSet( row.slug ); break; }
					if ( row.type === 'cursor-set' ) { applyCursorSet( row.slug ); break; }
					break;
				case 'add':
					playShopSound( 'success' );
					toggleWidget( 'odd/' + row.slug, true );
					break;
				case 'open':
					openAppWindow( row.slug );
					break;
				case 'reload':
					onEscapeHatchReload( row );
					break;
				case 'pending_reload':
				case 'installing':
				case 'active':
				case 'incompatible':
				default:
					break;
			}
		}

		function shopStatusBadges( row, isActive ) {
			var model = shopCardState( row, { isActive: isActive } );
			var badges = [ model.badge ];
			if ( row && row.featured ) badges.push( { label: __( 'Featured' ), mod: 'featured' } );
			return badges;
		}

		function shopCardImageBadges( row, isActive ) {
			return shopStatusBadges( row, isActive ).filter( function ( badge ) {
				return [ 'available', 'installed', 'active' ].indexOf( badge.mod ) === -1;
			} );
		}

		function detailBulletsFor( row ) {
			switch ( row && row.type ) {
				case 'scene':
					return [
						'Changes the live wallpaper scene on your desktop.',
						'Applies directly through the Desktop Mode wallpaper setting.',
						'Works with shuffle, favorites, and screensaver settings.',
					];
				case 'icon-set':
					return [
						'Updates desktop shortcut icons through the native Desktop Mode icon registry.',
						'Leaves the rail, dock, taskbar, and system actions on default Desktop Mode icons.',
						'Applies as one coherent set instead of patching individual DOM nodes.',
					];
				case 'cursor-set':
					return [
						'Changes pointer roles across Desktop Mode and wp-admin.',
						'Applies directly through the cursor registry.',
						'Uses the cursor registry instead of ad hoc CSS patches.',
					];
				case 'widget':
					return [
						'Adds a movable widget directly to the desktop.',
						'Keeps widget state owned by Desktop Mode.',
						'Can be removed later from the desktop widget layer.',
					];
				case 'app':
					return [
						'Installs a tiny desktop app with its own native window.',
						'Can appear on desktop or taskbar surfaces when enabled.',
						'Opens through Desktop Mode instead of a separate browser tab.',
					];
				default:
					return [ 'Adds another piece to your WordPress desktop.' ];
			}
		}

		function trustProfileFor( row ) {
			var flow = window.__odd && window.__odd.shopFlow;
			if ( ! flow || typeof flow.trustProfile !== 'function' ) {
				throw new Error( 'ODD Shop flow helper did not load before the panel.' );
			}
			return flow.trustProfile( row, { t: __ } );
		}

		function shopTitleCase( value ) {
			value = String( value || '' ).trim();
			return value ? value.charAt( 0 ).toUpperCase() + value.slice( 1 ) : '';
		}

		function detailVersionLabel( row ) {
			if ( row && row.version ) return row.version;
			return row && row.downloadUrl ? 'Catalog' : 'Installed';
		}

		function detailSourceLabel( row ) {
			var category = String( ( row && row.category ) || '' ).trim();
			var generic = row ? rowTypeLabel( row.type, false ) : '';
			if ( category && category.toLowerCase() !== String( generic || '' ).toLowerCase() ) return category;
			if ( row && row.builtin ) return 'Bundled';
			return row && row.downloadUrl ? 'Catalog' : 'Installed';
		}

		function detailCompatibilityLabel( row ) {
			if ( row && row.incompatible ) return row.incompatibilityReason || 'Needs update';
			return 'Works here';
		}

		function detailIconSvg( kind ) {
			if ( kind === 'safety' ) {
				return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l7 3v5c0 4.5-2.8 8.5-7 10-4.2-1.5-7-5.5-7-10V6l7-3z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/><path d="M8.8 12.2l2.1 2.1 4.5-4.8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
			}
			return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7L10 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
		}

		function appendDetailFact( container, label, value, mod ) {
			var fact = el( 'div', { class: 'odd-shop__detail-fact' + ( mod ? ' odd-shop__detail-fact--' + mod : '' ) } );
			var key = el( 'span' );
			key.textContent = label;
			var strong = el( 'strong' );
			strong.textContent = value || '-';
			fact.appendChild( key );
			fact.appendChild( strong );
			container.appendChild( fact );
			return fact;
		}

		function closeProductSheet() {
			if ( productSheetClose ) productSheetClose();
		}

		function openProductSheet( row ) {
			if ( ! row ) return;
			closeProductSheet();
			var normalised = normaliseShopRow( row, row.type );
			if ( ! normalised ) normalised = row;
			normalised.installed = row.installed;
			normalised.updateAvailable = row.updateAvailable;
			normalised.featured = row.featured;
			var isActive = shopCardIsActive( normalised );
			var action = shopCardAction( normalised );
			var trust = trustProfileFor( normalised );

			var titleId = 'odd-shop-detail-title-' + String( normalised.slug || 'item' ).replace( /[^a-z0-9_-]+/gi, '-' );
			var descId = titleId + '-desc';

			var overlay = el( 'div', {
				class: 'odd-shop__detail-overlay',
				'data-odd-product-sheet': '1',
			} );
			var sheet = el( 'section', {
				class: 'odd-shop__detail-sheet',
				role: 'dialog',
				'aria-modal': 'true',
				'aria-labelledby': titleId,
				'aria-describedby': descId,
			} );
			var close = el( 'button', {
				type: 'button',
				class: 'odd-shop__detail-close',
				'aria-label': 'Close details',
			} );
			close.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>';
			sheet.appendChild( close );

			var mediaWrap = el( 'div', { class: 'odd-shop__detail-media' } );
			var artWrap = el( 'div', { class: 'odd-shop__detail-art' } );
			artWrap.appendChild( renderShopCardArt( normalised ) );
			var mediaCaption = el( 'div', { class: 'odd-shop__detail-media-caption' } );
			var mediaCaptionLabel = el( 'span' );
			mediaCaptionLabel.textContent = 'Preview';
			var mediaCaptionName = el( 'strong' );
			mediaCaptionName.textContent = normalised.name;
			mediaCaption.appendChild( mediaCaptionLabel );
			mediaCaption.appendChild( mediaCaptionName );
			mediaWrap.appendChild( artWrap );
			mediaWrap.appendChild( mediaCaption );
			sheet.appendChild( mediaWrap );

			var bodyWrap = el( 'div', { class: 'odd-shop__detail-body' } );
			var header = el( 'header', { class: 'odd-shop__detail-header' } );
			var badges = el( 'div', { class: 'odd-shop__detail-badges' } );
			shopStatusBadges( normalised, isActive ).forEach( function ( badge ) {
				var chip = el( 'span', { class: 'odd-shop__status odd-shop__status--' + badge.mod } );
				chip.textContent = badge.label;
				badges.appendChild( chip );
			} );
			header.appendChild( badges );

			var title = el( 'h2', { class: 'odd-shop__detail-title', id: titleId } );
			title.textContent = normalised.name;
			var sub = el( 'p', { class: 'odd-shop__detail-sub' } );
			sub.textContent = normalised.subtitle || rowTypeLabel( normalised.type, false );
			var desc = el( 'p', { class: 'odd-shop__detail-desc', id: descId } );
			desc.textContent = normalised.description || 'A little piece of desktop personality for your WordPress workspace.';
			header.appendChild( title );
			header.appendChild( sub );
			header.appendChild( desc );
			bodyWrap.appendChild( header );

			var facts = el( 'div', { class: 'odd-shop__detail-facts' } );
			appendDetailFact( facts, 'Type', shopTitleCase( rowTypeLabel( normalised.type, false ) ), 'type' );
			appendDetailFact( facts, 'Version', detailVersionLabel( normalised ), 'version' );
			appendDetailFact( facts, 'Compatibility', detailCompatibilityLabel( normalised ), normalised.incompatible ? 'blocked' : 'ok' );
			appendDetailFact( facts, 'Source', detailSourceLabel( normalised ), 'source' );
			bodyWrap.appendChild( facts );

			var changes = el( 'section', { class: 'odd-shop__detail-changes' } );
			var changesTitle = el( 'h3', { class: 'odd-shop__detail-section-title' } );
			changesTitle.textContent = 'What changes';
			var list = el( 'div', { class: 'odd-shop__detail-change-list' } );
			detailBulletsFor( normalised ).forEach( function ( text, idx ) {
				var item = el( 'div', { class: 'odd-shop__detail-change' } );
				var icon = el( 'span', {
					class: 'odd-shop__detail-change-icon odd-shop__detail-change-icon--' + ( idx + 1 ),
					'aria-hidden': 'true',
				} );
				icon.innerHTML = detailIconSvg( 'check' );
				var copy = el( 'span', { class: 'odd-shop__detail-change-copy' } );
				copy.textContent = text;
				item.appendChild( icon );
				item.appendChild( copy );
				list.appendChild( item );
			} );
			changes.appendChild( changesTitle );
			changes.appendChild( list );
			bodyWrap.appendChild( changes );

			var safety = el( 'section', { class: 'odd-shop__detail-safety odd-shop__detail-safety--' + trust.id } );
			var safetyIcon = el( 'span', { class: 'odd-shop__detail-safety-icon', 'aria-hidden': 'true' } );
			safetyIcon.innerHTML = detailIconSvg( 'safety' );
			var safetyCopy = el( 'div', { class: 'odd-shop__detail-safety-copy' } );
			var safetyTitle = el( 'h3', { class: 'odd-shop__detail-section-title' } );
			safetyTitle.textContent = 'Safety checks';
			var trustNote = el( 'p', { class: 'odd-shop__detail-trust odd-shop__detail-trust--' + trust.id } );
			trustNote.textContent = trust.detail;
			safetyCopy.appendChild( safetyTitle );
			safetyCopy.appendChild( trustNote );
			safety.appendChild( safetyIcon );
			safety.appendChild( safetyCopy );
			bodyWrap.appendChild( safety );

			sheet.appendChild( bodyWrap );

			var actions = el( 'footer', { class: 'odd-shop__detail-actions' } );
			var actionSummary = el( 'div', { class: 'odd-shop__detail-action-summary' } );
			var actionState = el( 'strong' );
			actionState.textContent = shopCardState( normalised, { isActive: isActive } ).statusLabel;
			var actionHint = el( 'span' );
			actionHint.textContent = normalised.incompatible ? detailCompatibilityLabel( normalised ) : detailSourceLabel( normalised ) + ' bundle';
			actionSummary.appendChild( actionState );
			actionSummary.appendChild( actionHint );
			var actionControls = el( 'div', { class: 'odd-shop__detail-action-controls' } );
			var primary = el( 'button', {
				type: 'button',
				class: 'odd-shop__detail-primary odd-shop__card-btn--' + action.kind + ( action.disabled ? ' odd-shop__detail-primary--disabled-state' : '' ),
				'data-odd-card-action': action.kind,
			} );
			if ( action.progress ) {
				primary.appendChild( el( 'span', { class: 'odd-shop__btn-spinner', 'aria-hidden': 'true' } ) );
				var primaryLabel = el( 'span', { class: 'odd-shop__btn-label' } );
				primaryLabel.textContent = action.label;
				primary.appendChild( primaryLabel );
				primary.setAttribute( 'aria-busy', 'true' );
			} else {
				primary.textContent = action.label;
			}
			if ( action.disabled ) primary.disabled = true;
			primary.addEventListener( 'click', function () {
				if ( primary.disabled ) return;
				dispatchShopAction( normalised, action.kind, primary );
			} );
			var secondary = el( 'button', {
				type: 'button',
				class: 'odd-shop__detail-secondary' + ( action.disabled ? ' odd-shop__detail-secondary--primary' : '' ),
			} );
			secondary.textContent = 'Done';
			secondary.addEventListener( 'click', closeProductSheet );
			actionControls.appendChild( primary );
			actionControls.appendChild( secondary );
			actions.appendChild( actionSummary );
			actions.appendChild( actionControls );
			sheet.appendChild( actions );
			overlay.appendChild( sheet );
			body.appendChild( overlay );

			function onKey( ev ) {
				if ( ev.key === 'Escape' ) closeProductSheet();
			}
			function cleanupSheet() {
				document.removeEventListener( 'keydown', onKey );
				if ( overlay.parentNode ) overlay.parentNode.removeChild( overlay );
				productSheetClose = null;
			}
			productSheetClose = cleanupSheet;
			overlay.addEventListener( 'click', function ( ev ) {
				if ( ev.target === overlay ) closeProductSheet();
			} );
			close.addEventListener( 'click', closeProductSheet );
			document.addEventListener( 'keydown', onKey );
			try { ( action.disabled ? secondary : primary ).focus(); } catch ( e ) {}
		}

		// Artwork region of the tile. Kept in its own script so the main
		// panel renderer can focus on state and interaction.
		function renderShopCardArt( row ) {
			var renderer = window.__odd && window.__odd.panelCardArt;
			if ( renderer && typeof renderer.render === 'function' ) {
				return renderer.render( row, {
					el: el,
					restUrl: state.cfg.restUrl || '',
				} );
			}

			var art = el( 'div', { class: 'odd-shop__card-art odd-shop__card-art--' + row.type, 'aria-hidden': 'true' } );
			var fallback = el( 'div', { class: 'odd-shop__card-mono' } );
			fallback.textContent = String( row.name || row.label || row.slug || '' ).slice( 0, 2 ).toUpperCase();
			art.appendChild( fallback );
			return art;
		}

		// The one and only card renderer for the Shop. Every tile in
		// Wallpapers / Icons / Widgets / Apps — installed or not —
		// flows through this function.
		function renderShopCard( row, opts ) {
			opts = opts || {};
			if ( ! row ) return null;
			var cardState = shopCardState( row );
			var isActive = cardState.isActive;
			var action   = cardState.action;
			var kind     = action.kind;
			var installing = !! action.progress;
			var trust = trustProfileFor( row );
			var a11yBase = 'odd-shop-card-' + ( String( row.slug || row.name || 'item' ).toLowerCase().replace( /[^a-z0-9_-]+/g, '-' ).replace( /^-+|-+$/g, '' ) || 'item' );
			var subtitleText = row.subtitle || '';
			var subId = subtitleText ? a11yBase + '-subtitle' : '';
			var statusId = a11yBase + '-status';
			var trustId = a11yBase + '-trust';
			var describedBy = [];
			if ( subId ) describedBy.push( subId );
			describedBy.push( statusId, trustId );

			var wrap = el( 'div', {
				class: 'odd-shop__card-wrap'
					+ ( row.installed ? ' is-installed' : ' is-catalog' )
					+ ( isActive ? ' is-active' : '' )
					+ ( installing ? ' is-installing' : '' )
					+ ' is-state-' + cardState.id
					+ ( opts.variant ? ' odd-shop__card-wrap--' + opts.variant : '' ),
				'data-odd-shop-card': '1',
				'data-odd-card-type': row.type,
				'data-odd-card-state': cardState.id,
				'data-odd-card-phase': cardState.phase,
				'data-odd-card-status': cardState.statusLabel,
				'data-odd-card-action': kind,
				'data-odd-trust':      trust.id,
				'data-slug':          row.slug,
				'data-scene-slug':    row.type === 'scene' ? row.slug : null,
				'data-set-slug':      row.type === 'icon-set' ? row.slug : null,
				'data-cursor-set-slug': row.type === 'cursor-set' ? row.slug : null,
				'data-widget-id':     row.type === 'widget' ? ( 'odd/' + row.slug ) : null,
				'data-catalog-slug':  row.installed ? null : row.slug,
				'data-odd-cursor-root': 'true',
			} );

			var card = el( 'button', {
				type: 'button',
				class: 'odd-shop__card odd-shop__card--' + row.type
					+ ( row.installed ? ' is-installed' : ' is-catalog' )
					+ ( isActive ? ' is-active' : '' ),
				'aria-label': row.name + ' - ' + cardState.statusLabel,
				'aria-describedby': describedBy.join( ' ' ),
				'data-slug': row.slug,
				'data-odd-cursor': 'pointer',
			} );
			if ( row.type === 'scene' )    card.setAttribute( 'data-scene-slug',  row.slug );
			if ( row.type === 'icon-set' ) card.setAttribute( 'data-set-slug',    row.slug );
			if ( row.type === 'cursor-set' ) card.setAttribute( 'data-cursor-set-slug', row.slug );
			if ( row.type === 'widget' )   card.setAttribute( 'data-widget-id',   'odd/' + row.slug );
			if ( ! row.installed )         card.setAttribute( 'data-catalog-slug', row.slug );
				// Stable selectors for tests, styling, and delegated card actions.
			card.classList.add( 'odd-card', 'odd-shop__tile' );
			if ( row.type === 'widget' ) card.classList.add( 'odd-shop__tile--widget' );

			card.appendChild( renderShopCardArt( row ) );

			if ( isActive ) {
				var pin = el( 'span', { class: 'odd-shop__card-pin', 'aria-hidden': 'true' } );
				pin.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M5 12l4 4 10-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
				card.appendChild( pin );
			}

			var stateBadges = shopCardImageBadges( row, isActive );
			if ( stateBadges.length ) {
				var primaryBadge = stateBadges[ 0 ];
				var statusBadge = el( 'span', {
					class: 'odd-shop__card-badge odd-shop__card-badge--' + primaryBadge.mod,
					'aria-hidden': 'true',
				} );
				statusBadge.textContent = primaryBadge.label;
				card.appendChild( statusBadge );
			}

			var meta = el( 'div', { class: 'odd-shop__card-meta' } );
			var title = el( 'div', { class: 'odd-shop__card-title odd-shop__tile-title' } );
			title.textContent = row.name;
			var sub = el( 'div', { class: 'odd-shop__card-sub odd-shop__tile-sub' } );
			if ( subId ) sub.id = subId;
			sub.textContent = subtitleText;
			var stateLine = el( 'div', { class: 'odd-shop__card-state odd-shop__card-state--' + cardState.id, id: statusId } );
			stateLine.textContent = cardState.statusLabel;
			var trustLine = el( 'span', {
				class: 'odd-sr-only',
				id: trustId,
			} );
			trustLine.textContent = trust.label;
			meta.appendChild( title );
			meta.appendChild( sub );
			if ( cardState.id !== 'available' ) {
				meta.appendChild( stateLine );
			} else {
				var hiddenState = el( 'span', { class: 'odd-sr-only', id: statusId } );
				hiddenState.textContent = cardState.statusLabel;
				meta.appendChild( hiddenState );
			}
			meta.appendChild( trustLine );
			card.appendChild( meta );

			var btn = el( 'button', {
				type: 'button',
				class: 'odd-shop__card-btn odd-shop__tile-btn odd-shop__card-btn--' + kind
					+ ( action.disabled ? ' is-disabled' : ' odd-shop__tile-btn--primary' )
					+ ( kind === 'install' ? ' odd-shop__card-btn--install' : '' ),
					'aria-label': action.label + ' ' + row.name + ' - ' + cardState.statusLabel,
					'aria-describedby': describedBy.join( ' ' ),
					'data-odd-card-action': kind,
					'data-odd-cursor': action.disabled ? 'not-allowed' : 'pointer',
				} );
			if ( action.progress ) {
				btn.appendChild( el( 'span', { class: 'odd-shop__btn-spinner', 'aria-hidden': 'true' } ) );
				var btnLabel = el( 'span', { class: 'odd-shop__btn-label' } );
				btnLabel.textContent = action.label;
				btn.appendChild( btnLabel );
				btn.setAttribute( 'aria-busy', 'true' );
			} else {
				btn.textContent = action.label;
			}
			if ( row.incompatibilityReason ) {
				btn.title = row.incompatibilityReason;
			}
			if ( action.disabled ) {
				btn.disabled = true;
				btn.setAttribute( 'aria-disabled', 'true' );
			}
				btn.addEventListener( 'click', function ( e ) {
					e.stopPropagation();
					if ( btn.disabled ) return;
					dispatchShopAction( row, btn.getAttribute( 'data-odd-card-action' ) || kind, btn );
				} );

			// Whole-card click performs the visible primary action for
			// installed content. Catalog rows still require an explicit
			// Install click so misplaced hover-clicks don't trigger a
			// network download.
			card.addEventListener( 'click', function ( e ) {
					if ( e.target && e.target.closest && e.target.closest( '.odd-shop__card-btn' ) ) return;
					if ( ! row.installed ) return;
					if ( btn && btn.disabled ) return;
					dispatchShopAction( row, btn.getAttribute( 'data-odd-card-action' ) || kind, btn );
				} );

			wrap.appendChild( card );

			var quick = el( 'button', {
				type: 'button',
				class: 'odd-shop__quick-look',
				'aria-label': 'View details for ' + row.name,
				'data-odd-cursor': 'pointer',
			} );
			quick.textContent = 'Details';
			quick.addEventListener( 'click', function ( e ) {
				e.stopPropagation();
				openProductSheet( row );
			} );

			var actions = el( 'div', { class: 'odd-shop__card-actions' } );
			actions.appendChild( btn );
			actions.appendChild( quick );
			wrap.appendChild( actions );

			// Favorites star on scenes (the only type with a persisted
			// favorites list today). Stays outside the button shell so
			// nested-interactive rules aren't violated.
			if ( row.type === 'scene' ) {
				var fav = isFavorite( row.slug );
				var star = el( 'span', {
					class: 'odd-shop__card-fav odd-shop__fav' + ( fav ? ' is-on' : '' ),
					role: 'button',
					tabindex: '0',
					'aria-label': fav ? 'Remove ' + row.name + ' from favorites' : 'Add ' + row.name + ' to favorites',
					'aria-pressed': fav ? 'true' : 'false',
					'data-odd-cursor': 'pointer',
				} );
				star.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 3.6 L14.6 9.1 L20.5 9.9 L16.2 14.2 L17.3 20.1 L12 17.3 L6.7 20.1 L7.8 14.2 L3.5 9.9 L9.4 9.1 Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
				function toggleFromStar( ev ) {
					ev.stopPropagation();
					ev.preventDefault();
					toggleFavorite( row.slug );
				}
				star.addEventListener( 'click', toggleFromStar );
				star.addEventListener( 'keydown', function ( ev ) {
					if ( ev.key === 'Enter' || ev.key === ' ' ) toggleFromStar( ev );
				} );
				wrap.appendChild( star );
			}

			return wrap;
		}

		/* --- Install breadcrumb + widget hot-register ------------ */

		// Cross-reload breadcrumb for fallback paths. The normal install
		// flow refreshes Desktop Mode live; script-load failures can
		// still request a full reload, and this marker lets the panel
		// navigate to the right department and flash the new tile after.
		//
		// The key is inlined at every call site (rather than hoisted
		// to a `var`) because `var`-declared constants only get
		// their assignment at source order, and these helpers need
		// to be callable from the init block higher up inside
		// `renderPanel` — which runs before this sibling var
		// initialiser would.

		function rememberJustInstalled( payload ) {
			try {
				var json = JSON.stringify( {
					type: payload.type,
					slug: payload.slug,
					name: payload.name || payload.slug,
					at:   Date.now(),
				} );
				window.sessionStorage.setItem( 'odd.justInstalled', json );
			} catch ( e ) {}
		}

		function consumeJustInstalled() {
			try {
				var raw = window.sessionStorage.getItem( 'odd.justInstalled' );
				if ( ! raw ) return null;
				window.sessionStorage.removeItem( 'odd.justInstalled' );
				var parsed = JSON.parse( raw );
				// Ignore breadcrumbs older than ~30s — they belong
				// to a different navigation.
				if ( ! parsed || ! parsed.slug ) return null;
				if ( parsed.at && ( Date.now() - parsed.at ) > 30000 ) return null;
				return parsed;
			} catch ( e ) { return null; }
		}

		// Inject a `<script>` for a widget bundle and resolve once
		// it's finished loading. Widget bundles expose their mount
		// callback on `window.desktopModeWidgets[id]`.
		// Rejects on script-load errors so the caller can fall back
		// to a reload.
		function loadBundleScript( type, slug, entryUrl ) {
			return new Promise( function ( resolve, reject ) {
				if ( ! entryUrl ) { reject( new Error( 'no entry_url' ) ); return; }
				// Avoid double-injection if a previous attempt raced
				// this one (e.g. rapid double-install of the same
				// bundle before the first response came back).
				var attr = 'data-odd-' + type + '-slug';
				var existing = document.querySelector( 'script[' + attr + '="' + slug + '"]' );
				if ( existing ) {
					if ( existing.getAttribute( 'data-odd-loaded' ) === '1' ) {
						setTimeout( resolve, 0 );
						return;
					}
					existing.addEventListener( 'load', function () {
						existing.setAttribute( 'data-odd-loaded', '1' );
						setTimeout( resolve, 16 );
					}, { once: true } );
					existing.addEventListener( 'error', function () { reject( new Error( type + ' script failed to load' ) ); }, { once: true } );
					return;
				}
				var s = document.createElement( 'script' );
				s.src = entryUrl;
				s.async = true;
				s.setAttribute( attr, slug );
				s.onload  = function () {
					s.setAttribute( 'data-odd-loaded', '1' );
					setTimeout( resolve, 16 );
				};
				s.onerror = function () { reject( new Error( type + ' script failed to load' ) ); };
				document.head.appendChild( s );
			} );
		}

		function loadBundleStyles( type, slug, styleUrls ) {
			styleUrls = Array.isArray( styleUrls ) ? styleUrls : [];
			for ( var i = 0; i < styleUrls.length; i++ ) {
				var href = styleUrls[ i ];
				if ( typeof href !== 'string' || ! href ) continue;
				var safeHref = href.replace( /["\\]/g, '\\$&' );
				var existing = document.querySelector( 'link[data-odd-' + type + '-style-slug="' + slug + '"][href="' + safeHref + '"]' );
				if ( existing ) continue;
				var link = document.createElement( 'link' );
				link.rel = 'stylesheet';
				link.href = href;
				link.setAttribute( 'data-odd-' + type + '-style-slug', slug );
				link.setAttribute( 'data-odd-widget-style-url', href );
				document.head.appendChild( link );
			}
		}

		function savePrefs( body, onDone ) {
			var cfg = state.cfg;
			if ( ! cfg.restUrl ) {
				if ( typeof onDone === 'function' ) onDone( null );
				return;
			}
			// Route through shared `api.savePrefs` so prefs POSTs get the same
			// side effects as slash commands/widgets: merges `wallpaper` into
			// `window.odd`, and notifies Desktop Mode to select the `odd`
			// engine via `updateOsSettings` (live; PHP alone persists meta).
			var api = window.__odd && window.__odd.api;
			if ( api && typeof api.savePrefs === 'function' ) {
				api.savePrefs( body, onDone );
				return;
			}
			fetch( cfg.restUrl, {
				method:      'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce':   cfg.restNonce || '',
				},
				body: JSON.stringify( body ),
			} ).then( function ( r ) {
				return r.ok ? r.json() : null;
			} ).then( function ( data ) {
				if ( typeof onDone === 'function' ) onDone( data );
			} ).catch( function () {
				if ( typeof onDone === 'function' ) onDone( null );
			} );
		}
	};

	function renderOddNativeWindow( body ) {
		var win = hostOddWindow();
		try {
			markShopLoading( win );
			var teardown = renderPanel( body );
			markShopLoaded( win );
			return teardown;
		} catch ( err ) {
			reportError( 'panel.render', err );
			try {
				body.innerHTML =
					'<div style="padding:24px;font-family:system-ui;color:#1d2327">' +
					'<h2 style="margin:0 0 8px">ODD panel didn\'t load</h2>' +
					'<p style="color:#50575e;margin:0">A scene or widget threw while the panel was rendering. Reload the page or check the browser console.</p>' +
					'</div>';
			} catch ( e ) {}
			return function () {};
		}
	}
	window.desktopModeNativeWindows.odd = renderOddNativeWindow;

	/* --- dom helpers (unscoped) --- */

	function el( tag, attrs ) {
		var n = document.createElement( tag );
		if ( attrs ) {
			for ( var k in attrs ) {
				if ( Object.prototype.hasOwnProperty.call( attrs, k ) ) {
					if ( k === 'class' ) n.className = attrs[ k ];
					else if ( k === 'style' ) n.style.cssText = attrs[ k ];
					else n.setAttribute( k, attrs[ k ] );
				}
			}
		}
		return n;
	}
	function clone( o ) { try { return JSON.parse( JSON.stringify( o ) ); } catch ( e ) { return {}; } }
	function escape( s ) {
		return String( s ).replace( /[&<>"']/g, function ( c ) {
			return ( { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } )[ c ];
		} );
	}

	/**
	 * Stylesheet is injected once per page and scopes under `.odd-panel`
	 * so it can't leak into the shell chrome. WP Desktop Mode native
	 * windows receive our body inside a chromeless frame; all typography
	 * + spacing conventions here come from the WP admin design system.
	 */
	/**
	 * Mount the panel stylesheet.
	 *
	 * In production, odd/includes/enqueue.php enqueues
	 * odd/src/panel/styles.css as handle `odd-panel-style`, so this
	 * function is a no-op. In tests or standalone contexts the server
	 * enqueue doesn't run, so we inject a `<link>` pointing at the
	 * plugin's styles.css via `window.odd.pluginUrl`.
	 *
	 * Either way, we leave an empty `#odd-panel-styles` sentinel so
	 * consumers (and panel.test.js) can still test for its presence.
	 */
	function injectStyles() {
		if ( document.getElementById( 'odd-panel-styles' ) ) return;
		var marker = document.createElement( 'style' );
		marker.id = 'odd-panel-styles';
		document.head.appendChild( marker );
		// If the server-side enqueue already shipped odd-panel-style,
		// the link is already in the DOM and we're done.
		if ( document.querySelector( 'link[data-odd-panel-style]' ) ) return;
		if ( document.getElementById( 'odd-panel-style-css' ) ) return;
		var base = ( window.odd && window.odd.pluginUrl ) || '';
		if ( ! base ) return;
		var link = document.createElement( 'link' );
		link.rel  = 'stylesheet';
		link.href = base + '/src/panel/styles.css';
		link.setAttribute( 'data-odd-panel-style', '1' );
		document.head.appendChild( link );
	}
} )();
