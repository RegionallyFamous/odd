( function () {
	'use strict';

	window.openStationNativeWindows = window.openStationNativeWindows || {};

	var __ = window.wp && window.wp.i18n ? window.wp.i18n.__ : function ( text ) { return text; };

	function api() {
		if ( ! window.wp || ! window.wp.os ) {
			throw new Error( __( 'ODD Shop requires the OpenStation public API.' ) );
		}
		return window.wp.os;
	}

	function request( cfg, url, options ) {
		options = options || {};
		options.credentials = 'same-origin';
		options.headers = Object.assign( {
			'Accept': 'application/json',
			'X-WP-Nonce': cfg.restNonce
		}, options.headers || {} );
		return api().fetch( url, options, { windowId: 'odd', source: 'odd/shop' } ).then( async function ( response ) {
			var payload;
			try { payload = await response.json(); } catch ( error ) { payload = {}; }
			if ( ! response.ok ) {
				throw new Error( payload.message || ( response.status + ' ' + response.statusText ) );
			}
			return payload;
		} );
	}

	function el( tag, className, text ) {
		var node = document.createElement( tag );
		if ( className ) { node.className = className; }
		if ( text ) { node.textContent = text; }
		return node;
	}

	function versionNewer( catalog, installed ) {
		var a = String( catalog || '0' ).split( '.' ).map( Number );
		var b = String( installed || '0' ).split( '.' ).map( Number );
		for ( var i = 0; i < Math.max( a.length, b.length ); i++ ) {
			if ( ( a[ i ] || 0 ) !== ( b[ i ] || 0 ) ) { return ( a[ i ] || 0 ) > ( b[ i ] || 0 ); }
		}
		return false;
	}

	function renderCard( state, row ) {
		var installed = state.installed.find( function ( app ) { return app.slug === row.slug; } );
		var update = installed && versionNewer( row.version, installed.version );
		var card = el( 'article', 'odd-app-card' );
		var art = el( 'div', 'odd-app-card__art' );
		var preview = row.preview_url || row.previewUrl || row.card_url || row.cardUrl || '';
		if ( preview ) { art.style.backgroundImage = 'url("' + String( preview ).replace( /["\\]/g, '' ) + '")'; }
		card.appendChild( art );

		var body = el( 'div', 'odd-app-card__body' );
		var heading = el( 'div', 'odd-app-card__heading' );
		var icon = el( 'img', 'odd-app-card__icon' );
		icon.alt = '';
		icon.src = row.icon_url || row.iconUrl || '';
		heading.appendChild( icon );
		var title = el( 'div' );
		title.appendChild( el( 'h2', '', row.label || row.name || 'ODD Notes' ) );
		title.appendChild( el( 'p', 'odd-app-card__version', 'v' + ( row.version || '1.0.0' ) ) );
		heading.appendChild( title );
		body.appendChild( heading );
		body.appendChild( el( 'p', 'odd-app-card__description', row.description || __( 'A focused notes app stored in WordPress.' ) ) );

		var actions = el( 'div', 'odd-app-card__actions' );
		var primary = el( 'button', 'button button-primary' );
		primary.type = 'button';
		primary.textContent = installed ? ( update ? __( 'Update' ) : __( 'Open' ) ) : __( 'Install' );
		primary.disabled = ! installed && ! state.cfg.canInstall;
		primary.addEventListener( 'click', function () {
			if ( installed && ! update ) {
				api().openWindow( 'odd-app-' + row.slug );
				return;
			}
			mutate( state, primary, __( update ? 'Updating…' : 'Installing…' ), function () {
				return request( state.cfg, state.cfg.rest.install, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify( { slug: row.slug, allow_update: !! update } )
				} );
			} );
		} );
		actions.appendChild( primary );

		if ( installed && state.cfg.canInstall ) {
			var remove = el( 'button', 'button button-link-delete', __( 'Remove' ) );
			remove.type = 'button';
			remove.addEventListener( 'click', async function () {
				var confirmed = window.confirm( __( 'Remove ODD Notes from this site?' ) );
				if ( ! confirmed ) { return; }
				mutate( state, remove, __( 'Removing…' ), function () {
					return request( state.cfg, state.cfg.rest.bundles + encodeURIComponent( row.slug ), { method: 'DELETE' } );
				} );
			} );
			actions.appendChild( remove );
		}
		body.appendChild( actions );
		card.appendChild( body );
		return card;
	}

	async function reloadState( state ) {
		var results = await Promise.all( [
			request( state.cfg, state.cfg.rest.apps, { method: 'GET' } ),
			request( state.cfg, state.cfg.rest.catalog + '?type=app', { method: 'GET' } )
		] );
		state.installed = results[ 0 ].apps || [];
		state.catalog = ( results[ 1 ].bundles || [] ).filter( function ( row ) { return row.type === 'app'; } );
	}

	async function mutate( state, button, busyLabel, operation ) {
		var prior = button.textContent;
		button.disabled = true;
		button.textContent = busyLabel;
		state.status.textContent = busyLabel;
		try {
			await operation();
			await reloadState( state );
			if ( typeof api().refreshMenu === 'function' ) { await api().refreshMenu(); }
			state.status.textContent = __( 'Ready.' );
			render( state );
		} catch ( error ) {
			button.disabled = false;
			button.textContent = prior;
			state.status.textContent = error.message || __( 'Something went wrong.' );
		}
	}

	function render( state ) {
		var root = state.root;
		root.replaceChildren();
		var top = el( 'header', 'odd-shop__top' );
		var mark = el( 'img', 'odd-shop__mark' );
		mark.src = state.cfg.iconUrl || '';
		mark.alt = '';
		top.appendChild( mark );
		var copy = el( 'div' );
		copy.appendChild( el( 'p', 'odd-shop__eyebrow', __( 'ODD / APPS' ) ) );
		copy.appendChild( el( 'h1', '', __( 'Useful things for your OpenStation.' ) ) );
		top.appendChild( copy );
		var refresh = el( 'button', 'button', __( 'Refresh catalog' ) );
		refresh.type = 'button';
		refresh.disabled = ! state.cfg.canInstall;
		refresh.addEventListener( 'click', function () {
			mutate( state, refresh, __( 'Refreshing…' ), function () {
				return request( state.cfg, state.cfg.rest.refresh, { method: 'POST' } );
			} );
		} );
		top.appendChild( refresh );
		root.appendChild( top );

		var intro = el( 'section', 'odd-shop__intro' );
		intro.appendChild( el( 'h2', '', __( 'Apps' ) ) );
		intro.appendChild( el( 'p', '', __( 'One excellent app at a time. Install it here; OpenStation handles where its launcher lives.' ) ) );
		root.appendChild( intro );

		var grid = el( 'main', 'odd-shop__grid' );
		if ( state.catalog.length ) {
			state.catalog.forEach( function ( row ) { grid.appendChild( renderCard( state, row ) ); } );
		} else {
			grid.appendChild( el( 'p', 'odd-shop__empty', __( 'The app catalog is temporarily unavailable.' ) ) );
		}
		root.appendChild( grid );
		root.appendChild( state.status );
	}

	window.openStationNativeWindows.odd = function ( body, context ) {
		var root = body.querySelector( '[data-odd-shop]' ) || body;
		var cfg = api().getWindowConfig( 'odd' ) || {};
		cfg.iconUrl = cfg.iconUrl || '';
		var status = el( 'p', 'odd-shop__status' );
		status.setAttribute( 'role', 'status' );
		var state = { root: root, cfg: cfg, status: status, installed: cfg.installedApps || [], catalog: cfg.catalogApps || [] };
		if ( context && context.markLoading ) { context.markLoading(); }
		render( state );
		if ( context && context.markReady ) { context.markReady(); }
		return function () { root.replaceChildren(); };
	};
} )();
