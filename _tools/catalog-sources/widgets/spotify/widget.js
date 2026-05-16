/**
 * ODD · Spotify Embed widget.
 *
 * The user pastes any Spotify URL (open.spotify.com/...) or URI
 * (spotify:...) for a playlist, album, track, artist, show, or
 * episode. The widget parses and validates the input, then renders
 * Spotify's official Embed iframe built from the known
 * https://open.spotify.com/embed/{type}/{id} shape. Raw iframe HTML
 * and unknown domains are rejected; we never inject user-supplied
 * markup.
 *
 * Playback is owned by Spotify. Region, login state, and
 * encrypted-media support all live inside Spotify's iframe; the
 * widget only brokers the embed URL and persists the user's choice
 * through Desktop Mode's ctx.storage helper.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	var wpI18nW = window.wp && window.wp.i18n;
	function __( s ) {
		return ( wpI18nW && typeof wpI18nW.__ === 'function' ) ? wpI18nW.__( s, 'odd' ) : s;
	}

	function el( tag, attrs, children ) {
		var n = document.createElement( tag );
		if ( attrs ) {
			for ( var k in attrs ) {
				if ( ! Object.prototype.hasOwnProperty.call( attrs, k ) ) continue;
				if ( k === 'class' ) n.className = attrs[ k ];
				else if ( k === 'style' ) n.setAttribute( 'style', attrs[ k ] );
				else n.setAttribute( k, attrs[ k ] );
			}
		}
		if ( children ) {
			if ( ! Array.isArray( children ) ) children = [ children ];
			children.forEach( function ( c ) {
				if ( c == null ) return;
				n.appendChild( typeof c === 'string' ? document.createTextNode( c ) : c );
			} );
		}
		return n;
	}

	function safeMount( fn, source ) {
		return function ( node, ctx ) {
			try {
				return fn( node, ctx );
			} catch ( err ) {
				if ( window.__odd && window.__odd.events ) {
					try {
						window.__odd.events.emit( 'odd.error', {
							source:   source,
							err:      err,
							severity: 'error',
							message:  err && err.message,
							stack:    err && err.stack,
						} );
					} catch ( e2 ) {}
				}
				if ( window.console ) { try { window.console.error( '[ODD ' + source + ']', err ); } catch ( e3 ) {} }
				return function () {};
			}
		};
	}

	var STORAGE_KEY = 'embed';

	function restoreWidgetState( ctx ) {
		try {
			if ( ctx && ctx.storage && typeof ctx.storage.get === 'function' ) {
				var stored = ctx.storage.get( STORAGE_KEY );
				if ( stored != null ) return stored;
			}
		} catch ( e ) {}
		return null;
	}

	function persistWidgetState( ctx, value ) {
		try {
			if ( ctx && ctx.storage && typeof ctx.storage.set === 'function' ) {
				if ( value == null ) {
					if ( typeof ctx.storage.remove === 'function' ) ctx.storage.remove( STORAGE_KEY );
				} else {
					ctx.storage.set( STORAGE_KEY, value );
				}
			}
		} catch ( e ) {}
	}

	// ---------------------------------------------------------------
	// URL parsing. Accept only open.spotify.com URLs and spotify:
	// URIs. Map the Spotify content type to an embed path segment and
	// validate the ID as a Spotify base62-ish token.
	// ---------------------------------------------------------------

	var SUPPORTED_TYPES = {
		playlist: __( 'Playlist' ),
		album:    __( 'Album' ),
		track:    __( 'Track' ),
		artist:   __( 'Artist' ),
		show:     __( 'Show' ),
		episode:  __( 'Episode' ),
	};
	var ID_RE = /^[A-Za-z0-9]{16,40}$/;

	/** Default Spotify playlist when nothing is persisted (same playlist as initial catalog embed). */
	var DEFAULT_EMBED_FALLBACK_PLAYLIST_OPEN_URL =
		'https://open.spotify.com/playlist/37i9dQZEVXbLp5XoPON0wI';

	function parseSpotifyInput( raw ) {
		if ( typeof raw !== 'string' ) return null;
		var trimmed = raw.trim();
		if ( ! trimmed ) return null;

		// Reject anything that looks like HTML or javascript: payloads.
		if ( /<[a-z!\/]/i.test( trimmed ) ) return null;
		if ( /^javascript:/i.test( trimmed ) ) return null;

		// spotify:{type}:{id} URI form.
		var uri = trimmed.match( /^spotify:([a-z]+):([A-Za-z0-9]+)$/i );
		if ( uri ) {
			var uType = uri[ 1 ].toLowerCase();
			var uId   = uri[ 2 ];
			if ( ! SUPPORTED_TYPES[ uType ] ) return null;
			if ( ! ID_RE.test( uId ) )         return null;
			return {
				type:        uType,
				id:          uId,
				originalUrl: 'spotify:' + uType + ':' + uId,
				openUrl:     'https://open.spotify.com/' + uType + '/' + uId,
			};
		}

		// open.spotify.com/{type}/{id} URL form.
		var parsed;
		try {
			parsed = new URL( trimmed );
		} catch ( e ) {
			return null;
		}
		if ( parsed.protocol !== 'https:' && parsed.protocol !== 'http:' ) return null;
		if ( parsed.hostname !== 'open.spotify.com' ) return null;

		// Path shapes: /{type}/{id}, /embed/{type}/{id}, or /intl-xx/{type}/{id}.
		var parts = parsed.pathname.split( '/' ).filter( Boolean );
		if ( parts.length < 2 ) return null;
		if ( parts[ 0 ] === 'embed' )             parts.shift();
		else if ( /^intl-[a-z]{2}$/i.test( parts[ 0 ] ) ) parts.shift();
		if ( parts.length < 2 ) return null;

		var pType = parts[ 0 ].toLowerCase();
		var pId   = parts[ 1 ];
		if ( ! SUPPORTED_TYPES[ pType ] ) return null;
		if ( ! ID_RE.test( pId ) )         return null;

		return {
			type:        pType,
			id:          pId,
			originalUrl: 'https://open.spotify.com/' + pType + '/' + pId,
			openUrl:     'https://open.spotify.com/' + pType + '/' + pId,
		};
	}

	function buildEmbedUrl( parsed ) {
		return 'https://open.spotify.com/embed/' + parsed.type + '/' + parsed.id +
			'?utm_source=odd';
	}

	// ---------------------------------------------------------------
	// Scoped styles. Injected into the widget container so two copies
	// of the widget never interfere with each other.
	// ---------------------------------------------------------------

	var STYLE_RULES =
		'.odd-widget--spotify{display:flex;box-sizing:border-box;padding:12px;' +
			'background:linear-gradient(160deg,rgba(18,18,18,.98) 0%,rgba(30,31,38,.96) 52%,rgba(22,26,23,.98) 100%);' +
			'color:#f5f5f7;overflow:hidden;}' +
		'.odd-spotify{display:flex;flex-direction:column;height:100%;max-height:100%;width:100%;box-sizing:border-box;' +
			'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f5f5f7;overflow:hidden;}' +
		'.odd-spotify__head{display:flex;align-items:center;justify-content:space-between;gap:8px;' +
			'padding:2px 4px 10px;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:rgba(245,245,247,.72);}' +
		'.odd-spotify__head strong{color:#1ed760;font-weight:900;letter-spacing:.11em;}' +
		'.odd-spotify__kind{font-weight:700;color:rgba(245,245,247,.86);text-transform:none;letter-spacing:0;font-size:12px;' +
			'white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;}' +
		'.odd-spotify__body{flex:0 0 auto;display:flex;height:152px;min-height:152px;}' +
		'.odd-spotify__iframe{flex:1;width:100%;height:152px;border:0;border-radius:18px;' +
			'background:#121212;box-shadow:0 18px 30px -18px rgba(0,0,0,.78),0 0 0 1px rgba(255,255,255,.08);}' +
		'.odd-spotify__setup{flex:1;display:flex;flex-direction:column;gap:8px;justify-content:center;padding:14px;' +
			'background:radial-gradient(circle at 12% 10%,rgba(30,215,96,.18),transparent 34%),linear-gradient(145deg,#101010 0%,#1d1e23 100%);' +
			'color:#f5f5f7;border:1px solid rgba(255,255,255,.08);border-radius:16px;box-shadow:inset 0 1px 0 rgba(255,255,255,.08);}' +
		'.odd-spotify__setup h4{margin:0;font-size:14px;font-weight:800;letter-spacing:0;}' +
		'.odd-spotify__setup p{margin:0;font-size:11px;line-height:1.35;color:rgba(245,245,247,.72);}' +
		'.odd-spotify__input{flex:1;font:inherit;font-size:12px;height:36px;padding:0 11px;border-radius:10px;' +
			'border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.08);color:#f5f5f7;min-width:0;box-sizing:border-box;}' +
		'.odd-spotify__input:focus{outline:none;border-color:#1ed760;box-shadow:0 0 0 2px rgba(30,215,96,.32);}' +
		'.odd-spotify__row{display:flex;gap:8px;align-items:center;}' +
		'.odd-spotify__actions{display:flex;gap:10px;padding:11px 2px 0;justify-content:center;align-items:center;}' +
		'.odd-spotify__btn{display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;padding:0;' +
			'font:700 16px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;border-radius:999px;cursor:pointer;text-decoration:none;' +
			'border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.09);color:#f5f5f7;' +
			'box-shadow:inset 0 1px 0 rgba(255,255,255,.12),0 8px 18px -12px rgba(0,0,0,.7);transition:background .15s,transform .15s,border-color .15s,color .15s;}' +
		'.odd-spotify__btn:hover{background:rgba(255,255,255,.16);border-color:rgba(255,255,255,.28);transform:translateY(-1px);}' +
		'.odd-spotify__btn:focus-visible{outline:none;box-shadow:0 0 0 2px rgba(30,215,96,.45);}' +
		'.odd-spotify__btn--primary{width:auto;min-width:72px;height:36px;padding:0 14px;border-radius:10px;' +
			'background:#1ed760;color:#07140b;border-color:transparent;font-size:12px;letter-spacing:.01em;}' +
		'.odd-spotify__btn--primary:hover{background:#22ea6d;}' +
		'.odd-spotify__btn--open{background:#1ed760;border-color:transparent;color:#07140b;}' +
		'.odd-spotify__btn--open:hover{background:#22ea6d;border-color:transparent;}' +
		'.odd-spotify__btn--ghost{background:rgba(255,255,255,.04);color:rgba(245,245,247,.72);}' +
		'.odd-spotify__btn--ghost:hover{background:rgba(255,255,255,.11);color:#fff;}' +
		'.odd-spotify__error{margin:0;font-size:11px;color:#ff7b7b;min-height:1em;}' +
		'.odd-spotify__hint{margin:0;font-size:10px;color:rgba(245,245,247,.58);line-height:1.35;}';

	function injectStyles( container ) {
		if ( container.querySelector( '.odd-spotify__styles' ) ) return;
		var style = document.createElement( 'style' );
		style.className = 'odd-spotify__styles';
		style.textContent = STYLE_RULES;
		container.appendChild( style );
	}

	// ---------------------------------------------------------------
	// Render states.
	// ---------------------------------------------------------------

	function mountSpotify( container, ctx ) {
		container.classList.add( 'odd-widget', 'odd-widget--spotify' );
		injectStyles( container );

		var root = el( 'div', { class: 'odd-spotify' } );
		container.appendChild( root );

		var state = {
			parsed: null,
		};

		// Hydrate from persisted snapshot if the parsed form still
		// validates. Anything stale or malformed falls back to setup.
		var restored = restoreWidgetState( ctx );
		if ( restored && typeof restored === 'object' && restored.originalUrl ) {
			var hydrated = parseSpotifyInput( restored.originalUrl );
			if ( hydrated ) state.parsed = hydrated;
		}
		if ( ! state.parsed ) {
			var initial = parseSpotifyInput( DEFAULT_EMBED_FALLBACK_PLAYLIST_OPEN_URL );
			if ( initial ) {
				state.parsed = initial;
				persist();
			}
		}

		function persist() {
			if ( ! state.parsed ) { persistWidgetState( ctx, null ); return; }
			persistWidgetState( ctx, {
				type:        state.parsed.type,
				id:          state.parsed.id,
				originalUrl: state.parsed.originalUrl,
				updatedAt:   Date.now(),
			} );
		}

		function renderSetup( prefill, errorMessage ) {
			root.innerHTML = '';

			var setup = el( 'div', { class: 'odd-spotify__setup' } );
			setup.appendChild( el( 'h4', {}, __( 'Embed a Spotify link' ) ) );
			setup.appendChild( el( 'p', {}, __( 'Paste a Spotify playlist, album, track, artist, show, or episode URL — from the Share menu or the Spotify address bar.' ) ) );

			var form = el( 'form', { class: 'odd-spotify__row' } );
			var input = el( 'input', {
				type:          'url',
				class:         'odd-spotify__input',
				placeholder:   'https://open.spotify.com/playlist/…',
				'aria-label':  __( 'Spotify URL' ),
				spellcheck:    'false',
				autocomplete:  'off',
				autocorrect:   'off',
				autocapitalize: 'off',
			} );
			if ( prefill ) input.value = prefill;
			var submit = el( 'button', {
				type:  'submit',
				class: 'odd-spotify__btn odd-spotify__btn--primary',
			}, __( 'Embed' ) );
			form.appendChild( input );
			form.appendChild( submit );
			setup.appendChild( form );

			var err = el( 'p', { class: 'odd-spotify__error', role: 'alert' }, errorMessage || '' );
			setup.appendChild( err );

			setup.appendChild( el( 'p', { class: 'odd-spotify__hint' },
				__( 'Spotify may only play 30-second previews unless your browser is signed in and supports encrypted media.' )
			) );

			root.appendChild( setup );

			form.addEventListener( 'submit', function ( ev ) {
				ev.preventDefault();
				var parsed = parseSpotifyInput( input.value );
				if ( ! parsed ) {
					err.textContent = __( 'That doesn\u2019t look like a Spotify playlist, album, track, artist, show, or episode URL.' );
					return;
				}
				state.parsed = parsed;
				persist();
				renderPlayer();
			} );

			setTimeout( function () { try { input.focus(); } catch ( e ) {} }, 0 );
		}

		function renderPlayer() {
			if ( ! state.parsed ) { renderSetup(); return; }

			root.innerHTML = '';

			var head = el( 'div', { class: 'odd-spotify__head' } );
			head.appendChild( el( 'strong', {}, 'Spotify' ) );
			var kindText = SUPPORTED_TYPES[ state.parsed.type ] || state.parsed.type;
			head.appendChild( el( 'span', { class: 'odd-spotify__kind' }, kindText ) );
			root.appendChild( head );

			var body = el( 'div', { class: 'odd-spotify__body' } );
			var iframe = el( 'iframe', {
				src:             buildEmbedUrl( state.parsed ),
				class:           'odd-spotify__iframe',
				title:           __( 'Spotify Embed' ) + ' — ' + kindText,
				loading:         'lazy',
				referrerpolicy:  'strict-origin-when-cross-origin',
				allow:           'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
				allowfullscreen: 'true',
			} );
			body.appendChild( iframe );
			root.appendChild( body );

			var actions = el( 'div', { class: 'odd-spotify__actions' } );
			var change = el( 'button', {
				type:         'button',
				class:        'odd-spotify__btn',
				'aria-label': __( 'Change Spotify embed' ),
				title:        __( 'Change' ),
			}, '↻' );
			var open   = el( 'a', {
				href:         state.parsed.openUrl,
				target:       '_blank',
				rel:          'noopener noreferrer',
				class:        'odd-spotify__btn odd-spotify__btn--open',
				'aria-label': __( 'Open in Spotify' ),
				title:        __( 'Open in Spotify' ),
			}, '▶' );
			var clear  = el( 'button', {
				type:         'button',
				class:        'odd-spotify__btn odd-spotify__btn--ghost',
				'aria-label': __( 'Clear Spotify embed' ),
				title:        __( 'Clear' ),
			}, '×' );

			change.addEventListener( 'click', function () {
				renderSetup( state.parsed ? state.parsed.originalUrl : '', '' );
			} );
			clear.addEventListener( 'click', function () {
				state.parsed = null;
				persist();
				renderSetup( '', '' );
			} );

			actions.appendChild( change );
			actions.appendChild( open );
			actions.appendChild( clear );
			root.appendChild( actions );
		}

		if ( state.parsed ) renderPlayer();
		else                renderSetup();

		return function unmount() {
			container.classList.remove( 'odd-widget', 'odd-widget--spotify' );
			root.innerHTML = '';
			if ( root.parentNode === container ) container.removeChild( root );
		};
	}

	// Expose the parser for integration tests. Keep it under the ODD
	// global so test harnesses can reach it without re-requiring a
	// module system inside catalog widgets.
	try {
		window.__odd = window.__odd || {};
		window.__odd.widgets = window.__odd.widgets || {};
		window.__odd.widgets.spotify = {
			parse:    parseSpotifyInput,
			embedUrl: buildEmbedUrl,
			types:    Object.keys( SUPPORTED_TYPES ),
		};
	} catch ( e ) {}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/spotify' ] = safeMount( mountSpotify, 'widget.spotify' );
} )();
