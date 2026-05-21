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
						window.__odd.events.emit( 'odd.error', {
							source: source,
							err: err,
							severity: 'error',
							message: err && err.message,
							stack: err && err.stack,
						} );
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
			if ( ctx && ctx.storage && typeof ctx.storage.set === 'function' ) {
				ctx.storage.set( key, value );
			}
		} catch ( e ) {}
	}

	function summaryUrl() {
		var cfg = window.odd || window.oddout || {};
		if ( cfg.siteSummaryUrl ) return cfg.siteSummaryUrl;
		if ( cfg.restUrl ) return String( cfg.restUrl ).replace( /\/prefs(\?.*)?$/, '/site-summary$1' );
		return '/wp-json/odd/v1/site-summary';
	}

	function fetchSummary() {
		if ( typeof window.fetch !== 'function' ) {
			return Promise.reject( new Error( 'fetch unavailable' ) );
		}
		var cfg = window.odd || window.oddout || {};
		return window.fetch( summaryUrl(), {
			credentials: 'same-origin',
			headers: {
				Accept: 'application/json',
				'X-WP-Nonce': cfg.restNonce || '',
			},
		} ).then( function ( response ) {
			if ( ! response.ok ) throw new Error( 'summary request failed' );
			return response.json();
		} );
	}

	function mountDraftNudge( container, ctx ) {
		container.classList.add( 'odd-widget', 'odd-widget--draft-nudge' );
		container.textContent = '';
		if ( reducedMotion() ) container.classList.add( 'is-reduced' );

		var shell = el( 'div', { class: 'odd-draft', role: 'group', 'aria-label': __( 'Draft Nudge' ) } );
		var count = el( 'div', { class: 'odd-draft__count', text: '...' } );
		var title = el( 'div', { class: 'odd-draft__title', text: __( 'Checking the draft drawer' ) } );
		var meta = el( 'div', { class: 'odd-draft__meta', text: __( 'Tiny editorial tap incoming.' ) } );
		var action = el( 'a', { class: 'odd-draft__action', href: '#', 'aria-disabled': 'true' }, __( 'Open draft' ) );
		var refresh = el( 'button', { type: 'button', class: 'odd-draft__refresh', 'aria-label': __( 'Refresh draft nudge' ) } );
		var card = el( 'div', { class: 'odd-draft__card' }, [
			el( 'div', { class: 'odd-draft__paper', 'aria-hidden': 'true' }, [
				el( 'span', { class: 'odd-draft__line' } ),
				el( 'span', { class: 'odd-draft__line' } ),
				el( 'span', { class: 'odd-draft__line' } ),
			] ),
			el( 'div', { class: 'odd-draft__copy' }, [ count, title, meta ] ),
		] );
		shell.appendChild( el( 'div', { class: 'odd-draft__top' }, [
			el( 'div', { class: 'odd-draft__eyebrow', text: __( 'Draft Nudge' ) } ),
			refresh,
		] ) );
		shell.appendChild( card );
		shell.appendChild( action );
		container.appendChild( shell );

		var done = false;
		var interval = 0;

		function render( summary, stale ) {
			var draft = summary && summary.draft ? summary.draft : null;
			container.classList.toggle( 'is-stale', !! stale );
			if ( ! draft || ! draft.available ) {
				container.setAttribute( 'data-state', 'locked' );
				count.textContent = '-';
				title.textContent = __( 'Draft drawer is locked' );
				meta.textContent = __( 'No peeking without edit powers.' );
				action.setAttribute( 'href', '#' );
				action.setAttribute( 'aria-disabled', 'true' );
				return;
			}
			var total = Number( draft.count || 0 );
			count.textContent = String( total );
			if ( ! total || ! draft.id ) {
				container.setAttribute( 'data-state', 'clear' );
				title.textContent = __( 'No drafts waiting' );
				meta.textContent = __( 'Unusually peaceful. Suspicious, but nice.' );
				action.setAttribute( 'href', '#' );
				action.setAttribute( 'aria-disabled', 'true' );
				return;
			}
			container.setAttribute( 'data-state', 'ready' );
			title.textContent = draft.title || __( 'Untitled draft' );
			meta.textContent = ( draft.human || __( 'recently edited' ) ) + ' - ' + __( 'it misses you a little' );
			action.setAttribute( 'href', draft.editUrl || '#' );
			action.setAttribute( 'aria-disabled', draft.editUrl ? 'false' : 'true' );
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
					else render( { draft: { available: false } }, true );
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
			container.classList.remove( 'odd-widget', 'odd-widget--draft-nudge', 'is-reduced', 'is-stale', 'is-loading' );
			container.removeAttribute( 'data-state' );
		};
	}

	window.desktopModeWidgets = window.desktopModeWidgets || {};
	window.desktopModeWidgets[ 'odd/draft-nudge' ] = safeMount( mountDraftNudge, 'widget.draft-nudge' );
} )();
