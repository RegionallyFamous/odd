/**
 * ODD registries (window.__odd.registries)
 * ---------------------------------------------------------------
 * Filter-aware readers for the seven ODD registries. Reads the
 * seed list from the store, passes it through the matching JS
 * filter hook, and returns the result. Third-party plugins can
 * add/modify entries via wp.hooks.addFilter on the filter names
 * listed below.
 *
 * Registries + filter names:
 *
 *   scenes            → odd.scenes
 *   iconSets          → odd.iconSets
 *   muses             → odd.muses
 *   commands          → odd.commands
 *   widgets           → odd.widgets
 *   rituals           → odd.rituals
 *   motionPrimitives  → odd.motionPrimitives
 *
 * Each PHP side has the matching `oddout_*_registry` filter (see
 * odd/includes/extensions.php) so registrations can happen either
 * server- or client-side, or both.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;
	window.__odd = window.__odd || {};
	if ( window.__odd.registries ) return;

	function applyFilters( hook, value ) {
		if ( window.wp && window.wp.hooks && typeof window.wp.hooks.applyFilters === 'function' ) {
			try { return window.wp.hooks.applyFilters( hook, value ); } catch ( e ) { return value; }
		}
		return value;
	}

	function readRegistry( slice, filter ) {
		var store = window.__odd.store;
		var seed  = store ? store.get( 'registries.' + slice ) : [];
		var arr   = Array.isArray( seed ) ? seed.slice() : [];
		return applyFilters( filter, arr );
	}

	function find( list, slug ) {
		if ( ! Array.isArray( list ) || ! slug ) return null;
		for ( var i = 0; i < list.length; i++ ) {
			if ( list[ i ] && list[ i ].slug === slug ) return list[ i ];
		}
		return null;
	}

	var api = {
		readScenes:            function () { return readRegistry( 'scenes',            'odd.scenes' ); },
		readIconSets:          function () { return readRegistry( 'iconSets',          'odd.iconSets' ); },
		readMuses:             function () { return readRegistry( 'muses',             'odd.muses' ); },
		readCommands:          function () { return readRegistry( 'commands',          'odd.commands' ); },
		readWidgets:           function () { return readRegistry( 'widgets',           'odd.widgets' ); },
		readRituals:           function () { return readRegistry( 'rituals',           'odd.rituals' ); },
		readMotionPrimitives:  function () { return readRegistry( 'motionPrimitives',  'odd.motionPrimitives' ); },
		readApps:              function () { return readRegistry( 'apps',              'odd.apps' ); },

		findScene:   function ( slug ) { return find( api.readScenes(), slug ); },
		findIconSet: function ( slug ) { return find( api.readIconSets(), slug ); },
		findMuse:    function ( slug ) { return find( api.readMuses(), slug ); },
		findApp:     function ( slug ) { return find( api.readApps(), slug ); },
	};

	window.__odd.registries = api;
} )();
