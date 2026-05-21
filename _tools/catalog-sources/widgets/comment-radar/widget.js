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

	function mountCommentRadar( container, ctx ) {
		container.classList.add( 'odd-widget', 'odd-widget--comment-radar' );
		container.textContent = '';
		if ( reducedMotion() ) container.classList.add( 'is-reduced' );

		var refresh = el( 'button', { type: 'button', class: 'odd-radar__refresh', 'aria-label': __( 'Refresh comment radar' ) } );
		var count = el( 'div', { class: 'odd-radar__count', text: '...' } );
		var label = el( 'div', { class: 'odd-radar__label', text: __( 'Sweeping comments' ) } );
		var meta = el( 'div', { class: 'odd-radar__meta', text: __( 'Listening for tiny opinions.' ) } );
		var action = el( 'a', { class: 'odd-radar__action', href: '#', 'aria-disabled': 'true' }, __( 'Review queue' ) );
		var scope = el( 'div', { class: 'odd-radar__scope', 'aria-hidden': 'true' }, [
			el( 'span', { class: 'odd-radar__ring odd-radar__ring--outer' } ),
			el( 'span', { class: 'odd-radar__ring odd-radar__ring--inner' } ),
			el( 'span', { class: 'odd-radar__sweep' } ),
			el( 'span', { class: 'odd-radar__dot' } ),
		] );
		var shell = el( 'div', { class: 'odd-radar', role: 'group', 'aria-label': __( 'Comment Radar' ) }, [
			el( 'div', { class: 'odd-radar__top' }, [
				el( 'div', { class: 'odd-radar__eyebrow', text: __( 'Comment Radar' ) } ),
				refresh,
			] ),
			el( 'div', { class: 'odd-radar__body' }, [ scope, el( 'div', { class: 'odd-radar__copy' }, [ count, label, meta ] ) ] ),
			action,
		] );
		container.appendChild( shell );

		var done = false;
		var interval = 0;

		function render( summary, stale ) {
			var comments = summary && summary.comments ? summary.comments : null;
			container.classList.toggle( 'is-stale', !! stale );
			if ( ! comments || ! comments.available ) {
				container.setAttribute( 'data-state', 'locked' );
				count.textContent = '-';
				label.textContent = __( 'Radar needs moderator mode' );
				meta.textContent = __( 'The signal is polite but private.' );
				action.setAttribute( 'href', '#' );
				action.setAttribute( 'aria-disabled', 'true' );
				return;
			}
			var pending = Number( comments.pending || 0 );
			count.textContent = String( pending );
			action.setAttribute( 'href', comments.moderateUrl || '#' );
			action.setAttribute( 'aria-disabled', comments.moderateUrl ? 'false' : 'true' );
			if ( pending > 0 ) {
				container.setAttribute( 'data-state', 'ping' );
				label.textContent = pending === 1 ? __( '1 comment waiting' ) : pending + ' ' + __( 'comments waiting' );
				meta.textContent = __( 'A small chorus is clearing its throat.' );
			} else {
				container.setAttribute( 'data-state', 'clear' );
				label.textContent = __( 'Clear skies' );
				meta.textContent = __( 'No comments in the airlock.' );
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
					else render( { comments: { available: false } }, true );
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
			container.classList.remove( 'odd-widget', 'odd-widget--comment-radar', 'is-reduced', 'is-stale', 'is-loading' );
			container.removeAttribute( 'data-state' );
		};
	}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/comment-radar' ] = safeMount( mountCommentRadar, 'widget.comment-radar' );
} )();
