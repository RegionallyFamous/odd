/**
 * ODD screensaver — idle-triggered fullscreen scene overlay.
 * ---------------------------------------------------------------
 * After N minutes of no pointer / keyboard / wheel activity, drops
 * a z-index:2147483646 `<div>` over the entire window. The overlay:
 *
 *   - Hides every chrome affordance (dock, taskbar, widget layer,
 *     windows) by covering them with a full-viewport backdrop.
 *   - Shows a large centered clock that updates once per second.
 *   - Optionally fires `odd.pickScene` to swap to a chosen scene
 *     for the duration, then restores the previous scene on wake.
 *
 * Wakes on the next pointerdown / keydown / wheel / touchstart —
 * intentionally NOT `pointermove`, because mousing past the screen
 * while reading something else shouldn't dismiss it.
 *
 * Reduced-motion users get the overlay with animations disabled
 * (still a readable dim+clock card; no fades, no flicker).
 *
 * Zero host-API surface: this is a plain DOM overlay parked at max
 * z-index, so it works on any WP Desktop Mode build that loads the
 * ODD wallpaper. Does not use any `desktop-mode.*` hooks.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	var cfg    = window.odd || {};
	var events = window.__odd && window.__odd.events;
	var hooks  = window.wp && window.wp.hooks;

	var DEFAULT_MIN = 5;
	function clampMinutes( m ) {
		m = parseInt( m, 10 );
		if ( ! isFinite( m ) || m < 1 ) return DEFAULT_MIN;
		if ( m > 120 ) m = 120;
		return m;
	}

	// Prefs state — seeded from localized config, updated via REST
	// echoes (fired through an `odd.prefs-changed` event when the
	// panel commits a new value). Default: disabled, 5 min, current.
	var state = {
		enabled: false,
		minutes: DEFAULT_MIN,
		scene:   'current',
	};
	if ( cfg.screensaver && typeof cfg.screensaver === 'object' ) {
		state.enabled = !! cfg.screensaver.enabled;
		state.minutes = clampMinutes( cfg.screensaver.minutes );
		var rawScene  = cfg.screensaver.scene;
		if ( typeof rawScene === 'string' && rawScene ) state.scene = rawScene;
	}

	var idleTimer    = null;
	var overlay      = null;
	var clockTimer   = null;
	var previousSlug = null;   // Active scene before the screensaver fired.
	var active       = false;

	function resolveSleepScene() {
		if ( state.scene === '' || state.scene === 'current' ) return null; // no-op
		if ( state.scene === 'random' ) {
			var scenes = Array.isArray( cfg.scenes ) ? cfg.scenes : [];
			var pool   = [];
			for ( var i = 0; i < scenes.length; i++ ) {
				var s = scenes[ i ];
				if ( s && s.slug && s.slug !== currentActiveSlug() ) pool.push( s.slug );
			}
			if ( ! pool.length ) return null;
			return pool[ Math.floor( Math.random() * pool.length ) ];
		}
		return state.scene;
	}

	function currentActiveSlug() {
		// The wallpaper engine keeps the live slug on `__odd.runtime`;
		// fall back to the config blob if we boot before it's set.
		try {
			var rt = window.__odd && window.__odd.runtime && window.__odd.runtime.activeScene;
			if ( rt && typeof rt.slug === 'string' ) return rt.slug;
		} catch ( e ) {}
		return cfg.wallpaper || cfg.scene || '';
	}

	function pickScene( slug ) {
		if ( ! slug || ! hooks || typeof hooks.doAction !== 'function' ) return;
		try { hooks.doAction( 'odd.pickScene', slug ); } catch ( e ) {}
		try { hooks.doAction( 'odd/pickScene', slug ); } catch ( e2 ) {}
	}

	function pad( n ) { return ( n < 10 ? '0' : '' ) + n; }
	function formatTime( d ) {
		var h = d.getHours(), m = d.getMinutes();
		var ampm = h >= 12 ? 'PM' : 'AM';
		h = h % 12; if ( h === 0 ) h = 12;
		return h + ':' + pad( m ) + ' ' + ampm;
	}
	function formatDate( d ) {
		var days   = [ 'Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday' ];
		var months = [ 'January','February','March','April','May','June','July','August','September','October','November','December' ];
		return days[ d.getDay() ] + ', ' + months[ d.getMonth() ] + ' ' + d.getDate();
	}

	function buildOverlay() {
		var reduced = false;
		try { reduced = window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches; } catch ( e ) {}

		var root = document.createElement( 'div' );
		root.setAttribute( 'data-odd-screensaver', '' );
		root.setAttribute( 'role', 'dialog' );
		root.setAttribute( 'aria-label', 'Screensaver. Press any key to wake.' );
		root.style.cssText = [
			'position:fixed',
			'inset:0',
			'z-index:2147483646',                   // one below the toast host
			'background:rgba(6,8,14,0.62)',          // semi-transparent so the scene below shows through
			'backdrop-filter:blur(6px) saturate(0.9)',
			'-webkit-backdrop-filter:blur(6px) saturate(0.9)',
			'display:flex',
			'align-items:center',
			'justify-content:center',
			'color:#f6f7f7',
			'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif',
			'cursor:none',                           // hide cursor during sleep
			'opacity:' + ( reduced ? '1' : '0' ),
			'transition:' + ( reduced ? 'none' : 'opacity .6s ease' ),
			'pointer-events:auto',
		].join( ';' );

		var card = document.createElement( 'div' );
		card.style.cssText = 'text-align:center;user-select:none;-webkit-user-select:none;';

		var clock = document.createElement( 'div' );
		clock.style.cssText = 'font-size:clamp(64px,12vw,148px);font-weight:200;letter-spacing:-0.03em;line-height:1;text-shadow:0 4px 40px rgba(0,0,0,.55);font-variant-numeric:tabular-nums;';
		card.appendChild( clock );

		var date = document.createElement( 'div' );
		date.style.cssText = 'margin-top:16px;font-size:clamp(16px,2.2vw,22px);font-weight:400;opacity:.82;letter-spacing:.02em;text-shadow:0 2px 18px rgba(0,0,0,.55);';
		card.appendChild( date );

		var hint = document.createElement( 'div' );
		hint.textContent = 'Press any key to wake';
		hint.style.cssText = 'margin-top:44px;font-size:12px;text-transform:uppercase;letter-spacing:.28em;opacity:.58;';
		card.appendChild( hint );

		root.appendChild( card );

		function refresh() {
			var now = new Date();
			clock.textContent = formatTime( now );
			date.textContent  = formatDate( now );
		}
		refresh();

		return { root: root, refresh: refresh };
	}

	function show() {
		if ( active ) return;
		active = true;

		previousSlug = currentActiveSlug();
		var sleepSlug = resolveSleepScene();
		if ( sleepSlug && sleepSlug !== previousSlug ) pickScene( sleepSlug );

		overlay = buildOverlay();
		document.body.appendChild( overlay.root );
		// Force reflow then fade in (unless reduced-motion already has opacity:1).
		void overlay.root.offsetWidth;
		overlay.root.style.opacity = '1';

		clockTimer = setInterval( overlay.refresh, 1000 );

		if ( events ) { try { events.emit( 'odd.screensaver-shown', { minutes: state.minutes, scene: sleepSlug || previousSlug } ); } catch ( e ) {} }
	}

	function hide() {
		if ( ! active ) return;
		active = false;
		if ( clockTimer ) { clearInterval( clockTimer ); clockTimer = null; }
		if ( overlay && overlay.root && overlay.root.parentNode ) {
			var node = overlay.root;
			node.style.opacity = '0';
			setTimeout( function () {
				if ( node.parentNode ) node.parentNode.removeChild( node );
			}, 420 );
		}
		overlay = null;

		// Restore scene if we swapped away from the original.
		if ( previousSlug && previousSlug !== currentActiveSlug() ) pickScene( previousSlug );
		previousSlug = null;

		if ( events ) { try { events.emit( 'odd.screensaver-hidden', {} ); } catch ( e ) {} }
		// Kick the idle clock again so a user who bumps a key starts fresh.
		resetIdleTimer();
	}

	function resetIdleTimer() {
		if ( idleTimer ) { clearTimeout( idleTimer ); idleTimer = null; }
		if ( ! state.enabled ) return;
		if ( document.hidden ) return;     // Don't count backgrounded time.
		idleTimer = setTimeout( show, state.minutes * 60000 );
	}

	// "Activity" signals that reset the idle clock. `pointermove` is
	// included here but **not** as a wake signal while the overlay is
	// up — see handleWake below.
	function onActivity() {
		if ( active ) return;
		resetIdleTimer();
	}
	function handleWake( ev ) {
		if ( ! active ) return;
		// Swallow the event so a wake-click doesn't double as a shell
		// click (e.g. accidentally opening a dock item).
		if ( ev && ev.preventDefault ) ev.preventDefault();
		if ( ev && ev.stopPropagation ) ev.stopPropagation();
		hide();
	}

	function onVisibility() {
		if ( document.hidden ) {
			if ( idleTimer ) { clearTimeout( idleTimer ); idleTimer = null; }
		} else {
			resetIdleTimer();
		}
	}

	var activityEvents = [ 'pointermove', 'pointerdown', 'keydown', 'wheel', 'touchstart' ];
	var wakeEvents     = [ 'pointerdown', 'keydown', 'wheel', 'touchstart' ];
	activityEvents.forEach( function ( name ) {
		window.addEventListener( name, onActivity, { passive: true, capture: true } );
	} );
	wakeEvents.forEach( function ( name ) {
		window.addEventListener( name, handleWake, { capture: true } );
	} );
	document.addEventListener( 'visibilitychange', onVisibility );

	// Prefs sync — listen for echoes from the panel's REST save.
	function applyPrefs( next ) {
		if ( ! next || typeof next !== 'object' ) return;
		var wasEnabled = state.enabled;
		state.enabled  = !! next.enabled;
		state.minutes  = clampMinutes( next.minutes );
		if ( typeof next.scene === 'string' ) state.scene = next.scene;
		if ( active && ! state.enabled ) hide();
		if ( ! wasEnabled && state.enabled ) resetIdleTimer();
		if ( wasEnabled && state.enabled )   resetIdleTimer(); // minutes may have changed
		if ( wasEnabled && ! state.enabled ) { if ( idleTimer ) { clearTimeout( idleTimer ); idleTimer = null; } }
	}
	if ( events && typeof events.on === 'function' ) {
		try { events.on( 'odd.screensaver-prefs-changed', function ( payload ) { applyPrefs( payload ); } ); } catch ( e ) {}
	}
	// Public handle for the panel to call directly if the event bus
	// isn't available (tests, partial boots).
	window.__odd = window.__odd || {};
	window.__odd.screensaver = {
		applyPrefs: applyPrefs,
		show: show,
		hide: hide,
		state: function () { return { enabled: state.enabled, minutes: state.minutes, scene: state.scene, active: active }; },
	};

	resetIdleTimer();
} )();
