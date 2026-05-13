/**
 * Iris — the default ODD muse.
 * ---------------------------------------------------------------
 * Registers as the first entry in the `odd.muses` registry (Cut 1
 * extension point). Future icon sets can register their own muses
 * the same way by calling `wp.hooks.addFilter( 'odd.muses', … )`.
 *
 * Voice rule: two to seven words. Period or em-dash only, never
 * exclamation. Observational, never instructive. First person
 * sparingly — Iris is the Eye. Mildly uncanny. The desktop is
 * slightly alive.
 *
 * Public surface on `window.__odd.iris`:
 *
 *   iris.say( bucket, opts )  — route a bucket through the active
 *                               muse, through safeCall, honoring
 *                               the `oddout_mascot_quiet` pref.
 *   iris.labels               — shorthand UI strings.
 *   iris.activeMuse()         — { slug, label, voice } currently
 *                               driving the voice (defaults Iris).
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;
	window.__odd = window.__odd || {};
	if ( window.__odd.iris && window.__odd.iris.__museInstalled ) return;

	var IRIS_VOICE = {
		boot:         [ 'Open. And looking.', 'Something was always decorating.', 'The lid lifts.' ],
		welcomeBack:  [ 'Back.', 'Where did you go.', 'The room missed you.' ],
		sceneOpen: {
			flux:    [ 'The ink remembers.',       'Indifferent to schedules.', 'A slow weather.' ],
			aurora:  [ 'The sky wrote something.', 'Twelve colors, one kept.',  'A draft of evening.' ],
			origami: [ 'Three cranes unfolded.',   'A square became a wing.',   'Paper remembers a bird.' ],
		},
		iconChange:   [ 'New costumes for the icons.', 'The dock is dressed.', 'Fresh uniforms.' ],
		shuffle:      [ 'Consulting the dice.', 'Fate engine warm.', 'I pick for you.' ],
		shellError:   [ 'Something blinked.', 'A small thing broke politely.', 'Brief static.' ],
		idle:         [ 'The desktop dreams of rectangles.', 'No hands. Just light.', 'Unattended and unbothered.' ],
		festival:     [ 'Festival.', 'Someone knew the combination.', 'The old code still works.' ],
		ritual7:      [ 'Seven. You saw me.' ],
		kept:         [ 'Kept.' ],
		// Apps (v0.16.0). Per-slug overrides go under
		// `appOpen.<slug>` / `appClose.<slug>` and can be provided
		// either by a registered muse or by an installed app via
		// `manifest.extensions.muses`. These are the catch-alls.
		appOpen:      [ 'A door opens.', 'A new room.', 'It was always there.' ],
		appClose:     [ 'Closed.', 'Back to the lobby.', 'A room folds away.' ],
		appInstalled: [ 'New app. Welcome.', 'Something arrived.', 'One more door.' ],
	};

	var LABELS = {
		wallpaper: 'Wallpaper',
		favorites: 'Kept close',
		recents:   'Lingering',
		shuffle:   'Fate engine',
		audio:     'Listen with',
		icons:     'Costumes',
		about:     'Colophon',
		quiet:     'Iris — quiet mode',
	};

	var IRIS = {
		slug:  'iris',
		label: 'Iris',
		default: true,
		voice: IRIS_VOICE,
		labels: LABELS,
	};

	var hooks = window.wp && window.wp.hooks;
	if ( hooks && typeof hooks.addFilter === 'function' ) {
		hooks.addFilter( 'odd.muses', 'odd.iris-muse', function ( muses ) {
			var list = Array.isArray( muses ) ? muses.slice() : [];
			for ( var i = 0; i < list.length; i++ ) {
				if ( list[ i ] && list[ i ].slug === 'iris' ) return list;
			}
			list.unshift( IRIS );
			return list;
		} );
	}

	// Ring-buffer dedupe so the same line never repeats twice in a
	// row. 8-slot history is ~one session's worth for any bucket.
	var HISTORY_CAP = 8;
	var history = Object.create( null );

	function pickLine( pool ) {
		if ( ! pool || ! pool.length ) return '';
		if ( pool.length === 1 ) return pool[ 0 ];
		var tries = 8;
		while ( tries-- > 0 ) {
			var pick = pool[ Math.floor( Math.random() * pool.length ) ];
			var key  = pick.slice( 0, 24 );
			var log  = history[ key ] || 0;
			if ( log < 1 ) {
				history[ key ] = log + 1;
				bound();
				return pick;
			}
		}
		return pool[ 0 ];
	}
	function bound() {
		var keys = Object.keys( history );
		while ( keys.length > HISTORY_CAP ) {
			delete history[ keys.shift() ];
		}
	}

	function resolveBucket( voice, path ) {
		if ( ! voice ) return null;
		var segs = String( path ).split( '.' );
		var node = voice;
		for ( var i = 0; i < segs.length; i++ ) {
			if ( node == null ) return null;
			node = node[ segs[ i ] ];
		}
		return Array.isArray( node ) ? node : null;
	}

	function activeMuse() {
		var hooks = window.wp && window.wp.hooks;
		var list  = hooks && typeof hooks.applyFilters === 'function'
			? hooks.applyFilters( 'odd.muses', [ IRIS ] )
			: [ IRIS ];
		return Array.isArray( list ) && list[ 0 ] ? list[ 0 ] : IRIS;
	}

	function say( bucket, opts ) {
		opts = opts || {};
		var store = window.__odd.store;
		var quiet = store && store.get( 'user.mascotQuiet' );
		if ( quiet && ! opts.force ) return '';

		var muse = activeMuse();
		var line = pickLine( resolveBucket( muse.voice, bucket ) )
			|| pickLine( resolveBucket( IRIS_VOICE, bucket ) );
		if ( ! line ) return '';

		var api = window.__odd.api;
		if ( api && typeof api.toast === 'function' && ! opts.silent ) {
			api.toast( line );
		}
		var evt = window.__odd.events;
		if ( evt && typeof evt.emit === 'function' ) {
			evt.emit( 'odd.iris-said', { bucket: bucket, line: line, muse: muse.slug } );
		}
		return line;
	}

	window.__odd.iris = window.__odd.iris || {};
	window.__odd.iris.say         = say;
	window.__odd.iris.labels      = LABELS;
	window.__odd.iris.activeMuse  = activeMuse;
	window.__odd.iris.__museInstalled = true;
} )();
