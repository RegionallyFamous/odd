/**
 * ODD live Desktop Mode bootstrap.
 *
 * Desktop Mode's mid-session refresh path lazy-loads only the registered
 * surface handle. This file is that small handle: it publishes immediate
 * wallpaper/window placeholders, then loads the full ODD script chain and
 * delegates to the real implementations.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	var PLACEHOLDER = '__oddLiveBootstrapPlaceholder';
	var stateRoot = window.__odd = window.__odd || {};
	var state = stateRoot.liveBootstrap = stateRoot.liveBootstrap || {};
	state.loaded = state.loaded || {};

	window.oddout = ( window.oddout && typeof window.oddout === 'object' )
		? window.oddout
		: ( ( window.odd && typeof window.odd === 'object' ) ? window.odd : {} );
	window.odd = window.oddout;

	var LOAD_ORDER = [
		'odd-store',
		'odd-events',
		'odd-registries',
		'odd-lifecycle',
		'odd-safecall',
		'odd-debug',
		'odd-diagnostics',
		'odd-desktop-adapter',
		'odd-api',
		'odd-sdk',
		'odd-workspace',
		'odd-shop-flow',
		'odd-panel-card-art',
		'odd-cursors',
		'odd',
		'odd-panel',
		'odd-shop-cast',
		'odd-commands',
		'odd-desktop-hooks',
		'odd-apps',
	];

	function cfg() {
		return ( window.oddout && typeof window.oddout === 'object' )
			? window.oddout
			: ( ( window.odd && typeof window.odd === 'object' ) ? window.odd : {} );
	}

	function scriptMap() {
		var c = cfg();
		return ( c.liveScripts && typeof c.liveScripts === 'object' ) ? c.liveScripts : {};
	}

	function realWallpaperDef() {
		var def = window.desktopModeWallpapers && window.desktopModeWallpapers.odd;
		return def && ! def[ PLACEHOLDER ] ? def : null;
	}

	function realPanelRender() {
		var render = window.desktopModeNativeWindows && window.desktopModeNativeWindows.odd;
		return typeof render === 'function' && ! render[ PLACEHOLDER ] ? render : null;
	}

	function readyForHandle( handle ) {
		var odd = window.__odd || {};
		var map = {
			'odd-store':          function () { return !! odd.store; },
			'odd-events':         function () { return !! odd.events; },
			'odd-registries':     function () { return !! odd.registries; },
			'odd-lifecycle':      function () { return !! odd.lifecycle; },
			'odd-safecall':       function () { return !! odd.safeCall; },
			'odd-debug':          function () { return !! odd.debug; },
			'odd-diagnostics':    function () { return !! odd.diagnostics; },
			'odd-desktop-adapter': function () { return !! odd.desktop; },
			'odd-api':            function () { return !! odd.api; },
			'odd-sdk':            function () { return !! odd.sdk; },
			'odd-workspace':      function () { return !! odd.workspace; },
			'odd-shop-flow':      function () { return !! odd.shopFlow; },
			'odd-panel-card-art': function () { return !! odd.panelCardArt; },
			'odd-cursors':        function () { return !! odd.cursors; },
			'odd':                function () { return !! realWallpaperDef(); },
			'odd-panel':          function () { return !! realPanelRender(); },
			'odd-shop-cast':      function () { return !! odd.shopCast; },
			'odd-desktop-hooks':  function () { return !! odd.desktopHooks; },
			'odd-apps':           function () { return !! ( odd.apps && odd.apps.registerWpdmCallbacks ); },
		};
		return map[ handle ] ? map[ handle ]() : false;
	}

	function sameScriptUrl( url ) {
		var scripts = document.getElementsByTagName( 'script' );
		for ( var i = 0; i < scripts.length; i++ ) {
			if ( scripts[ i ].src === url ) return scripts[ i ];
		}
		return null;
	}

	function loadScript( handle, url ) {
		if ( ! url || readyForHandle( handle ) || state.loaded[ handle ] ) {
			return Promise.resolve();
		}
		var existing = sameScriptUrl( url );
		if ( existing ) {
			state.loaded[ handle ] = true;
			return Promise.resolve();
		}
		return new Promise( function ( resolve, reject ) {
			var script = document.createElement( 'script' );
			script.src = url;
			script.async = false;
			script.dataset.oddLiveHandle = handle;
			script.onload = function () {
				state.loaded[ handle ] = true;
				resolve();
			};
			script.onerror = function () {
				reject( new Error( 'ODD live script failed: ' + handle ) );
			};
			document.head.appendChild( script );
		} );
	}

	function report( label, err ) {
		state.lastError = err && ( err.message || String( err ) ) || '';
		if ( window.console && typeof window.console.warn === 'function' ) {
			window.console.warn( '[ODD live bootstrap] ' + label, err );
		}
	}

	function shouldClaimFirstRunWallpaper( current ) {
		if ( ! current || current === 'odd' || current === 'dark' ) return true;
		var defaults = window.desktopModeConfig || {};
		var configured = defaults.defaultWallpaper || defaults.wallpaper || '';
		return !! configured && current === configured;
	}

	function firstRunMarkerKey() {
		return 'odd.liveBootstrap.firstRunApplied';
	}

	function hasFirstRunMarker() {
		try {
			return !! ( window.localStorage && window.localStorage.getItem( firstRunMarkerKey() ) );
		} catch ( e ) {
			return false;
		}
	}

	function markFirstRunApplied() {
		try {
			if ( window.localStorage ) {
				window.localStorage.setItem( firstRunMarkerKey(), '1' );
			}
		} catch ( e ) {}
		state.firstRunApplied = true;
	}

	function applyFirstRunSettings() {
		if ( state.firstRunApplied || hasFirstRunMarker() ) return;
		var desktop = window.wp && window.wp.desktop;
		if ( ! desktop || typeof desktop.updateOsSettings !== 'function' ) return;

		var snap = {};
		if ( typeof desktop.getOsSettings === 'function' ) {
			try { snap = desktop.getOsSettings() || {}; } catch ( e ) { snap = {}; }
		}

		var patch = {};
		if ( shouldClaimFirstRunWallpaper( snap.wallpaper ) ) {
			patch.wallpaper = 'odd';
			patch.dockSize = 'large';
		}

		var visibility = Object.assign( {}, snap.itemVisibility || {} );
		if ( ! Object.prototype.hasOwnProperty.call( visibility, 'odd' ) ) {
			visibility.odd = cfg().shopTaskbar ? 'both' : 'desktop';
			patch.itemVisibility = visibility;
		}

		if ( Object.keys( patch ).length ) {
			try {
				desktop.updateOsSettings( patch );
				markFirstRunApplied();
			} catch ( e ) {
				report( 'settings apply failed', e );
			}
		} else if ( snap.wallpaper === 'odd' ) {
			markFirstRunApplied();
		}
	}

	function ensureLoaded() {
		if ( state.promise ) return state.promise;
		var urls = scriptMap();
		var chain = Promise.resolve();
		LOAD_ORDER.forEach( function ( handle ) {
			chain = chain.then( function () {
				return loadScript( handle, urls[ handle ] || '' ).catch( function ( err ) {
					report( 'script failed: ' + handle, err );
				} );
			} );
		} );
		state.promise = chain.then( function () {
			applyFirstRunSettings();
			return true;
		} ).catch( function ( err ) {
			report( 'script chain failed', err );
			return false;
		} );
		return state.promise;
	}

	function loadingNode( label ) {
		var el = document.createElement( 'div' );
		el.setAttribute( 'data-odd-live-loading', '1' );
		el.style.cssText = [
			'box-sizing:border-box',
			'width:100%',
			'height:100%',
			'min-height:160px',
			'display:grid',
			'place-items:center',
			'font:700 13px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
			'letter-spacing:.08em',
			'text-transform:uppercase',
			'color:#f7f5ff',
			'background:radial-gradient(circle at 30% 20%,rgba(78,232,255,.24),transparent 28%),linear-gradient(135deg,#10121a,#1c1530 62%,#2a1f10)',
		].join( ';' );
		el.textContent = label;
		return el;
	}

	function clearNode( node ) {
		try { node.replaceChildren(); } catch ( e ) { node.innerHTML = ''; }
	}

	function publishWallpaperPlaceholder() {
		window.desktopModeWallpapers = window.desktopModeWallpapers || {};
		if ( realWallpaperDef() ) return;

		var placeholder = {
			id: 'odd',
			label: 'ODD',
			type: 'canvas',
			preview: 'linear-gradient(135deg,#10121a 0%,#2b1b4a 58%,#352b11 100%)',
			needs: [ 'pixijs' ],
			mount: function ( container, context ) {
				var disposed = false;
				var teardown = null;
				clearNode( container );
				container.appendChild( loadingNode( 'Starting ODD' ) );
				ensureLoaded().then( function () {
					if ( disposed ) return;
					var real = realWallpaperDef();
					if ( ! real || typeof real.mount !== 'function' ) {
						clearNode( container );
						container.appendChild( loadingNode( 'ODD needs a refresh' ) );
						return;
					}
					clearNode( container );
					teardown = real.mount( container, context ) || null;
				} );
				return function () {
					disposed = true;
					if ( typeof teardown === 'function' ) {
						try { teardown(); } catch ( e ) {}
					}
				};
			},
			renderEditor: function ( mount, context ) {
				var disposed = false;
				var cleanup = null;
				clearNode( mount );
				mount.appendChild( loadingNode( 'Loading ODD controls' ) );
				ensureLoaded().then( function () {
					if ( disposed ) return;
					var real = realWallpaperDef();
					if ( real && typeof real.renderEditor === 'function' ) {
						clearNode( mount );
						cleanup = real.renderEditor( mount, context ) || null;
					}
				} );
				return function () {
					disposed = true;
					if ( typeof cleanup === 'function' ) {
						try { cleanup(); } catch ( e ) {}
					}
				};
			},
		};
		placeholder[ PLACEHOLDER ] = true;
		window.desktopModeWallpapers.odd = placeholder;
	}

	function publishPanelPlaceholder() {
		window.desktopModeNativeWindows = window.desktopModeNativeWindows || {};
		if ( realPanelRender() ) return;

		var render = function ( body, context ) {
			var disposed = false;
			var teardown = null;
			clearNode( body );
			body.appendChild( loadingNode( 'Loading ODD Shop' ) );
			ensureLoaded().then( function () {
				if ( disposed ) return;
				var real = realPanelRender();
				if ( ! real ) {
					clearNode( body );
					body.appendChild( loadingNode( 'ODD Shop needs a refresh' ) );
					return;
				}
				teardown = real( body, context ) || null;
			} );
			return function () {
				disposed = true;
				if ( typeof teardown === 'function' ) {
					try { teardown(); } catch ( e ) {}
				}
			};
		};
		render[ PLACEHOLDER ] = true;
		window.desktopModeNativeWindows.odd = render;
	}

	publishWallpaperPlaceholder();
	publishPanelPlaceholder();

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', function () {
			ensureLoaded();
			applyFirstRunSettings();
		}, { once: true } );
	} else {
		ensureLoaded();
		applyFirstRunSettings();
	}
} )();
