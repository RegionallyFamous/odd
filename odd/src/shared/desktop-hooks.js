/**
 * ODD ↔ WP Desktop Mode hook bridge.
 * ---------------------------------------------------------------
 * Targets the **wordpress.org** shipping line — currently Desktop Mode
 * **0.7.2** — `desktop-mode.*` wp.hooks, `wp.desktop.*`, layout + registry
 * CustomEvents, and the activity bus. Older host builds (pre-0.7.2) are
 * not supported.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	window.__odd = window.__odd || {};
	if ( window.__odd.desktopHooks ) return;

	var NS = 'odd.desktop-hooks';
	var INSTALLED = [];
	var ODD_WINDOW_PREFIX = 'odd-app-';

	function hooks() {
		return ( window.wp && window.wp.hooks ) || null;
	}

	function desktop() {
		return ( window.wp && window.wp.desktop ) || null;
	}

	function diagnostics() {
		return window.__odd && window.__odd.diagnostics;
	}

	function events() {
		return window.__odd && window.__odd.events;
	}

	function record( level, label, payload ) {
		var d = diagnostics();
		if ( d && typeof d.record === 'function' ) {
			d.record( level || 'info', [ label, payload || {} ] );
		}
	}

	function emit( name, payload ) {
		var e = events();
		if ( e && typeof e.emit === 'function' ) {
			e.emit( name, payload || {} );
		}
	}

	function addAction( name, cb ) {
		var h = hooks();
		if ( ! h || typeof h.addAction !== 'function' ) return;
		try {
			h.addAction( name, NS, cb );
			INSTALLED.push( function () {
				try { h.removeAction( name, NS ); } catch ( _ ) {}
			} );
		} catch ( _ ) {}
	}

	function addFilter( name, cb ) {
		var h = hooks();
		if ( ! h || typeof h.addFilter !== 'function' ) return;
		try {
			h.addFilter( name, NS, cb );
			INSTALLED.push( function () {
				try { h.removeFilter( name, NS ); } catch ( _ ) {}
			} );
		} catch ( _ ) {}
	}

	function addDomEvent( name, cb ) {
		if ( typeof document === 'undefined' || typeof document.addEventListener !== 'function' ) return;
		document.addEventListener( name, cb );
		INSTALLED.push( function () {
			try { document.removeEventListener( name, cb ); } catch ( _ ) {}
		} );
	}

	function addActivity( channel, cb ) {
		var d = desktop();
		if ( ! d || ! d.activity || typeof d.activity.subscribe !== 'function' ) return;
		try {
			var off = d.activity.subscribe( channel, cb );
			if ( typeof off === 'function' ) INSTALLED.push( off );
		} catch ( _ ) {}
	}

	function cfg() {
		return ( window.odd && typeof window.odd === 'object' ) ? window.odd : {};
	}

	function makeDesktopState() {
		return {
			revision: 0,
			supports: {
				windows: false,
				wallpaperSurfaces: false,
				activity: false,
			},
			document: {
				hidden: typeof document !== 'undefined' ? !! document.hidden : false,
			},
			wallpaper: {
				visible: true,
				state: 'visible',
				id: '',
			},
			windows: {
				all: [],
				focusedId: '',
				count: 0,
			},
			surfaces: {
				all: [],
				count: 0,
			},
			activity: {
				window: 0,
				dock: 0,
				presence: 0,
			},
			updatedAt: 0,
		};
	}

	var desktopState = window.__odd.desktopState || makeDesktopState();
	var windowStateById = {};
	var activityTimers = {};
	var warnedShopFullscreen = false;
	window.__odd.desktopState = desktopState;

	function stateNow() {
		return Date.now ? Date.now() : 0;
	}

	function bumpDesktopState() {
		desktopState.revision++;
		desktopState.updatedAt = stateNow();
		emit( 'odd.desktop-state-changed', desktopState );
	}

	function setDesktopSupport( key ) {
		if ( desktopState.supports[ key ] ) return false;
		desktopState.supports[ key ] = true;
		return true;
	}

	function numericOrNull( value ) {
		var n = Number( value );
		return isFinite( n ) ? n : null;
	}

	function normalizeBounds( payload ) {
		if ( ! payload || typeof payload !== 'object' ) return null;
		var b = payload.bounds && typeof payload.bounds === 'object' ? payload.bounds : payload;
		var x = numericOrNull( b.x != null ? b.x : b.left );
		var y = numericOrNull( b.y != null ? b.y : b.top );
		var w = numericOrNull( b.width != null ? b.width : b.w );
		var h = numericOrNull( b.height != null ? b.height : b.h );
		if ( x === null && y === null && w === null && h === null ) return null;
		return {
			x: x === null ? 0 : x,
			y: y === null ? 0 : y,
			width: w === null ? 0 : w,
			height: h === null ? 0 : h,
		};
	}

	function windowIdFromPayload( payload ) {
		if ( ! payload || typeof payload !== 'object' ) return '';
		return String(
			payload.windowId ||
			payload.id ||
			payload.baseId ||
			( payload.config && payload.config.id ) ||
			''
		);
	}

	function refreshWindowList() {
		var out = [];
		Object.keys( windowStateById ).sort().forEach( function ( id ) {
			out.push( windowStateById[ id ] );
		} );
		desktopState.windows.all = out;
		desktopState.windows.count = out.length;
	}

	function updateDesktopWindowState( hookName, payload ) {
		var id = windowIdFromPayload( payload );
		if ( ! id ) return;
		setDesktopSupport( 'windows' );
		if ( hookName === 'desktop-mode.window.closed' || hookName === 'desktop-mode.native-window.before-close' ) {
			delete windowStateById[ id ];
			if ( desktopState.windows.focusedId === id ) desktopState.windows.focusedId = '';
			refreshWindowList();
			bumpDesktopState();
			return;
		}
		var row = windowStateById[ id ] || {
			id: id,
			windowId: id,
			title: '',
			odd: isOddWindow( id ),
			focused: false,
			state: '',
			layoutSource: '',
			bounds: null,
			body: null,
			updatedAt: 0,
		};
		row.windowId = id;
		row.odd = isOddWindow( id );
		if ( payload && typeof payload.title === 'string' ) row.title = payload.title;
		if ( payload && payload.config && typeof payload.config.title === 'string' ) row.title = payload.config.title;
		if ( payload && typeof payload.state === 'string' ) row.state = payload.state;
		if ( hookName === 'desktop-mode.window.maximized' ) row.state = 'maximized';
		if ( hookName === 'desktop-mode.window.unmaximized' || hookName === 'desktop-mode.window.fullscreen-exited' ) row.state = 'normal';
		if ( hookName === 'desktop-mode.window.fullscreen-entered' ) row.state = 'fullscreen';
		var bounds = normalizeBounds( payload );
		if ( bounds ) row.bounds = bounds;
		if ( payload && ( payload.width != null || payload.height != null ) ) {
			row.body = {
				width: numericOrNull( payload.width ) || 0,
				height: numericOrNull( payload.height ) || 0,
			};
		}
		if ( hookName === 'desktop-mode.window.focused' || hookName === 'desktop-mode.window.opened' || hookName === 'desktop-mode.window.reopened' ) {
			desktopState.windows.focusedId = id;
			row.focused = true;
			Object.keys( windowStateById ).forEach( function ( otherId ) {
				if ( otherId !== id ) windowStateById[ otherId ].focused = false;
			} );
		} else if ( hookName === 'desktop-mode.window.blurred' ) {
			row.focused = false;
			if ( desktopState.windows.focusedId === id ) {
				desktopState.windows.focusedId = payload && payload.focusedTo ? String( payload.focusedTo ) : '';
			}
		}
		row.updatedAt = stateNow();
		windowStateById[ id ] = row;
		refreshWindowList();
		pulseActivity( 'window' );
		bumpDesktopState();
	}

	function updateWallpaperState( payload ) {
		payload = payload || {};
		var state = payload.state === 'hidden' ? 'hidden' : 'visible';
		desktopState.wallpaper.state = state;
		desktopState.wallpaper.visible = state !== 'hidden';
		desktopState.wallpaper.id = payload.id ? String( payload.id ) : desktopState.wallpaper.id || '';
		bumpDesktopState();
		emit( 'odd.visibility-changed', { state: state } );
	}

	function updateDocumentVisibilityState() {
		desktopState.document.hidden = typeof document !== 'undefined' ? !! document.hidden : false;
		bumpDesktopState();
	}

	function normalizeSurface( surface, index ) {
		if ( ! surface || typeof surface !== 'object' ) {
			return { id: String( index ), bounds: null };
		}
		return {
			id: String( surface.id || surface.name || index ),
			bounds: normalizeBounds( surface ),
		};
	}

	function updateWallpaperSurfaces( surfaces ) {
		surfaces = Array.isArray( surfaces ) ? surfaces : [];
		setDesktopSupport( 'wallpaperSurfaces' );
		desktopState.surfaces.all = surfaces.map( normalizeSurface );
		desktopState.surfaces.count = desktopState.surfaces.all.length;
		bumpDesktopState();
	}

	function pulseActivity( key ) {
		if ( ! Object.prototype.hasOwnProperty.call( desktopState.activity, key ) ) return;
		setDesktopSupport( 'activity' );
		desktopState.activity[ key ] = 1;
		bumpDesktopState();
		if ( activityTimers[ key ] ) {
			clearTimeout( activityTimers[ key ] );
		}
		activityTimers[ key ] = setTimeout( function () {
			desktopState.activity[ key ] = 0;
			bumpDesktopState();
		}, 1200 );
	}

	function cursors() {
		return window.__odd && window.__odd.cursors;
	}

	function markCursor( node, kind ) {
		var c = cursors();
		if ( c && typeof c.mark === 'function' ) {
			c.mark( node, kind );
		} else if ( node && node.setAttribute ) {
			try { node.setAttribute( 'data-odd-cursor', kind || 'default' ); } catch ( _ ) {}
		}
		return node;
	}

	function markCursorRoot( node ) {
		var c = cursors();
		if ( c && typeof c.markRoot === 'function' ) {
			c.markRoot( node );
		} else if ( node && node.setAttribute ) {
			try { node.setAttribute( 'data-odd-cursor-root', 'true' ); } catch ( _ ) {}
		}
		return node;
	}

	function observeCursorSurface( node, meta ) {
		var c = cursors();
		if ( c && typeof c.observeSurface === 'function' && node ) {
			try { return c.observeSurface( node, meta || {} ); } catch ( _ ) {}
		}
		return false;
	}

	function markCursorDescendants( node ) {
		var c = cursors();
		if ( c && typeof c.markInteractiveDescendants === 'function' ) {
			return c.markInteractiveDescendants( node );
		}
		if ( ! node || ! node.querySelectorAll ) return 0;
		var count = 0;
		var nodes = node.querySelectorAll( 'a[href], button, [role="button"], input, textarea, [contenteditable="true"], [contenteditable=""], select, [draggable="true"], [data-drag], [data-drag-handle], [disabled], [aria-disabled="true"], [aria-busy="true"]' );
		for ( var i = 0; i < nodes.length; i++ ) {
			var el = nodes[ i ];
			if ( el.hasAttribute && el.hasAttribute( 'data-odd-cursor' ) ) continue;
			if ( el.matches && el.matches( 'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, [contenteditable="true"], [contenteditable=""]' ) ) {
				markCursor( el, 'text' );
			} else if ( el.matches && el.matches( '[draggable="true"], [data-drag], [data-drag-handle]' ) ) {
				markCursor( el, 'grab' );
			} else if ( el.matches && el.matches( '[disabled], [aria-disabled="true"]' ) ) {
				markCursor( el, 'not-allowed' );
			} else if ( el.matches && el.matches( '[aria-busy="true"]' ) ) {
				markCursor( el, 'progress' );
			} else {
				markCursor( el, 'pointer' );
			}
			count++;
		}
		return count;
	}

	function elementFromPayload( payload ) {
		if ( ! payload || typeof payload !== 'object' ) return null;
		return payload.element || payload.el || payload.node || payload.host || payload.body || payload.root || null;
	}

	function cssEscape( value ) {
		value = String( value || '' );
		if ( window.CSS && typeof window.CSS.escape === 'function' ) {
			return window.CSS.escape( value );
		}
		return value.replace( /["\\]/g, '\\$&' );
	}

	function findWindowElement( id ) {
		if ( ! id || typeof document === 'undefined' || ! document.querySelector ) return null;
		var q = cssEscape( id );
		var selectors = [
			'[data-window-id="' + q + '"]',
			'[data-windowid="' + q + '"]',
			'[data-desktop-window-id="' + q + '"]',
			'[data-window="' + q + '"]',
			'[data-native-window-id="' + q + '"]',
			'#desktop-mode-native-window-' + q,
			'#desktop-mode-window-' + q,
		];
		for ( var i = 0; i < selectors.length; i++ ) {
			try {
				var found = document.querySelector( selectors[ i ] );
				if ( found ) return found;
			} catch ( _ ) {}
		}
		return null;
	}

	function windowElementFromPayload( payload ) {
		return elementFromPayload( payload ) || findWindowElement( windowIdFromPayload( payload ) );
	}

	function windowInstance( id ) {
		var d = desktop();
		return d && d.windowManager && typeof d.windowManager.getById === 'function'
			? d.windowManager.getById( id )
			: null;
	}

	function stampChromeTheme( payload ) {
		var id = windowIdFromPayload( payload );
		if ( ! id ) return;
		var themeId = payload && payload.themeId ? String( payload.themeId ) : '';
		var root = findWindowElement( id );
		if ( root && root.setAttribute ) {
			root.setAttribute( 'data-odd-chrome-theme', themeId );
			var panels = root.querySelectorAll ? root.querySelectorAll( '.odd-panel.odd-shop' ) : [];
			for ( var i = 0; i < panels.length; i++ ) {
				panels[ i ].setAttribute( 'data-odd-chrome-theme', themeId );
			}
			if ( root.classList && root.classList.contains( 'odd-panel' ) && root.classList.contains( 'odd-shop' ) ) {
				root.setAttribute( 'data-odd-chrome-theme', themeId );
			}
		}
		if ( windowStateById[ id ] ) {
			windowStateById[ id ].chromeTheme = themeId;
			windowStateById[ id ].updatedAt = stateNow();
			refreshWindowList();
			bumpDesktopState();
		}
	}

	function fullscreenOddShopOnTouch( payload ) {
		if ( windowIdFromPayload( payload ) !== 'odd' ) return;
		var api = window.__odd && window.__odd.api;
		if ( ! api || typeof api.isTouchOnly !== 'function' || ! api.isTouchOnly() ) return;
		var win = windowInstance( 'odd' );
		if ( win && win.state === 'fullscreen' ) return;
		var result = typeof api.requestMaximize === 'function' ? api.requestMaximize( desktop() ) : false;
		if ( ! windowStateById.odd ) {
			windowStateById.odd = {
				id: 'odd',
				windowId: 'odd',
				title: 'ODD Shop',
				odd: true,
				focused: true,
				state: '',
				layoutSource: '',
				bounds: null,
				body: null,
				updatedAt: 0,
			};
		}
		windowStateById.odd.layoutSource = result || 'host-normal';
		windowStateById.odd.state = result === 'fullscreen' ? 'fullscreen' : ( win && win.state || windowStateById.odd.state || 'normal' );
		windowStateById.odd.updatedAt = stateNow();
		refreshWindowList();
		bumpDesktopState();
		if ( ! warnedShopFullscreen ) {
			setTimeout( function () {
				var current = windowInstance( 'odd' );
				if ( current && current.state === 'normal' ) {
					warnedShopFullscreen = true;
					if ( window.console && typeof window.console.warn === 'function' ) {
						window.console.warn( '[odd] Shop opened on touch viewport but host did not enter fullscreen' );
					}
				}
			}, 200 );
		}
	}

	function markWindowChrome( root ) {
		if ( ! root || ! root.querySelectorAll ) return 0;
		var count = 0;
		var chrome = root.querySelectorAll( '.desktop-mode-window-titlebar, .desktop-mode-window-header, [data-window-titlebar], [data-window-header], [data-drag-handle], [data-resize-handle], [data-window-drag-handle], [data-window-resize-handle]' );
		for ( var i = 0; i < chrome.length; i++ ) {
			markCursor( chrome[ i ], 'grab' );
			count++;
		}
		var resize = root.querySelectorAll( '[data-resize-handle], [data-window-resize-handle]' );
		for ( var r = 0; r < resize.length; r++ ) {
			markCursor( resize[ r ], 'grab' );
			count++;
		}
		var buttons = root.querySelectorAll( 'button, [role="button"], a[href], [data-window-control], wpd-button, .components-button' );
		for ( var j = 0; j < buttons.length; j++ ) {
			markCursor( buttons[ j ], 'pointer' );
			count++;
		}
		count += markCursorDescendants( root );
		return count;
	}

	function markWidgetChrome( root ) {
		if ( ! root || ! root.querySelectorAll ) return 0;
		var count = 0;
		var chrome = root.querySelectorAll( '.odd-widget__chrome, .odd-widget__move, [data-widget-chrome], [data-widget-drag-handle], [data-drag-handle]' );
		for ( var i = 0; i < chrome.length; i++ ) {
			markCursor( chrome[ i ], 'grab' );
			count++;
		}
		count += markCursorDescendants( root );
		return count;
	}

	function injectCursorIntoFrame( payload ) {
		var frame = payload && ( payload.frame || payload.iframe || payload.element || payload.el );
		var doc = payload && payload.document;
		if ( ! doc && frame ) {
			try { doc = frame.contentDocument; } catch ( _ ) {}
		}
		var c = cursors();
		if ( c && typeof c.injectInto === 'function' && doc ) {
			c.injectInto( doc );
			return true;
		}
		return false;
	}

	function ready( cb ) {
		var d = desktop();
		if ( d && typeof d.ready === 'function' ) {
			d.ready( cb );
			return;
		}
		cb();
	}

	function applyClass( classes, className ) {
		if ( Array.isArray( classes ) ) {
			if ( classes.indexOf( className ) === -1 ) classes.push( className );
			return classes;
		}
		classes = String( classes || '' );
		return classes.indexOf( className ) === -1 ? ( classes + ' ' + className ).trim() : classes;
	}

	function isOddWindow( id ) {
		id = String( id || '' );
		return id === 'odd' || id.indexOf( ODD_WINDOW_PREFIX ) === 0;
	}

	function isOddWidget( id ) {
		return String( id || '' ).indexOf( 'odd/' ) === 0;
	}

	function itemId( item ) {
		if ( ! item || typeof item !== 'object' ) return '';
		return String( item.id || item.windowId || item.baseId || item.menuSlug || item.slug || '' );
	}

	function isOddDockItem( item ) {
		var id = itemId( item );
		if ( isOddWindow( id ) || isOddWidget( id ) ) return true;
		if ( id === 'odd' ) return true;
		if ( item && typeof item.title === 'string' && item.title.indexOf( 'ODD' ) === 0 ) return true;
		if ( item && typeof item.url === 'string' && item.url.indexOf( 'odd' ) !== -1 ) return true;
		return false;
	}

	function isOddCommand( slug ) {
		slug = String( slug || '' );
		return slug === 'shuffle' || slug.indexOf( 'odd' ) === 0;
	}

	function windowIdFromWindow( win ) {
		if ( ! win || typeof win !== 'object' ) return '';
		if ( win.id ) return String( win.id );
		if ( win.windowId ) return String( win.windowId );
		if ( win.config && win.config.id ) return String( win.config.id );
		return '';
	}

	function normalizeWindowPayload( payload ) {
		if ( ! payload || typeof payload !== 'object' ) return {};
		var windowId = payload.windowId || payload.id || '';
		var out = {};
		for ( var key in payload ) {
			if ( Object.prototype.hasOwnProperty.call( payload, key ) ) {
				out[ key ] = payload[ key ];
			}
		}
		if ( windowId && ! out.id ) out.id = windowId;
		if ( windowId && ! out.windowId ) out.windowId = windowId;
		return out;
	}

	function setupWindowDiagnostics() {
		var map = {
			'desktop-mode.window.opened':              'odd.window-opened',
			'desktop-mode.window.reopened':            'odd.window-reopened',
			'desktop-mode.window.content-loading':     'odd.window-content-loading',
			'desktop-mode.window.content-loaded':      'odd.window-content-loaded',
			'desktop-mode.window.closing':             'odd.window-closing',
			'desktop-mode.window.closed':              'odd.window-closed',
			'desktop-mode.window.focused':             'odd.window-focused',
			'desktop-mode.window.blurred':             'odd.window-blurred',
			'desktop-mode.window.changed':             'odd.window-changed',
			'desktop-mode.window.detached':            'odd.window-detached',
			'desktop-mode.window.bounds-changed':      'odd.window-bounds-changed',
			'desktop-mode.window.body-resized':        'odd.window-body-resized',
			'desktop-mode.window.maximized':           'odd.window-maximized',
			'desktop-mode.window.unmaximized':         'odd.window-unmaximized',
			'desktop-mode.window.fullscreen-entered':  'odd.window-fullscreen-entered',
			'desktop-mode.window.fullscreen-exited':   'odd.window-fullscreen-exited',
			'desktop-mode.native-window.after-render': 'odd.native-window-after-render',
			'desktop-mode.native-window.before-close': 'odd.native-window-before-close',
		};
		Object.keys( map ).forEach( function ( hookName ) {
			addAction( hookName, function ( payload ) {
				var windowId = payload && ( payload.windowId || payload.id );
				updateDesktopWindowState( hookName, payload || {} );
				if ( hookName === 'desktop-mode.window.opened' || hookName === 'desktop-mode.window.reopened' ) {
					fullscreenOddShopOnTouch( payload || {} );
				}
				if ( ! isOddWindow( windowId ) ) return;
				var normalized = normalizeWindowPayload( payload );
				record( 'info', hookName, normalized );
				emit( map[ hookName ], normalized );
			} );
		} );

		addFilter( 'desktop-mode.window.loading-overlay', function ( host, ctx ) {
			var windowId = ctx && ctx.windowId;
			if ( ! host || ! isOddWindow( windowId ) ) return host;
			try {
				host.setAttribute( 'data-odd-loading-observed', 'true' );
			} catch ( _ ) {}
			record( 'info', 'desktop-mode.window.loading-overlay', { windowId: windowId } );
			return host;
		} );

		addFilter( 'desktop-mode.native-window.before-render', function ( body, ctx ) {
			var windowId = ctx && ( ctx.windowId || ctx.id || ( ctx.config && ctx.config.id ) );
			if ( ! body ) return body;
			if ( isOddWindow( windowId ) ) {
				try { body.setAttribute( 'data-odd-native-window', windowId ); } catch ( _ ) {}
				record( 'info', 'desktop-mode.native-window.before-render', { windowId: windowId } );
			}
			markCursorRoot( body );
			if ( ! observeCursorSurface( body, {
				source:   'desktop-mode.native-window.before-render',
				windowId: windowId || '',
			} ) ) {
				markWindowChrome( body );
				markCursorDescendants( body );
			}
			return body;
		} );
	}

	function setupIframeDiagnostics() {
		addAction( 'desktop-mode.iframe.error', function ( payload ) {
			record( 'error', 'desktop-mode.iframe.error', payload || {} );
			emit( 'odd.iframe-error', payload || {} );
		} );
		addAction( 'desktop-mode.iframe.network-completed', function ( payload ) {
			if ( ! payload ) return;
			if ( payload.failed || Number( payload.status || 0 ) >= 400 ) {
				record( 'warn', 'desktop-mode.iframe.network-completed', payload );
			}
		} );
		addAction( 'desktop-mode.iframe.ready', function ( payload ) {
			var windowId = payload && payload.windowId;
			var injected = injectCursorIntoFrame( payload );
			record( isOddWindow( windowId ) || injected ? 'info' : 'warn', 'desktop-mode.iframe.ready', {
				windowId: windowId,
				cursorInjected: injected,
			} );
		} );
	}

	function setupWidgetDiagnostics() {
		[
			'desktop-mode.widget.mounting',
			'desktop-mode.widget.added',
			'desktop-mode.widget.removed',
			'desktop-mode.widget.mounted',
			'desktop-mode.widget.unmounting',
		].forEach( function ( hookName ) {
			addAction( hookName, function ( payload ) {
				if ( payload && isOddWidget( payload.id ) ) {
					var el = elementFromPayload( payload );
					if ( el ) {
						markCursorRoot( el );
						if ( ! observeCursorSurface( el, {
							source: 'desktop-mode.widget',
							id:     payload.id || '',
						} ) ) {
							markWidgetChrome( el );
						}
					}
					record( 'info', hookName, payload );
				}
			} );
		} );
		addAction( 'desktop-mode.widget.mount-failed', function ( payload ) {
			if ( payload && isOddWidget( payload.id ) ) {
				record( 'error', 'desktop-mode.widget.mount-failed', payload );
				emit( 'odd.error', {
					source:   'desktop.widget.mount-failed',
					severity: 'error',
					message:  payload.error && payload.error.message || 'Widget mount failed',
					err:      payload.error,
				} );
			}
		} );
	}

	function setupWallpaperDiagnostics() {
		[
			'desktop-mode.wallpaper.mounting',
			'desktop-mode.wallpaper.mounted',
			'desktop-mode.wallpaper.unmounting',
			'desktop-mode.wallpaper.visibility',
		].forEach( function ( hookName ) {
			addAction( hookName, function ( payload ) {
				record( 'info', hookName, payload || {} );
				if ( hookName === 'desktop-mode.wallpaper.visibility' ) {
					updateWallpaperState( payload || {} );
				}
			} );
		} );
		addAction( 'desktop-mode.wallpaper.mount-failed', function ( payload ) {
			record( 'error', 'desktop-mode.wallpaper.mount-failed', payload || {} );
			emit( 'odd.error', {
				source:   'desktop.wallpaper.mount-failed',
				severity: 'error',
				message:  payload && payload.error && payload.error.message || 'Wallpaper mount failed',
				err:      payload && payload.error,
			} );
		} );
		addFilter( 'desktop-mode.wallpaper.surfaces', function ( surfaces ) {
			surfaces = Array.isArray( surfaces ) ? surfaces : [];
			updateWallpaperSurfaces( surfaces );
			record( 'info', 'desktop-mode.wallpaper.surfaces', { count: surfaces.length } );
			return surfaces;
		} );
	}

	function setupDockDiagnostics() {
		addAction( 'desktop-mode.dock.before-render', function ( ctx ) {
			pulseActivity( 'dock' );
			record( 'info', 'desktop-mode.dock.before-render', {
				dockId: ctx && ctx.dockId,
				rail:   ctx && ctx.rail,
				items:  ctx && Array.isArray( ctx.items ) ? ctx.items.length : 0,
			} );
		} );
		addFilter( 'desktop-mode.dock.tile-class', function ( classes, ctx ) {
			if ( ctx && isOddDockItem( ctx.item ) ) {
				return applyClass( classes, 'odd-desktop-tile' );
			}
			return classes;
		} );
		addFilter( 'desktop-mode.dock.tile-element', function ( el, ctx ) {
			if ( el && ctx ) {
				markCursor( el, 'pointer' );
				if ( isOddDockItem( ctx.item ) ) {
					try { el.setAttribute( 'data-odd-dock-tile', itemId( ctx.item ) || 'odd' ); } catch ( _ ) {}
				}
			}
			return el;
		} );
		addFilter( 'desktop-mode.dock.tile-tooltip', function ( label, ctx ) {
			if ( ctx && isOddDockItem( ctx.item ) && label && String( label ).indexOf( 'ODD' ) === -1 ) {
				return String( label ) + ' · ODD';
			}
			return label;
		} );
		[
			'desktop-mode.dock.tile-rendered',
			'desktop-mode.dock.after-render',
			'desktop-mode.dock.item-appended',
			'desktop-mode.dock.item-removed',
		].forEach( function ( hookName ) {
			addAction( hookName, function ( payload ) {
				pulseActivity( 'dock' );
				if ( hookName.indexOf( 'tile' ) !== -1 && payload && ! isOddDockItem( payload.item ) ) return;
				var el = elementFromPayload( payload );
				if ( el ) markCursor( el, 'pointer' );
				record( 'info', hookName, payload || {} );
			} );
		} );
	}

	function setupCursorSurfaceMapping() {
		function mapWindowSurface( payload ) {
			var el = windowElementFromPayload( payload );
			if ( ! el ) return false;
			markCursorRoot( el );
			if ( ! observeCursorSurface( el, {
				source:   'desktop-window-hook',
				windowId: payload && ( payload.windowId || payload.id ) || '',
			} ) ) {
				markWindowChrome( el );
				markCursorDescendants( el );
			}
			record( 'info', 'odd.cursor.window-mapped', {
				windowId: payload && ( payload.windowId || payload.id ),
			} );
			return true;
		}
		[
			'desktop-mode.window.opened',
			'desktop-mode.window.reopened',
			'desktop-mode.window.content-loaded',
			'desktop-mode.window.focused',
			'desktop-mode.window.body-resized',
			'desktop-mode.window.bounds-changed',
			'desktop-mode.window.chrome.applied',
		].forEach( function ( hookName ) {
			addAction( hookName, mapWindowSurface );
		} );
		if ( typeof document !== 'undefined' ) {
			ready( function () {
				var roots = document.querySelectorAll ? document.querySelectorAll( '#desktop-mode-shell, .desktop-mode, .desktop-mode-shell, [data-window-id], [data-windowid], [data-desktop-window-id], [data-native-window-id]' ) : [];
				for ( var i = 0; i < roots.length; i++ ) {
					markCursorRoot( roots[ i ] );
					if ( ! observeCursorSurface( roots[ i ], { source: 'desktop-ready-sweep' } ) ) {
						markWindowChrome( roots[ i ] );
					}
				}
			} );
		}
	}

	function setupCommandDiagnostics() {
		addFilter( 'desktop-mode.command.before-run', function ( intent ) {
			if ( intent && isOddCommand( intent.slug ) ) {
				record( 'info', 'desktop-mode.command.before-run', intent );
			}
			return intent;
		} );
		addAction( 'desktop-mode.command.after-run', function ( payload ) {
			if ( payload && isOddCommand( payload.slug ) ) {
				record( 'info', 'desktop-mode.command.after-run', payload );
			}
		} );
		addAction( 'desktop-mode.command.error', function ( payload ) {
			if ( payload && isOddCommand( payload.slug ) ) {
				record( 'error', 'desktop-mode.command.error', payload );
				emit( 'odd.error', {
					source:   'desktop.command.' + payload.slug,
					severity: 'error',
					message:  payload.error && payload.error.message || 'ODD command failed',
					err:      payload.error,
				} );
			}
		} );
		addFilter( 'desktop-mode.open-command.items', function ( items ) {
			items = Array.isArray( items ) ? items : [];
			var api = window.__odd && window.__odd.api;
			items.push( {
				id:          'odd',
				label:       'ODD Shop',
				description: 'Open the ODD Shop.',
				icon:        'dashicons-cart',
				open:        function () { if ( api && typeof api.openPanel === 'function' ) api.openPanel(); },
			} );
			var apps = cfg().apps;
			if ( Array.isArray( apps ) && window.wp && window.wp.desktop && typeof window.wp.desktop.openWindow === 'function' ) {
				apps.forEach( function ( app ) {
					if ( ! app || ! app.slug ) return;
					items.push( {
						id:          'odd-app-' + app.slug,
						label:       app.name || app.label || app.slug,
						description: 'Open ODD app.',
						icon:        app.icon || 'dashicons-screenoptions',
						open:        function () { window.wp.desktop.openWindow( 'odd-app-' + app.slug ); },
					} );
				} );
			}
			return items;
		} );
	}

	function setupLayoutDiagnostics() {
		addDomEvent( 'desktop-mode-layout-changed', function ( event ) {
			var detail = event && event.detail || {};
			record( 'info', 'desktop-mode-layout-changed', detail );
			emit( 'odd.desktop-layout-changed', detail );
		} );
		addDomEvent( 'desktop-mode-registry-changed', function ( event ) {
			var detail = event && event.detail || {};
			record( 'info', 'desktop-mode-registry-changed', detail );
			emit( 'odd.host-registry-changed', detail );
			// Host shell/live-activation syncs `nativeWindows` without always
			// reloading the page. Re-run app window registration when an ODD app
			// id appears so `desktopModeNativeWindows['odd-app-*']` exists before
			// `openWindow` (matches WP.org desktop-mode 0.7.2+ payload apply).
			if ( ! detail || detail.registry !== 'native-windows' || ! Array.isArray( detail.added ) ) return;
			var needsOdd = false;
			for ( var i = 0; i < detail.added.length; i++ ) {
				var rid = detail.added[ i ];
				if ( typeof rid === 'string' && rid.indexOf( ODD_WINDOW_PREFIX ) === 0 ) {
					needsOdd = true;
					break;
				}
			}
			if ( ! needsOdd ) return;
			var reg = window.__odd && window.__odd.apps && window.__odd.apps.registerWpdmCallbacks;
			if ( typeof reg === 'function' ) {
				try { reg(); } catch ( _e ) {}
			}
		} );
		addDomEvent( 'desktop-mode-presence-changed', function ( event ) {
			pulseActivity( 'presence' );
			record( 'info', 'desktop-mode-presence-changed', event && event.detail || {} );
		} );
		addDomEvent( 'visibilitychange', updateDocumentVisibilityState );
	}

	function setupActivityDiagnostics() {
		[
			'desktop-mode/toast-requested',
			'desktop-mode/toast-shown',
			'desktop-mode/window-attention-requested',
			'desktop-mode/badge-changed',
			'desktop-mode/open-requested',
			'desktop-mode/presence-changed',
			'desktop-mode/presence-snapshot-applied',
		].forEach( function ( channel ) {
			addActivity( channel, function ( payload ) {
				if ( channel.indexOf( 'presence' ) !== -1 ) pulseActivity( 'presence' );
				else if ( channel.indexOf( 'window' ) !== -1 ) pulseActivity( 'window' );
				else pulseActivity( 'dock' );
				record( 'info', 'wp.desktop.activity.' + channel, payload || {} );
			} );
		} );
	}

	function setupTitlebarButton() {
		ready( function () {
			var d = desktop();
			if ( ! d || typeof d.registerTitleBarButton !== 'function' ) return;
			try {
				d.registerTitleBarButton( {
					id:        'odd/copy-diagnostics',
					label:     'Copy ODD diagnostics',
					icon:      'dashicons-clipboard',
					placement: 'right',
					order:     80,
					owner:     'odd-desktop-hooks',
					match:     function ( win ) { return isOddWindow( windowIdFromWindow( win ) ); },
					onClick:   function () {
						var diag = diagnostics();
						if ( diag && typeof diag.copy === 'function' ) diag.copy();
					},
				} );
			} catch ( _ ) {}
		} );
	}

	function setupDevtoolsDiagnostics() {
		var requestDisposers = {};
		addAction( 'desktop-mode.window.opened', function ( payload ) {
			var windowId = payload && ( payload.windowId || payload.id );
			var d = desktop();
			if ( ! isOddWindow( windowId ) || ! d || ! d.devtools || typeof d.devtools.onRequest !== 'function' ) return;
			if ( requestDisposers[ windowId ] ) return;
			try {
				requestDisposers[ windowId ] = d.devtools.onRequest( windowId, function ( req ) {
					if ( req && ( req.failed || Number( req.status || 0 ) >= 400 ) ) {
						record( 'warn', 'wp.desktop.devtools.request', req );
					}
				}, { observe: false } );
				INSTALLED.push( function () {
					if ( requestDisposers[ windowId ] ) {
						try { requestDisposers[ windowId ](); } catch ( _ ) {}
						delete requestDisposers[ windowId ];
					}
				} );
			} catch ( _ ) {}
		} );
	}

	function setupBroadSurfaceDiagnostics() {
		[
			'desktop-mode.window.chrome.theme-changed',
			'desktop-mode.window.chrome.applied',
		].forEach( function ( hookName ) {
			addAction( hookName, function ( payload ) {
				stampChromeTheme( payload || {} );
				record( 'info', hookName, payload || {} );
			} );
		} );
		addAction( 'desktop-mode.desktop-icon.clicked', function ( payload ) {
			record( 'info', 'desktop-mode.desktop-icon.clicked', payload || {} );
			if ( payload && payload.id === 'odd' ) {
				emit( 'odd.desktop-icon-clicked', payload );
			}
		} );
		addAction( 'desktop-mode.window.attention', function ( payload ) {
			record( 'info', 'desktop-mode.window.attention', payload || {} );
		} );

		ready( function () {
			var d = desktop();
			if ( ! d ) return;
			record( 'info', 'wp.desktop.surface-summary', {
				palettes:      d.listPalettes && typeof d.listPalettes === 'function' ? d.listPalettes().length : null,
				settingsTabs:  d.listSettingsTabs && typeof d.listSettingsTabs === 'function' ? d.listSettingsTabs().length : null,
				railRenderers: d.listDockRailRenderers && typeof d.listDockRailRenderers === 'function' ? d.listDockRailRenderers().length : null,
				systemTiles:   d.listSystemTiles && typeof d.listSystemTiles === 'function' ? d.listSystemTiles().length : null,
			} );
		} );
	}

	function renderSettingsTab( body ) {
		if ( ! body ) return;
		var d = diagnostics();
		var recent = d && typeof d.recent === 'function' ? d.recent().slice( -5 ).reverse() : [];
		body.innerHTML = [
			'<wpd-section heading="ODD" description="Shop, catalog, and diagnostics." stack>',
			'<wpd-stack gap="8">',
			'<wpd-button data-odd-settings-open-shop>Open ODD Shop</wpd-button>',
			'<wpd-button data-odd-settings-copy>Copy diagnostics</wpd-button>',
			'</wpd-stack>',
			'<wpd-section heading="Current state" stack>',
			'<wpd-code block data-odd-settings-health></wpd-code>',
			'</wpd-section>',
			'<wpd-section heading="Recent diagnostics" stack>',
			'<wpd-code block data-odd-settings-log></wpd-code>',
			'</wpd-section>',
			'</wpd-section>',
		].join( '' );

		var health = body.querySelector( '[data-odd-settings-health]' );
		if ( health ) {
			var cfg = window.odd || {};
			var system = cfg.systemHealth || {};
			health.textContent = JSON.stringify( {
				version: cfg.version || '',
				scene: cfg.scene || cfg.wallpaper || '',
				iconSet: cfg.iconSet || '',
				cursorSet: cfg.cursorSet || '',
				catalog: system.catalog || {},
				content: system.content || {},
				desktopMode: system.desktopMode || {},
			}, null, 2 );
		}

		var log = body.querySelector( '[data-odd-settings-log]' );
		if ( log ) {
			log.textContent = recent.length
				? recent.map( function ( item ) {
					return '[' + item.level + '] ' + item.message;
				} ).join( '\n' )
				: 'No diagnostics recorded yet.';
		}

		var open = body.querySelector( '[data-odd-settings-open-shop]' );
		if ( open ) {
			open.addEventListener( 'click', function () {
				var api = window.__odd && window.__odd.api;
				if ( api && typeof api.openPanel === 'function' ) api.openPanel();
			} );
		}
		var copy = body.querySelector( '[data-odd-settings-copy]' );
		if ( copy ) {
			copy.addEventListener( 'click', function () {
				if ( d && typeof d.copy === 'function' ) d.copy();
			} );
		}
	}

	function setupSettingsTab() {
		var d = desktop();
		if ( ! d || typeof d.registerSettingsTab !== 'function' ) return;
		function register() {
			try {
				d.registerSettingsTab( {
					id:         'odd',
					label:      'ODD',
					capability: 'manage_options',
					order:      50,
					owner:      'odd-desktop-hooks',
					render:     renderSettingsTab,
				} );
			} catch ( _ ) {}
		}
		if ( typeof d.ready === 'function' ) {
			d.ready( register );
		} else {
			register();
		}
	}

	setupWindowDiagnostics();
	setupIframeDiagnostics();
	setupWidgetDiagnostics();
	setupWallpaperDiagnostics();
	setupDockDiagnostics();
	setupCursorSurfaceMapping();
	setupCommandDiagnostics();
	setupLayoutDiagnostics();
	setupActivityDiagnostics();
	setupSettingsTab();
	setupTitlebarButton();
	setupDevtoolsDiagnostics();
	setupBroadSurfaceDiagnostics();

	window.__odd.desktopHooks = {
		renderSettingsTab: renderSettingsTab,
		uninstall: function () {
			Object.keys( activityTimers ).forEach( function ( key ) {
				try { clearTimeout( activityTimers[ key ] ); } catch ( _ ) {}
				delete activityTimers[ key ];
			} );
			while ( INSTALLED.length ) {
				try { INSTALLED.pop()(); } catch ( _ ) {}
			}
		},
	};
} )();
