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
				else if ( k === 'text' ) n.textContent = attrs[ k ];
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
				return fn( node, ctx || {} );
			} catch ( err ) {
				if ( window.__odd && window.__odd.events ) {
					try {
						window.__odd.events.emit( 'odd.error', { source: source, err: err, severity: 'error', message: err && err.message, stack: err && err.stack } );
					} catch ( e2 ) {}
				}
				if ( window.console ) { try { window.console.error( '[ODD ' + source + ']', err ); } catch ( e3 ) {} }
				return function () {};
			}
		};
	}
	function reducedMotion() {
		try {
			return window.matchMedia && window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches;
		} catch ( e ) { return false; }
	}
	function storageGet( ctx, key, fallback ) {
		try {
			if ( ctx && ctx.storage && typeof ctx.storage.get === 'function' ) {
				var stored = ctx.storage.get( key );
				return stored == null ? fallback : stored;
			}
		} catch ( e ) {}
		return fallback;
	}
	function storageSet( ctx, key, value ) {
		try {
			if ( ctx && ctx.storage && typeof ctx.storage.set === 'function' ) ctx.storage.set( key, value );
		} catch ( e ) {}
	}
	function summaryUrl() {
		var cfg = window.odd || window.oddout || {};
		if ( cfg.siteSummaryUrl ) return cfg.siteSummaryUrl;
		if ( cfg.restUrl ) return String( cfg.restUrl ).replace( /\/prefs(\?.*)?$/, '/site-summary$1' );
		return '/wp-json/odd/v1/site-summary';
	}
	function fetchSummary() {
		if ( typeof window.fetch !== 'function' ) return Promise.reject( new Error( 'fetch unavailable' ) );
		var cfg = window.odd || window.oddout || {};
		return window.fetch( summaryUrl(), {
			credentials: 'same-origin',
			headers: { Accept: 'application/json', 'X-WP-Nonce': cfg.restNonce || '' },
		} ).then( function ( response ) {
			if ( ! response.ok ) throw new Error( 'summary request failed' );
			return response.json();
		} );
	}

	function mountUpdateWhisper( container, ctx ) {
		container.classList.add( 'odd-widget', 'odd-widget--update-whisper' );
		container.textContent = '';
		if ( reducedMotion() ) container.classList.add( 'is-reduced' );

		var refresh = el( 'button', { type: 'button', class: 'odd-whisper__refresh', 'aria-label': __( 'Refresh update whisper' ) } );
		var count = el( 'div', { class: 'odd-whisper__count', text: '...' } );
		var label = el( 'div', { class: 'odd-whisper__label', text: __( 'Asking the plugins' ) } );
		var meta = el( 'div', { class: 'odd-whisper__meta', text: __( 'They love a dramatic pause.' ) } );
		var action = el( 'a', { class: 'odd-whisper__action', href: '#', 'aria-disabled': 'true' }, __( 'Open updates' ) );
		var meter = el( 'div', { class: 'odd-whisper__meter', 'aria-hidden': 'true' }, [
			el( 'span', { class: 'odd-whisper__bar odd-whisper__bar--one' } ),
			el( 'span', { class: 'odd-whisper__bar odd-whisper__bar--two' } ),
			el( 'span', { class: 'odd-whisper__bar odd-whisper__bar--three' } ),
		] );
		var shell = el( 'div', { class: 'odd-whisper', role: 'group', 'aria-label': __( 'Update Whisper' ) }, [
			el( 'div', { class: 'odd-whisper__top' }, [
				el( 'div', { class: 'odd-whisper__eyebrow', text: __( 'Update Whisper' ) } ),
				refresh,
			] ),
			el( 'div', { class: 'odd-whisper__body' }, [ meter, el( 'div', { class: 'odd-whisper__copy' }, [ count, label, meta ] ) ] ),
			action,
		] );
		container.appendChild( shell );

		var done = false;
		var interval = 0;

		function render( summary, stale ) {
			var updates = summary && summary.updates ? summary.updates : null;
			container.classList.toggle( 'is-stale', !! stale );
			if ( ! updates || ! updates.available ) {
				container.setAttribute( 'data-state', 'locked' );
				count.textContent = '-';
				label.textContent = __( 'Update secrets are tucked away' );
				meta.textContent = __( 'Only plugin caretakers hear the murmurs.' );
				action.setAttribute( 'href', '#' );
				action.setAttribute( 'aria-disabled', 'true' );
				return;
			}
			var plugins = Number( updates.plugins || 0 );
			count.textContent = String( plugins );
			action.setAttribute( 'href', updates.updatesUrl || '#' );
			action.setAttribute( 'aria-disabled', updates.updatesUrl ? 'false' : 'true' );
			if ( plugins > 0 ) {
				container.setAttribute( 'data-state', 'murmur' );
				label.textContent = plugins === 1 ? __( '1 plugin is murmuring' ) : plugins + ' ' + __( 'plugins are murmuring' );
				meta.textContent = updates.human || __( 'checked recently' );
			} else {
				container.setAttribute( 'data-state', 'quiet' );
				label.textContent = __( 'The plugins are quiet' );
				meta.textContent = updates.human || __( 'no update gossip today' );
			}
		}

		function load() {
			refresh.disabled = true;
			container.classList.add( 'is-loading' );
			return fetchSummary()
				.then( function ( summary ) {
					if ( done ) return;
					storageSet( ctx, 'summary', summary );
					render( summary, false );
				} )
				.catch( function () {
					if ( done ) return;
					var cached = storageGet( ctx, 'summary', null );
					if ( cached ) render( cached, true );
					else render( { updates: { available: false } }, true );
				} )
				.then( function () {
					if ( done ) return;
					refresh.disabled = false;
					container.classList.remove( 'is-loading' );
				} );
		}

		function onRefresh( ev ) {
			ev.preventDefault();
			load();
		}

		refresh.addEventListener( 'click', onRefresh );
		var cached = storageGet( ctx, 'summary', null );
		if ( cached ) render( cached, true );
		load();
		interval = window.setInterval( load, 5 * 60 * 1000 );

		return function () {
			if ( done ) return;
			done = true;
			window.clearInterval( interval );
			refresh.removeEventListener( 'click', onRefresh );
			container.classList.remove( 'odd-widget', 'odd-widget--update-whisper', 'is-reduced', 'is-stale', 'is-loading' );
			container.removeAttribute( 'data-state' );
		};
	}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/update-whisper' ] = safeMount( mountUpdateWhisper, 'widget.update-whisper' );
} )();
