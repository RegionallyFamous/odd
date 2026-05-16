/**
 * ODD — shared client API (window.__odd.api)
 * ---------------------------------------------------------------
 * Thin reusable wrapper over the REST endpoint + the foundation
 * store / event bus. Widgets, slash commands, and the panel all
 * call into this so scene / icon-set swaps behave identically no
 * matter where the user triggered them from.
 *
 * On load this module advances the lifecycle to `configured` and
 * then `registries-ready` since the seed registries are already
 * inline on the localized `window.odd` blob.
 *
 * Exposes (all no-throw, all tolerant of a missing config):
 *
 *   api.config            — alias of window.odd
 *   api.scenes()          — live scene list (from store + filters)
 *   api.sceneBySlug(s)    — lookup
 *   api.currentScene()    — active scene slug
 *   api.iconSets()        — live icon-set list
 *   api.currentIconSet()  — active slug or '' for default
 *   api.cursorSets()      — live cursor-set list
 *   api.currentCursorSet() — active cursor slug or '' for default
 *   api.savePrefs(p, cb)  — POST /odd/v1/prefs, merges response
	 *   api.setScene(slug)    — save + broadcast scene hooks + toast
 *   api.setIconSet(slug)  — save + soft reload so dock rebuilds
 *   api.setCursorSet(slug) — save + live cursor refresh
 *   api.setShuffle(prefs) — save shuffle prefs
 *   api.setAudioReactive(on) — save audio-reactive pref
 *   api.shuffle()         — setScene() with a random non-current slug
 *   api.installedWidgets() — installed ODD widget summaries
 *   api.mountWidget(id)   — mount an installed widget through Desktop Mode
 *   api.openApp(slug)     — open an installed ODD app window
 *   api.toast(msg, o?)    — wp.desktop.showToast({ … }) if available
 *   api.openOsSettings()  — open Desktop Mode OS Settings
 *   api.showAttention(id) — request attention/highlight for a window
 *   api.setBadge(id, n)   — set a badge where the host exposes a rail API
 *   api.diagnosticsSnapshot(id?) — host window debug/config snapshot
 *   api.onSceneChange(cb) — subscribe to scene swaps (returns unsub fn)
 *   api.onIconSetChange(cb)
 *   api.openPanel()       — wp.desktop.openWindow('odd')
 *   api.isTouchOnly()     — phone-class pointer + viewport detection
 *   api.requestMaximize() — ask Desktop Mode to fullscreen the Shop
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	window.__odd = window.__odd || {};
	if ( window.__odd.api ) return;

		// Command hooks use the same dotted naming convention as Desktop Mode.
	var HOOK_SCENE    = 'odd.pickScene';
	var HOOK_ICONSET  = 'odd.pickIconSet';
	var TOAST_TONE    = 'odd-muse';

	var store      = window.__odd.store      || null;
	var events     = window.__odd.events     || null;
	var registries = window.__odd.registries || null;
	var lifecycle  = window.__odd.lifecycle  || null;
	var safeCall   = window.__odd.safeCall   || function ( fn ) { try { return fn(); } catch ( e ) {} };

	function cfg() { return window.odd || {}; }

	function scenes() {
		if ( registries ) {
			var r = registries.readScenes();
			if ( Array.isArray( r ) && r.length ) return r;
		}
		var s = cfg().scenes;
		return Array.isArray( s ) ? s : [];
	}
	function sceneBySlug( slug ) {
		var list = scenes();
		for ( var i = 0; i < list.length; i++ ) {
			if ( list[ i ] && list[ i ].slug === slug ) return list[ i ];
		}
		return null;
	}
	function currentScene() {
		if ( store ) {
			var s = store.get( 'user.wallpaper' );
			if ( s ) return s;
		}
		var c = cfg();
		return c.wallpaper || c.scene || '';
	}
	function iconSets() {
		if ( registries ) {
			var r = registries.readIconSets();
			if ( Array.isArray( r ) && r.length ) return r;
		}
		var s = cfg().iconSets;
		return Array.isArray( s ) ? s : [];
	}
	function iconSetBySlug( slug ) {
		var list = iconSets();
		for ( var i = 0; i < list.length; i++ ) {
			if ( list[ i ] && list[ i ].slug === slug ) return list[ i ];
		}
		return null;
	}
	function currentIconSet() {
		if ( store ) {
			var v = store.get( 'user.iconSet' );
			if ( typeof v === 'string' ) return v;
		}
		return cfg().iconSet || '';
	}
	function cursorSets() {
		var s = cfg().cursorSets;
		return Array.isArray( s ) ? s : [];
	}
	function cursorSetBySlug( slug ) {
		var list = cursorSets();
		for ( var i = 0; i < list.length; i++ ) {
			if ( list[ i ] && list[ i ].slug === slug ) return list[ i ];
		}
		return null;
	}
	function currentCursorSet() {
		return cfg().cursorSet || '';
	}
	function installedWidgets() {
		var widgets = cfg().installedWidgets;
		return Array.isArray( widgets ) ? widgets : [];
	}
	function apps() {
		var list = cfg().apps;
		return Array.isArray( list ) ? list : [];
	}
	function appBySlug( slug ) {
		var list = apps();
		for ( var i = 0; i < list.length; i++ ) {
			if ( list[ i ] && list[ i ].slug === slug ) return list[ i ];
		}
		return null;
	}

	function doAction( hook, payload ) {
		try {
			if ( window.wp && window.wp.hooks && typeof window.wp.hooks.doAction === 'function' ) {
				window.wp.hooks.doAction( hook, payload );
			}
		} catch ( e ) {}
	}

	function emitBus( name, payload ) {
		if ( events ) { try { events.emit( name, payload ); } catch ( e ) {} }
	}

	function addAction( hook, namespace, cb ) {
		if ( ! ( window.wp && window.wp.hooks && typeof window.wp.hooks.addAction === 'function' ) ) {
			return function () {};
		}
		try { window.wp.hooks.addAction( hook, namespace, cb ); } catch ( e ) {}
		return function () {
			try { window.wp.hooks.removeAction( hook, namespace ); } catch ( e ) {}
		};
	}

	function toast( message, opts ) {
		opts = opts || {};
		if ( ! ( window.wp && window.wp.desktop && typeof window.wp.desktop.showToast === 'function' ) ) return;
		safeCall( function () {
			window.wp.desktop.showToast( {
				message: String( message || '' ),
				duration: typeof opts.duration === 'number' ? opts.duration : 2400,
				source: opts.source || 'odd',
				meta: opts.meta || { tone: opts.tone || TOAST_TONE },
				action: opts.action,
			} );
		}, 'api.toast' );
	}

	function openOsSettings() {
		var d = window.wp && window.wp.desktop;
		if ( ! d ) return false;
		return !! safeCall( function () {
			if ( typeof d.openOsSettings === 'function' ) {
				d.openOsSettings();
				return true;
			}
			if ( typeof d.getSystemTile === 'function' ) {
				var tile = d.getSystemTile( 'desktop-mode-os-settings' );
				if ( tile && typeof tile.onOpen === 'function' ) {
					tile.onOpen();
					return true;
				}
			}
			return false;
		}, 'api.openOsSettings' );
	}

	function showAttention( windowId, opts ) {
		var d = window.wp && window.wp.desktop;
		if ( ! d || ! windowId ) return false;
		return !! safeCall( function () {
			var win = d.windowManager && typeof d.windowManager.getById === 'function'
				? d.windowManager.getById( windowId )
				: null;
			if ( win && typeof win.requestAttention === 'function' ) {
				win.requestAttention( opts || {} );
				return true;
			}
			if ( win && typeof win.setHighlight === 'function' ) {
				win.setHighlight( opts && opts.mode || 'pulse', opts || {} );
				return true;
			}
			if ( win && typeof win.shake === 'function' ) {
				win.shake();
				return true;
			}
			return false;
		}, 'api.showAttention' );
	}

	function setBadge( itemId, count ) {
		var d = window.wp && window.wp.desktop;
		if ( ! d || ! itemId ) return false;
		return !! safeCall( function () {
			var rails = [ d.dock, d.sideDock, d.icons ];
			for ( var i = 0; i < rails.length; i++ ) {
				if ( rails[ i ] && typeof rails[ i ].setBadge === 'function' ) {
					rails[ i ].setBadge( itemId, count );
				}
			}
			return true;
		}, 'api.setBadge' );
	}

	function diagnosticsSnapshot( windowId ) {
		var d = window.wp && window.wp.desktop;
		if ( ! d ) return {};
		return safeCall( function () {
			var out = {};
			if ( windowId && typeof d.getWindowConfig === 'function' ) {
				out.windowConfig = d.getWindowConfig( windowId );
			}
			if ( windowId && d.debug && typeof d.debug.window === 'function' ) {
				out.windowDebug = d.debug.window( windowId );
			}
			if ( typeof d.listSettingsTabs === 'function' ) out.settingsTabs = d.listSettingsTabs();
			if ( typeof d.listDockRailRenderers === 'function' ) out.dockRailRenderers = d.listDockRailRenderers();
			if ( typeof d.listSystemTiles === 'function' ) out.systemTiles = d.listSystemTiles();
			if ( typeof d.listPalettes === 'function' ) out.palettes = d.listPalettes();
			var win = d.windowManager && typeof d.windowManager.getById === 'function' ? d.windowManager.getById( 'odd' ) : null;
			var panel = document.querySelector ? document.querySelector( '.odd-panel.odd-shop' ) : null;
			var hostWindowState = win && typeof win.state === 'string' ? win.state : 'normal';
			var hostFullscreen = !! ( document.body && document.body.classList && document.body.classList.contains( 'desktop-mode-has-fullscreen-window' ) );
			out.shop = {
				hostWindowState: hostWindowState,
				hostFullscreen:  hostFullscreen,
				panelLayout:     panel ? panel.getAttribute( 'data-odd-layout' ) || '' : '',
				panelViewport:   panel ? panel.getAttribute( 'data-odd-viewport' ) || '' : '',
				panelSize:       panel ? panel.getAttribute( 'data-odd-size' ) || '' : '',
				panelPointer:    panel ? panel.getAttribute( 'data-odd-pointer' ) || '' : '',
				layoutSource:    hostFullscreen ? 'host-fullscreen' : ( hostWindowState === 'maximized' ? 'host-maximized' : 'host-normal' ),
			};
			return out;
		}, 'api.diagnosticsSnapshot' ) || {};
	}

	function savePrefs( patch, cb ) {
		var c = cfg();
		if ( ! c.restUrl ) { if ( cb ) cb( null ); return; }
		safeCall( function () {
			fetch( c.restUrl, {
				method: 'POST',
				credentials: 'same-origin',
				headers: {
					'Content-Type': 'application/json',
					'X-WP-Nonce': c.restNonce || '',
				},
				body: JSON.stringify( patch || {} ),
			} )
				.then( function ( r ) { return r.json(); } )
				.then( function ( data ) {
					if ( data && typeof data === 'object' ) {
						if ( typeof data.wallpaper === 'string' ) {
							c.wallpaper = data.wallpaper;
							c.scene     = data.wallpaper;
						}
						if ( typeof data.iconSet === 'string' ) {
							c.iconSet = data.iconSet;
						}
						if ( typeof data.cursorSet === 'string' ) {
							c.cursorSet = data.cursorSet;
						}
						if ( typeof data.cursorStylesheet === 'string' ) {
							c.cursorStylesheet = data.cursorStylesheet;
						}
						if ( data.shuffle && typeof data.shuffle === 'object' ) {
							c.shuffle = data.shuffle;
						}
						if ( typeof data.audioReactive === 'boolean' ) {
							c.audioReactive = data.audioReactive;
						}
					}
					// Desktop Mode only lazy-loads Pixi and runs ODD's canvas mount when
					// the host wallpaper id is `odd`. Without this, users who stayed on the
					// built-in `dark` gradient never get the ODD engine — Shop scene picks
					// look broken until a full reload. updateOsSettings persists + applies live.
					var patchObj = patch && typeof patch === 'object' ? patch : {};
					var hostOdd    = Object.prototype.hasOwnProperty.call( patchObj, 'wallpaper' )
						|| Object.prototype.hasOwnProperty.call( patchObj, 'scene' );
					var prefsOk    = data && typeof data === 'object' && typeof data.code !== 'string';
					if ( hostOdd && prefsOk && typeof data.wallpaper === 'string' ) {
						var desk = window.wp && window.wp.desktop;
						if ( desk && typeof desk.updateOsSettings === 'function' ) {
							try {
								desk.updateOsSettings( { wallpaper: 'odd' } );
							} catch ( _e ) {}
						}
					}
					if ( cb ) cb( data );
				} )
				.catch( function () { if ( cb ) cb( null ); } );
		}, 'api.savePrefs' );
	}

	function setScene( slug, opts ) {
		if ( ! slug || ! sceneBySlug( slug ) ) return false;
		var prev = currentScene();
		if ( slug === prev ) return false;

		// Update the store optimistically so subscribers see the new scene before
		// the server round-trip finishes. The wallpaper engine listens to the
		// internal hook bridge for the visual swap.
		if ( store ) store.set( { user: { wallpaper: slug } }, { source: 'api.setScene' } );
		emitBus( 'odd.scene-changed', { from: prev, to: slug } );
		// Broadcast the live scene-pick hook for wallpaper previews.
		doAction( HOOK_SCENE, slug );
		savePrefs( { wallpaper: slug } );

		var quiet = opts && opts.quiet;
		if ( ! quiet ) {
			var s = sceneBySlug( slug );
			toast( ( s && s.label ) ? s.label : slug, { duration: 1800 } );
		}
		return true;
	}

	function setIconSet( slug, opts ) {
		var valid = slug === 'none' || iconSetBySlug( slug );
		if ( ! valid ) return false;
		var prev = currentIconSet() || 'none';
		if ( slug === prev ) return false;

		if ( store ) store.set( { user: { iconSet: slug === 'none' ? '' : slug } }, { source: 'api.setIconSet' } );
		emitBus( 'odd.icon-set-changed', { from: prev, to: slug } );

		savePrefs( { iconSet: slug }, function () {
			doAction( HOOK_ICONSET, slug );
			if ( ! ( opts && opts.skipReload ) ) {
				try { window.location.reload(); } catch ( e ) {}
			}
		} );
		return true;
	}

	function setCursorSet( slug, opts ) {
		var valid = slug === 'none' || cursorSetBySlug( slug );
		if ( ! valid ) return false;
		var prev = currentCursorSet() || 'none';
		if ( slug === prev ) return false;

		savePrefs( { cursorSet: slug }, function ( data ) {
			var c = cfg();
			var next = data && typeof data.cursorSet === 'string' ? data.cursorSet : ( slug === 'none' ? '' : slug );
			var href = data && typeof data.cursorStylesheet === 'string' ? data.cursorStylesheet : '';
			c.cursorSet = next;
			c.cursorStylesheet = href;
			doAction( 'odd.cursorSet', next || 'none', href );
			emitBus( 'odd.cursor-set-changed', { from: prev, to: next || 'none' } );
			if ( ! ( opts && opts.quiet ) ) {
				var set = next ? cursorSetBySlug( next ) : null;
				toast( next ? 'Cursor set: ' + ( set && set.label ? set.label : next ) : 'Cursor set reset.', { duration: 1800 } );
			}
		} );
		return true;
	}

	function setShuffle( prefs, opts ) {
		var current = cfg().shuffle && typeof cfg().shuffle === 'object' ? cfg().shuffle : {};
		var next = {
			enabled: !! ( prefs && prefs.enabled ),
			minutes: Math.max( 1, Math.min( 240, parseInt( prefs && prefs.minutes, 10 ) || parseInt( current.minutes, 10 ) || 15 ) ),
		};
		cfg().shuffle = next;
		savePrefs( { shuffle: next }, function ( data ) {
			if ( data && data.shuffle ) cfg().shuffle = data.shuffle;
		} );
		if ( ! ( opts && opts.quiet ) ) {
			toast( next.enabled ? 'Wallpaper shuffle is on.' : 'Wallpaper shuffle is off.', { duration: 1800 } );
		}
		return true;
	}

	function setAudioReactive( enabled, opts ) {
		var on = !! enabled;
		cfg().audioReactive = on;
		savePrefs( { audioReactive: on }, function ( data ) {
			if ( data && typeof data.audioReactive === 'boolean' ) cfg().audioReactive = data.audioReactive;
		} );
		if ( ! ( opts && opts.quiet ) ) {
			toast( on ? 'Audio-reactive wallpaper is on.' : 'Audio-reactive wallpaper is off.', { duration: 1800 } );
		}
		return true;
	}

	function shuffle() {
		var list = scenes();
		if ( ! list.length ) return false;
		var cur = currentScene();
		var pool = list.filter( function ( s ) { return s && s.slug && s.slug !== cur; } );
		if ( ! pool.length ) pool = list.slice();
		var pick = pool[ Math.floor( Math.random() * pool.length ) ];
		emitBus( 'odd.shuffle-tick', { slug: pick.slug } );
		return setScene( pick.slug );
	}

	function mountWidget( id, opts ) {
		var d = window.wp && window.wp.desktop;
		if ( ! d || ! id ) return false;
		return !! safeCall( function () {
			var layer = d.widgetLayer;
			var ok = false;
			if ( layer && typeof layer.ensureMounted === 'function' ) {
				ok = !! layer.ensureMounted( id );
				if ( ok && typeof layer.mountIfEnabled === 'function' ) {
					layer.mountIfEnabled( id );
				}
			} else if ( layer && typeof layer.add === 'function' ) {
				layer.add( id );
				ok = true;
			}
			if ( ok && ! ( opts && opts.quiet ) ) {
				toast( 'Added widget to the desktop.', { duration: 1800 } );
			}
			return ok;
		}, 'api.mountWidget' );
	}

	function tidyWidgets( opts ) {
		var count = 0;
		if ( document && document.querySelectorAll ) {
			var redock = document.querySelectorAll( '.desktop-mode-widgets__card[data-widget-id^="odd/"].desktop-mode-widgets__card--floating .desktop-mode-widgets__card-redock' );
			for ( var i = 0; i < redock.length; i++ ) {
				try {
					redock[ i ].click();
					count++;
				} catch ( e ) {}
			}
		}
		installedWidgets().forEach( function ( widget ) {
			if ( widget && widget.id && mountWidget( widget.id, { quiet: true } ) ) count++;
		} );
		if ( ! ( opts && opts.quiet ) ) {
			toast( count ? 'ODD widgets are gathered up.' : 'No installed ODD widgets to gather yet.', { duration: 2200 } );
		}
		return count > 0;
	}

	function openApp( slug ) {
		var d = window.wp && window.wp.desktop;
		if ( ! d || typeof d.openWindow !== 'function' ) return false;
		var clean = norm( slug );
		if ( ! clean || ! appBySlug( clean ) ) return false;
		return !! safeCall( function () {
			d.openWindow( 'odd-app-' + clean );
			return true;
		}, 'api.openApp' );
	}

	function resetDecorations() {
		var prevIcon = currentIconSet() || '';
		var prevCursor = currentCursorSet() || '';
		if ( ! prevIcon && ! prevCursor ) {
			toast( 'ODD decorations are already reset.', { duration: 2200 } );
			return false;
		}

		if ( store && prevIcon ) {
			store.set( { user: { iconSet: '' } }, { source: 'api.resetDecorations' } );
		}

		savePrefs( { iconSet: 'none', cursorSet: 'none' }, function ( data ) {
			var c = cfg();
			var nextIcon = data && typeof data.iconSet === 'string' ? data.iconSet : '';
			var nextCursor = data && typeof data.cursorSet === 'string' ? data.cursorSet : '';
			var href = data && typeof data.cursorStylesheet === 'string' ? data.cursorStylesheet : '';
			c.iconSet = nextIcon;
			c.cursorSet = nextCursor;
			c.cursorStylesheet = href;
			if ( prevIcon ) {
				doAction( HOOK_ICONSET, 'none' );
				emitBus( 'odd.icon-set-changed', { from: prevIcon, to: 'none' } );
			}
			if ( prevCursor ) {
				doAction( 'odd.cursorSet', 'none', '' );
				emitBus( 'odd.cursor-set-changed', { from: prevCursor, to: 'none' } );
			}
			toast( 'ODD icon and cursor decorations reset.', { duration: 2200 } );
			if ( prevIcon ) {
				try { window.location.reload(); } catch ( e ) {}
			}
		} );
		return true;
	}

	function onSceneChange( cb ) {
		return addAction( HOOK_SCENE, 'odd.api-sub-' + Math.random().toString( 36 ).slice( 2 ), cb );
	}
	function onIconSetChange( cb ) {
		return addAction( HOOK_ICONSET, 'odd.api-sub-' + Math.random().toString( 36 ).slice( 2 ), cb );
	}

	function isTouchOnly() {
		if ( ! window.matchMedia ) return false;
		try {
			var coarse   = window.matchMedia( '(pointer: coarse)' ).matches;
			var noHover  = ! window.matchMedia( '(hover: hover)' ).matches;
			var narrow   = ( window.innerWidth || document.documentElement.clientWidth || 0 ) < 720;
			return coarse && noHover && narrow;
		} catch ( _ ) {
			return false;
		}
	}

	function requestMaximize( d ) {
		var win = d && d.windowManager && typeof d.windowManager.getById === 'function'
			? d.windowManager.getById( 'odd' )
			: null;
		if ( win && typeof win.toggleFullscreen === 'function' && win.state !== 'fullscreen' ) {
			win.toggleFullscreen();
			return 'fullscreen';
		}
		return false;
	}

	function openPanel() {
		var d = window.wp && window.wp.desktop;
		if ( ! d ) return false;
		// Server-registered native windows must open through the host
		// registry so Desktop Mode hydrates the template and script.
		var maximize = isTouchOnly();
		return !! safeCall( function () {
			if ( typeof d.openWindow !== 'function' ) return false;
			d.openWindow( 'odd' );
			if ( maximize ) requestMaximize( d );
			return true;
		}, 'api.openPanel' );
	}

	// API compatibility version. Separate from ODDOUT_VERSION so plugin
	// patch releases don't force downstream extensions to re-test. We
	// bump this when the surface described in the docstring above
	// changes in a way extensions can observe. See
	// docs/api-versioning.md for the contract.
	var API_VERSION = '2.3.0';

	window.__odd.api = {
		version:         API_VERSION,
		HOOK_SCENE:      HOOK_SCENE,
		HOOK_ICONSET:    HOOK_ICONSET,
		TOAST_TONE:      TOAST_TONE,
		get config()      { return cfg(); },
		scenes:          scenes,
		sceneBySlug:     sceneBySlug,
		currentScene:    currentScene,
		iconSets:        iconSets,
		iconSetBySlug:   iconSetBySlug,
		currentIconSet:  currentIconSet,
		cursorSets:      cursorSets,
		cursorSetBySlug: cursorSetBySlug,
		currentCursorSet: currentCursorSet,
		installedWidgets: installedWidgets,
		apps:            apps,
		appBySlug:       appBySlug,
		savePrefs:       savePrefs,
		setScene:        setScene,
		setIconSet:      setIconSet,
		setCursorSet:    setCursorSet,
		setShuffle:      setShuffle,
		setAudioReactive: setAudioReactive,
		shuffle:         shuffle,
		mountWidget:     mountWidget,
		tidyWidgets:     tidyWidgets,
		openApp:         openApp,
		resetDecorations: resetDecorations,
		toast:           toast,
		openOsSettings:  openOsSettings,
		showAttention:   showAttention,
		setBadge:        setBadge,
		diagnosticsSnapshot: diagnosticsSnapshot,
		onSceneChange:   onSceneChange,
		onIconSetChange: onIconSetChange,
		openPanel:       openPanel,
		isTouchOnly:     isTouchOnly,
		requestMaximize: requestMaximize,
	};

	// Lifecycle: the store hydrated on `odd-store` load, and `odd-api`
	// is a dependency of every feature surface. By the time this IIFE
	// runs the config blob is applied and the seed registries are in
	// the store — advance through configured and registries-ready so
	// downstream subsystems can `whenPhase('registries-ready')`.
	if ( lifecycle ) {
		try { lifecycle.advance( 'configured' ); } catch ( e ) {}
		try { lifecycle.advance( 'registries-ready' ); } catch ( e ) {}
	}
} )();
