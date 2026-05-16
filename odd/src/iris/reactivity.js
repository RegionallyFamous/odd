/**
 * Iris — environmental reactivity.
 * ---------------------------------------------------------------
 * Subscribes to the WP Desktop Mode hooks listed in the plan,
 * re-emits them as dot-namespaced `odd.*` events on the ODD bus
 * (so third-party extensions don't have to know the `desktop-mode.*`
 * convention), and triggers the matching motion primitive on the
 * active scene.
 *
 * Every reaction is throttled and every reaction respects
 * `user.mascotQuiet` for the spoken half while still letting the
 * silent half (the motion primitive) play. The reactivity layer
 * never draws anything itself — it just glues the shell to the
 * Iris voice and the motion registry.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;
	window.__odd = window.__odd || {};
	window.__odd.iris = window.__odd.iris || {};
	if ( window.__odd.iris.__reactivityInstalled ) return;
	window.__odd.iris.__reactivityInstalled = true;

	function on( name, cb ) {
		var hooks = window.wp && window.wp.hooks;
		if ( ! hooks || typeof hooks.addAction !== 'function' ) return;
		try { hooks.addAction( name, 'odd.iris-reactivity', cb ); } catch ( e ) { /* bad name */ }
	}
	function desktopHookName( key, fallback ) {
		var d = window.wp && window.wp.desktop;
		return key && d && d.HOOKS && d.HOOKS[ key ] ? d.HOOKS[ key ] : fallback;
	}
	function onDesktop( key, fallback, cb ) {
		on( desktopHookName( key, fallback ), cb );
	}
	function emit( name, payload ) {
		var evt = window.__odd.events;
		if ( evt && typeof evt.emit === 'function' ) evt.emit( name, payload );
	}
	function onOdd( name, cb ) {
		var evt = window.__odd.events;
		if ( evt && typeof evt.on === 'function' ) evt.on( name, cb );
	}
	function motion( slug, opts ) {
		var m = window.__odd.iris && window.__odd.iris.motion;
		if ( m && typeof m[ slug ] === 'function' ) m[ slug ]( opts || {} );
	}
	function say( bucket ) {
		var iris = window.__odd.iris;
		if ( iris && typeof iris.say === 'function' ) iris.say( bucket );
	}
	function stringifyShellIssuePayload( payload ) {
		var seen = [];
		try {
			return JSON.stringify( payload || {}, function ( key, value ) {
				if ( value instanceof Error ) {
					return {
						name:    value.name || 'Error',
						message: value.message || '',
						stack:   value.stack || '',
					};
				}
				if ( value && typeof value === 'object' ) {
					if ( seen.indexOf( value ) !== -1 ) {
						return '[Circular]';
					}
					seen.push( value );
				}
				return value;
			} );
		} catch ( e ) {
			return String( payload || '' );
		}
	}
	function logShellIssue( source, payload ) {
		var c = window.console;
		if ( ! c || typeof c.log !== 'function' ) return;
		c.log( '[ODD] Shell issue: ' + source + ' ' + stringifyShellIssuePayload( payload ) );
	}

	function centerOf( bounds ) {
		if ( ! bounds || typeof bounds !== 'object' ) return null;
		var x = ( bounds.x != null ? bounds.x : bounds.left   || 0 ) + ( bounds.width  || 0 ) / 2;
		var y = ( bounds.y != null ? bounds.y : bounds.top    || 0 ) + ( bounds.height || 0 ) / 2;
		return { x: x, y: y };
	}
	function throttle( ms ) {
		var last = 0;
		return function ( fn ) {
			var now = Date.now();
			if ( now - last < ms ) return;
			last = now;
			fn();
		};
	}

	var throttleShellIssueLog = throttle( 30000 );
	var throttleWelcomeBck = throttle( 10 * 60 * 1000 );

	onOdd( 'odd.window-opened', function ( payload ) {
		var c = centerOf( payload && payload.bounds );
		motion( 'ripple', c ? { x: c.x, y: c.y, intensity: 1.0 } : { x: 0.5, y: 0.5, intensity: 1.0, normalized: true } );
	} );
	onOdd( 'odd.window-closed', function ( payload ) {
		var c = centerOf( payload && payload.bounds );
		motion( 'ripple', c ? { x: c.x, y: c.y, intensity: 0.6 } : { x: 0.5, y: 0.5, intensity: 0.6, normalized: true } );
	} );
	onOdd( 'odd.window-focused', function ( payload ) {
		var c = centerOf( payload && payload.bounds );
		if ( c ) motion( 'glance', { x: c.x, y: c.y } );
	} );
	onDesktop( 'SHELL_ERROR', 'desktop-mode.shell.error', function ( payload ) {
		emit( 'odd.shell-error', payload || {} );
		throttleShellIssueLog( function () { logShellIssue( 'desktop-mode.shell.error', payload ); } );
	} );
	onOdd( 'odd.iframe-error', function ( payload ) {
		throttleShellIssueLog( function () { logShellIssue( 'odd.iframe-error', payload ); } );
	} );
	onDesktop( 'DOCK_ITEM_APPENDED', 'desktop-mode.dock.item-appended', function ( payload ) {
		var c = centerOf( payload && payload.bounds );
		motion( 'ripple', c ? { x: c.x, y: c.y, intensity: 0.3 } : { x: 0.85, y: 0.95, intensity: 0.3, normalized: true } );
	} );
	onDesktop( 'COMMAND_AFTER_RUN', 'desktop-mode.command.after-run', function () {
		motion( 'glance', { nod: true } );
	} );
	onOdd( 'odd.visibility-changed', function ( payload ) {
		var state = payload && payload.state;
		if ( state === 'visible' ) {
			throttleWelcomeBck( function () { say( 'welcomeBack' ); } );
		}
	} );

	// Scene-change + icon-set change are emitted by ODD itself.
	// Hook them here so Iris can react to her own changes.
	var events = window.__odd.events;
	if ( events && typeof events.on === 'function' ) {
		events.on( 'odd.scene-changed', function ( p ) {
			if ( p && p.to ) say( 'sceneOpen.' + p.to );
		} );
		events.on( 'odd.icon-set-changed', function () {
			say( 'iconChange' );
		} );

		// Apps (v0.16.0). Voice buckets are per-slug
		// (`appOpen.<slug>`) with a generic `appOpen` fallback that
		// Iris's own voice table defines. Opening an app winks —
		// the wallpaper doesn't ripple because the window is an ODD
		// native surface, not a host shell window; the wink
		// primitive is a lightweight acknowledgment that stays on
		// the eye layer.
		events.on( 'odd.app-opened', function ( p ) {
			var slug = p && p.slug;
			motion( 'wink' );
			if ( slug ) say( 'appOpen.' + slug );
			say( 'appOpen' );
		} );
		events.on( 'odd.app-closed', function ( p ) {
			var slug = p && p.slug;
			if ( slug ) say( 'appClose.' + slug );
		} );
		events.on( 'odd.app-installed', function () {
			motion( 'glance', { nod: true } );
			say( 'appInstalled' );
		} );
	}
} )();
