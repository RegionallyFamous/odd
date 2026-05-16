/**
 * ODD Apps — window host.
 * ---------------------------------------------------------------
 * Owns how an installed app's window body gets populated with a
 * sandboxed iframe. Supports two render paths, belt-and-suspenders:
 *
 *   1. Client-side hydration (PREFERRED) — for every installed app
 *      we register both native-window callback globals
 *      (`wpDesktopNativeWindows` and older `desktopModeNativeWindows`)
 *      at boot. When WPDM opens the window, it invokes our callback
 *      directly on the body element; we build the mount div and
 *      iframe with no dependency on any server-rendered <template>.
 *      This mirrors the ODD Shop's working pattern and
 *      insulates us from template-emission failure modes (closure
 *      serialization, admin_footer skipped, mid-session install).
 *
 *   2. Server template + event (FALLBACK) — the window body may
 *      already contain a `.odd-app-host` div from the server-side
 *      `template` closure. We listen to `odd.window-opened` + a
 *      MutationObserver to catch any host that appears, install the
 *      iframe, and emit APP_OPENED exactly once per open.
 *
 * Event re-emission:
 *
 *   Host → ODD             Translation
 *   odd.window-opened      odd.app-opened   (when id starts `odd-app-`)
 *   odd.window-closed      odd.app-closed
 *   odd.window-focused     odd.app-focused
 *
 * This is the one place in ODD where we know an app has actually
 * opened. Muse voice lines (`appOpen.<slug>`), motion primitives
 * (wink on open), and analytics all subscribe to odd.app-opened
 * rather than listening to the raw window events.
 *
 * Security:
 *
 *   - The iframe is `sandbox="allow-scripts allow-forms allow-popups
 *     allow-same-origin allow-downloads"`. allow-same-origin is
 *     required so apps can call fetch() back to /wp-json/odd/v1/
 *     with the session cookie; the serve endpoint enforces
 *     capability on every request.
 *   - `loading="eager"`, `referrerpolicy="no-referrer"`.
 *   - No cross-document access — the admin shell never scripts into
 *     the app frame.
 *
 * Resilience:
 *
 *   - If the JS hydration path runs, we build the mount ourselves
 *     and the iframe always appears.
 *   - If the server template already painted, the MutationObserver
 *     path finds and hydrates it without double-firing APP_OPENED.
 *   - If `window.odd.appServeUrls` is missing for a slug, we render
 *     a visible error card inside the window body instead of leaving
 *     it blank — never pure white.
 *   - Verbose trace: add `?odd-apps-debug=1` to the **admin** URL *or*
 *     enable `?odd-debug=1` (ODD debug inspector) and watch the console
 *     for `[ODD apps]` lines. Copy diagnostics still includes an Apps
 *     section via `window.__odd.diagnostics.collect()`.
 *   - If the iframe `error` or `load`-with-zero-size fires, we
 *     emit odd.iframe-error and leave the loading placeholder in
 *     place so the user sees a visible failure rather than a blank
 *     dark rectangle.
 *   - After iframe `load`, we wait 1500ms and peek at the app's
 *     `#root` (or `body`) children. If still empty, we replace the
 *     loading placeholder with a diagnostic card explaining the
 *     most likely cause (app JS threw → bare `react` imports
 *     unresolvable). This is the Phase H5 fix from the v1.4.6
 *     "Still White" diagnostic — turns a silent failure into a
 *     user-visible, user-actionable one.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;
	if ( ! window.__odd || ! window.__odd.events ) return;

	var events = window.__odd.events;
	var desktopAdapter = window.__odd.desktop || null;
	var APP_ID_PREFIX = 'odd-app-';

	function desktop() {
		return desktopAdapter && typeof desktopAdapter.host === 'function'
			? desktopAdapter.host()
			: ( window.wp && window.wp.desktop ) || null;
	}

	function diagnostics() {
		return window.__odd && window.__odd.diagnostics;
	}

	function diagInfo( msg, meta ) {
		var d = diagnostics();
		if ( d && typeof d.record === 'function' ) {
			try {
				d.record( 'info', meta !== undefined ? [ msg, meta ] : [ msg ] );
			} catch ( _ ) {}
		}
	}
	function appsVerboseOn() {
		try {
			if ( window.__odd && window.__odd.debug && window.__odd.debug.enabled ) {
				return true;
			}
			var q = ( window.location && window.location.search ) || '';
			return /(?:^|[?&])odd-apps-debug=1(?:&|$)/.test( q );
		} catch ( _ ) {
			return false;
		}
	}
	function appsLog() {
		if ( ! appsVerboseOn() ) return;
		try {
			var a = Array.prototype.slice.call( arguments );
			a.unshift( '[ODD apps]' );
			if ( window.console && window.console.debug ) {
				window.console.debug.apply( window.console, a );
			} else if ( window.console && window.console.log ) {
				window.console.log.apply( window.console, a );
			}
		} catch ( _ ) {}
	}
	function diagTime( name, meta ) {
		var d = diagnostics();
		return d && typeof d.time === 'function' ? d.time( name, meta ) : function () {};
	}
	function diagCount( name, by ) {
		var d = diagnostics();
		if ( d && typeof d.count === 'function' ) d.count( name, by );
	}
	function diagProbeApp( slug, reason ) {
		var d = diagnostics();
		if ( ! d || typeof d.probeApp !== 'function' || ! slug ) return;
		try {
			d.probeApp( slug, { reason: reason || 'app-window' } ).then( function ( probe ) {
				appsLog( 'diagnostic probe complete', {
					slug: slug,
					reason: reason || '',
					status: probe && probe.status,
				} );
			}, function ( err ) {
				appsLog( 'diagnostic probe failed', slug, err );
			} );
		} catch ( err ) {
			appsLog( 'diagnostic probe threw', slug, err );
		}
	}

	function cfg() {
		return ( window.odd && typeof window.odd === 'object' ) ? window.odd : {};
	}
	function serveUrlFor( slug ) {
		var map = cfg().appServeUrls;
		if ( ! map || typeof map !== 'object' ) return '';
		return typeof map[ slug ] === 'string' ? map[ slug ] : '';
	}
	function appLabel( slug ) {
		var apps = cfg().apps;
		if ( Array.isArray( apps ) ) {
			for ( var i = 0; i < apps.length; i++ ) {
				if ( apps[ i ] && apps[ i ].slug === slug ) {
					return apps[ i ].name || apps[ i ].label || slug;
				}
			}
		}
		return slug || 'ODD App';
	}
	function installedSlugs() {
		var ua = cfg().userApps;
		if ( ! ua || ! Array.isArray( ua.installed ) ) return [];
		return ua.installed.slice();
	}
	function cursorStylesheetUrl() {
		return typeof cfg().cursorStylesheet === 'string' ? cfg().cursorStylesheet : '';
	}
	function injectCursorStylesheet( frame, href ) {
		href = arguments.length > 1 ? href : cursorStylesheetUrl();
		if ( ! frame ) return;
		var doc;
		try { doc = frame.contentDocument; } catch ( e ) { return; }
		if ( ! doc || ! doc.head ) return;
		var runtime = window.__odd && window.__odd.cursors;
		if ( runtime && typeof runtime.injectInto === 'function' ) {
			if ( href ) runtime.injectInto( doc, href );
			else if ( typeof runtime.clear === 'function' ) runtime.clear( doc );
			return;
		}
		if ( ! href ) {
			var existing = doc.getElementById( 'odd-cursors-css' );
			if ( existing && existing.parentNode ) existing.parentNode.removeChild( existing );
			return;
		}
		var link = doc.getElementById( 'odd-cursors-css' );
		if ( ! link ) {
			link = doc.createElement( 'link' );
			link.id = 'odd-cursors-css';
			link.rel = 'stylesheet';
			doc.head.appendChild( link );
		}
		link.setAttribute( 'href', href );
	}
	function injectCursorStylesheetIntoOpenFrames( href ) {
		var frames = queryAllDeep( 'iframe.odd-app-frame' );
		for ( var i = 0; i < frames.length; i++ ) {
			injectCursorStylesheet( frames[ i ], href );
		}
	}

	function queryAllDeep( selector, root ) {
		var out = [];
		var seen = [];
		function visit( scope ) {
			if ( ! scope || seen.indexOf( scope ) !== -1 ) return;
			seen.push( scope );
			if ( scope.querySelectorAll ) {
				try {
					Array.prototype.forEach.call( scope.querySelectorAll( selector ), function ( node ) {
						if ( out.indexOf( node ) === -1 ) out.push( node );
					} );
					Array.prototype.forEach.call( scope.querySelectorAll( '*' ), function ( node ) {
						if ( node.shadowRoot ) visit( node.shadowRoot );
					} );
				} catch ( _ ) {}
			}
		}
		visit( root || document );
		return out;
	}

	function slugFromWindowId( id ) {
		if ( typeof id !== 'string' ) return '';
		if ( id.indexOf( APP_ID_PREFIX ) !== 0 ) return '';
		return id.slice( APP_ID_PREFIX.length );
	}

	function windowController( ctx ) {
		if ( ctx && ctx.window && typeof ctx.window === 'object' ) return ctx.window;
		if ( ctx && typeof ctx.markContentLoading === 'function' ) return ctx;
		var id = windowIdFromPayload( ctx );
		var d = desktop();
		var win = id && d && d.windowManager && typeof d.windowManager.getById === 'function'
			? d.windowManager.getById( id )
			: null;
		if ( win && typeof win === 'object' ) return win;
		return null;
	}

	function windowIdFromPayload( payload ) {
		return payload && ( payload.id || payload.windowId ) || '';
	}

	function elementCandidate( value ) {
		if ( value && ( value.nodeType === 1 || value.nodeType === 11 ) && value.querySelector && value.appendChild ) return value;
		return null;
	}

	function elementFromPayload( payload ) {
		if ( ! payload || typeof payload !== 'object' ) return null;
		var keys = [ 'body', 'bodyElement', 'content', 'contentElement', 'element', 'el', 'node', 'host', 'root' ];
		for ( var i = 0; i < keys.length; i++ ) {
			var found = elementCandidate( payload[ keys[ i ] ] );
			if ( found ) return found;
		}
		if ( payload.window && typeof payload.window === 'object' ) {
			for ( var j = 0; j < keys.length; j++ ) {
				var nested = elementCandidate( payload.window[ keys[ j ] ] );
				if ( nested ) return nested;
			}
		}
		return null;
	}

	function cssEscape( value ) {
		value = String( value || '' );
		if ( window.CSS && typeof window.CSS.escape === 'function' ) {
			return window.CSS.escape( value );
		}
		return value.replace( /["\\]/g, '\\$&' );
	}

	function setStyleDefault( node, prop, value ) {
		if ( ! node || ! node.style ) return;
		try {
			if ( ! node.style[ prop ] ) node.style[ prop ] = value;
		} catch ( _ ) {}
	}

	function ensureMountBodyGeometry( body ) {
		if ( ! body || ! body.style ) return;
		try {
			var computed = window.getComputedStyle ? window.getComputedStyle( body ) : null;
			var position = computed && computed.position;
			if ( ( ! body.style.position ) && ( ! position || position === 'static' ) ) {
				body.style.position = 'relative';
			}
		} catch ( _ ) {
			setStyleDefault( body, 'position', 'relative' );
		}
		setStyleDefault( body, 'width', '100%' );
		setStyleDefault( body, 'height', '100%' );
		setStyleDefault( body, 'minHeight', '240px' );
		setStyleDefault( body, 'overflow', 'hidden' );
	}

	function ensureMountGeometry( mount ) {
		if ( ! mount || ! mount.style ) return;
		mount.style.position = 'relative';
		mount.style.width = '100%';
		mount.style.height = '100%';
		mount.style.minHeight = '240px';
		mount.style.overflow = 'hidden';
		mount.style.background = '#101014';
		mount.style.boxSizing = 'border-box';
		mount.style.isolation = 'isolate';
	}

	function appWindowRoot( id ) {
		if ( ! id ) return null;
		var q = cssEscape( id );
		var selectors = [
			'[data-odd-native-window="' + q + '"]',
			'[data-window-id="' + q + '"]',
			'[data-windowid="' + q + '"]',
			'[data-desktop-window-id="' + q + '"]',
			'[data-window="' + q + '"]',
			'[data-native-window-id="' + q + '"]',
			'#desktop-mode-native-window-' + q,
			'#desktop-mode-window-' + q,
		];
		for ( var i = 0; i < selectors.length; i++ ) {
			var found = queryAllDeep( selectors[ i ] )[ 0 ];
			if ( found ) return found;
		}
		return null;
	}

	function appWindowBodyWithin( root ) {
		if ( ! root || ! root.querySelector ) return null;
		if ( root.matches && root.matches( '[data-odd-native-window]' ) ) return root;
		var selectors = [
			'[data-odd-native-window]',
			'[data-window-body]',
			'[data-native-window-body]',
			'[data-window-content]',
			'.desktop-mode-window__body',
			'.desktop-mode-window-body',
			'.desktop-mode-native-window__body',
			'.desktop-mode-native-window-body',
			'.desktop-window__body',
			'.native-window-body',
		];
		for ( var i = 0; i < selectors.length; i++ ) {
			try {
				var found = root.querySelector( selectors[ i ] );
				if ( found ) return found;
			} catch ( _ ) {}
		}
		return null;
	}

	function appWindowBodyFromPayload( payload, slug ) {
		var id = windowIdFromPayload( payload ) || ( slug ? APP_ID_PREFIX + slug : '' );
		var el = elementFromPayload( payload );
		if ( el ) {
			if ( el.matches && el.matches( '.odd-app-host[data-odd-app-slug="' + cssEscape( slug ) + '"]' ) ) {
				return el.parentNode || el;
			}
			var body = appWindowBodyWithin( el );
			return body || el;
		}
		var d = desktop();
		var instance = d && d.windowManager && typeof d.windowManager.getById === 'function'
			? d.windowManager.getById( id )
			: null;
		el = elementFromPayload( instance );
		if ( el ) {
			return appWindowBodyWithin( el ) || el;
		}
		return appWindowBodyWithin( appWindowRoot( id ) );
	}

	function markContentLoading( ctx ) {
		var win = windowController( ctx );
		if ( win && typeof win.markContentLoading === 'function' ) {
			try { win.markContentLoading(); } catch ( _ ) {}
		}
	}

	function markContentLoaded( ctx ) {
		var win = windowController( ctx );
		if ( win && typeof win.markContentLoaded === 'function' ) {
			try { win.markContentLoaded(); } catch ( _ ) {}
		}
	}

	function findMount( slug ) {
		var nodes = queryAllDeep( '.odd-app-host[data-odd-app-slug="' + cssEscape( slug ) + '"]' );
		if ( ! nodes.length ) return null;
		// Prefer the one inside a visible window (offsetParent !== null
		// under most layouts). Fall back to the last-rendered node.
		for ( var i = nodes.length - 1; i >= 0; i-- ) {
			if ( nodes[ i ].offsetParent !== null ) return nodes[ i ];
		}
		return nodes[ nodes.length - 1 ];
	}

	/**
	 * Ensure a mount has its iframe. Returns one of three strings so
	 * callers can decide whether to fire APP_OPENED or skip it:
	 *   - 'mounted'     : iframe was newly inserted.
	 *   - 'already'     : iframe was already present — no-op.
	 *   - 'skipped'     : mount was missing or lacked a src attr.
	 *
	 * This matters because both the WINDOW_OPENED handler and the
	 * defensive MutationObserver path call installFrame independently.
	 * Without the return code, the slower path re-emits APP_OPENED on
	 * an already-mounted frame — double-firing downstream subscribers
	 * (muse, motion, analytics).
	 */
	function installFrame( mount, ctx ) {
		if ( ! mount ) return 'skipped';
		if ( mount.parentNode && mount.parentNode.nodeType === 1 ) {
			ensureMountBodyGeometry( mount.parentNode );
		}
		ensureMountGeometry( mount );
		if ( mount.querySelector( 'iframe.odd-app-frame' ) ) {
			markContentLoaded( ctx );
			return 'already';
		}
		var slugForMetric = mount.getAttribute( 'data-odd-app-slug' ) || '';
		var stopInstallTimer = diagTime( 'app.iframe.install', { slug: slugForMetric } );
		markContentLoading( ctx );
		var src = mount.getAttribute( 'data-odd-app-src' );
		if ( ! src ) {
			var fallbackSlug = mount.getAttribute( 'data-odd-app-slug' );
			src = fallbackSlug ? serveUrlFor( fallbackSlug ) : '';
			if ( src ) mount.setAttribute( 'data-odd-app-src', src );
		}
		if ( ! src ) {
			markContentLoaded( ctx );
			appsLog( 'installFrame: missing serve URL', { slug: slugForMetric } );
			diagInfo( 'app.iframe.missingServeUrl', { slug: slugForMetric } );
			var missing = mount.querySelector( '.odd-app-host__loading' );
			if ( missing ) {
				missing.style.display = 'grid';
				missing.textContent = 'No serve URL is registered for this app. Reload the desktop or reinstall the app from ODD Shop.';
			}
			events.emit( events.NAMES.IFRAME_ERROR, {
				message: 'odd-apps: missing app serve URL',
				slug: slugForMetric,
			} );
			diagProbeApp( slugForMetric, 'missing-serve-url' );
			stopInstallTimer( { status: 'missing-src' } );
			diagCount( 'app.iframe.skipped' );
			return 'skipped';
		}

		appsLog( 'installFrame: creating iframe', { slug: slugForMetric, srcLen: ( src || '' ).length } );
		diagInfo( 'app.iframe.create', { slug: slugForMetric } );

		var stopLoadTimer = diagTime( 'app.iframe.load', { slug: slugForMetric } );
		var frame = document.createElement( 'iframe' );
		frame.className = 'odd-app-frame';
		frame.title = appLabel( slugForMetric );
		frame.src = src;
		frame.setAttribute( 'data-odd-cursor-root', 'true' );
		frame.setAttribute( 'sandbox', 'allow-scripts allow-forms allow-popups allow-same-origin allow-downloads' );
		frame.setAttribute( 'loading', 'eager' );
		frame.setAttribute( 'referrerpolicy', 'no-referrer' );
		frame.setAttribute( 'allow', 'clipboard-read; clipboard-write; fullscreen' );
		frame.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;border:0;background:#101014;';
		frame.addEventListener( 'error', function ( e ) {
			appsLog( 'iframe error event', slugForMetric, e );
			diagInfo( 'app.iframe.elementError', { slug: slugForMetric } );
			events.emit( events.NAMES.IFRAME_ERROR, { message: 'app frame error', slug: slugForMetric, err: e } );
			diagProbeApp( slugForMetric, 'iframe-error-event' );
			stopLoadTimer( { status: 'error' } );
			diagCount( 'app.iframe.error' );
			markContentLoaded( ctx );
		} );
		frame.addEventListener( 'load', function () {
			markContentLoaded( ctx );
			stopLoadTimer( { status: 'loaded' } );
			diagCount( 'app.iframe.loaded' );
			appsLog( 'iframe load', slugForMetric );
			diagInfo( 'app.iframe.loaded', { slug: slugForMetric } );
			var loading = mount.querySelector( '.odd-app-host__loading' );
			if ( loading ) loading.style.display = 'none';
			injectCursorStylesheet( frame );
			// Empty-root watchdog. Most installed apps are Vite/React
			// bundles with a `<div id="root">` that React mounts into
			// on startup. If React never mounts (e.g. the importmap
			// runtime threw "React is unavailable"), `#root` stays
			// empty and the iframe paints pure white. We detect this
			// same-origin (our `allow-same-origin` sandbox permits
			// cross-frame DOM access within the same origin) and
			// surface a diagnostic card after a short grace period
			// so the user sees an actionable message instead of a
			// blank dark rectangle.
			window.setTimeout( function () {
				watchdogCheckEmpty( mount, frame );
			}, 1500 );

			window.setTimeout( function () {
				try {
					if ( ! appsVerboseOn() ) return;
					var doc = frame.contentDocument;
					if ( ! doc ) {
						appsLog( 'post-load peek: no contentDocument', slugForMetric );
						return;
					}
					var rt = doc.getElementById( 'root' ) || doc.body;
					var kids = rt && rt.children ? rt.children.length : -1;
					var scripts = doc.querySelectorAll( 'script[src]' ).length;
					var mod = doc.querySelectorAll( 'script[type="module"]' ).length;
					var imp = doc.querySelectorAll( 'script[type="importmap"]' ).length;
					appsLog( 'post-load peek ~500ms', slugForMetric, {
						docTitle: doc.title || '',
						rootChildren: kids,
						scriptsWithSrc: scripts,
						moduleScripts: mod,
						importMaps: imp,
						bootstrap: !! doc.getElementById( 'oddout_apps_iframe_fetch_bootstrap' ),
					} );
				} catch ( err ) {
					appsLog( 'post-load peek threw', slugForMetric, err );
				}
			}, 500 );
		} );
		mount.appendChild( frame );
		stopInstallTimer( { status: 'mounted' } );
		return 'mounted';
	}

	/**
	 * Post-load empty-root check. Silent no-op on cross-origin
	 * iframes (we can't peek into those), on iframes that already
	 * navigated away, and on iframes whose body clearly has content.
	 */
	function watchdogCheckEmpty( mount, frame ) {
		if ( ! frame || ! frame.isConnected ) return;
		var doc;
		try { doc = frame.contentDocument; } catch ( e ) { return; }
		if ( ! doc || ! doc.body ) return;

		// Prefer `#root` (the Vite/React convention every catalog
		// app uses). Fall back to `body` so this also covers apps
		// that mount directly onto the body.
		var mountTarget = doc.getElementById( 'root' ) || doc.body;
		if ( ! mountTarget ) return;
		if ( mountTarget.children.length > 0 ) return;
		if ( ( mountTarget.textContent || '' ).trim().length > 0 ) return;

		var slug = mount.getAttribute( 'data-odd-app-slug' ) || '';
		appsLog( 'watchdog: empty root after grace', slug, { title: doc.title || '' } );
		diagInfo( 'app.iframe.emptyRootWatchdog', { slug: slug, docTitle: doc.title || '' } );
		// Still empty. The ODD plugin now ships its own React 19
		// runtime under /odd-app-runtime/*.js, so the classic
		// `wp.element`-missing / bare-react-imports failure mode
		// from earlier releases is gone. If we reach this point
		// the most likely cause is a runtime exception thrown by
		// the app itself (e.g. an unhandled render error).
		var loading = mount.querySelector( '.odd-app-host__loading' );
		if ( ! loading ) return;
		loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:#eaeaf0;background:#1a1420;padding:24px;text-align:center;font:13px/1.5 -apple-system,system-ui,sans-serif;';
		var hint = 'The app loaded but did not render. Right-click inside the window → Inspect, switch the DevTools context to this frame, and check the Console for errors.';
		loading.innerHTML = '';
		var card = document.createElement( 'div' );
		card.style.cssText = 'max-width:460px;display:grid;gap:10px;';
		var title = document.createElement( 'div' );
		title.style.cssText = 'font-weight:600;font-size:14px;color:#ffd9a3;';
		title.textContent = 'App did not render';
		var body = document.createElement( 'div' );
		body.style.cssText = 'opacity:.88;';
		body.textContent = hint;
		var button = document.createElement( 'button' );
		button.type = 'button';
		button.textContent = 'Copy diagnostics';
		button.style.cssText = [
			'justify-self:center',
			'border:1px solid rgba(255,255,255,.22)',
			'background:#2f2740',
			'color:#fff',
			'border-radius:6px',
			'padding:7px 10px',
			'font:600 12px/1 -apple-system,system-ui,sans-serif',
			'cursor:pointer',
		].join( ';' );
		button.addEventListener( 'click', function () {
			diagProbeApp( slug, 'copy-diagnostics-button' );
			var d = diagnostics();
			if ( d && typeof d.copy === 'function' ) d.copy();
		} );
		card.appendChild( title );
		card.appendChild( body );
		card.appendChild( button );
		loading.appendChild( card );
		loading.style.display = 'grid';

		events.emit( events.NAMES.IFRAME_ERROR, {
			message: 'odd-apps: iframe loaded but app root stayed empty',
			slug: slug,
		} );
		diagProbeApp( slug, 'empty-root-watchdog' );
		diagCount( 'app.iframe.emptyRoot' );
	}

	/**
	 * Build a `.odd-app-host` mount div inside an arbitrary body
	 * element and install the iframe. Used by the JS hydration
	 * path (native-window callback) so app windows render
	 * correctly even when the server-side `<template>` was never
	 * emitted or was dropped before reaching the DOM.
	 */
	function buildAndMount( body, slug, ctx ) {
		if ( ! body || ! slug ) return 'skipped';
		ensureMountBodyGeometry( body );
		// Reuse any existing host the server may already have
		// painted (avoids double-mounts on session-restore paths).
		var existing = body.querySelector( '.odd-app-host[data-odd-app-slug="' + cssEscape( slug ) + '"]' );
		if ( existing ) {
			return installFrame( existing, ctx );
		}
		var src = serveUrlFor( slug );
		var host = document.createElement( 'div' );
		host.className = 'odd-app-host';
		host.setAttribute( 'data-odd-app', '' );
		host.setAttribute( 'data-odd-app-slug', slug );
		host.setAttribute( 'data-odd-cursor-root', 'true' );
		if ( src ) host.setAttribute( 'data-odd-app-src', src );
		ensureMountGeometry( host );

		var loading = document.createElement( 'div' );
		loading.className = 'odd-app-host__loading';
		loading.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;color:#d0d0e0;font:13px/1.4 -apple-system,system-ui,sans-serif;opacity:.8';
		loading.textContent = src
			? ( 'Loading ' + slug + '…' )
			: ( 'No serve URL registered for "' + slug + '". Reload the desktop to refresh the app list.' );
		host.appendChild( loading );

		body.appendChild( host );
		return installFrame( host, ctx );
	}

	function removeFrame( slug ) {
		var mount = findMount( slug );
		if ( ! mount ) return;
		var frame = mount.querySelector( 'iframe.odd-app-frame' );
		if ( frame ) frame.remove();
		var loading = mount.querySelector( '.odd-app-host__loading' );
		if ( loading ) loading.style.display = '';
	}

	/**
	 * WPDM can fire window-opened before our template is painted.
	 * A single rAF is usually enough, but some theme transitions
	 * (fade-in animations, lazy-rendered windows) defer the body
	 * render for several frames. We retry up to ~30 animation
	 * frames (~500ms at 60fps) and then give up silently — the
	 * loading placeholder stays visible if the mount never arrives.
	 */
	function waitForMount( slug, attemptsLeft, cb ) {
		var mount = findMount( slug );
		if ( mount ) { cb( mount ); return; }
		if ( attemptsLeft <= 0 ) { cb( null ); return; }
		var raf = window.requestAnimationFrame || function ( fn ) { return window.setTimeout( fn, 16 ); };
		raf( function () {
			waitForMount( slug, attemptsLeft - 1, cb );
		} );
	}

	function emitAppOpenForResult( slug, windowId, result ) {
		if ( result === 'already' ) return;
		if ( result === 'mounted' ) {
			events.emit( events.NAMES.APP_OPENED, { slug: slug, windowId: windowId } );
			return;
		}
		diagInfo( 'app.window.noMountTarget', { slug: slug, windowId: windowId } );
		diagCount( 'app.window.noMountTarget' );
		diagProbeApp( slug, 'window-open-no-mount-target' );
	}

	function handleWindowShown( payload ) {
		if ( ! payload || typeof payload !== 'object' ) return;
		var windowId = windowIdFromPayload( payload );
		var slug = slugFromWindowId( windowId );
		if ( ! slug ) return;
		var body = appWindowBodyFromPayload( payload, slug );
		if ( body && ! findMount( slug ) ) {
			var immediate = buildAndMount( body, slug, payload );
			if ( immediate !== 'skipped' ) {
				emitAppOpenForResult( slug, windowId, immediate );
				return;
			}
		}
		waitForMount( slug, 30, function ( mount ) {
			var result = mount
				? installFrame( mount, payload )
				: buildAndMount( body || appWindowBodyFromPayload( payload, slug ), slug, payload );
			emitAppOpenForResult( slug, windowId, result );
		} );
	}

	function hostHookNames( key, fallbacks ) {
		if ( desktopAdapter && typeof desktopAdapter.hookNames === 'function' ) {
			return desktopAdapter.hookNames( key, fallbacks );
		}
		var out = [];
		var d = desktop();
		function add( name ) {
			if ( name && out.indexOf( name ) === -1 ) out.push( name );
		}
		if ( key && d && d.HOOKS && d.HOOKS[ key ] ) add( d.HOOKS[ key ] );
		( fallbacks || [] ).forEach( add );
		return out;
	}

	function bindNativeWindowRenderHooks() {
		if ( desktopAdapter && typeof desktopAdapter.addActionFor === 'function' ) {
			desktopAdapter.addActionFor( 'NATIVE_WINDOW_AFTER_RENDER', [
				'desktop-mode.native-window.after-render',
				'wp-desktop.native-window.after-render',
			], handleWindowShown, 'odd.apps.native-window-after-render' );
			return;
		}
		var h = window.wp && window.wp.hooks;
		if ( ! h || typeof h.addAction !== 'function' ) return;
		hostHookNames( 'NATIVE_WINDOW_AFTER_RENDER', [
			'desktop-mode.native-window.after-render',
			'wp-desktop.native-window.after-render',
		] ).forEach( function ( name, index ) {
			try {
				h.addAction( name, 'odd.apps.native-window-after-render-' + index, handleWindowShown );
			} catch ( _ ) {}
		} );
	}

	events.on( events.NAMES.WINDOW_OPENED, handleWindowShown );
	events.on( events.NAMES.WINDOW_REOPENED, handleWindowShown );
	events.on( events.NAMES.NATIVE_WINDOW_AFTER_RENDER || 'odd.native-window-after-render', handleWindowShown );
	bindNativeWindowRenderHooks();

	events.on( events.NAMES.WINDOW_CLOSED, function ( payload ) {
		if ( ! payload || typeof payload !== 'object' ) return;
		var slug = slugFromWindowId( payload.id );
		if ( ! slug ) return;
		removeFrame( slug );
		events.emit( events.NAMES.APP_CLOSED, { slug: slug, windowId: payload.id } );
	} );

	events.on( events.NAMES.WINDOW_FOCUSED, function ( payload ) {
		if ( ! payload || typeof payload !== 'object' ) return;
		var slug = slugFromWindowId( payload.id );
		if ( ! slug ) return;
		events.emit( events.NAMES.APP_FOCUSED, { slug: slug, windowId: payload.id } );
	} );

	/**
	 * Defensive fallback. Current Desktop Mode builds expose native-
	 * window render hooks, and ODD binds those directly above. Older
	 * or unusual host orderings can still restore server-templated
	 * windows before hooks/scripts attach, so we also watch the DOM
	 * for any `.odd-app-host[data-odd-app]` node that lacks an iframe
	 * and install one as soon as it appears.
	 *
	 * This mirrors the event-driven path and dedupes on the
	 * iframe-already-present check inside installFrame, so a window
	 * that does fire the event won't end up with two frames.
	 */
	function scanAndMount( root ) {
		var scope = root && root.querySelectorAll ? root : document;
		var hosts = queryAllDeep( '.odd-app-host[data-odd-app]', scope );
		for ( var i = 0; i < hosts.length; i++ ) {
			var host = hosts[ i ];
			if ( host.querySelector( 'iframe.odd-app-frame' ) ) continue;
			var slug = host.getAttribute( 'data-odd-app-slug' );
			if ( ! slug ) continue;
			var result = installFrame( host, { id: APP_ID_PREFIX + slug } );
			// Only emit APP_OPENED on an actual new mount. Without the
			// guard, a stale host that already has an iframe would
			// re-emit every time the observer picks it up.
			if ( result !== 'mounted' ) continue;
			events.emit( events.NAMES.APP_OPENED, { slug: slug, windowId: APP_ID_PREFIX + slug } );
		}
	}

	function startObserver() {
		if ( ! window.MutationObserver || ! document.body ) return;
		var observedScopes = [];
		var mo = new MutationObserver( function ( mutations ) {
			for ( var i = 0; i < mutations.length; i++ ) {
				var m = mutations[ i ];
				if ( ! m.addedNodes || ! m.addedNodes.length ) continue;
				for ( var j = 0; j < m.addedNodes.length; j++ ) {
					var n = m.addedNodes[ j ];
					if ( n.nodeType !== 1 ) continue;
					if ( n.shadowRoot ) observeScope( n.shadowRoot );
					if ( n.querySelectorAll ) {
						Array.prototype.forEach.call( n.querySelectorAll( '*' ), function ( child ) {
							if ( child.shadowRoot ) observeScope( child.shadowRoot );
						} );
					}
					if ( n.matches && n.matches( '.odd-app-host[data-odd-app]' ) ) {
						scanAndMount( n.parentNode || document );
					} else if ( n.querySelector && n.querySelector( '.odd-app-host[data-odd-app]' ) ) {
						scanAndMount( n );
					} else if ( n.shadowRoot ) {
						scanAndMount( n.shadowRoot );
					}
				}
			}
		} );
		function observeScope( scope ) {
			if ( ! scope || ! scope.querySelectorAll || observedScopes.indexOf( scope ) !== -1 ) return;
			observedScopes.push( scope );
			scanAndMount( scope );
			Array.prototype.forEach.call( scope.querySelectorAll( '*' ), function ( node ) {
				if ( node.shadowRoot ) observeScope( node.shadowRoot );
			} );
			mo.observe( scope, { childList: true, subtree: true } );
		}
		function patchAttachShadow() {
			var proto = window.Element && window.Element.prototype;
			if ( ! proto || typeof proto.attachShadow !== 'function' ) return;
			var original = proto.attachShadow.__oddAppsOriginal || proto.attachShadow;
			var wrapped = function () {
				var root = original.apply( this, arguments );
				try { observeScope( root ); } catch ( _ ) {}
				return root;
			};
			wrapped.__oddAppsPatched = true;
			wrapped.__oddAppsOriginal = original;
			proto.attachShadow = wrapped;
		}
		patchAttachShadow();
		observeScope( document.body );
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', startObserver, { once: true } );
	} else {
		startObserver();
	}

	/**
	 * Client-side hydration — register a native-window render callback
	 * for every installed app. WPDM's window manager prefers these
	 * callbacks over the server `<template>`
	 * clone path, so even if the template emission failed for any
	 * reason (closure serialization, admin_footer skipped, mid-
	 * session install without a page reload), the window body is
	 * still built correctly.
	 *
	 * The callback just delegates to buildAndMount(), which:
	 *   - dedupes against any pre-existing server-rendered host,
	 *   - builds a fresh `.odd-app-host` div + loading placeholder,
	 *   - installs the sandboxed iframe, and
	 *   - keeps the loading placeholder visible until the iframe
	 *     fires `load` (so the user always sees SOMETHING).
	 */
	function registerWpdmCallbacks() {
		var classicReg = window.desktopModeNativeWindows = window.desktopModeNativeWindows || {};
		var currentReg = window.wpDesktopNativeWindows = window.wpDesktopNativeWindows || classicReg;
		var slugs = installedSlugs();
		for ( var i = 0; i < slugs.length; i++ ) {
			( function ( slug ) {
				var id = APP_ID_PREFIX + slug;
				var existing = typeof currentReg[ id ] === 'function'
					? currentReg[ id ]
					: ( typeof classicReg[ id ] === 'function' ? classicReg[ id ] : null );
				if ( existing ) {
					classicReg[ id ] = existing;
					currentReg[ id ] = existing;
					return;
				}
				var render = function ( body, ctx ) {
					var appCtx = ctx && typeof ctx === 'object' ? ctx : {};
					if ( ! appCtx.id ) appCtx.id = id;
					if ( ! appCtx.windowId ) appCtx.windowId = id;
					var result = buildAndMount( body, slug, appCtx );
					if ( result === 'mounted' ) {
						events.emit( events.NAMES.APP_OPENED, { slug: slug, windowId: id } );
					}
				};
				classicReg[ id ] = render;
				currentReg[ id ] = render;
			} )( slugs[ i ] );
		}
	}

	// Register eagerly so a session-restored window that opens
	// before DOMContentLoaded still finds its callback.
	registerWpdmCallbacks();

	var onCursorSet = function ( slug, href ) {
		cfg().cursorStylesheet = ( slug === 'none' || slug === '' ) ? '' : ( href || cursorStylesheetUrl() );
		injectCursorStylesheetIntoOpenFrames( cfg().cursorStylesheet );
	};
	if ( desktopAdapter && typeof desktopAdapter.addAction === 'function' ) {
		desktopAdapter.addAction( 'odd.cursorSet', onCursorSet, 'odd.apps.cursors' );
	} else if ( window.wp && window.wp.hooks && typeof window.wp.hooks.addAction === 'function' ) {
		window.wp.hooks.addAction( 'odd.cursorSet', 'odd.apps.cursors', onCursorSet );
	}

	// Re-register after page load in case `window.odd` was
	// populated by a late inline <script> (some WPDM shell
	// orderings localize after ODD's scripts enqueue).
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', registerWpdmCallbacks, { once: true } );
	}

	// Expose for tests + debugging.
	window.__odd = window.__odd || {};
	window.__odd.apps = window.__odd.apps || {};
	window.__odd.apps.buildAndMount = buildAndMount;
	window.__odd.apps.installFrame = installFrame;
	window.__odd.apps.injectCursorStylesheet = injectCursorStylesheet;
	window.__odd.apps.registerWpdmCallbacks = registerWpdmCallbacks;
	window.__odd.apps.verbose = appsVerboseOn;
	window.__odd.apps.peek = function peekAppMounts() {
		try {
			return window.__odd.diagnostics && typeof window.__odd.diagnostics.appsSnapshot === 'function'
				? window.__odd.diagnostics.appsSnapshot()
				: {};
		} catch ( _ ) {
			return {};
		}
	};
} )();
