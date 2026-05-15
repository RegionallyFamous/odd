/**
 * ODD Shop — native-window render callback.
 * ---------------------------------------------------------------
 * Registered on `window.desktopModeNativeWindows.odd`; the shell
 * invokes this when the window opens and re-invokes it every
 * time the user re-opens a previously-closed instance. The
 * returned function is the teardown, called on close.
 *
 * Layout: Mac App Store–style shop with a top bar, a left
 * department rail (Wallpapers / Icon Sets / Apps / About), and
 * a right content pane that groups items into franchise
 * "shelves". All state still flows through the same REST
 * endpoint used by ODD's runtime — wallpaper via WP Desktop Mode's
 * per-user settings, icons via a soft reload (the server-side dock
 * filter is the canonical renderer).
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	var wpI18nOdd = window.wp && window.wp.i18n;
	function __( s ) {
		return ( wpI18nOdd && typeof wpI18nOdd.__ === 'function' ) ? wpI18nOdd.__( s, 'odd-outlandish-desktop-decorator' ) : s;
	}

	window.desktopModeNativeWindows = window.desktopModeNativeWindows || {};

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
		{ id: 'icons',     label: __( 'Icon Sets' ),  icon: '🧩', glyph: 'g-icons',     group: 'decorate', tint: 'var(--odd-shop-tint-icons)',     tagline: __( 'Dock disguises' ) },
		{ id: 'cursors',   label: __( 'Cursors' ),    icon: '➹', glyph: 'g-cursors',   group: 'decorate', tint: 'var(--odd-shop-tint-cursors)',   tagline: __( 'Pointers with opinions' ) },
		{ id: 'widgets',   label: __( 'Widgets' ),    icon: '🧷', glyph: 'g-widgets',   group: 'more',     tint: 'var(--odd-shop-tint-widgets)',   tagline: __( 'Tiny desktop creatures' ) },
		{ id: 'apps',      label: __( 'Apps' ),       icon: '📦', glyph: 'g-apps',      group: 'more',     tint: 'var(--odd-shop-tint-apps)',      tagline: __( 'Little tools, big portals' ), gated: 'appsEnabled' },
		{ id: 'install',   label: __( 'Install' ),    icon: '⇪', glyph: 'g-install',   group: 'you',      tint: 'var(--odd-shop-accent)',         tagline: __( 'Feed it a .wp' ),           gated: 'canInstall' },
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
		var NOUN_FOR_TYPE = {
			'app':      'app',
			'cursor-set': 'cursor set',
			'icon-set': 'icon set',
			'scene':    'scene',
			'widget':   'widget',
		};
		var CATALOG_BASE_URL = 'https://odd.regionallyfamous.com/catalog/v1';
		var cleanupFns = [];
		var sectionCleanupFns = [];

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
			// Older scene rows may only carry a bare preview filename
			// from the pre-1.0 in-plugin asset era. Those files no
			// longer ship in the runtime zip, but the remote catalog
			// always publishes the matching scene thumbnail.
			if ( rowType === 'scene' && slug && /\.webp(?:[?#].*)?$/i.test( url ) ) {
				return CATALOG_BASE_URL + '/icons/scene-' + encodeURIComponent( slug ) + '.webp';
			}
			return url;
		}

		function normaliseShopTheme( value ) {
			value = String( value || 'auto' ).toLowerCase();
			return value === 'light' || value === 'dark' || value === 'auto' ? value : 'auto';
		}

		function applyShopTheme( target, theme ) {
			theme = normaliseShopTheme( theme );
			target.setAttribute( 'data-odd-theme', theme );
			return theme;
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
		body.setAttribute( 'data-odd-chaos', window.odd && window.odd.chaosMode ? '1' : '0' );
		applyShopTheme( body, window.odd && window.odd.theme );
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
		var franchiseChips = {};
		var allStylesChip = el( 'button', { type: 'button', class: 'odd-shop__search-chip odd-shop__search-chip--all is-active' } );
		allStylesChip.textContent = __( 'All styles' );
		allStylesChip.setAttribute( 'aria-pressed', 'true' );
		allStylesChip.addEventListener( 'click', function () {
			state.franchiseFilter = '';
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
				state.franchiseFilter = state.franchiseFilter === label ? '' : label;
				updateSearchToolState();
				renderSection( state.active, { keepQuery: true } );
			} );
			franchiseChips[ label ] = chip;
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
						state.franchiseFilter = '';
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
			// Preview state: when non-null, the user has clicked a
			// scene, icon-set, or cursor-set card and the shell is showing the
			// live result without having committed yet. Confirming
			// persists via REST; cancelling reverts to `original`.
			//
			//   { kind: 'wallpaper' | 'iconSet' | 'cursorSet',
			//     slug:         'aurora',
			//     originalSlug: 'flux',
			//     iconSnapshot: [ { img, src } ]   // iconSet only
			//     reloadOnCommit: bool              // iconSet only
			//   }
			preview:       null,
			// Live global search query. Cleared on department switch
			// unless the caller passes `keepQuery: true` (e.g. the
			// search field re-rendering its result surface).
			query:         '',
			franchiseFilter: '',
			searchScope:   'all',
			shopSounds:    loadShopSoundsSetting(),
			// When set, the Shop scheduled a full admin reload (desktop / taskbar /
			// script-fallback). Catalog tiles show "Applying…" for the matching slug.
			pendingAdminReload: null,
		};
		state.cfg.shopV2 = state.cfg.shopV2 !== false;
		body.setAttribute( 'data-odd-shop-v2', state.cfg.shopV2 ? '1' : '0' );
		state.cfg.theme = normaliseShopTheme( state.cfg.theme );
		applyShopTheme( body, state.cfg.theme );
		body.setAttribute( 'data-odd-chaos', state.cfg.chaosMode ? '1' : '0' );
		var shopRowCache = {};
		var buttons = {};
		var shopSfx = { ctx: null, last: {} };
		var pendingAdminReloadTimer = null;

		var ODD_RELOAD_DELAY_MS_ICON    = 180;
		var ODD_RELOAD_DELAY_MS_TASKBAR       = 250;
		var ODD_RELOAD_DELAY_MS_DESKTOP_PIN = 260;
		var ODD_RELOAD_DELAY_MS_SURFACE = 300;
		var ODD_RELOAD_DELAY_MS_DEFAULT = 400;

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
			var active = String( state.franchiseFilter || '' );
			allStylesChip.classList.toggle( 'is-active', ! active );
			allStylesChip.setAttribute( 'aria-pressed', active ? 'false' : 'true' );
			Object.keys( franchiseChips ).forEach( function ( label ) {
				var chip = franchiseChips[ label ];
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
					'desktop-mode.window.bounds-changed',
					'desktop-mode.window.body-resized',
					'desktop-mode.native-window.after-render',
					'desktop-mode.window.maximized',
					'desktop-mode.window.unmaximized',
					'desktop-mode.window.fullscreen-entered',
					'desktop-mode.window.fullscreen-exited',
				].forEach( function ( hookName ) {
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
				case 'preview': return [ { freq: 520, length: 0.055, type: 'sine' }, { freq: 780, delay: 0.045, length: 0.07, type: 'sine', level: 0.55 } ];
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
			if ( cfg.shopDesktopPinned ) active++;
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
			btn.addEventListener( 'click', function () {
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
				chaos: !! state.cfg.chaosMode,
				pluginUrl: state.cfg.pluginUrl || '',
			} );
		}

		installDropAnywhere( body );
		installShopKeyboard( body, sidebar, buttons, renderSection );
		installCardMotion( body );
		installResponsiveState( body );
		installShopRailOverflow( body, sidebar );

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
		stopPanelTimer( {
			sections: SECTIONS.length,
			cards:    content.querySelectorAll ? content.querySelectorAll( '[data-odd-shop-card]' ).length : 0,
		} );

		return function teardown() {
			clearPendingAdminReload();
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
					window.wp.hooks.removeAction( 'desktop-mode.widget.added',   'odd.widgets' );
					window.wp.hooks.removeAction( 'desktop-mode.widget.removed', 'odd.widgets' );
				}
			} catch ( e ) {}
		};

		/* --- routing --- */

		function renderSection( id, opts ) {
			var stopSectionTimer = diagTime( 'panel.renderSection', { section: id || '' } );
			opts = opts || {};
			var scrollSnap = opts.skipScrollPreserve ? null : captureShopScrollTops();
			// Abandoning a tab with a pending preview reverts the
			// live swap — no silent commits because the user clicked
			// "About" to look at stats.
			if ( state.preview ) {
				var sameTab = ( id === 'wallpaper' && state.preview.kind === 'wallpaper' ) ||
					( id === 'icons' && state.preview.kind === 'iconSet' ) ||
					( id === 'cursors' && state.preview.kind === 'cursorSet' );
				if ( ! sameTab ) cancelPreview();
			}

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
			// If we re-entered the tab that owns an active preview,
			// re-draw the sticky confirmation bar.
			if ( state.preview ) renderPreviewBar();

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

			wrap.appendChild( renderAppsHero() );
			var appsEditorial = renderEditorialStrip( shopRowsFor( 'app' ), 'apps' );
			if ( appsEditorial ) wrap.appendChild( appsEditorial );

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
					rows.sort( function ( a, b ) {
						if ( !! a.installed !== !! b.installed ) return a.installed ? -1 : 1;
						return ( a.name || a.slug || '' ).localeCompare( b.name || b.slug || '' );
					} );

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
		function renderCatalogCard( row, wrap ) {
			var normalised = normaliseShopRow( row, 'app' );
			if ( ! normalised ) return el( 'div' );
			normalised.installed = !! row.installed;
			var cardWrap = renderShopCard( normalised );
			if ( ! cardWrap ) return el( 'div' );

			// Legacy hooks so existing tests / styles (e.g. the
			// per-app surfaces-checkbox matcher) still resolve.
			cardWrap.classList.add( 'odd-card--app' );
			cardWrap.setAttribute( 'data-app-slug', row.slug );

			if ( row.installed && row.update_available ) {
				var updateBadge = el( 'span', { class: 'odd-shop__card-badge odd-shop__card-badge--update' } );
				updateBadge.textContent = 'Update';
				var inner = cardWrap.querySelector( '.odd-shop__card' );
				if ( inner ) inner.appendChild( updateBadge );
				var updateBtn = el( 'button', { type: 'button', class: 'odd-shop__card-btn odd-shop__card-btn--update' } );
				updateBtn.textContent = 'Update';
				updateBtn.addEventListener( 'click', function () {
					updateBtn.disabled = true;
					updateBtn.textContent = 'Updating…';
					setAppsStatus( wrap, 'Updating ' + ( row.name || row.slug ) + '…', 'busy' );
					installFromCatalog( row.slug, { allowUpdate: true } ).then( function ( res ) {
						if ( res && res.ok && res.data && res.data.installed ) {
							setAppsStatus( wrap, 'Updated ' + ( row.name || row.slug ) + '.', 'ok' );
							handleInstallSuccess( res.data );
							return;
						}
						updateBtn.disabled = false;
						updateBtn.textContent = 'Update';
						setAppsStatus( wrap, ( res && res.message ) || 'Update failed.', 'error' );
					} );
				} );
				cardWrap.appendChild( updateBtn );
			}

			if ( row.installed ) {
				cardWrap.appendChild( renderAppCardManagement( row, wrap ) );
			}

			return cardWrap;
		}

		function renderAppCardManagement( app, wrap ) {
			var manage = el( 'div', { class: 'odd-shop__card-manage' } );

			var rowSurfaces = ( app.surfaces && typeof app.surfaces === 'object' )
				? app.surfaces
				: { desktop: true, taskbar: false };
			var surfacesRow = el( 'div', {
				class: 'odd-card__surfaces odd-shop__card-surfaces',
				'aria-label': __( 'App surfaces' ),
			} );
			if ( ! app.enabled ) {
				surfacesRow.setAttribute( 'aria-disabled', 'true' );
				surfacesRow.classList.add( 'is-disabled' );
			}

			function makeSurfaceToggle( key, label, hint ) {
				var wrapLbl = el( 'label', { class: 'odd-card__surface' } );
				var box     = el( 'input', { type: 'checkbox' } );
				box.checked = !! rowSurfaces[ key ];
				box.disabled = ! app.enabled;
				var text = el( 'span', { class: 'odd-card__surface-text' } );
				var name = el( 'strong' );
				name.textContent = label;
				var tail = el( 'span', { class: 'odd-card__surface-hint' } );
				tail.textContent = hint;
				text.appendChild( name );
				text.appendChild( tail );
				wrapLbl.appendChild( box );
				wrapLbl.appendChild( text );
				box.addEventListener( 'change', function () {
					if ( ! app.enabled ) return;
					var payload      = {};
					payload[ key ]   = !! box.checked;
					rowSurfaces[ key ] = !! box.checked;
					box.disabled = true;
					setAppSurfaces( app.slug, payload ).then( function ( res ) {
						box.disabled = false;
						if ( res && res.surfaces ) {
							mirrorAppSurfacesInCfg( app.slug, res.surfaces );
							scheduleAdminReload( {
								delayMs:      ODD_RELOAD_DELAY_MS_SURFACE,
								slug:         app.slug,
								type:         'app',
								name:         app.name || app.slug,
								toastMessage: __( 'Applying changes…' ),
							} );
							setAppsStatus( wrap, __( 'Applying changes…' ), '' );
							return;
						}
						box.checked  = ! box.checked;
						rowSurfaces[ key ] = !! box.checked;
						setAppsStatus( wrap, __( 'Could not update surfaces.' ), 'error' );
					} );
				} );
				return wrapLbl;
			}
			surfacesRow.appendChild( makeSurfaceToggle( 'desktop', __( 'Desktop icon' ), __( 'Show a shortcut on the desktop.' ) ) );
			surfacesRow.appendChild( makeSurfaceToggle( 'taskbar', __( 'Taskbar icon' ), __( 'Pin a launcher to the bottom taskbar.' ) ) );
			manage.appendChild( surfacesRow );

			var actions = el( 'div', { class: 'odd-shop__card-manage-actions' } );
			var toggle = el( 'button', { type: 'button', class: 'odd-apps-btn' } );
			toggle.textContent = app.enabled ? 'Disable' : 'Enable';
			toggle.addEventListener( 'click', function () {
				toggleApp( app.slug, ! app.enabled ).then( function ( ok ) {
					if ( ok ) refreshAppsGallery( wrap );
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
						refreshAppsGallery( wrap );
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

			// Surface toggles — Desktop icon + Taskbar icon.
			//
			// Desktop Mode registers native windows on `init`, so a
			// saved checkbox change schedules the shared deferred
			// admin reload (deduped) once the REST toggle succeeds.
			var rowSurfaces = ( app.surfaces && typeof app.surfaces === 'object' )
				? app.surfaces
				: { desktop: true, taskbar: false };
			var surfacesRow = el( 'div', {
				class: 'odd-card__surfaces',
				'aria-label': __( 'App surfaces' ),
			} );
			if ( ! app.enabled ) {
				surfacesRow.setAttribute( 'aria-disabled', 'true' );
				surfacesRow.classList.add( 'is-disabled' );
			}

			function makeSurfaceToggle( key, label, hint ) {
				var wrapLbl = el( 'label', { class: 'odd-card__surface' } );
				var box     = el( 'input', { type: 'checkbox' } );
				box.checked = !! rowSurfaces[ key ];
				box.disabled = ! app.enabled;
				var text = el( 'span', { class: 'odd-card__surface-text' } );
				var name = el( 'strong' );
				name.textContent = label;
				var tail = el( 'span', { class: 'odd-card__surface-hint' } );
				tail.textContent = hint;
				text.appendChild( name );
				text.appendChild( tail );
				wrapLbl.appendChild( box );
				wrapLbl.appendChild( text );

				box.addEventListener( 'change', function () {
					if ( ! app.enabled ) return;
					var payload      = {};
					payload[ key ]   = !! box.checked;
					rowSurfaces[ key ] = !! box.checked;
					box.disabled = true;
					setAppSurfaces( app.slug, payload ).then( function ( res ) {
						box.disabled = false;
						if ( res && res.surfaces ) {
							mirrorAppSurfacesInCfg( app.slug, res.surfaces );
							scheduleAdminReload( {
								delayMs:      ODD_RELOAD_DELAY_MS_SURFACE,
								slug:         app.slug,
								type:         'app',
								name:         app.name || app.slug,
								toastMessage: __( 'Applying changes…' ),
							} );
							setAppsStatus(
								wrap,
								__( 'Applying changes…' ),
								''
							);
							return;
						}
						box.checked  = ! box.checked;
						rowSurfaces[ key ] = !! box.checked;
						setAppsStatus(
							wrap,
							__( 'Could not update surfaces.' ),
							'error'
						);
					} );
				} );

				return wrapLbl;
			}

			surfacesRow.appendChild(
				makeSurfaceToggle(
					'desktop',
					__( 'Desktop icon' ),
					__( 'Show a shortcut on the desktop.' )
				)
			);
			surfacesRow.appendChild(
				makeSurfaceToggle(
					'taskbar',
					__( 'Taskbar icon' ),
					__( 'Pin a launcher to the bottom taskbar.' )
				)
			);
			card.appendChild( surfacesRow );

			var actions = el( 'div', { class: 'odd-card__actions' } );

			var open = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--primary' } );
			open.textContent = 'Open';
			open.addEventListener( 'click', function () { openAppWindow( app.slug ); } );

			var toggle = el( 'button', { type: 'button', class: 'odd-apps-btn' } );
			toggle.textContent = app.enabled ? 'Disable' : 'Enable';
			toggle.addEventListener( 'click', function () {
				toggleApp( app.slug, ! app.enabled ).then( function ( ok ) {
					if ( ok ) refreshAppsGallery( wrap );
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
						refreshAppsGallery( wrap );
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
		// DEPT_FOR_TYPE + NOUN_FOR_TYPE are hoisted up top so inner
		// helpers (status messaging, routing, etc.) resolve them even
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
				case 'missing_icon':        return __( 'Bundle is missing one of the SVGs it declared.' );
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

		// Deferred full reload after install / surface-save success.
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
					'Installed scene "' + name + '". Refreshing admin…',
					{ scheduleReload: true, delayMs: ODD_RELOAD_DELAY_MS_DEFAULT }
				);
			}
			loadBundleScript( 'scene', slug, entryUrl ).then( function () {
				onInstallSuccessInPanel(
					data,
					'scene',
					slug,
					name,
					'Installed scene "' + name + '". Ready to preview.'
				);
			} ).catch( function () {
				onInstallSuccessInPanel(
					data,
					'scene',
					slug,
					name,
					'Installed scene "' + name + '". Refreshing admin…',
					{ scheduleReload: true, delayMs: ODD_RELOAD_DELAY_MS_DEFAULT }
				);
			} );
		}

		function onInstallSuccessInPanel( data, type, slug, name, message, reloadOpts ) {
			reloadOpts       = reloadOpts || {};
			var scheduleReload = !! reloadOpts.scheduleReload;
			var reloadDelayMs = typeof reloadOpts.delayMs === 'number' ? reloadOpts.delayMs : ODD_RELOAD_DELAY_MS_DEFAULT;
			var noun         = NOUN_FOR_TYPE[ type ] || 'bundle';
			var row          = data && data.row;
			if ( 'app' === type ) {
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
				// REST may return serve_url so we can hydrate `window.odd` +
				// iframe hosts before reload, but Desktop Mode still registers
				// per-app surfaces and native-window metadata during admin boot —
				// a deferred full reload stays the reliable completion path.
				scheduleReload = true;
				reloadDelayMs = ODD_RELOAD_DELAY_MS_DEFAULT;
				message =
					message ||
					( 'Installed app "' + name + '". Refreshing admin…' );
			}
			spliceInstalledRow( type, slug, row, data && data.manifest );
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
						( 'Installed ' + noun + ' "' + name + '". Refreshing admin…' ),
				} );
			} else {
				toast( message || ( 'Installed ' + noun + ' "' + name + '".' ) );
			}
			renderSection( DEPT_FOR_TYPE[ type ] || state.active, { keepQuery: true } );
		}

		// Widget install flow: no reload needed. Dynamically inject
		// the widget's entry script (which self-registers into
		// `wp.desktop.registerWidget`), splice a panel-shaped row
		// into `state.cfg.installedWidgets`, re-render the Widgets
		// department, and flash the new tile. If the script fails to
		// load, we schedule the same deferred admin reload as other
		// registration-bound installs.
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
					'Installed widget "' + name + '". Refreshing admin…',
					{ scheduleReload: true, delayMs: ODD_RELOAD_DELAY_MS_DEFAULT }
				);
			}
			if ( ! entryUrl ) { fallback(); return; }

			loadBundleScript( 'widget', slug, entryUrl ).then( function () {
				spliceInstalledRow( 'widget', slug, row || { id: 'odd/' + slug, slug: slug, label: name, installed: true }, data && data.manifest );
				state.justInstalled = { type: 'widget', slug: slug, name: name, at: Date.now() };
				playShopSound( 'success' );
				toast( 'Installed widget "' + name + '". Added to your widget shelf.' );
				renderSection( 'widgets', { keepQuery: true } );
			} ).catch( function () {
				fallback();
			} );
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

		function uploadBundle( file ) {
			var fd = new FormData();
			fd.append( 'file', file, file.name );
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

		/**
		 * Non-blocking recovery UI: structured server payload + one-click
		 * diagnostics for GitHub issues (plan item 21).
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

		function installShopRailOverflow( body, rail ) {
			if ( ! body || ! rail || rail.__oddRailOverflowInstalled ) return;
			rail.__oddRailOverflowInstalled = true;

			function makeButton( direction ) {
				var label = direction < 0 ? __( 'Scroll store sections up' ) : __( 'Scroll store sections down' );
				var btn = el( 'button', {
					type: 'button',
					class: 'odd-shop__rail-scroll odd-shop__rail-scroll--' + ( direction < 0 ? 'start' : 'end' ),
					'aria-label': label,
				} );
				btn.innerHTML = direction < 0
					? '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 14 6-6 6 6"/></svg>'
					: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 10 6 6 6-6"/></svg>';
				btn.hidden = true;
				return btn;
			}

			var startBtn  = makeButton( -1 );
			var endBtn    = makeButton( 1 );
			var startFade = el( 'span', { class: 'odd-shop__rail-fade odd-shop__rail-fade--start', 'aria-hidden': 'true' } );
			var endFade   = el( 'span', { class: 'odd-shop__rail-fade odd-shop__rail-fade--end', 'aria-hidden': 'true' } );
			startFade.hidden = true;
			endFade.hidden = true;
			body.appendChild( startFade );
			body.appendChild( endFade );
			body.appendChild( startBtn );
			body.appendChild( endBtn );

			function reducedMotion() {
				try {
					return !! ( window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches );
				} catch ( e ) {
					return false;
				}
			}

			function isHorizontalRail() {
				try {
					return window.getComputedStyle && window.getComputedStyle( rail ).flexDirection === 'row';
				} catch ( e ) {
					return false;
				}
			}

			function positionRailChrome() {
				var bodyRect;
				var railRect;
				try {
					bodyRect = body.getBoundingClientRect();
					railRect = rail.getBoundingClientRect();
				} catch ( e ) {
					return;
				}
				var railWidth = Math.max( 0, railRect.width || rail.offsetWidth || 0 );
				var railHeight = Math.max( 0, railRect.height || rail.clientHeight || 0 );
				if ( ! railWidth || ! railHeight ) return;
				var buttonSize = Math.min( 34, Math.max( 28, railWidth - 18 ) );
				var left = Math.round( ( railRect.left - bodyRect.left ) + ( railWidth - buttonSize ) / 2 );
				var top = Math.round( railRect.top - bodyRect.top );
				var bottom = Math.round( railRect.bottom - bodyRect.top );

				startBtn.style.left = left + 'px';
				startBtn.style.top = Math.round( top + 8 ) + 'px';
				startBtn.style.width = buttonSize + 'px';
				startBtn.style.height = buttonSize + 'px';
				endBtn.style.left = left + 'px';
				endBtn.style.top = Math.round( bottom - buttonSize - 8 ) + 'px';
				endBtn.style.width = buttonSize + 'px';
				endBtn.style.height = buttonSize + 'px';

				[ startFade, endFade ].forEach( function ( fade ) {
					fade.style.left = Math.round( railRect.left - bodyRect.left ) + 'px';
					fade.style.width = Math.round( railWidth ) + 'px';
				} );
				startFade.style.top = top + 'px';
				endFade.style.top = Math.round( bottom - Math.min( 54, railHeight / 3 ) ) + 'px';
				endFade.style.height = Math.round( Math.min( 54, railHeight / 3 ) ) + 'px';
			}

			function setFadeVisible( node, visible ) {
				node.hidden = ! visible;
				node.classList.toggle( 'is-visible', !! visible );
			}

			function updateRailOverflow() {
				var horizontal = isHorizontalRail();
				if ( ! horizontal && rail.scrollLeft ) {
					rail.scrollLeft = 0;
				}
				var overflow = ! horizontal && rail.scrollHeight > rail.clientHeight + 2;
				var atStart = ! overflow || rail.scrollTop <= 2;
				var atEnd = ! overflow || rail.scrollTop + rail.clientHeight >= rail.scrollHeight - 2;

				rail.toggleAttribute( 'data-odd-rail-overflow', overflow );
				rail.toggleAttribute( 'data-odd-rail-at-start', atStart );
				rail.toggleAttribute( 'data-odd-rail-at-end', atEnd );

				startBtn.hidden = ! overflow || atStart;
				endBtn.hidden = ! overflow || atEnd;
				setFadeVisible( startFade, overflow && ! atStart );
				setFadeVisible( endFade, overflow && ! atEnd );
				positionRailChrome();
			}

			var raf = 0;
			function scheduleRailUpdate() {
				if ( raf ) return;
				var rafFn = window.requestAnimationFrame || function ( cb ) { return window.setTimeout( cb, 16 ); };
				raf = rafFn( function () {
					raf = 0;
					updateRailOverflow();
				} );
			}

			function scrollRail( direction ) {
				var maxTop = Math.max( 0, rail.scrollHeight - rail.clientHeight );
				var delta = Math.max( 96, Math.round( rail.clientHeight * 0.72 ) );
				var top = Math.max( 0, Math.min( maxTop, rail.scrollTop + direction * delta ) );
				if ( typeof rail.scrollTo === 'function' ) {
					try {
						rail.scrollTo( { top: top, left: 0, behavior: reducedMotion() ? 'auto' : 'smooth' } );
					} catch ( e ) {
						try { rail.scrollTo( 0, top ); } catch ( e2 ) { rail.scrollTop = top; }
					}
				} else {
					rail.scrollTop = top;
				}
				scheduleRailUpdate();
			}

			startBtn.addEventListener( 'click', function () { scrollRail( -1 ); } );
			endBtn.addEventListener( 'click', function () { scrollRail( 1 ); } );
			rail.addEventListener( 'scroll', scheduleRailUpdate, { passive: true } );
			window.addEventListener( 'resize', scheduleRailUpdate );

			var ro = null;
			if ( typeof ResizeObserver !== 'undefined' ) {
				ro = new ResizeObserver( scheduleRailUpdate );
				try {
					ro.observe( body );
					ro.observe( rail );
				} catch ( e3 ) {}
			}

			var mo = null;
			if ( typeof MutationObserver !== 'undefined' ) {
				mo = new MutationObserver( scheduleRailUpdate );
				try { mo.observe( rail, { childList: true, subtree: true } ); } catch ( e4 ) {}
			}

			updateRailOverflow();
			cleanupFns.push( function () {
				if ( raf ) {
					try {
						if ( window.cancelAnimationFrame ) window.cancelAnimationFrame( raf );
					} catch ( e5 ) {}
					try { window.clearTimeout( raf ); } catch ( e6 ) {}
					raf = 0;
				}
				rail.__oddRailOverflowInstalled = false;
				rail.removeEventListener( 'scroll', scheduleRailUpdate );
				window.removeEventListener( 'resize', scheduleRailUpdate );
				if ( ro ) ro.disconnect();
				if ( mo ) mo.disconnect();
				[ startBtn, endBtn, startFade, endFade ].forEach( function ( node ) {
					if ( node && node.parentNode ) node.parentNode.removeChild( node );
				} );
			} );
		}

		// Shop-wide drag-and-drop overlay — accept a .wp dropped
		// anywhere inside the panel, not just on the topbar pill.
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
				if ( ! /\.wp$/i.test( f.name ) ) return;
				e.preventDefault();
				installBundle( f );
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

		// Thin compat adapter — any lingering call sites that render
		// a single catalog row pass through the unified card too.
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

		/**
		 * POST to /odd/v1/bundles/install-from-catalog and funnel
		 * through the same success / failure handlers that the file-
		 * upload path uses, so the UX (highlight, toast, soft reload
		 * for icon sets) is identical regardless of install source.
		 */
		function installFromBundleCatalog( row, btn ) {
			playShopSound( 'install' );
			if ( btn ) {
				btn.disabled = true;
				btn.textContent = 'Installing…';
			}
			toast( 'Installing ' + ( row.name || row.slug ) + '…' );
			var url = ( state.cfg.bundleInstallUrl || '' ) ||
				( ( state.cfg.restUrl || '' ).replace( /\/prefs\/?$/, '' ) + '/bundles/install-from-catalog' );
			fetch( url, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce':   state.cfg.restNonce || '',
				},
				body: JSON.stringify( { slug: row.slug } ),
			} ).then( function ( r ) {
				return r.json().then( function ( data ) {
					return { ok: r.ok, status: r.status, data: data };
				} ).catch( function () {
					return { ok: false, status: r.status, message: 'HTTP ' + r.status };
				} );
			} ).then( function ( res ) {
				if ( res.ok && res.data && res.data.installed ) {
					handleInstallSuccess( res.data );
				} else {
					onInstallFailure( res );
					if ( btn ) {
						btn.disabled = false;
						btn.textContent = 'Install';
					}
				}
			} ).catch( function ( err ) {
				reportError( 'bundles.install-from-catalog', err );
				playShopSound( 'error' );
				toast( ( err && err.message ) || 'Network error while installing.' );
				if ( btn ) {
					btn.disabled = false;
					btn.textContent = 'Install';
				}
			} );
		}

		/**
		 * Dedicated "Install" department — one canonical surface
		 * for dropping a .wp archive of any type (app, icon set,
		 * cursor set, scene, widget) instead of sprinkling "Install from
		 * file…" affordances across every shelf. The topbar
		 * Install pill and the Shop-wide drop overlay still work
		 * from anywhere; this tab just makes the action a
		 * first-class destination with room to explain the format.
		 */
		function renderInstall() {
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--install' } );
			wrap.appendChild( sectionHeader(
				'Install a .wp bundle',
				'Drop a .wp archive to add an app, icon set, cursor set, scene, or widget. One little package, one install ritual, no companion plugins needed. Authors: the .wp manifest reference has the spellbook.',
				{ eyebrow: 'ODD · Universal Installer' }
			) );

			// Primary drop zone. Clicking anywhere inside it fires
			// the hidden topbar <input type="file">, which routes
			// through installBundle() like every other entry point.
			var zone = el( 'div', {
				class: 'odd-shop__dropzone',
				'data-odd-install-zone': '1',
				role: 'button',
				tabindex: '0',
				'aria-label': 'Install a .wp bundle',
			} );
			var zoneGlyph = el( 'div', { class: 'odd-shop__dropzone-glyph', 'aria-hidden': 'true' } );
			zoneGlyph.textContent = '⇪';
			var zoneTitle = el( 'div', { class: 'odd-shop__dropzone-title' } );
			zoneTitle.textContent = 'Drop a .wp bundle here';
			var zoneSub = el( 'div', { class: 'odd-shop__dropzone-sub' } );
			zoneSub.textContent = 'or click to summon one from your computer.';
			var zoneBtn = el( 'button', {
				type: 'button',
				class: 'odd-shop__dropzone-btn',
				'data-odd-install-choose': '1',
			} );
			zoneBtn.textContent = 'Choose .wp file…';
			zone.appendChild( zoneGlyph );
			zone.appendChild( zoneTitle );
			zone.appendChild( zoneSub );
			zone.appendChild( zoneBtn );

			function triggerPicker() {
				var input = document.querySelector( '[data-odd-install-input]' );
				if ( input ) input.click();
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
				if ( ! /\.wp$/i.test( f.name ) ) return;
				e.preventDefault();
				installBundle( f );
			} );
			wrap.appendChild( zone );

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
					desc: 'SVG costume racks for the dock and desktop shortcuts.',
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
		 * Dedicated Settings department — Shuffle + Audio-reactive +
		 * Screensaver used to sit on top of the Wallpapers shelf,
		 * which cluttered scene browsing and hid preferences behind a
		 * department that wasn't really about preferences. They all
		 * live here now. All three continue to write through the same
		 * /odd/v1/prefs endpoint (`shuffle`, `audioReactive`,
		 * `screensaver`), so the REST contract is unchanged.
		 */
		function renderSettings() {
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--settings' } );
			wrap.appendChild( sectionHeader(
				'Settings',
				'Tune the desktop creature: rotate scenes, let sound wake the wallpaper, or dim everything into screensaver mode when you step away.',
				{ eyebrow: 'ODD · Preferences' }
			) );
			wrap.appendChild( renderSystemHealth() );

			var settings = el( 'div', { class: 'odd-wallpaper-settings' } );

			var themeCard = el( 'div', { class: 'odd-setting-card odd-setting-card--appearance' } );
			var themeRow = el( 'div', { class: 'odd-switch-row odd-switch-row--static' } );
			var themeIcon = el( 'span', { class: 'odd-setting-card__icon', 'aria-hidden': 'true' } );
			themeIcon.textContent = '◐';
			var themeText = el( 'span', { class: 'odd-setting-card__text' } );
			var themeLbl = el( 'strong' );
			themeLbl.textContent = __( 'Appearance' );
			var themeHint = el( 'span' );
			themeHint.textContent = __( 'Choose sunny, midnight, or let your system steer.' );
			themeText.appendChild( themeLbl );
			themeText.appendChild( themeHint );
			themeRow.appendChild( themeIcon );
			themeRow.appendChild( themeText );
			var themeControls = el( 'div', { class: 'odd-setting-card__controls odd-setting-card__controls--appearance' } );
			var themeField = el( 'label', { class: 'odd-setting-field' } );
			var themeFieldLabel = el( 'span' );
			themeFieldLabel.textContent = __( 'Theme' );
			var themeSelect = el( 'select', { class: 'odd-select', 'aria-label': __( 'ODD Shop theme' ) } );
			[
				{ value: 'auto',  label: __( 'Auto' ) },
				{ value: 'light', label: __( 'Light' ) },
				{ value: 'dark',  label: __( 'Dark' ) },
			].forEach( function ( opt ) {
				var o = el( 'option', { value: opt.value } );
				o.textContent = opt.label;
				themeSelect.appendChild( o );
			} );
			themeSelect.value = normaliseShopTheme( state.cfg.theme );
			themeField.appendChild( themeFieldLabel );
			themeField.appendChild( themeSelect );
			themeControls.appendChild( themeField );
			themeCard.appendChild( themeRow );
			themeCard.appendChild( themeControls );
			settings.appendChild( themeCard );
			themeSelect.addEventListener( 'change', function () {
				var nextTheme = normaliseShopTheme( themeSelect.value );
				applyShopTheme( body, nextTheme );
				savePrefs( { theme: nextTheme }, function ( data ) {
					state.cfg.theme = normaliseShopTheme( data && data.theme ? data.theme : nextTheme );
					themeSelect.value = state.cfg.theme;
					applyShopTheme( body, state.cfg.theme );
				} );
			} );

			// Shuffle — rotates the wallpaper every N minutes while
			// the desktop window is open. `state.cfg.shuffle` is the
			// committed value from REST; we mirror writes back onto
			// it so a re-render stays in sync.
			var shuffleCard = el( 'div', { class: 'odd-setting-card odd-setting-card--shuffle' } );
			var shuffleRow = el( 'label', { class: 'odd-switch-row' } );
			var shuffleBox = el( 'input', { type: 'checkbox' } );
			shuffleBox.checked = !! ( state.cfg.shuffle && state.cfg.shuffle.enabled );
			var shuffleKnob = el( 'span', { class: 'odd-switch' } );
			var shuffleText = el( 'span', { class: 'odd-setting-card__text' } );
			var shuffleLabel = el( 'strong' );
			shuffleLabel.textContent = __( 'Shuffle every' );
			var shuffleHint = el( 'span' );
			shuffleHint.textContent = __( 'Let the wallpaper wander while the desktop is open.' );
			shuffleText.appendChild( shuffleLabel );
			shuffleText.appendChild( shuffleHint );
			var minutes = el( 'input', {
				type:         'number',
				min:          '1',
				max:          '240',
				class:        'odd-minutes',
				'aria-label': __( 'Shuffle interval (minutes)' ),
			} );
			minutes.value = String( ( state.cfg.shuffle && state.cfg.shuffle.minutes ) || 15 );
			var shuffleControls = el( 'div', { class: 'odd-setting-card__controls' } );
			var minutesPrefix = el( 'span' );
			minutesPrefix.textContent = __( 'Every' );
			var minutesSuffix = el( 'span' );
			minutesSuffix.textContent = __( 'minutes' );
			shuffleRow.appendChild( shuffleBox );
			shuffleRow.appendChild( shuffleKnob );
			shuffleRow.appendChild( shuffleText );
			shuffleControls.appendChild( minutesPrefix );
			shuffleControls.appendChild( minutes );
			shuffleControls.appendChild( minutesSuffix );
			shuffleCard.appendChild( shuffleRow );
			shuffleCard.appendChild( shuffleControls );
			settings.appendChild( shuffleCard );

			function pushShuffle() {
				var m = parseInt( minutes.value, 10 );
				if ( isNaN( m ) ) { m = 15; }
				if ( m < 1 ) m = 1;
				if ( m > 240 ) m = 240;
				minutes.value = String( m );
				savePrefs( { shuffle: { enabled: shuffleBox.checked, minutes: m } }, function ( data ) {
					if ( data && data.shuffle ) state.cfg.shuffle = data.shuffle;
				} );
			}
			shuffleBox.addEventListener( 'change', pushShuffle );
			minutes.addEventListener( 'change', pushShuffle );

			// Audio-reactive — opt-in hook that lets scenes sample
			// the system audio analyser in tick(). Off by default
			// because mic/tab capture requires a user gesture.
			var audioRow = el( 'label', { class: 'odd-setting-card odd-setting-card--audio odd-switch-row' } );
			var audioBox = el( 'input', { type: 'checkbox' } );
			audioBox.checked = !! state.cfg.audioReactive;
			var audioKnob = el( 'span', { class: 'odd-switch' } );
			var audioText = el( 'span', { class: 'odd-setting-card__text' } );
			var audioLbl = el( 'strong' );
			audioLbl.textContent = __( 'Audio-reactive' );
			var audioHint = el( 'span' );
			audioHint.textContent = __( 'Let supported scenes pulse along with nearby sound.' );
			audioText.appendChild( audioLbl );
			audioText.appendChild( audioHint );
			audioRow.appendChild( audioBox );
			audioRow.appendChild( audioKnob );
			audioRow.appendChild( audioText );
			settings.appendChild( audioRow );
			audioBox.addEventListener( 'change', function () {
				savePrefs( { audioReactive: audioBox.checked }, function ( data ) {
					if ( data ) state.cfg.audioReactive = !! data.audioReactive;
				} );
			} );

			// Shop sound effects — local browser preference for the
			// tiny UI chimes generated by this panel. It intentionally
			// does not touch the wallpaper audio-reactive setting above.
			var sfxRow = el( 'label', { class: 'odd-setting-card odd-setting-card--shop-sounds odd-switch-row' } );
			var sfxBox = el( 'input', { type: 'checkbox' } );
			sfxBox.checked = !! state.shopSounds;
			var sfxKnob = el( 'span', { class: 'odd-switch' } );
			var sfxText = el( 'span', { class: 'odd-setting-card__text' } );
			var sfxLbl = el( 'strong' );
			sfxLbl.textContent = __( 'Shop sound effects' );
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

			var chaosRow = el( 'label', { class: 'odd-setting-card odd-setting-card--chaos odd-switch-row' } );
			var chaosBox = el( 'input', { type: 'checkbox' } );
			chaosBox.checked = !! state.cfg.chaosMode;
			var chaosKnob = el( 'span', { class: 'odd-switch' } );
			var chaosText = el( 'span', { class: 'odd-setting-card__text' } );
			var chaosLbl = el( 'strong' );
			chaosLbl.textContent = __( 'Chaos mode' );
			var chaosHint = el( 'span' );
			chaosHint.textContent = __( 'Turn up the color and invite more Oddlings into the aisles.' );
			chaosText.appendChild( chaosLbl );
			chaosText.appendChild( chaosHint );
			chaosRow.appendChild( chaosBox );
			chaosRow.appendChild( chaosKnob );
			chaosRow.appendChild( chaosText );
			settings.appendChild( chaosRow );
			chaosBox.addEventListener( 'change', function () {
				body.setAttribute( 'data-odd-chaos', chaosBox.checked ? '1' : '0' );
				savePrefs( { chaosMode: chaosBox.checked }, function ( data ) {
					state.cfg.chaosMode = !! ( data && data.chaosMode );
					body.setAttribute( 'data-odd-chaos', state.cfg.chaosMode ? '1' : '0' );
					if ( state.cfg.chaosMode && window.__odd && window.__odd.shopCast ) {
						window.__odd.shopCast.run( body, { chaos: true, pluginUrl: state.cfg.pluginUrl || '' } );
					}
				} );
			} );

			// ODD Shop taskbar launcher — Desktop Mode reads native
			// window placement during boot, so changes need a soft
			// reload before the taskbar item appears/disappears.
			var dockRow = el( 'label', { class: 'odd-setting-card odd-setting-card--shop-taskbar odd-switch-row' } );
			var dockBox = el( 'input', { type: 'checkbox' } );
			dockBox.checked = !! state.cfg.shopTaskbar;
			var dockKnob = el( 'span', { class: 'odd-switch' } );
			var dockText = el( 'span', { class: 'odd-setting-card__text' } );
			var dockLbl = el( 'strong' );
			dockLbl.textContent = __( 'Show ODD in Taskbar' );
			var dockHint = el( 'span' );
			dockHint.textContent = __( 'Keep a quick ODD Shop portal in the Desktop Mode taskbar.' );
			dockText.appendChild( dockLbl );
			dockText.appendChild( dockHint );
			dockRow.appendChild( dockBox );
			dockRow.appendChild( dockKnob );
			dockRow.appendChild( dockText );
			settings.appendChild( dockRow );
			dockBox.addEventListener( 'change', function () {
				savePrefs( { shopTaskbar: dockBox.checked }, function ( data ) {
					if ( data && Object.prototype.hasOwnProperty.call( data, 'shopTaskbar' ) ) {
						state.cfg.shopTaskbar = !! data.shopTaskbar;
					}
					scheduleAdminReload( {
						delayMs:      ODD_RELOAD_DELAY_MS_TASKBAR,
						slug:         '',
						type:         'settings',
						name:         __( 'Shop taskbar' ),
						toastMessage: __( 'Updated ODD taskbar setting. Reloading…' ),
					} );
				} );
			} );

			var pinRow = el( 'label', { class: 'odd-setting-card odd-setting-card--shop-desktop-pin odd-switch-row' } );
			var pinBox = el( 'input', { type: 'checkbox' } );
			pinBox.checked = !! state.cfg.shopDesktopPinned;
			var pinKnob = el( 'span', { class: 'odd-switch' } );
			var pinText = el( 'span', { class: 'odd-setting-card__text' } );
			var pinLbl = el( 'strong' );
			pinLbl.textContent = __( 'Pin ODD to desktop wallpaper' );
			var pinHint = el( 'span' );
			pinHint.textContent = __( 'Keep the ODD Shop shortcut in Desktop Mode\'s pinned row with My WordPress (Desktop Mode files layer).' );
			pinText.appendChild( pinLbl );
			pinText.appendChild( pinHint );
			pinRow.appendChild( pinBox );
			pinRow.appendChild( pinKnob );
			pinRow.appendChild( pinText );
			settings.appendChild( pinRow );
			pinBox.addEventListener( 'change', function () {
				savePrefs( { shopDesktopPinned: pinBox.checked }, function ( data ) {
					if ( data && Object.prototype.hasOwnProperty.call( data, 'shopDesktopPinned' ) ) {
						state.cfg.shopDesktopPinned = !! data.shopDesktopPinned;
					}
					scheduleAdminReload( {
						delayMs:      ODD_RELOAD_DELAY_MS_DESKTOP_PIN,
						slug:         '',
						type:         'settings',
						name:         __( 'Desktop shortcut' ),
						toastMessage: __( 'Updated ODD wallpaper shortcut. Reloading…' ),
					} );
				} );
			} );

			// Screensaver — dims into a full-screen scene after N
			// minutes of admin idleness. The scene selector reads
			// the current scene list off state.cfg.scenes so it
			// always reflects whatever is installed.
			var ss = state.cfg.screensaver || { enabled: false, minutes: 5, scene: 'current' };
			var ssRow = el( 'div', { class: 'odd-setting-card odd-setting-card--screensaver' } );

			var ssToggle = el( 'label', { class: 'odd-switch-row' } );
			var ssBox = el( 'input', { type: 'checkbox' } );
			ssBox.checked = !! ss.enabled;
			var ssKnob = el( 'span', { class: 'odd-switch' } );
			var ssText = el( 'span', { class: 'odd-setting-card__text' } );
			var ssLbl = el( 'strong' );
			ssLbl.textContent = __( 'Screensaver after' );
			var ssHint = el( 'span' );
			ssHint.textContent = __( 'Let the desktop drift into a full-screen scene while you are away.' );
			ssText.appendChild( ssLbl );
			ssText.appendChild( ssHint );
			var ssControls = el( 'div', { class: 'odd-setting-card__controls odd-setting-card__controls--screensaver' } );
			var ssMins = el( 'input', {
				type:         'number',
				min:          '1',
				max:          '120',
				class:        'odd-minutes',
				'aria-label': __( 'Screensaver idle timeout (minutes)' ),
			} );
			ssMins.value = String( Math.max( 1, Math.min( 120, ( ss.minutes | 0 ) || 5 ) ) );
			var ssMinsLbl = el( 'span' );
			ssMinsLbl.textContent = __( 'minutes idle' );
			ssToggle.appendChild( ssBox );
			ssToggle.appendChild( ssKnob );
			ssToggle.appendChild( ssText );
			ssRow.appendChild( ssToggle );
			ssControls.appendChild( ssMins );
			ssControls.appendChild( ssMinsLbl );

			var ssSceneWrap = el( 'label', { class: 'odd-setting-field' } );
			var ssSceneLbl = el( 'span' );
			ssSceneLbl.textContent = __( 'Play' );
			var ssSceneSel = el( 'select', { class: 'odd-select' } );
			var ssChoices = [
				{ value: 'current', label: __( 'current scene' ) },
				{ value: 'random',  label: __( 'a random scene' ) },
			];
			( state.cfg.scenes || [] ).forEach( function ( s ) {
				ssChoices.push( { value: s.slug, label: s.label || s.slug } );
			} );
			ssChoices.forEach( function ( opt ) {
				var o = el( 'option', { value: opt.value } );
				o.textContent = opt.label;
				ssSceneSel.appendChild( o );
			} );
			ssSceneSel.value = ss.scene || 'current';
			ssSceneWrap.appendChild( ssSceneLbl );
			ssSceneWrap.appendChild( ssSceneSel );
			ssControls.appendChild( ssSceneWrap );

			var ssPreview = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--pill odd-setting-preview' } );
			ssPreview.textContent = __( 'Preview' );
			ssPreview.addEventListener( 'click', function () {
				var ssApi = window.__odd && window.__odd.screensaver;
				if ( ssApi && typeof ssApi.show === 'function' ) ssApi.show();
			} );
			ssControls.appendChild( ssPreview );
			ssRow.appendChild( ssControls );

			function pushScreensaver() {
				var m = parseInt( ssMins.value, 10 );
				if ( isNaN( m ) ) m = 5;
				if ( m < 1 ) m = 1;
				if ( m > 120 ) m = 120;
				ssMins.value = String( m );
				var patch = {
					screensaver: {
						enabled: ssBox.checked,
						minutes: m,
						scene:   ssSceneSel.value || 'current',
					},
				};
				savePrefs( patch, function ( data ) {
					if ( data && data.screensaver ) {
						state.cfg.screensaver = data.screensaver;
						var ssApi = window.__odd && window.__odd.screensaver;
						if ( ssApi && typeof ssApi.applyPrefs === 'function' ) ssApi.applyPrefs( data.screensaver );
						var events = window.__odd && window.__odd.events;
						if ( events ) { try { events.emit( 'odd.screensaver-prefs-changed', data.screensaver ); } catch ( e ) {} }
					}
				} );
			}
			ssBox.addEventListener( 'change', pushScreensaver );
			ssMins.addEventListener( 'change', pushScreensaver );
			ssSceneSel.addEventListener( 'change', pushScreensaver );

			settings.appendChild( ssRow );
			wrap.appendChild( settings );

			return wrap;
		}

		function renderSystemHealth() {
			var health = state.cfg.systemHealth || {};
			var catalog = health.catalog || {};
			var starter = health.starter || {};
			var apps = health.apps || {};
			var source = catalog.source || 'unknown';
			var warning = source === 'fallback_file' || source === 'stale_option' || source === 'empty' || !! catalog.last_error_message;
			var strip = el( 'div', { class: 'odd-shop__health' + ( warning ? ' is-warning' : ' is-ok' ) } );
			var body = el( 'div', { class: 'odd-shop__health-body' } );
			var title = el( 'strong' );
			title.textContent = source === 'remote' || source === 'transient'
				? __( 'Catalog healthy' )
				: __( 'Catalog needs attention' );
			var detail = el( 'span' );
			var parts = [
				'Catalog: ' + source.replace( /_/g, ' ' ),
				'Bundles: ' + ( catalog.bundle_count || 0 ),
				'Starter: ' + ( starter.status || 'unknown' ),
				'Apps: ' + ( apps.installed || 0 ),
			];
			if ( catalog.last_error_message ) {
				parts.push( 'Last error: ' + catalog.last_error_message );
			}
			detail.textContent = parts.join( ' · ' );
			body.appendChild( title );
			body.appendChild( detail );
			strip.appendChild( body );

			var actions = el( 'div', { class: 'odd-shop__health-actions' } );
			var refreshBtn = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--pill' } );
			refreshBtn.textContent = __( 'Refresh catalog' );
			refreshBtn.addEventListener( 'click', function () {
				refreshBtn.disabled = true;
				refreshBtn.textContent = __( 'Refreshing…' );
				fetch( ( state.cfg.bundleCatalogUrl || '' ).replace( /\/catalog\/?$/, '/refresh' ), {
					method: 'POST',
					credentials: 'same-origin',
					headers: { 'X-WP-Nonce': state.cfg.restNonce || '' },
				} ).then( function ( res ) {
					return res.ok ? res.json() : null;
				} ).then( function ( res ) {
					if ( res && res.meta ) {
						state.cfg.systemHealth = state.cfg.systemHealth || {};
						state.cfg.systemHealth.catalog = res.meta;
					}
					toast( __( 'Catalog refreshed.' ) );
					renderSection( 'settings', { keepQuery: true } );
				} ).catch( function ( err ) {
					reportError( 'bundles.refresh', err );
					toast( __( 'Catalog refresh failed.' ), 'error' );
				} ).finally( function () {
					refreshBtn.disabled = false;
					refreshBtn.textContent = __( 'Refresh catalog' );
				} );
			} );
			actions.appendChild( refreshBtn );

			var copyBtn = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--primary odd-apps-btn--pill' } );
			copyBtn.textContent = __( 'Copy diagnostics' );
			copyBtn.addEventListener( 'click', function () {
				var d = window.__odd && window.__odd.diagnostics;
				if ( d && typeof d.copy === 'function' ) {
					copyBtn.disabled = true;
					d.copy().then( function () {
						copyBtn.textContent = __( 'Copied' );
						setTimeout( function () {
							copyBtn.disabled = false;
							copyBtn.textContent = __( 'Copy diagnostics' );
						}, 2000 );
					} );
				}
			} );
			actions.appendChild( copyBtn );
			strip.appendChild( actions );
			return strip;
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
		 * POST a partial surfaces update (one or both of
		 * { desktop, taskbar }) to the same /toggle route and
		 * return the new, server-normalized shape.
		 *
		 * Native-window registration is request-lifetime; after
		 * success the checkbox handlers call scheduleAdminReload().
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
		/**
		 * Mirror server-normalised `surfaces` onto the cfg.apps row
		 * without forcing a reload pill — callers schedule reload.
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

			// Scenes on disk come from installed bundles (plus
			// the built-in "pending" fallback exposed by the runtime
			// for first-boot safety). The main product shelves below
			// use shopRowsFor('scene') so catalog-only scenes appear in
			// the same card lane they turn into after install.
			var installedScenes = ( Array.isArray( state.cfg.scenes ) ? state.cfg.scenes : [] )
				.filter( function ( s ) { return s && s.slug && s.slug !== 'odd-pending'; } );
			var rows = filterByQuery( shopRowsFor( 'scene' ), state.query );

			// Hero — the currently-active scene, or the first result
			// from installed content. Catalog-only rows stay in the
			// product shelves until installed, so the hero never offers
			// a Preview action for a scene that does not exist on disk.
			var heroScenes = filterByQuery( installedScenes, state.query );
			if ( heroScenes.length ) {
				var featured = pickFeaturedScene( heroScenes );
				if ( featured ) wrap.appendChild( renderWallpaperHero( featured ) );
			}
			var wallpaperEditorial = renderEditorialStrip( rows, 'wallpaper' );
			if ( wallpaperEditorial ) wrap.appendChild( wallpaperEditorial );

			// Category quilt — gradient franchise tiles that jump
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
			// sits closest to the hero. Hidden while searching so the
			// result-focused view stays tight.
			if ( ! state.query ) {
				var recentsShelf = renderPersonalShelf( 'Recents', state.cfg.recents, installedScenes, 'wallpaper' );
				if ( recentsShelf ) wrap.appendChild( recentsShelf );
				var favShelf = renderPersonalShelf( 'Favorites', state.cfg.favorites, installedScenes, 'wallpaper' );
				if ( favShelf ) wrap.appendChild( favShelf );
			}

			var shelves = groupByCategory( rows, 'wallpaper', 'More' );
			shelves.forEach( function ( shelf ) {
				wrap.appendChild( renderShelf( shelf.franchise, shelf.items, renderSceneCard, { scope: 'wallpaper' } ) );
			} );

			return wrap;
		}

		/**
		 * Pick the scene to feature in the department hero.
		 * Prefers the committed-active scene when it's still in the
		 * filtered pool; otherwise falls back to the first result so
		 * search queries always show a hero even when the active
		 * scene was filtered out.
		 */
		function pickFeaturedScene( scenes ) {
			var current = state.cfg.wallpaper || state.cfg.scene;
			for ( var i = 0; i < scenes.length; i++ ) {
				if ( scenes[ i ] && scenes[ i ].heroSafe !== false && scenes[ i ].slug === current ) return scenes[ i ];
			}
			for ( var j = 0; j < scenes.length; j++ ) {
				if ( scenes[ j ] && scenes[ j ].heroSafe !== false ) return scenes[ j ];
			}
			return null;
		}

		function renderWallpaperHero( scene ) {
			var currentSlug = state.cfg.wallpaper || state.cfg.scene;
			var isActive    = scene.slug === currentSlug;
			var previewUrl  = scene.previewUrl || scene.iconUrl || '';

			var hero = el( 'div', {
				class: 'odd-shop__hero',
				'data-hero-slug': scene.slug,
				style: 'background-color:' + ( scene.fallbackColor || '#1d1d1f' ),
			} );
			var bg = el( 'div', { class: 'odd-shop__hero-bg', 'aria-hidden': 'true' } );
			if ( previewUrl ) bg.style.backgroundImage = 'url("' + previewUrl + '")';
			hero.appendChild( bg );
			mountWallpaperHeroScene( bg, scene, previewUrl );
			hero.appendChild( el( 'div', { class: 'odd-shop__hero-scrim', 'aria-hidden': 'true' } ) );

			var inner = el( 'div', { class: 'odd-shop__hero-body' } );
			var eyebrow = el( 'div', { class: 'odd-shop__hero-eyebrow' } );
			eyebrow.textContent = isActive ? 'Currently haunting your desktop' : 'Featured scene';
			var title = el( 'h3', { class: 'odd-shop__hero-title' } );
			title.textContent = scene.label || scene.slug;
			var sub = el( 'p', { class: 'odd-shop__hero-sub' } );
			sub.textContent = heroTagline( scene );
			var actions = el( 'div', { class: 'odd-shop__hero-actions' } );

			if ( isActive && ! state.preview ) {
				var active = el( 'span', { class: 'odd-shop__hero-badge' } );
				active.textContent = '✓ Living here';
				actions.appendChild( active );
			} else {
				var previewBtn = el( 'button', {
					type: 'button',
					class: 'odd-shop__hero-btn odd-shop__hero-btn--primary',
				} );
				previewBtn.innerHTML = '<span aria-hidden="true">▶</span> Preview';
				previewBtn.addEventListener( 'click', function ( e ) {
					e.stopPropagation();
					previewScene( scene.slug );
				} );
				actions.appendChild( previewBtn );
			}

			inner.appendChild( eyebrow );
			inner.appendChild( title );
			inner.appendChild( sub );
			inner.appendChild( actions );
			hero.appendChild( inner );

			var thumb = el( 'div', { class: 'odd-shop__hero-thumb', 'aria-hidden': 'true' } );
			var thumbImg = el( 'img', { src: previewUrl, alt: '', loading: 'lazy' } );
			thumb.appendChild( thumbImg );
			hero.appendChild( thumb );

			return hero;
		}

		function mountWallpaperHeroScene( bg, scene, previewUrl ) {
			if ( ! bg || ! scene || scene.heroSafe === false ) return;
			var reduced = window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
			if ( reduced || ! window.WebGLRenderingContext || ! window.__odd || typeof window.__odd.mountSceneInto !== 'function' ) return;
			var live = el( 'div', { class: 'odd-shop__hero-live', 'aria-hidden': 'true' } );
			bg.appendChild( live );
			var handle = null;
			var destroyed = false;
			var pausedByVisibility = false;
			var perfTimer = 0;
			var mountPromise;
			try {
				mountPromise = window.__odd.mountSceneInto( live, scene.slug, {
					lowPower: true,
					maxFPS: 30,
					resolution: 1,
					heroMode: true,
					desktopStub: { supports: {}, wallpaper: { visible: true, state: 'visible', id: 'odd-shop-hero' }, windows: { all: [], count: 0 }, surfaces: { all: [], count: 0 } },
				} );
			} catch ( err ) {
				reportError( 'panel.hero-scene', err );
				if ( live.parentNode ) live.parentNode.removeChild( live );
				if ( previewUrl ) bg.style.backgroundImage = 'url("' + previewUrl + '")';
				return;
			}
			if ( ! mountPromise || typeof mountPromise.then !== 'function' ) return;
			mountPromise.then( function ( mounted ) {
				if ( destroyed ) {
					if ( mounted && typeof mounted.destroy === 'function' ) mounted.destroy();
					return;
				}
				handle = mounted;
				if ( handle && handle.env && handle.env.perfTier === 'low' ) {
					destroyHero();
				}
				perfTimer = window.setInterval( function () {
					if ( handle && handle.env && handle.env.perfTier === 'low' ) destroyHero();
				}, 1000 );
			} ).catch( function ( err ) {
				if ( destroyed ) return;
				reportError( 'panel.hero-scene', err );
				if ( live.parentNode ) live.parentNode.removeChild( live );
				if ( previewUrl ) bg.style.backgroundImage = 'url("' + previewUrl + '")';
			} );
			function setPaused( paused ) {
				pausedByVisibility = !! paused;
				if ( handle && handle.app && handle.app.ticker ) {
					if ( pausedByVisibility ) handle.app.ticker.stop();
					else handle.app.ticker.start();
				}
			}
			function onVisibility() {
				setPaused( document.visibilityState === 'hidden' );
			}
			function destroyHero() {
				destroyed = true;
				if ( perfTimer ) {
					window.clearInterval( perfTimer );
					perfTimer = 0;
				}
				if ( handle && typeof handle.destroy === 'function' ) handle.destroy();
				handle = null;
				if ( live.parentNode ) live.parentNode.removeChild( live );
			}
			document.addEventListener( 'visibilitychange', onVisibility );
			addSectionCleanup( function () {
				document.removeEventListener( 'visibilitychange', onVisibility );
				destroyHero();
			} );
		}

		/**
		 * Tagline copy for the hero. Uses the scene's tags where
		 * available so each franchise hero reads as distinct; falls
		 * back to a franchise-flavoured line otherwise.
		 */
		function heroTagline( scene ) {
			if ( scene.tagline && typeof scene.tagline === 'string' ) return scene.tagline;
			if ( Array.isArray( scene.tags ) && scene.tags.length ) {
				return scene.tags.slice( 0, 3 ).join( ' · ' );
			}
			switch ( scene.franchise ) {
				case 'Atmosphere':    return 'Painterly weather and ambient light.';
				case 'Paper':         return 'Folded forms drifting through negative space.';
				case 'ODD Originals': return 'House specials from the ODD studio, gently misbehaving.';
				default:              return 'A generative scene that lives, loops, and loiters on your desktop.';
			}
		}

		function renderEditorialStrip( rows, scope ) {
			if ( state.query || ! Array.isArray( rows ) ) return null;
			var picks = rows.filter( function ( row ) { return row && ( row.featured || row.is_new || row.raw && ( row.raw.featured || row.raw.is_new ) ); } );
			if ( ! picks.length ) picks = rows.slice( 0, 3 );
			picks = picks.slice( 0, 3 );
			if ( ! picks.length ) return null;
			var strip = el( 'section', { class: 'odd-shop__editorial odd-shop__editorial--' + ( scope || 'shop' ) } );
			var head = el( 'div', { class: 'odd-shop__editorial-head' } );
			var eyebrow = el( 'div', { class: 'odd-shop__editorial-eyebrow' } );
			eyebrow.textContent = __( 'Today at ODD' );
			var title = el( 'h3', { class: 'odd-shop__editorial-title' } );
			title.textContent = __( 'Fresh from the weird shelf' );
			head.appendChild( eyebrow );
			head.appendChild( title );
			strip.appendChild( head );
			var grid = el( 'div', { class: 'odd-shop__editorial-grid' } );
			picks.forEach( function ( row, i ) {
				var card = el( 'button', {
					type: 'button',
					class: 'odd-shop__editorial-card' + ( i === 0 ? ' is-primary' : '' ),
				} );
				var art = el( 'span', { class: 'odd-shop__editorial-art', 'aria-hidden': 'true' } );
				var img = row.cardUrl || row.previewUrl || row.iconUrl || ( row.raw && ( row.raw.card_url || row.raw.previewUrl || row.raw.icon_url ) ) || '';
				if ( img ) art.style.backgroundImage = 'url("' + img + '")';
				var copy = el( 'span', { class: 'odd-shop__editorial-copy' } );
				var name = el( 'strong' );
				name.textContent = row.name || row.label || row.slug;
				var sub = el( 'span' );
				sub.textContent = row.subtitle || row.description || __( 'Featured in the catalog' );
				copy.appendChild( name );
				copy.appendChild( sub );
				card.appendChild( art );
				card.appendChild( copy );
				card.addEventListener( 'click', function () {
					var inner = content.querySelector( '[data-odd-shop-card][data-slug="' + cssEscape( row.slug ) + '"], [data-odd-shop-card][data-set-slug="' + cssEscape( row.slug ) + '"], [data-odd-shop-card][data-cursor-set-slug="' + cssEscape( row.slug ) + '"], [data-odd-shop-card][data-app-slug="' + cssEscape( row.slug ) + '"]' );
					if ( inner && typeof inner.scrollIntoView === 'function' ) inner.scrollIntoView( { block: 'center', behavior: 'smooth' } );
				} );
				grid.appendChild( card );
			} );
			strip.appendChild( grid );
			return strip;
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

			var allRows = collectSearchRows();
			var matches = filterByQuery( allRows, query );

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
			return String( state.query || state.franchiseFilter || '' ).trim();
		}

		/**
		 * Client-side filter used by the top-bar search pill. Matches
		 * against label, slug, franchise, and any tag — everything the
		 * user can actually see on a card.
		 */
		function filterByQuery( items, query ) {
			var franchise = String( state.franchiseFilter || '' ).toLowerCase().trim();
			if ( ! query && ! franchise ) return items;
			var q = String( query ).toLowerCase().trim();
			if ( ! q && ! franchise ) return items;
			return items.filter( function ( item ) {
				if ( ! item ) return false;
				if ( franchise ) {
					var itemFranchise = String( item.franchise || ( item.raw && item.raw.franchise ) || '' ).toLowerCase();
					var tags = Array.isArray( item.tags ) ? item.tags : [];
					var tagMatch = tags.some( function ( tag ) {
						return String( tag || '' ).toLowerCase() === franchise;
					} );
					if ( itemFranchise !== franchise && ! tagMatch ) return false;
				}
				if ( ! q ) return true;
				var hay = [
					item.label,
					item.name,
					item.slug,
					item.type,
					item.subtitle,
					item.franchise,
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
		 * ordering — `franchiseGradient` gets called during initial
		 * render before sibling `var`-decl palettes would be assigned.
		 *
		 * Named after `franchise` for legacy continuity; we feed
		 * category names through it now (Skies / Wilds / Places /
		 * Forms / Playful / Crafted / Technical / Cool / Default),
		 * keeping a few legacy franchise entries below for fallback.
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
		 * so new franchises always get *something* visual.
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

		function franchiseGradient( name ) {
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
		 * declares a narrow `franchise` string (one per item, more
		 * or less); shelving by franchise produced one-row shelves
		 * everywhere. The slug → category tables below roll those
		 * up into broader buckets so each shelf has real siblings.
		 * Items that aren't curated yet fall back to their declared
		 * franchise so nothing disappears — they'll just appear on
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
			return ( item.franchise && String( item.franchise ) ) || 'More';
		}

		/**
		 * Stable display order for the bucketed shelves. Listed in
		 * descending breadth so the densest categories surface
		 * first; uncategorized franchises fall to the bottom.
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
					style: 'background:' + franchiseGradient( category ),
					'data-franchise-jump': category,
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
		 * without a slug-table entry collapse into their `franchise`
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
				return { franchise: c, items: bag[ c ] };
			} );
		}

		/**
		 * Render a MAS-style shelf: franchise title + count anchor
		 * over a horizontally-scrolling row of cards built by
		 * `cardFn`. `opts.scope` ("wallpaper" | "icons") swaps the
		 * card track class so wallpapers get square-ish tile cards
		 * while icon sets get wide list rows that still wrap on
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

		function renderShelf( franchise, items, cardFn, opts ) {
			opts = opts || {};
			var scope = opts.scope || 'wallpaper';
			var shelf = el( 'section', {
				class: 'odd-shop__shelf',
				'data-shelf-anchor': franchise,
			} );
			var head = el( 'div', { class: 'odd-shop__shelf-head' } );
			var title = el( 'h3', { class: 'odd-shop__shelf-title' } );
			title.textContent = franchise;
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
			items.forEach( function ( item ) {
				track.appendChild( cardFn( item ) );
			} );

			// Wrap the track in a slider shell so we can overlay
			// prev/next pills. The native scroll still works for
			// touch, wheel, and keyboard — buttons are a convenience
			// layer that nudge by roughly-one-card-width on click.
			var slider = el( 'div', { class: 'odd-shop__slider' } );
			var prev = el( 'button', {
				type: 'button',
				class: 'odd-shop__slider-btn odd-shop__slider-btn--prev',
				'aria-label': 'Scroll ' + franchise + ' back',
			} );
			prev.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M15 4 L7 12 L15 20" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
			var next = el( 'button', {
				type: 'button',
				class: 'odd-shop__slider-btn odd-shop__slider-btn--next',
				'aria-label': 'Scroll ' + franchise + ' forward',
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
			if ( typeof window !== 'undefined' && typeof window.setTimeout === 'function' ) {
				window.setTimeout( updateButtons, 0 );
				window.setTimeout( updateButtons, 400 );
			}
			if ( typeof ResizeObserver !== 'undefined' ) {
				try { new ResizeObserver( updateButtons ).observe( track ); } catch ( _e ) {}
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
			// Scene card gets additional preview-state affordances
			// that the generic renderer doesn't know about — the
			// active scene gets the Iris "watching" sticker and the
			// mid-preview tile grows a `is-previewing` class the
			// preview-bar logic keys off. Layer these on after the
			// unified render returns its DOM.
			if ( wrap && row.installed ) decorateSceneCard( wrap, scene );
			return wrap;
		}

		function decorateSceneCard( wrap, scene ) {
			var card = wrap.querySelector( '.odd-shop__card' );
			if ( ! card ) return;
			var currentSlug = state.cfg.wallpaper || state.cfg.scene;
			var active = scene.slug === currentSlug;
			var isPreview = state.preview && state.preview.kind === 'wallpaper' && state.preview.slug === scene.slug;
			if ( isPreview ) {
				card.classList.add( 'is-previewing' );
				wrap.classList.add( 'is-previewing' );
				var btn = wrap.querySelector( '.odd-shop__card-btn' );
				if ( btn ) btn.textContent = 'Previewing';
			}
			if ( active && ! state.preview ) {
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

		function previewScene( slug ) {
			if ( state.posting ) return;
			playShopSound( 'preview' );

			// First click starts a preview; subsequent clicks on other
			// cards just swap the preview target without changing the
			// `originalSlug` we'd revert to on cancel.
			var originalSlug;
			if ( state.preview && state.preview.kind === 'wallpaper' ) {
				originalSlug = state.preview.originalSlug;
			} else if ( state.preview && state.preview.kind === 'iconSet' ) {
				// Entering a wallpaper preview while an icon preview is
				// open just leaves the icon preview in place.
				originalSlug = state.cfg.wallpaper || state.cfg.scene;
			} else {
				originalSlug = state.cfg.wallpaper || state.cfg.scene;
			}

			state.preview = {
				kind: 'wallpaper',
				slug: slug,
				originalSlug: originalSlug,
			};

			// Live-swap the visible wallpaper without persisting.
			pickSceneLive( slug );

			// Re-decorate the grid so "is-previewing" highlights move.
			redecorateSceneGrid();
			renderPreviewBar();
		}

		function pickSceneLive( slug ) {
			if ( window.wp && window.wp.hooks && typeof window.wp.hooks.doAction === 'function' ) {
				try { window.wp.hooks.doAction( 'odd.pickScene', slug ); } catch ( e ) {}
			}
		}

		function redecorateSceneGrid() {
			var cards = content.querySelectorAll( '.odd-card[data-slug]' );
			var currentSlug = state.cfg.wallpaper || state.cfg.scene;
			var previewSlug = state.preview && state.preview.kind === 'wallpaper' ? state.preview.slug : null;
			for ( var i = 0; i < cards.length; i++ ) {
				var c = cards[ i ];
				var slug = c.getAttribute( 'data-slug' );
				c.classList.remove( 'is-active', 'is-previewing' );
				if ( previewSlug && slug === previewSlug ) c.classList.add( 'is-previewing' );
				else if ( ! previewSlug && slug === currentSlug ) c.classList.add( 'is-active' );

				// Keep the inline pill label in sync so the shelf
				// cards mirror the hero state without a full re-render.
				var pill = c.querySelector( '.odd-shop__tile-pill' );
				if ( pill ) {
					if ( previewSlug && slug === previewSlug ) pill.textContent = 'Previewing';
					else if ( ! previewSlug && slug === currentSlug ) pill.textContent = 'Open';
					else pill.textContent = 'Preview';
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
					star.classList.toggle( 'is-on', favOn );
					star.setAttribute( 'aria-pressed', favOn ? 'true' : 'false' );
					star.setAttribute( 'aria-label', favOn ? 'Remove from favorites' : 'Add to favorites' );
					star.setAttribute( 'title', favOn ? 'Unfavorite' : 'Favorite' );
				}

				var thumb = c.querySelector( '.odd-shop__tile-thumb' );
				if ( thumb ) {
					var existingBadge = thumb.querySelector( '.odd-shop__tile-badge' );
					var shouldBadge   = ! previewSlug && slug === currentSlug;
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

		function confirmScenePreview() {
			if ( ! state.preview || state.preview.kind !== 'wallpaper' || state.posting ) return;
			state.posting = true;
			var slug = state.preview.slug;
			// Re-fire even if Preview already swapped — Pixi hook may have
			// wired after the preview action, leaving REST committed but
			// the canvas stale.
			pickSceneLive( slug );

			savePrefs( { wallpaper: slug }, function ( data ) {
				state.posting = false;
				if ( data && typeof data.wallpaper === 'string' ) {
					state.cfg.wallpaper = data.wallpaper;
					state.cfg.scene    = data.wallpaper;
					pickSceneLive( data.wallpaper );
				}
				state.preview = null;
				playShopSound( 'success' );
				redecorateSceneGrid();
				renderPreviewBar();
			} );
		}

		function cancelPreview() {
			if ( ! state.preview ) return;
			playShopSound( 'nav' );
			if ( state.preview.kind === 'wallpaper' ) {
				pickSceneLive( state.preview.originalSlug );
			} else if ( state.preview.kind === 'iconSet' ) {
				restoreIconSnapshot();
			} else if ( state.preview.kind === 'cursorSet' ) {
				setActiveCursorLink( state.preview.originalSlug );
			}
			state.preview = null;
			redecorateSceneGrid();
			redecorateIconGrid();
			redecorateCursorGrid();
			renderPreviewBar();
		}

		/* --- Icons section --- */

		function renderIcons() {
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--icons' } );
			wrap.appendChild( sectionHeader(
				'Icon Sets',
				'Dress the dock and desktop shortcuts in a new costume. Preview the look in place; only the "Default" reset needs a reload.',
				{ eyebrow: 'ODD · Dock Couture' }
			) );

			var sets = Array.isArray( state.cfg.iconSets ) ? state.cfg.iconSets.slice() : [];
			var rows = shopRowsFor( 'icon-set' ).filter( function ( s ) {
				return s && s.slug && s.slug !== 'none';
			} );

			// Quilt + shelves only feature real, themed sets so each
			// category has actual siblings instead of a 1-item shelf.
			// The "Default" pseudo-set is reachable via the dedicated
			// reset pill below — and via the hero, when no custom set
			// has been committed yet.
			var realSets = sets.filter( function ( s ) {
				return s && s.slug && s.slug !== 'none';
			} );

			var defaultSet = {
				slug:        'none',
				label:       'Default',
				franchise:   'WP Desktop Mode',
				description: 'Bring back the stock Dashicons and WP Desktop Mode icons.',
				preview:     '',
				icons:       {},
			};
			var heroPool = state.cfg.iconSet === 'none'
				? [ defaultSet ].concat( realSets )
				: realSets;

			var filtered = filterByQuery( rows, state.query );

			if ( heroPool.length ) {
				var featuredSet = pickFeaturedSet( heroPool );
				if ( featuredSet ) wrap.appendChild( renderIconHero( featuredSet ) );
			}
			var iconEditorial = renderEditorialStrip( rows, 'icons' );
			if ( iconEditorial ) wrap.appendChild( iconEditorial );

			// "Reset to default" pill — only shown when a custom set is
			// committed. Gives users an obvious way back without
			// cluttering the catalog with a singleton "Default" shelf.
			if ( state.cfg.iconSet && state.cfg.iconSet !== 'none' && ! state.query ) {
				var resetRow = el( 'div', { class: 'odd-shop__reset-row' } );
				var resetLeft = el( 'div', { class: 'odd-shop__reset-left' } );
				var resetIcon = el( 'span', { class: 'odd-shop__reset-icon', 'aria-hidden': 'true' } );
				resetIcon.textContent = '↺';
				var resetText = el( 'span', { class: 'odd-shop__reset-text' } );
				resetText.textContent = 'Missing the stock WordPress icon wardrobe?';
				resetLeft.appendChild( resetIcon );
				resetLeft.appendChild( resetText );
				var resetBtn = el( 'button', {
					type: 'button',
					class: 'odd-shop__reset-btn',
				} );
				resetBtn.textContent = 'Reset to default';
				resetBtn.addEventListener( 'click', function () {
					previewIconSet( 'none' );
				} );
				resetRow.appendChild( resetLeft );
				resetRow.appendChild( resetBtn );
				wrap.appendChild( resetRow );
			}

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
					'Install one from the catalog below and give the dock a fresh disguise.',
					'🎛️'
				) );
				return wrap;
			}

			var shelves = groupByCategory( filtered, 'icons', 'More' );
			shelves.forEach( function ( shelf ) {
				wrap.appendChild( renderShelf( shelf.franchise, shelf.items, renderIconSetCard, { scope: 'icons' } ) );
			} );

			return wrap;
		}

		function pickFeaturedSet( sets ) {
			// Only honor a current selection if the user has explicitly
			// picked something; an empty/missing iconSet pref means
			// "fresh user", and the hero should show off a real pack
			// rather than advertise "ship stock WP dock as-is".
			var current = state.cfg.iconSet;
			if ( typeof current === 'string' && current !== '' ) {
				for ( var i = 0; i < sets.length; i++ ) {
					if ( sets[ i ] && sets[ i ].slug === current ) return sets[ i ];
				}
			}
			for ( var j = 0; j < sets.length; j++ ) {
				if ( sets[ j ] && sets[ j ].slug !== 'none' ) return sets[ j ];
			}
			return sets[ 0 ] || null;
		}

		function renderIconHero( set ) {
			var currentSlug = state.cfg.iconSet || '';
			var isActive    = ( set.slug === 'none' && ! currentSlug ) || ( set.slug !== 'none' && set.slug === currentSlug );
			var accent      = set.accent && /^#[0-9a-f]{3,8}$/i.test( set.accent ) ? set.accent : '#0071e3';
			var bannerUrl   = ( state.cfg.pluginUrl || '' ) + '/assets/shop/icons-hero.webp';

			var hero = el( 'div', {
				class: 'odd-shop__hero odd-shop__hero--icons',
				'data-hero-slug': set.slug,
				style: 'background-color:#1d1640',
			} );
			// Editorial banner backdrop — a constellation of pastel
			// app-icon stickers on a deep galactic gradient. Empty
			// left third is intentional headline real estate.
			var bg = el( 'div', { class: 'odd-shop__hero-bg', 'aria-hidden': 'true' } );
			bg.style.backgroundImage = 'url("' + bannerUrl + '")';
			hero.appendChild( bg );
			var scrim = el( 'div', { class: 'odd-shop__hero-scrim', 'aria-hidden': 'true' } );
			hero.appendChild( scrim );

			var inner = el( 'div', { class: 'odd-shop__hero-body' } );
			var eyebrow = el( 'div', { class: 'odd-shop__hero-eyebrow' } );
			eyebrow.textContent = isActive ? 'Current costume' : 'Featured costume';
			var title = el( 'h3', { class: 'odd-shop__hero-title' } );
			title.textContent = set.label || set.slug;
			var sub = el( 'p', { class: 'odd-shop__hero-sub' } );
			sub.textContent = set.description || 'A themed costume pack for the WordPress desktop dock.';
			var actions = el( 'div', { class: 'odd-shop__hero-actions' } );

			if ( isActive && ! state.preview ) {
				var active = el( 'span', { class: 'odd-shop__hero-badge' } );
				active.textContent = '✓ Wearing it';
				actions.appendChild( active );
			} else {
				var previewBtn = el( 'button', {
					type: 'button',
					class: 'odd-shop__hero-btn odd-shop__hero-btn--primary',
				} );
				previewBtn.innerHTML = '<span aria-hidden="true">▶</span> Preview';
				previewBtn.addEventListener( 'click', function ( e ) {
					e.stopPropagation();
					previewIconSet( set.slug );
				} );
				actions.appendChild( previewBtn );
			}

			inner.appendChild( eyebrow );
			inner.appendChild( title );
			inner.appendChild( sub );
			inner.appendChild( actions );
			hero.appendChild( inner );

			// Icon quartet floating bottom-right, mirroring the
			// scene hero's preview thumbnail.
			if ( set.icons && typeof set.icons === 'object' ) {
				var thumb = el( 'div', { class: 'odd-shop__hero-thumb odd-shop__hero-thumb--icons', 'aria-hidden': 'true' } );
				if ( accent ) thumb.style.background = accent;
				var quartet = el( 'div', { class: 'odd-shop__hero-quartet' } );
				[ 'dashboard', 'posts', 'pages', 'media' ].forEach( function ( k ) {
					if ( set.icons[ k ] ) {
						quartet.appendChild( el( 'img', { src: set.icons[ k ], alt: '', loading: 'lazy' } ) );
					}
				} );
				if ( quartet.children.length ) {
					thumb.appendChild( quartet );
					hero.appendChild( thumb );
				}
			}

			return hero;
		}

		/**
		 * Apps hero — editorial banner for the whole department.
		 * The Apps tab doesn't have a "currently active" item the way
		 * Wallpapers + Icon Sets do, so the hero is purely a brand
		 * masthead: backdrop art + eyebrow + headline + tagline. No
		 * action buttons on the hero itself; install + manage actions
		 * live in the rows below.
		 */
		function renderAppsHero() {
			var bannerUrl = ( state.cfg.pluginUrl || '' ) + '/assets/shop/apps-hero.webp';
			var hero = el( 'div', {
				class: 'odd-shop__hero odd-shop__hero--apps',
				'data-hero-slug': 'apps',
				style: 'background-color:#f4d4c5',
			} );
			var bg = el( 'div', { class: 'odd-shop__hero-bg', 'aria-hidden': 'true' } );
			bg.style.backgroundImage = 'url("' + bannerUrl + '")';
			hero.appendChild( bg );
			hero.appendChild( el( 'div', { class: 'odd-shop__hero-scrim', 'aria-hidden': 'true' } ) );

			var inner = el( 'div', { class: 'odd-shop__hero-body' } );
			var eyebrow = el( 'div', { class: 'odd-shop__hero-eyebrow' } );
			eyebrow.textContent = 'Mini Apps';
			var title = el( 'h3', { class: 'odd-shop__hero-title' } );
			title.textContent = 'Tiny apps. Real windows. Zero fuss.';
			var sub = el( 'p', { class: 'odd-shop__hero-sub' } );
			sub.textContent = 'Standalone little programs that live on your WordPress desktop. They do not need WordPress to babysit them; they just open, do the thing, and behave.';
			inner.appendChild( eyebrow );
			inner.appendChild( title );
			inner.appendChild( sub );
			hero.appendChild( inner );

			return hero;
		}

		// Icon-set card adapter — same unified tile as scenes, with a
		// mid-preview overlay + an extra `odd-catalog-row--iconset`
		// marker so `redecorateIconGrid` can still find previously-
		// built rows to toggle between Preview / Previewing / Active.
		function renderIconSetCard( set ) {
			var row = normaliseShopRow( set, 'icon-set' );
			if ( ! row ) return el( 'div' );
			var wrap = renderShopCard( row );
			if ( wrap ) {
				// Legacy marker + data-slug on the inner card so the
				// in-place preview decorator (`redecorateIconGrid`)
				// still finds its tiles after a selection changes.
				var inner = wrap.querySelector( '.odd-shop__card' );
				if ( inner ) {
					inner.classList.add( 'odd-catalog-row--iconset' );
					inner.setAttribute( 'data-slug', set.slug );
				}
				wrap.classList.add( 'odd-catalog-row--iconset-wrap' );
				var isPreview = row.installed && state.preview && state.preview.kind === 'iconSet' && state.preview.slug === set.slug;
				if ( isPreview ) {
					wrap.classList.add( 'is-previewing' );
					if ( inner ) inner.classList.add( 'is-previewing' );
					var btn = wrap.querySelector( '.odd-shop__card-btn' );
					if ( btn ) { btn.textContent = 'Previewing'; btn.disabled = true; }
				}
			}
			return wrap;
		}

		/* --- Cursors section --- */

		function renderCursors() {
			var wrap = el( 'div', { class: 'odd-shop__dept odd-shop__dept--cursors' } );
			wrap.appendChild( sectionHeader(
				'Cursors',
				'Give your pointer a personality. Preview instantly; Apply lets it follow you through Desktop Mode and classic wp-admin.',
				{ eyebrow: 'ODD · Pointer Wardrobe' }
			) );

			var sets = Array.isArray( state.cfg.cursorSets ) ? state.cfg.cursorSets.slice() : [];
			var rows = shopRowsFor( 'cursor-set' ).filter( function ( s ) { return s && s.slug && s.slug !== 'none'; } );
			var realSets = sets.filter( function ( s ) { return s && s.slug && s.slug !== 'none'; } );
			var defaultSet = {
				slug: 'none',
				label: 'Default',
				franchise: 'Browser',
				description: 'Return to the stock browser and operating-system cursors.',
				preview: '',
				cursors: {},
			};
			var heroPool = state.cfg.cursorSet === 'none' ? [ defaultSet ].concat( realSets ) : realSets;
			var filtered = filterByQuery( rows, state.query );

			if ( heroPool.length ) {
				var featured = pickFeaturedCursorSet( heroPool );
				if ( featured ) wrap.appendChild( renderCursorHero( featured ) );
			}
			var cursorEditorial = renderEditorialStrip( rows, 'cursors' );
			if ( cursorEditorial ) wrap.appendChild( cursorEditorial );

			if ( state.cfg.cursorSet && state.cfg.cursorSet !== 'none' && ! state.query ) {
				var resetRow = el( 'div', { class: 'odd-shop__reset-row' } );
				var resetLeft = el( 'div', { class: 'odd-shop__reset-left' } );
				var resetIcon = el( 'span', { class: 'odd-shop__reset-icon', 'aria-hidden': 'true' } );
				resetIcon.textContent = '↺';
				var resetText = el( 'span', { class: 'odd-shop__reset-text' } );
				resetText.textContent = 'Want the native pointer back on duty?';
				resetLeft.appendChild( resetIcon );
				resetLeft.appendChild( resetText );
				var resetBtn = el( 'button', { type: 'button', class: 'odd-shop__reset-btn' } );
				resetBtn.textContent = 'Reset to default';
				resetBtn.addEventListener( 'click', function () { previewCursorSet( 'none' ); } );
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
				wrap.appendChild( renderShelf( shelf.franchise, shelf.items, renderCursorSetCard, { scope: 'cursors' } ) );
			} );
			return wrap;
		}

		function pickFeaturedCursorSet( sets ) {
			var current = state.cfg.cursorSet;
			if ( typeof current === 'string' && current !== '' ) {
				for ( var i = 0; i < sets.length; i++ ) {
					if ( sets[ i ] && sets[ i ].slug === current ) return sets[ i ];
				}
			}
			for ( var j = 0; j < sets.length; j++ ) {
				if ( sets[ j ] && sets[ j ].slug !== 'none' ) return sets[ j ];
			}
			return sets[ 0 ] || null;
		}

		function renderCursorHero( set ) {
			var currentSlug = state.cfg.cursorSet || '';
			var isActive = ( set.slug === 'none' && ! currentSlug ) || ( set.slug !== 'none' && set.slug === currentSlug );
			var hero = el( 'div', {
				class: 'odd-shop__hero odd-shop__hero--cursors',
				'data-hero-slug': set.slug,
				style: 'background-color:#14111f',
			} );
			var bg = el( 'div', { class: 'odd-shop__hero-bg', 'aria-hidden': 'true' } );
			bg.style.background = 'radial-gradient(circle at 72% 24%, rgba(56,232,255,.38), transparent 34%), linear-gradient(135deg,#241033,#111827)';
			hero.appendChild( bg );
			hero.appendChild( el( 'div', { class: 'odd-shop__hero-scrim', 'aria-hidden': 'true' } ) );

			var inner = el( 'div', { class: 'odd-shop__hero-body' } );
			var eyebrow = el( 'div', { class: 'odd-shop__hero-eyebrow' } );
			eyebrow.textContent = isActive ? 'Current pointer mood' : 'Featured pointer mood';
			var title = el( 'h3', { class: 'odd-shop__hero-title' } );
			title.textContent = set.label || set.slug;
			var sub = el( 'p', { class: 'odd-shop__hero-sub' } );
			sub.textContent = set.description || 'A pointer theme with just enough attitude for Desktop Mode and wp-admin.';
			var actions = el( 'div', { class: 'odd-shop__hero-actions' } );
			if ( isActive && ! state.preview ) {
				var active = el( 'span', { class: 'odd-shop__hero-badge' } );
				active.textContent = '✓ Pointing now';
				actions.appendChild( active );
			} else {
				var previewBtn = el( 'button', { type: 'button', class: 'odd-shop__hero-btn odd-shop__hero-btn--primary' } );
				previewBtn.innerHTML = '<span aria-hidden="true">▶</span> Preview';
				previewBtn.addEventListener( 'click', function ( e ) {
					e.stopPropagation();
					previewCursorSet( set.slug );
				} );
				actions.appendChild( previewBtn );
			}
			inner.appendChild( eyebrow );
			inner.appendChild( title );
			inner.appendChild( sub );
			inner.appendChild( actions );
			hero.appendChild( inner );

			var thumbUrl = set.preview || '';
			if ( thumbUrl ) {
				var thumb = el( 'div', { class: 'odd-shop__hero-thumb odd-shop__hero-thumb--cursors', 'aria-hidden': 'true' } );
				thumb.appendChild( el( 'img', { src: thumbUrl, alt: '', loading: 'lazy' } ) );
				hero.appendChild( thumb );
			}
			return hero;
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
				var isPreview = row.installed && state.preview && state.preview.kind === 'cursorSet' && state.preview.slug === set.slug;
				if ( isPreview ) {
					wrap.classList.add( 'is-previewing' );
					if ( inner ) inner.classList.add( 'is-previewing' );
					var btn = wrap.querySelector( '.odd-shop__card-btn' );
					if ( btn ) { btn.textContent = 'Previewing'; btn.disabled = true; }
				}
			}
			return wrap;
		}

		function previewCursorSet( slug ) {
			if ( state.posting ) return;
			playShopSound( 'preview' );
			var current = state.cfg.cursorSet || '';
			if ( ! state.preview || state.preview.kind !== 'cursorSet' ) {
				state.preview = {
					kind: 'cursorSet',
					slug: slug,
					originalSlug: current,
				};
			} else {
				state.preview.slug = slug;
			}
			setActiveCursorLink( slug );
			redecorateCursorGrid();
			renderPreviewBar();
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
			var previewSlug = state.preview && state.preview.kind === 'cursorSet' ? state.preview.slug : null;
			for ( var i = 0; i < rows.length; i++ ) {
				var row = rows[ i ];
				var slug = row.getAttribute( 'data-slug' );
				var isActive = ( slug === 'none' && ! currentSlug ) || ( slug !== 'none' && slug === currentSlug );
				var isPreviewing = previewSlug && slug === previewSlug;
				row.classList.toggle( 'is-active', !! ( isActive && ! previewSlug ) );
				row.classList.toggle( 'is-previewing', !! isPreviewing );
				var wrap = row.closest ? row.closest( '.odd-shop__card-wrap' ) : null;
				if ( wrap ) {
					wrap.classList.toggle( 'is-active', !! ( isActive && ! previewSlug ) );
					wrap.classList.toggle( 'is-previewing', !! isPreviewing );
				}
				var btn = ( wrap && wrap.querySelector( '.odd-shop__card-btn' ) ) || row.querySelector( '.odd-shop__card-btn' );
				if ( btn ) {
					if ( isPreviewing ) {
						btn.textContent = 'Previewing';
						btn.disabled = true;
						btn.classList.add( 'is-disabled' );
					} else if ( isActive && ! previewSlug ) {
						btn.textContent = 'Active';
						btn.disabled = true;
						btn.classList.add( 'is-disabled' );
					} else {
						btn.textContent = 'Preview';
						btn.disabled = false;
						btn.classList.remove( 'is-disabled' );
					}
				}
			}
		}

		function confirmCursorPreview() {
			if ( ! state.preview || state.preview.kind !== 'cursorSet' || state.posting ) return;
			state.posting = true;
			var slug = state.preview.slug;
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
				state.preview = null;
				playShopSound( 'success' );
				redecorateCursorGrid();
				renderPreviewBar();
			} );
		}

		function previewIconSet( slug ) {
			if ( state.posting ) return;
			playShopSound( 'preview' );

			var isNone  = ( slug === 'none' || slug === '' );
			var current = state.cfg.iconSet || '';

			// First entry into preview mode — snapshot the current
			// dock + desktop-shortcut icon <img>.src URLs so Cancel
			// can revert pixel-for-pixel. Subsequent preview
			// switches don't re-snapshot: we always revert to the
			// on-screen state *before* the preview flow started.
			if ( ! state.preview || state.preview.kind !== 'iconSet' ) {
				state.preview = {
					kind:           'iconSet',
					slug:           slug,
					originalSlug:   current,
					iconSnapshot:   snapshotIconDom(),
					reloadOnCommit: isNone,
				};
			} else {
				state.preview.slug           = slug;
				state.preview.reloadOnCommit = isNone;
			}

			if ( isNone ) {
				// No live preview — we can't rebuild the pre-ODD
				// icon URLs client-side. Keep the current icons
				// visible and warn via the preview bar that commit
				// requires a reload.
				restoreIconSnapshot();
			} else {
				liveSwapIcons( slug );
			}

			redecorateIconGrid();
			renderPreviewBar();
		}

		function snapshotIconDom() {
			var snap = [];
			var tiles = document.querySelectorAll( '.desktop-mode-dock__item[data-menu-slug] img' );
			for ( var i = 0; i < tiles.length; i++ ) {
				snap.push( { img: tiles[ i ], src: tiles[ i ].getAttribute( 'src' ) } );
			}
			var shortcuts = document.querySelectorAll( '.desktop-mode-icon[data-icon-id] img' );
			for ( var j = 0; j < shortcuts.length; j++ ) {
				snap.push( { img: shortcuts[ j ], src: shortcuts[ j ].getAttribute( 'src' ) } );
			}
			return snap;
		}

		function restoreIconSnapshot() {
			if ( ! state.preview || ! Array.isArray( state.preview.iconSnapshot ) ) return;
			var snap = state.preview.iconSnapshot;
			for ( var i = 0; i < snap.length; i++ ) {
				var rec = snap[ i ];
				if ( rec && rec.img && rec.src ) rec.img.setAttribute( 'src', rec.src );
			}
		}

		function redecorateIconGrid() {
			var rows = content.querySelectorAll( '.odd-catalog-row--iconset' );
			var currentSlug = state.cfg.iconSet || '';
			var previewSlug = state.preview && state.preview.kind === 'iconSet' ? state.preview.slug : null;
			for ( var i = 0; i < rows.length; i++ ) {
				var row = rows[ i ];
				var slug = row.getAttribute( 'data-slug' );
				var isActive     = ( slug === 'none' && ! currentSlug ) || ( slug !== 'none' && slug === currentSlug );
				var isPreviewing = previewSlug && slug === previewSlug;
				row.classList.toggle( 'is-active',     !! ( isActive && ! previewSlug ) );
				row.classList.toggle( 'is-previewing', !! isPreviewing );
				var wrap = row.closest ? row.closest( '.odd-shop__card-wrap' ) : null;
				if ( wrap ) {
					wrap.classList.toggle( 'is-active',     !! ( isActive && ! previewSlug ) );
					wrap.classList.toggle( 'is-previewing', !! isPreviewing );
				}

				// Support both the unified tile button class and the
				// legacy `.odd-apps-btn` class — the latter still
				// lives on the Icons-department "Reset to default"
				// pill plus any third-party shelves that haven't
				// rebased yet.
				var btn = ( wrap && wrap.querySelector( '.odd-shop__card-btn' ) )
					|| row.querySelector( '.odd-shop__card-btn' )
					|| row.querySelector( '.odd-apps-btn' );
				if ( btn ) {
					if ( isPreviewing ) {
						btn.textContent = 'Previewing';
						btn.disabled = true;
						btn.classList.add( 'is-disabled' );
					} else if ( isActive && ! previewSlug ) {
						btn.textContent = 'Active';
						btn.disabled = true;
						btn.classList.add( 'is-disabled' );
					} else {
						btn.textContent = 'Preview';
						btn.disabled = false;
						btn.classList.remove( 'is-disabled' );
					}
				}
			}
		}

		function confirmIconPreview() {
			if ( ! state.preview || state.preview.kind !== 'iconSet' || state.posting ) return;
			state.posting = true;
			var slug   = state.preview.slug;
			var reload = state.preview.reloadOnCommit;

			savePrefs( { iconSet: slug }, function ( data ) {
				state.posting = false;
				if ( data && typeof data.iconSet === 'string' ) {
					state.cfg.iconSet = data.iconSet;
				}
				state.preview = null;
				playShopSound( 'success' );
				if ( reload ) {
					var iconLabel = slug;
					var sets = Array.isArray( state.cfg.iconSets ) ? state.cfg.iconSets : [];
					for ( var ii = 0; ii < sets.length; ii++ ) {
						if ( sets[ ii ] && sets[ ii ].slug === slug ) {
							iconLabel = sets[ ii ].label || sets[ ii ].name || slug;
							break;
						}
					}
					scheduleAdminReload( {
						delayMs: ODD_RELOAD_DELAY_MS_ICON,
						slug:    slug,
						type:    'icon-set',
						name:    iconLabel,
					} );
					return;
				}
				redecorateIconGrid();
				renderPreviewBar();
			} );
		}

		/**
		 * Rewrite every dock tile and desktop-shortcut icon in the
		 * current document to the selected set's icon URLs. Works
		 * because v1.0.4 switched ODD icons over to real HTTP URLs
		 * (`/odd/v1/icons/{set}/{key}`), which WP Desktop Mode's
		 * `resolveIcon()` renders as `<img>` tags — so we can just
		 * update `.src` in place instead of rebuilding DOM nodes.
		 */
		function liveSwapIcons( slug ) {
			var set = null;
			var sets = Array.isArray( state.cfg.iconSets ) ? state.cfg.iconSets : [];
			for ( var i = 0; i < sets.length; i++ ) {
				if ( sets[ i ] && sets[ i ].slug === slug ) { set = sets[ i ]; break; }
			}
			var icons = ( set && set.icons && typeof set.icons === 'object' ) ? set.icons : null;
			var fallback = icons && icons.fallback ? icons.fallback : '';

			function keyFromMenuSlug( dock ) {
				if ( ! dock ) return '';
				// WPDM sets data-menu-slug to the sanitized html id of
				// the admin menu, typically "menu-posts", "menu-dashboard"…
				var m = /^menu-(.+)$/.exec( dock );
				if ( m && m[ 1 ] ) {
					var k = m[ 1 ];
					if ( k === 'comments' || k === 'appearance'
						|| k === 'plugins'  || k === 'users'
						|| k === 'tools'    || k === 'settings'
						|| k === 'links'    || k === 'profile'
						|| k === 'dashboard'|| k === 'media'
						|| k === 'posts'    || k === 'pages' ) {
						return k;
					}
				}
				return '';
			}

			function resolve( key ) {
				if ( icons && key && icons[ key ] ) return icons[ key ];
				return fallback;
			}

			// Dock tiles (left rail + taskbar).
			var tiles = document.querySelectorAll( '.desktop-mode-dock__item[data-menu-slug]' );
			for ( var t = 0; t < tiles.length; t++ ) {
				var tile = tiles[ t ];
				var url = resolve( keyFromMenuSlug( tile.getAttribute( 'data-menu-slug' ) ) );
				if ( ! url ) continue;
				replaceTileIcon( tile, url );
			}

			// Desktop shortcut icons (buttons inside .desktop-mode-icons).
			var shortcuts = document.querySelectorAll( '.desktop-mode-icon[data-icon-id]' );
			for ( var s = 0; s < shortcuts.length; s++ ) {
				var sc = shortcuts[ s ];
				var id = sc.getAttribute( 'data-icon-id' );
				// Skip the ODD Shop's own icon — keep the
				// eye recognizable regardless of the active set.
				if ( id === 'odd' ) continue;
				var sUrl = resolve( id ) || fallback;
				if ( ! sUrl ) continue;
				replaceShortcutIcon( sc, sUrl );
			}
		}

		function replaceTileIcon( tile, url ) {
			var primary = tile.querySelector( '.desktop-mode-dock__item-primary' );
			if ( ! primary ) return;
			var img = primary.querySelector( '.desktop-mode-dock__item-img' );
			if ( img ) { img.src = url; return; }
			var span = primary.querySelector( '.desktop-mode-dock__item-svg' );
			if ( span ) { span.style.backgroundImage = 'url("' + url + '")'; return; }
			// First paint landed on a letter badge or dashicon —
			// replace it with a fresh <img>.
			var existing = primary.querySelector(
				'.desktop-mode-dock__item-letter, .dashicons'
			);
			if ( existing ) existing.remove();
			var fresh = document.createElement( 'img' );
			fresh.className = 'desktop-mode-dock__item-img';
			fresh.src = url;
			fresh.alt = '';
			fresh.setAttribute( 'aria-hidden', 'true' );
			// Badges and other primary children (badge <span>) come
			// after the icon, so prepend keeps DOM order sane.
			primary.insertBefore( fresh, primary.firstChild );
		}

		function replaceShortcutIcon( sc, url ) {
			var host = sc.querySelector( '.desktop-mode-icon__image' );
			if ( ! host ) return;
			host.className = 'desktop-mode-icon__image';
			host.style.background = '';
			var img = host.querySelector( 'img' );
			if ( img ) { img.src = url; return; }
			while ( host.firstChild ) host.removeChild( host.firstChild );
			var fresh = document.createElement( 'img' );
			fresh.src = url;
			fresh.alt = '';
			host.appendChild( fresh );
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
			// during boot races after a hard reload).
			try {
				var raw = window.localStorage.getItem( 'desktop-mode.widgets' );
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
				if ( shouldAdd && typeof layer.add === 'function' ) {
					var ids = enabledWidgetIds();
					var already = ids.some( function ( x ) {
						if ( typeof x !== 'string' ) {
							return false;
						}
						if ( x === wid || x === id ) {
							return true;
						}
						return x.replace( /^odd\//, '' ) === wid.replace( /^odd\//, '' );
					} );
					if ( already && typeof layer.remove === 'function' ) {
						try {
							layer.remove( wid );
						} catch ( ignored ) {}
					}
					layer.add( wid );
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
					window.wp.hooks.addAction( 'desktop-mode.widget.added', 'odd.widgets', function () {
						if ( state.active === 'widgets' ) renderSection( 'widgets', { keepQuery: true } );
					} );
					window.wp.hooks.addAction( 'desktop-mode.widget.removed', 'odd.widgets', function () {
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

			var rows = filterByQuery( shopRowsFor( 'widget' ), state.query );

			// Hero: whichever widget is currently on the desktop wins.
			// Falls back to the first installed row so the department
			// always has a masthead (catalog-only rows skip the hero).
			var hero = null;
			for ( var i = 0; i < rows.length; i++ ) {
				if ( rows[ i ] && rows[ i ].installed && shopCardIsActive( rows[ i ] ) ) { hero = rows[ i ]; break; }
			}
			if ( ! hero ) {
				for ( var j = 0; j < rows.length; j++ ) {
					if ( rows[ j ] && rows[ j ].installed ) { hero = rows[ j ]; break; }
				}
			}
			if ( hero && ! state.query ) {
				wrap.appendChild( renderWidgetsHero(
					{
						id:          'odd/' + hero.slug,
						label:       hero.name,
						iconUrl:     hero.iconUrl || '',
						glyph:       hero.raw && hero.raw.glyph ? hero.raw.glyph : '',
						gradient:    hero.raw && hero.raw.gradient
							? hero.raw.gradient
							: 'linear-gradient(135deg,#3b3b52 0%,#6d6d8a 55%,#b5b5cc 100%)',
						description: hero.description || 'A desktop widget.',
					},
					shopCardIsActive( hero )
				) );
			}
			var widgetEditorial = renderEditorialStrip( rows, 'widgets' );
			if ( widgetEditorial ) wrap.appendChild( widgetEditorial );

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
				tipText.textContent = 'Added widgets land on the desktop — grab the title bar and park them wherever your dashboard goblin heart desires.';
				tip.appendChild( tipIcon );
				tip.appendChild( tipText );
				wrap.appendChild( tip );
			}

			return wrap;
		}

		function renderWidgetsHero( widget, isEnabled ) {
			var hero = el( 'div', {
				class: 'odd-shop__hero odd-shop__hero--widgets',
				'data-hero-slug': widget.id,
				style: 'background:' + widget.gradient,
			} );
			// Giant translucent glyph floats to the right as the hero's
			// visual anchor — no painted artwork to ship, and the
			// gradient + emoji combo reads instantly across locales.
			// `aria-hidden` keeps screen readers from narrating an
			// emoji that's purely decorative.
			var art = el( 'div', {
				class: 'odd-shop__hero-glyph',
				'aria-hidden': 'true',
			} );
			if ( widget.iconUrl ) {
				art.appendChild( el( 'img', {
					class:   'odd-shop__hero-icon-img',
					src:     widget.iconUrl,
					alt:     '',
					loading: 'lazy',
				} ) );
			} else if ( widget.glyph ) {
				art.textContent = widget.glyph;
			} else {
				art.classList.add( 'odd-shop__hero-glyph--initials' );
				art.textContent = ( widget.label || '' ).slice( 0, 2 ).toUpperCase();
			}
			hero.appendChild( art );
			hero.appendChild( el( 'div', { class: 'odd-shop__hero-scrim', 'aria-hidden': 'true' } ) );

			var inner = el( 'div', { class: 'odd-shop__hero-body' } );
			var eyebrow = el( 'div', { class: 'odd-shop__hero-eyebrow' } );
			eyebrow.textContent = isEnabled ? 'On your desktop' : 'Featured widget';
			var title = el( 'h3', { class: 'odd-shop__hero-title' } );
			title.textContent = widget.label;
			var sub = el( 'p', { class: 'odd-shop__hero-sub' } );
			sub.textContent = widget.description;

			// Use the shared hero-actions/hero-btn pattern so the CTA
			// visually matches anything else we might drop in other
			// departments later. Primary = white pill for "Add";
			// ghost = translucent bordered pill for "Remove from
			// desktop" (the destructive-ish inverse).
			var actions = el( 'div', { class: 'odd-shop__hero-actions' } );
			var cta = el( 'button', {
				type: 'button',
				class: 'odd-shop__hero-btn ' + ( isEnabled ? 'odd-shop__hero-btn--ghost' : 'odd-shop__hero-btn--primary' ),
			} );
			cta.textContent = isEnabled ? 'Remove from desktop' : 'Add to desktop';
			cta.addEventListener( 'click', function () {
				toggleWidget( widget.id, ! isEnabled );
			} );
			actions.appendChild( cta );

			inner.appendChild( eyebrow );
			inner.appendChild( title );
			inner.appendChild( sub );
			inner.appendChild( actions );
			hero.appendChild( inner );
			return hero;
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
				// Random scene swap — chaos commit, no preview bar.
				// Fires through the same live-swap + REST path the
				// wallpaper grid uses when the user confirms, so the
				// active card elsewhere stays in sync on reload.
				if ( state.posting ) return;
				var scenes = Array.isArray( cfg.scenes ) ? cfg.scenes : [];
				var current = cfg.wallpaper || cfg.scene;
				var choices = scenes.filter( function ( s ) { return s && s.slug && s.slug !== current; } );
				if ( choices.length ) {
					var next = choices[ Math.floor( Math.random() * choices.length ) ];
					// If a preview is open, cancel it first so we don't
					// stack two swaps.
					if ( state.preview ) cancelPreview();
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

		/**
		 * Sticky confirmation bar for the preview-and-confirm flow.
		 * Mounted as the last child of the content pane; removed when
		 * `state.preview` is cleared. Keep / Apply writes the pending
		 * change through REST; Cancel reverts the live swap.
		 */
		function renderPreviewBar() {
			var existing = content.querySelector( '[data-odd-preview-bar]' );
			if ( existing && existing.parentNode ) existing.parentNode.removeChild( existing );
			if ( ! state.preview ) return;

			var kind     = state.preview.kind;
			var slug     = state.preview.slug;
			var reload   = state.preview.kind === 'iconSet' && state.preview.reloadOnCommit;
			var itemName = '';
			if ( kind === 'wallpaper' ) {
				var scenes = Array.isArray( state.cfg.scenes ) ? state.cfg.scenes : [];
				for ( var i = 0; i < scenes.length; i++ ) {
					if ( scenes[ i ] && scenes[ i ].slug === slug ) { itemName = scenes[ i ].label || slug; break; }
				}
			} else if ( kind === 'iconSet' ) {
				if ( slug === 'none' || slug === '' ) {
					itemName = 'Default icons';
				} else {
					var sets = Array.isArray( state.cfg.iconSets ) ? state.cfg.iconSets : [];
					for ( var j = 0; j < sets.length; j++ ) {
						if ( sets[ j ] && sets[ j ].slug === slug ) { itemName = sets[ j ].label || slug; break; }
					}
				}
			} else if ( kind === 'cursorSet' ) {
				if ( slug === 'none' || slug === '' ) {
					itemName = 'Default cursors';
				} else {
					var cursorSets = Array.isArray( state.cfg.cursorSets ) ? state.cfg.cursorSets : [];
					for ( var k = 0; k < cursorSets.length; k++ ) {
						if ( cursorSets[ k ] && cursorSets[ k ].slug === slug ) { itemName = cursorSets[ k ].label || slug; break; }
					}
				}
			}

			var bar = el( 'div', { class: 'odd-preview-bar', 'data-odd-preview-bar': '1', role: 'status' } );

			var eye = el( 'div', { class: 'odd-preview-bar__eye', 'aria-hidden': 'true' } );
			eye.textContent = '👁';
			bar.appendChild( eye );

			var text = el( 'div', { class: 'odd-preview-bar__text' } );
			if ( kind === 'wallpaper' ) {
				text.innerHTML = 'Previewing <em></em>. Keep to save, Cancel to revert.';
			} else if ( kind === 'cursorSet' ) {
				text.innerHTML = 'Previewing <em></em> cursors. Apply to save, Cancel to revert.';
			} else if ( reload ) {
				text.innerHTML = 'Applying <em></em> reloads the page to restore stock dock icons.';
			} else {
				text.innerHTML = 'Previewing <em></em> icons. Apply to save, Cancel to revert.';
			}
			text.querySelector( 'em' ).textContent = itemName || slug;
			bar.appendChild( text );

			var actions = el( 'div', { class: 'odd-preview-bar__actions' } );
			var cancel = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--pill', 'data-testid': 'odd-preview-cancel' } );
			cancel.textContent = 'Cancel';
			cancel.addEventListener( 'click', function () { cancelPreview(); } );
			actions.appendChild( cancel );

			var commit = el( 'button', { type: 'button', class: 'odd-apps-btn odd-apps-btn--pill odd-apps-btn--primary', 'data-testid': 'odd-preview-commit' } );
			if ( kind === 'wallpaper' ) {
				commit.textContent = 'Keep';
				commit.addEventListener( 'click', function () { confirmScenePreview(); } );
			} else if ( kind === 'cursorSet' ) {
				commit.textContent = 'Apply';
				commit.addEventListener( 'click', function () { confirmCursorPreview(); } );
			} else {
				commit.textContent = reload ? 'Apply & reload' : 'Apply';
				commit.addEventListener( 'click', function () { confirmIconPreview(); } );
			}
			actions.appendChild( commit );

			bar.appendChild( actions );
			content.appendChild( bar );
		}

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
		function normaliseShopRow( raw, type ) {
			if ( ! raw ) return null;
			var slug = raw.slug || ( raw.id ? String( raw.id ).replace( /^odd\//, '' ) : '' );
			if ( ! slug ) return null;
			var cacheKey = [
				type,
				slug,
				raw.version || '',
				raw.installed === undefined ? 'u' : ( raw.installed ? '1' : '0' ),
				raw.state || '',
				raw.status || '',
				raw.updateAvailable || raw.update_available ? 'u' : '',
				raw.requiresReload ? 'r' : '',
				raw.card_url || raw.cardUrl || '',
				raw.icon_url || raw.icon || '',
				raw.previewUrl || raw.preview_url || raw.preview || '',
			].join( '|' );
			if ( shopRowCache[ cacheKey ] ) {
				diagCount( 'panel.normalise.cacheHit' );
				return Object.assign( {}, shopRowCache[ cacheKey ], { raw: raw } );
			}
			var name = raw.label || raw.name || slug;

			var subtitle = '';
			if ( type === 'scene' ) {
				subtitle = ( categoryOf( raw, 'wallpaper' ) || raw.franchise || 'Scene' ) + ' · Scene';
			} else if ( type === 'icon-set' ) {
				subtitle = ( raw.franchise || 'Icon set' ) + ' · Icon set';
			} else if ( type === 'cursor-set' ) {
				subtitle = ( raw.franchise || 'Cursor set' ) + ' · Cursor set';
			} else if ( type === 'widget' ) {
				subtitle = ( raw.franchise || 'Widget' ) + ' · Widget';
			} else if ( type === 'app' ) {
				subtitle = ( raw.version ? 'v' + raw.version : 'App' ) + ( raw.description ? ' · ' + raw.description.slice( 0, 48 ) : '' );
			}

			var row = {
				slug:          slug,
				type:          type,
				name:          name,
				subtitle:      subtitle,
				description:   raw.description || '',
				version:       raw.version || '',
				franchise:     raw.franchise || '',
				tags:          Array.isArray( raw.tags ) ? raw.tags : [],
				previewUrl:    normaliseCatalogAssetUrl( raw.previewUrl || raw.preview_url || raw.preview || '', type, slug ),
				wallpaperUrl:  normaliseCatalogAssetUrl( raw.wallpaperUrl || raw.wallpaper_url || raw.wallpaper || '', type, slug ),
				iconUrl:       normaliseCatalogAssetUrl( raw.icon_url || raw.icon || '', type, slug ),
				cardUrl:       normaliseCatalogAssetUrl( raw.card_url || raw.cardUrl || '', type, slug ),
				icons:         raw.icons && typeof raw.icons === 'object' ? raw.icons : null,
				cursors:       raw.cursors && typeof raw.cursors === 'object' ? raw.cursors : null,
				preview:       raw.preview || '',
				accent:        raw.accent || '',
				fallbackColor: raw.fallbackColor || '',
				featured:      !! raw.featured,
				builtin:       !! raw.builtin,
				broken:        !! raw.broken || raw.state === 'broken' || raw.status === 'broken',
				incompatible:  !! raw.incompatible || raw.state === 'incompatible' || raw.status === 'incompatible',
				updateAvailable: !! raw.updateAvailable || !! raw.update_available || raw.state === 'updateAvailable',
				requiresReload: !! raw.requiresReload,
				installed:     raw.installed === undefined ? true : !! raw.installed,
				enabled:       raw.enabled !== false,
				raw:           raw,
			};
			shopRowCache[ cacheKey ] = Object.assign( {}, row, { raw: null } );
			return row;
		}

		// Return the list of installed rows for a type, normalised to
		// the unified row shape. Apps come from `state.cfg.apps` (the
		// extension-registry snapshot) — the REST /apps list is only
		// used inside the legacy Apps gallery, but the unified grid
		// doesn't need it.
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
			var key = ( type === 'icon-set' ) ? 'iconSet' : ( type === 'cursor-set' ? 'cursorSet' : type );
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
		// icon-set quartets). Those MUST layer in when the thin installed
		// row lacks them — otherwise widgets lose their thumbnails, apps lose
		// catalogue icons, and icon-set quartet data never appears.
		// Sort: active → installed alphabetical → not-installed alphabetical.
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
			takeIfEmpty( 'franchise' );
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
			if ( cat.description && ! ins.description ) ins.description = cat.description;

			// Refresh subline copy when franchise/version arrive from catalog.
			if ( ins.type === 'widget' ) {
				ins.subtitle = ( ins.franchise || 'Widget' ) + ' · Widget';
			} else if ( ins.type === 'app' ) {
				ins.subtitle = ( ins.version ? 'v' + ins.version : 'App' ) + ( ins.description ? ' · ' + ins.description.slice( 0, 48 ) : '' );
			} else if ( ins.type === 'scene' ) {
				ins.subtitle = ( categoryOf( ins.raw, 'wallpaper' ) || ins.franchise || 'Scene' ) + ' · Scene';
			} else if ( ins.type === 'icon-set' ) {
				ins.subtitle = ( ins.franchise || 'Icon set' ) + ' · Icon set';
			} else if ( ins.type === 'cursor-set' ) {
				ins.subtitle = ( ins.franchise || 'Cursor set' ) + ' · Cursor set';
			}
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
				var aActive = shopCardIsActive( a );
				var bActive = shopCardIsActive( b );
				if ( aActive !== bActive ) return aActive ? -1 : 1;
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

		// Primary action label + kind derived from state. The kind is
		// routed through `dispatchShopAction` below; the label is what
		// the user actually sees on the tile's pill button.
		function shopCardAction( row ) {
			if ( row && row.incompatible ) {
				return { label: 'Incompatible', kind: 'incompatible', disabled: true };
			}
			if ( ! row || ! row.installed ) {
				return { label: 'Install', kind: 'install', disabled: false };
			}
			if ( row.broken ) {
				return { label: 'Repair', kind: 'repair', disabled: false };
			}
			if ( row.updateAvailable ) {
				return { label: 'Update', kind: 'update', disabled: false };
			}
			var pend = state.pendingAdminReload;
			if ( pend && row && row.slug && row.installed && pend.slug === row.slug ) {
				return { label: __( 'Applying…' ), kind: 'pending_reload', disabled: true };
			}
			if ( row.requiresReload ) {
				return { label: __( 'Reload now' ), kind: 'reload', disabled: false };
			}
			if ( shopCardIsActive( row ) ) {
				return { label: 'Active', kind: 'active', disabled: true };
			}
			switch ( row.type ) {
				case 'scene':
				case 'icon-set':
				case 'cursor-set':
					return { label: 'Preview', kind: 'preview', disabled: false };
				case 'widget':
					return { label: 'Add', kind: 'add', disabled: false };
				case 'app':
					return { label: 'Open', kind: 'open', disabled: false };
			}
			return { label: 'Open', kind: 'open', disabled: false };
		}

		function dispatchShopAction( row, kind, btn ) {
			switch ( kind ) {
				case 'install':
					if ( row.type === 'app' ) {
						// Apps install through the same bundle endpoint
						// as every other content type, while keeping the
						// Apps status rail + toast copy.
						var originalLabel = btn ? btn.textContent : 'Install';
						if ( btn ) { btn.disabled = true; btn.textContent = 'Installing…'; }
						playShopSound( 'install' );
						toast( 'Installing ' + row.name + '…' );
						installFromCatalog( row.slug ).then( function ( res ) {
							if ( res && res.ok && res.data && res.data.installed ) {
								handleInstallSuccess( res.data );
								return;
							}
							if ( btn ) { btn.disabled = false; btn.textContent = originalLabel; }
							onInstallFailure( res );
						} );
					} else {
						installFromBundleCatalog( row.raw || row, btn );
					}
					break;
				case 'repair':
				case 'update':
					if ( btn ) { btn.disabled = true; btn.textContent = kind === 'repair' ? 'Repairing…' : 'Updating…'; }
					installFromCatalog( row.slug, { allowUpdate: true } ).then( function ( res ) {
						if ( res && res.ok && res.data && res.data.installed ) {
							handleInstallSuccess( res.data );
							return;
						}
						if ( btn ) { btn.disabled = false; btn.textContent = kind === 'repair' ? 'Repair' : 'Update'; }
						onInstallFailure( res );
					} );
					break;
				case 'preview':
					if ( row.type === 'scene' )    { previewScene( row.slug );    break; }
					if ( row.type === 'icon-set' ) { previewIconSet( row.slug );  break; }
					if ( row.type === 'cursor-set' ) { previewCursorSet( row.slug ); break; }
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
				case 'active':
				case 'incompatible':
				default:
					break;
			}
		}

		// Artwork region of the tile. Shape changes by type:
		//
		//  - scene    → full-bleed preview.webp
		//  - icon-set → 2×2 quartet of the canonical dashboard/posts/
		//               pages/media icons on the shared dark Shop
		//               surface, so sets compare by glyph language
		//               instead of competing background colours
		//  - cursor-set → full-bleed preview tile, falling back to a glyph plate
		//  - widget   → gradient plate with the widget's glyph
		//  - app      → square app icon centered on a soft plate
		function renderShopCardArt( row ) {
			var art = el( 'div', { class: 'odd-shop__card-art odd-shop__card-art--' + row.type, 'aria-hidden': 'true' } );
			function artImg( src, className ) {
				var img = el( 'img', {
					src: src,
					alt: '',
					loading: 'lazy',
					decoding: 'async',
					width: '512',
					height: '512',
				} );
				if ( className ) img.classList.add( className );
				return img;
			}

			if ( row.cardUrl ) {
				art.appendChild( artImg( row.cardUrl, 'odd-shop__card-art-fill' ) );
				return art;
			}

			if ( row.type === 'scene' ) {
				art.style.backgroundColor = row.fallbackColor || '#1d1d22';
				// Catalog rows only ship `icon_url` (a single thumbnail);
				// installed rows have a richer `previewUrl`. Fall back
				// through the chain so neither path renders a broken
				// `<img>` placeholder over the CATALOG badge.
				var sceneUrl = row.previewUrl || row.iconUrl || '';
				if ( sceneUrl ) {
					art.appendChild( artImg( sceneUrl ) );
				} else {
					var sceneMono = el( 'div', { class: 'odd-shop__card-mono' } );
					sceneMono.textContent = ( row.name || row.slug ).slice( 0, 2 ).toUpperCase();
					art.appendChild( sceneMono );
				}
				return art;
			}

			if ( row.type === 'icon-set' ) {
				if ( row.icons ) {
					var quartet = el( 'div', { class: 'odd-shop__card-quartet' } );
					var keys = [ 'dashboard', 'posts', 'pages', 'media' ].filter( function ( k ) { return row.icons[ k ]; } );
					if ( ! keys.length ) keys = Object.keys( row.icons ).slice( 0, 4 );
					keys.slice( 0, 4 ).forEach( function ( k ) {
						quartet.appendChild( artImg( row.icons[ k ] ) );
					} );
					if ( quartet.children.length ) {
						art.appendChild( quartet );
						return art;
					}
				}
				// `preview` is the legacy combined preview image; the
				// remote catalog uses `icon_url` instead, so prefer
				// that. Either renders as a single full-bleed image.
				var iconSetUrl = row.preview || row.iconUrl;
				if ( iconSetUrl ) {
					art.appendChild( artImg( iconSetUrl, 'odd-shop__card-art-fill' ) );
					return art;
				}
				var fallback = el( 'div', { class: 'odd-shop__card-mono' } );
				fallback.textContent = ( row.name || row.slug ).slice( 0, 2 ).toUpperCase();
				art.appendChild( fallback );
				return art;
			}

			if ( row.type === 'cursor-set' ) {
				art.style.background = row.accent || '#38e8ff';
				var cursorUrl = row.preview || row.iconUrl;
				if ( cursorUrl ) {
					art.appendChild( artImg( cursorUrl, 'odd-shop__card-art-fill' ) );
					return art;
				}
				var cursorMono = el( 'div', { class: 'odd-shop__card-mono' } );
				cursorMono.textContent = '➹';
				art.appendChild( cursorMono );
				return art;
			}

			if ( row.type === 'widget' ) {
				art.style.background = 'linear-gradient(135deg,#3b3b52 0%,#6d6d8a 55%,#b5b5cc 100%)';
				if ( row.iconUrl ) {
					art.appendChild( artImg( row.iconUrl, 'odd-shop__card-art-fill' ) );
				} else {
					var wf = el( 'div', { class: 'odd-shop__card-mono' } );
					wf.textContent = ( row.name || row.slug ).slice( 0, 2 ).toUpperCase();
					art.appendChild( wf );
				}
				art.appendChild( el( 'span', { class: 'odd-shop__card-shine' } ) );
				return art;
			}

			if ( row.type === 'app' ) {
				if ( row.iconUrl ) {
					var src = row.iconUrl;
					if ( src.indexOf( 'data:' ) !== 0 && src.indexOf( 'http' ) !== 0 ) {
						src = ( ( state.cfg.restUrl || '' ).replace( /\/prefs\/?$/, '' ) + '/apps/icon/' + row.slug );
					}
					art.appendChild( artImg( src ) );
				} else {
					var mono = el( 'div', { class: 'odd-shop__card-mono' } );
					mono.textContent = ( row.name || row.slug ).slice( 0, 2 ).toUpperCase();
					art.appendChild( mono );
				}
				return art;
			}

			return art;
		}

		// The one and only card renderer for the Shop. Every tile in
		// Wallpapers / Icons / Widgets / Apps — installed or not —
		// flows through this function.
		function renderShopCard( row, opts ) {
			opts = opts || {};
			if ( ! row ) return null;
			var isActive = shopCardIsActive( row );
			var action   = shopCardAction( row );
			var kind     = action.kind;

			var wrap = el( 'div', {
				class: 'odd-shop__card-wrap'
					+ ( row.installed ? ' is-installed' : ' is-catalog' )
					+ ( isActive ? ' is-active' : '' )
					+ ( opts.variant ? ' odd-shop__card-wrap--' + opts.variant : '' ),
				'data-odd-shop-card': '1',
				'data-odd-card-type': row.type,
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
				'aria-label': row.name,
				'data-slug': row.slug,
				'data-odd-cursor': 'pointer',
			} );
			if ( row.type === 'scene' )    card.setAttribute( 'data-scene-slug',  row.slug );
			if ( row.type === 'icon-set' ) card.setAttribute( 'data-set-slug',    row.slug );
			if ( row.type === 'cursor-set' ) card.setAttribute( 'data-cursor-set-slug', row.slug );
			if ( row.type === 'widget' )   card.setAttribute( 'data-widget-id',   'odd/' + row.slug );
			if ( ! row.installed )         card.setAttribute( 'data-catalog-slug', row.slug );
			// Legacy hooks so existing selectors in tests + styles
			// keep matching (e.g. `.odd-card`, `.odd-shop__tile`, the
			// widget-specific `.odd-shop__tile--widget`).
			card.classList.add( 'odd-card', 'odd-shop__tile' );
			if ( row.type === 'widget' ) card.classList.add( 'odd-shop__tile--widget' );

			card.appendChild( renderShopCardArt( row ) );

			if ( isActive ) {
				var pin = el( 'span', { class: 'odd-shop__card-pin', 'aria-hidden': 'true' } );
				pin.innerHTML = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M5 12l4 4 10-10" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
				card.appendChild( pin );
			}

			if ( ! row.installed ) {
				var catalogBadge = el( 'span', { class: 'odd-shop__card-badge odd-shop__card-badge--catalog' } );
				catalogBadge.textContent = 'Catalog';
				card.appendChild( catalogBadge );
			}

			var meta = el( 'div', { class: 'odd-shop__card-meta' } );
			var title = el( 'div', { class: 'odd-shop__card-title odd-shop__tile-title' } );
			title.textContent = row.name;
			var sub = el( 'div', { class: 'odd-shop__card-sub odd-shop__tile-sub' } );
			sub.textContent = row.subtitle || '';
			meta.appendChild( title );
			meta.appendChild( sub );
			card.appendChild( meta );

			var btn = el( 'button', {
				type: 'button',
				class: 'odd-shop__card-btn odd-shop__tile-btn odd-shop__card-btn--' + kind
					+ ( action.disabled ? ' is-disabled' : ' odd-shop__tile-btn--primary' )
					+ ( kind === 'install' ? ' odd-shop__card-btn--install' : '' ),
				'aria-pressed': isActive ? 'true' : 'false',
				'data-odd-cursor': action.disabled ? 'not-allowed' : 'pointer',
			} );
			btn.textContent = action.label;
			if ( action.disabled ) btn.disabled = true;
			btn.addEventListener( 'click', function ( e ) {
				e.stopPropagation();
				if ( btn.disabled ) return;
				dispatchShopAction( row, kind, btn );
			} );

			// Whole-card click mirrors the button for installed rows
			// (so clicking anywhere on a scene tile starts preview)
			// but is a no-op for catalog rows — those require an
			// explicit Install click so misplaced hover-clicks don't
			// trigger a network download.
			card.addEventListener( 'click', function ( e ) {
				if ( e.target && e.target.closest && e.target.closest( '.odd-shop__card-btn' ) ) return;
				if ( ! row.installed ) return;
				if ( action.disabled ) return;
				dispatchShopAction( row, kind, btn );
			} );

			wrap.appendChild( card );
			wrap.appendChild( btn );

			// Favorites star on scenes (the only type with a persisted
			// favorites list today). Stays outside the button shell so
			// nested-interactive rules aren't violated.
			if ( row.type === 'scene' ) {
				var fav = isFavorite( row.slug );
				var star = el( 'span', {
					class: 'odd-shop__card-fav odd-shop__fav' + ( fav ? ' is-on' : '' ),
					role: 'button',
					tabindex: '0',
					'aria-label': fav ? 'Remove from favorites' : 'Add to favorites',
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

		// Cross-reload breadcrumb. Scene / icon-set / app installs
		// trigger a full page reload so their registration (scene.js
		// enqueue, server-canonical dock filter, app native-window +
		// surfaces) actually takes effect. The breadcrumb survives
		// the reload in sessionStorage so the post-reload panel
		// navigates the user to the right department and flashes
		// the new tile.
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
		// it's finished loading — the widget.js is expected to call
		// `wp.desktop.registerWidget` at the bottom of its IIFE, so
		// one microtask after `onload` the bundle is discoverable.
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
					setTimeout( resolve, 0 );
					return;
				}
				var s = document.createElement( 'script' );
				s.src = entryUrl;
				s.async = true;
				s.setAttribute( attr, slug );
				s.onload  = function () { setTimeout( resolve, 16 ); };
				s.onerror = function () { reject( new Error( type + ' script failed to load' ) ); };
				document.head.appendChild( s );
			} );
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

	window.desktopModeNativeWindows.odd = function ( body ) {
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
	};

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
