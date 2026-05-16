/**
 * ODD event bus (window.__odd.events)
 * ---------------------------------------------------------------
 * Thin wrapper over @wordpress/hooks with the canonical set of ODD
 * event names documented in one place. Every internal subsystem
 * should use these constants rather than string literals so the
 * names stay discoverable and refactorable.
 *
 * Canonical events (firing contract). All names follow WordPress's
 * @wordpress/hooks naming rule — ASCII letters / digits / dashes /
 * periods / underscores, matching the `desktop-mode.*` convention in
 * the host shell.
 *
 *   Lifecycle phases (fired by the lifecycle module):
 *     odd.boot                — shared modules loaded, store hydrated
 *     odd.configured          — localized config applied
 *     odd.registries-ready    — all registries populated
 *     odd.mounted             — first wallpaper frame painted
 *     odd.ready               — every enqueued subsystem reported in
 *     odd.teardown            — plugin is shutting down (page unload)
 *
 *   Scene lifecycle (wallpaper runtime):
 *     odd.scene-changed        { from, to }
 *     odd.scene-swap-started   { from, to }
 *     odd.scene-swap-completed { from, to, ms }
 *     odd.scene-mount-failed   { slug, err }
 *
 *   Prefs:
 *     odd.icon-set-changed    { from, to }
 *     odd.shuffle-tick        { slug }
 *
 *   Shell reactivity (re-emitted from WP Desktop Mode):
	 *     odd.window-opened       { id, bounds }
	 *     odd.window-reopened     { id, windowId }
	 *     odd.window-closing      { id, windowId }
	 *     odd.window-closed       { id }
	 *     odd.window-focused      { id, bounds }
	 *     odd.window-blurred      { id, focusedTo }
	 *     odd.window-changed      { id, windowId }
	 *     odd.window-detached     { id, url }
	 *     odd.window-bounds-changed { id, windowId, bounds }
	 *     odd.window-body-resized { id, windowId, width, height }
 *     odd.shell-error         { message, err }
 *     odd.iframe-error        { message, err }
 *     odd.visibility-changed  { state: 'hidden' | 'visible' }
 *     odd.desktop-state-changed { revision, document, wallpaper, windows, surfaces, activity }
 *
 *   Apps (v0.16.0+):
 *     odd.app-installed       { slug, manifest }
 *     odd.app-uninstalled     { slug }
 *     odd.app-enabled         { slug }
 *     odd.app-disabled        { slug }
 *     odd.app-opened          { slug, windowId }
 *     odd.app-closed          { slug, windowId }
 *     odd.app-focused         { slug, windowId }
 *
 *   Errors:
 *     odd.error               { source, err, severity, message, stack }
 *
 * Live command hooks such as `odd.pickScene` are emitted by api.js and
 * mirrored into the richer lifecycle events above.
 *
 * The `log()` accessor exposes the most recent 200 events when debug
 * mode is on (`desktopModeConfig.debug === true` or ?odd-debug=1). In
 * production the log is a no-op so there's no unbounded memory growth.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;
	window.__odd = window.__odd || {};
	if ( window.__odd.events ) return;

	var NAMES = {
		BOOT:                 'odd.boot',
		CONFIGURED:           'odd.configured',
		REGISTRIES_READY:     'odd.registries-ready',
		MOUNTED:              'odd.mounted',
		READY:                'odd.ready',
		TEARDOWN:             'odd.teardown',
		SCENE_CHANGED:        'odd.scene-changed',
		SCENE_SWAP_STARTED:   'odd.scene-swap-started',
		SCENE_SWAP_COMPLETED: 'odd.scene-swap-completed',
		SCENE_MOUNT_FAILED:   'odd.scene-mount-failed',
		ICON_SET_CHANGED:     'odd.icon-set-changed',
		SHUFFLE_TICK:         'odd.shuffle-tick',
		WINDOW_OPENED:        'odd.window-opened',
		WINDOW_REOPENED:      'odd.window-reopened',
		WINDOW_CLOSING:       'odd.window-closing',
		WINDOW_CLOSED:        'odd.window-closed',
		WINDOW_FOCUSED:       'odd.window-focused',
		WINDOW_BLURRED:       'odd.window-blurred',
		WINDOW_CHANGED:       'odd.window-changed',
		WINDOW_DETACHED:      'odd.window-detached',
		WINDOW_BOUNDS_CHANGED: 'odd.window-bounds-changed',
		WINDOW_BODY_RESIZED:  'odd.window-body-resized',
		SHELL_ERROR:          'odd.shell-error',
		IFRAME_ERROR:         'odd.iframe-error',
		VISIBILITY_CHANGED:   'odd.visibility-changed',
		DESKTOP_STATE_CHANGED: 'odd.desktop-state-changed',
		APP_INSTALLED:        'odd.app-installed',
		APP_UNINSTALLED:      'odd.app-uninstalled',
		APP_ENABLED:          'odd.app-enabled',
		APP_DISABLED:         'odd.app-disabled',
		APP_OPENED:           'odd.app-opened',
		APP_CLOSED:           'odd.app-closed',
		APP_FOCUSED:          'odd.app-focused',
		ERROR:                'odd.error',
	};

	var LOG_SIZE = 200;
	var log = [];
	var subCounter = 0;

	function debugOn() {
		return !! ( window.__odd.store && window.__odd.store.get( 'runtime.debug' ) );
	}

	function maybeLog( name, payload ) {
		if ( ! debugOn() ) return;
		log.push( { t: Date.now(), name: name, payload: payload } );
		if ( log.length > LOG_SIZE ) log.shift();
	}

	function hooks() {
		return ( window.wp && window.wp.hooks ) || null;
	}

	function emit( name, payload ) {
		maybeLog( name, payload );
		var h = hooks();
		if ( h && typeof h.doAction === 'function' ) {
			try { h.doAction( name, payload ); } catch ( e ) {}
		}
	}

	function on( name, cb ) {
		var h = hooks();
		if ( ! h || typeof h.addAction !== 'function' ) return function () {};
		subCounter++;
		var ns = 'odd.sub-' + subCounter + '-' + Math.random().toString( 36 ).slice( 2, 8 );
		try { h.addAction( name, ns, cb ); } catch ( e ) {}
		return function () {
			try { h.removeAction( name, ns ); } catch ( e ) {}
		};
	}

	function once( name, cb ) {
		var off = on( name, function () {
			off();
			try { cb.apply( null, arguments ); } catch ( e ) {}
		} );
		return off;
	}

	window.__odd.events = {
		NAMES: NAMES,
		emit:  emit,
		on:    on,
		once:  once,
		log:   function () { return log.slice(); },
	};
} )();
