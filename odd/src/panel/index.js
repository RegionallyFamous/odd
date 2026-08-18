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

	function displayName( row ) {
		return row.label || row.name || 'ODD Notes';
	}

	function appRows( state ) {
		var rows = ( state.catalog || [] ).slice();
		( state.installed || [] ).forEach( function ( installed ) {
			if ( ! rows.some( function ( row ) { return row.slug === installed.slug; } ) ) {
				rows.push( installed );
			}
		} );
		return rows;
	}

	function setStatus( state, message, tone ) {
		state.status.textContent = message || '';
		state.status.dataset.tone = tone || 'neutral';
		state.status.classList.toggle( 'is-visible', !! message );
	}

	function buttonLabel( button ) {
		return button.querySelector( '[data-odd-button-label]' ) || button;
	}

	function appWindowId( slug ) {
		return 'odd-app-' + String( slug || '' ).replace( /[^a-z0-9-]/g, '' );
	}

	function placementFor( row ) {
		var surfaces = row && row.surfaces && typeof row.surfaces === 'object'
			? row.surfaces
			: { desktop: true, taskbar: false };
		var desktop = surfaces.desktop !== false;
		var taskbar = surfaces.taskbar === true;
		if ( desktop && taskbar ) { return 'both'; }
		if ( taskbar ) { return 'dock'; }
		if ( desktop ) { return 'desktop'; }
		return 'hidden';
	}

	function seedLivePlacement( row ) {
		var os = api();
		if ( typeof os.getOsSettings !== 'function' || typeof os.updateOsSettings !== 'function' ) {
			throw new Error( __( 'OpenStation live placement is unavailable. Update OpenStation and try again.' ) );
		}
		var snapshot = os.getOsSettings() || {};
		var visibility = Object.assign( {}, snapshot.itemVisibility || {} );
		var id = appWindowId( row && row.slug );
		if ( ! id || id === 'odd-app-' || Object.prototype.hasOwnProperty.call( visibility, id ) ) {
			return false;
		}
		visibility[ id ] = placementFor( row );
		os.updateOsSettings( { itemVisibility: visibility }, { windowId: 'odd' } );
		return true;
	}

	function removeLivePlacement( slug ) {
		var os = api();
		if ( typeof os.getOsSettings !== 'function' || typeof os.updateOsSettings !== 'function' ) {
			return false;
		}
		var snapshot = os.getOsSettings() || {};
		var visibility = Object.assign( {}, snapshot.itemVisibility || {} );
		var id = appWindowId( slug );
		if ( ! Object.prototype.hasOwnProperty.call( visibility, id ) ) {
			return false;
		}
		delete visibility[ id ];
		os.updateOsSettings( { itemVisibility: visibility }, { windowId: 'odd' } );
		return true;
	}

	async function refreshOpenStation() {
		if ( typeof api().refreshMenu !== 'function' ) {
			throw new Error( __( 'OpenStation live refresh is unavailable. Update OpenStation and try again.' ) );
		}
		await api().refreshMenu();
	}

	function validateInstallResult( payload, slug ) {
		if ( ! payload || payload.installed !== true || payload.slug !== slug ) {
			throw new Error( __( 'The app installer returned an incomplete result.' ) );
		}
		return payload.row && typeof payload.row === 'object'
			? payload.row
			: ( payload.manifest && typeof payload.manifest === 'object' ? payload.manifest : { slug: slug } );
	}

	async function openInstalledApp( state, row, button ) {
		var label = buttonLabel( button );
		var prior = label.textContent;
		button.disabled = true;
		label.textContent = __( 'Opening…' );
		setStatus( state, __( 'Opening ' ) + displayName( row ) + '…', 'busy' );
		try {
			var id = appWindowId( row.slug );
			var opened = api().openWindow( id, { source: 'odd/shop' } );
			if ( opened !== true ) {
				await refreshOpenStation();
				opened = api().openWindow( id, { source: 'odd/shop-retry' } );
			}
			if ( opened !== true ) {
				throw new Error( displayName( row ) + __( ' could not open. OpenStation did not register its window.' ) );
			}
			setStatus( state, '', 'neutral' );
		} catch ( error ) {
			setStatus( state, error.message || __( 'The app could not open.' ), 'error' );
		} finally {
			button.disabled = false;
			label.textContent = prior;
		}
	}

	function prettyTag( tag ) {
		var normalized = String( tag || '' ).trim().toLowerCase();
		if ( normalized === 'wordpress' ) { return 'WordPress'; }
		if ( normalized === 'openstation' ) { return 'OpenStation'; }
		return normalized
			.replace( /-/g, ' ' )
			.replace( /\b\w/g, function ( letter ) { return letter.toUpperCase(); } );
	}

	function cardKicker( row ) {
		var tags = ( row.tags || [] ).slice( 1, 3 ).map( prettyTag );
		return tags.length ? tags.join( ' · ' ) : __( 'OpenStation app' );
	}

	function appendHighlights( body, row ) {
		var highlights = el( 'ul', 'odd-app-card__highlights' );
		var labels = row.slug === 'odd-notes'
			? [ __( 'Private WordPress storage' ), __( 'Favorites, tags & sharing' ), __( 'Revision history' ) ]
			: ( row.tags || [] ).slice( 0, 3 ).map( prettyTag );

		labels.forEach( function ( label, index ) {
			var item = el( 'li', 'odd-app-card__highlight' );
			var glyph = el( 'span', 'odd-app-card__highlight-glyph' );
			glyph.setAttribute( 'aria-hidden', 'true' );
			glyph.dataset.color = String( index + 1 );
			item.appendChild( glyph );
			item.appendChild( el( 'span', '', label ) );
			highlights.appendChild( item );
		} );

		if ( labels.length ) { body.appendChild( highlights ); }
	}

	function renderCard( state, row ) {
		var installed = state.installed.find( function ( app ) { return app.slug === row.slug; } );
		var rowIncompatible = row.incompatible === true || row.state === 'incompatible';
		var update = installed && ! rowIncompatible && versionNewer( row.version, installed.version );
		var incompatible = ! installed && rowIncompatible;
		var incompatibilityReason = incompatible && typeof row.incompatibility_reason === 'string'
			? row.incompatibility_reason.trim()
			: '';
		if ( incompatible && ! incompatibilityReason ) {
			incompatibilityReason = __( 'Update ODD or OpenStation to install this app.' );
		}
		var titleText = displayName( row );
		var card = el( 'article', 'odd-app-card' );
		card.dataset.slug = row.slug || '';
		card.dataset.state = update ? 'update' : ( installed ? 'installed' : ( incompatible ? 'incompatible' : 'available' ) );

		var art = el( 'div', 'odd-app-card__art' );
		var preview = row.preview_url || row.previewUrl || row.card_url || row.cardUrl || '';
		if ( preview ) {
			var previewImage = el( 'img', 'odd-app-card__preview' );
			previewImage.src = preview;
			previewImage.alt = '';
			previewImage.loading = 'eager';
			previewImage.decoding = 'async';
			art.appendChild( previewImage );
		}
		art.appendChild( el( 'span', 'odd-app-card__art-glint' ) );
		card.appendChild( art );

		var body = el( 'div', 'odd-app-card__body' );
		var identity = el( 'div', 'odd-app-card__identity' );
		var iconWrap = el( 'span', 'odd-app-card__icon-wrap' );
		var iconUrl = row.icon_url || row.iconUrl || '';
		if ( iconUrl ) {
			var icon = el( 'img', 'odd-app-card__icon' );
			icon.alt = '';
			icon.src = iconUrl;
			iconWrap.appendChild( icon );
		}
		identity.appendChild( iconWrap );
		var identityCopy = el( 'div', 'odd-app-card__identity-copy' );
		identityCopy.appendChild( el( 'p', 'odd-app-card__kicker', cardKicker( row ) ) );
		identityCopy.appendChild( el( 'h2', '', titleText ) );
		identity.appendChild( identityCopy );
		body.appendChild( identity );

		var stateBadge = el(
			'span',
			'odd-app-card__state',
			update ? __( 'Update available' ) : ( installed ? __( 'Installed' ) : ( incompatible ? __( 'Update required' ) : __( 'Available' ) ) )
		);
		stateBadge.insertBefore( el( 'span', 'odd-app-card__state-dot' ), stateBadge.firstChild );
		body.appendChild( stateBadge );

		body.appendChild( el(
			'p',
			incompatible ? 'odd-app-card__description odd-app-card__compatibility' : 'odd-app-card__description',
			incompatible ? incompatibilityReason : ( row.description || __( 'A focused notes app stored in WordPress.' ) )
		) );
		appendHighlights( body, row );

		var footer = el( 'div', 'odd-app-card__footer' );
		var actions = el( 'div', 'odd-app-card__actions' );
		var primary = el( 'button', 'odd-app-card__button odd-app-card__button--primary' );
		primary.type = 'button';
		var primaryLabel = el( 'span', '', installed ? ( update ? __( 'Update app' ) : __( 'Open app' ) ) : ( incompatible ? __( 'Update required' ) : __( 'Install app' ) ) );
		primaryLabel.dataset.oddButtonLabel = '1';
		primary.appendChild( primaryLabel );
		primary.appendChild( el( 'span', 'odd-app-card__button-arrow', '↗' ) );
		primary.disabled = incompatible || ( ! installed && ! state.cfg.canInstall );
		if ( incompatible ) {
			primary.title = incompatibilityReason;
		} else if ( primary.disabled ) {
			primary.title = __( 'An administrator must install this app.' );
		}
		if ( ! incompatible ) {
			primary.addEventListener( 'click', function () {
				if ( installed && ! update ) {
					openInstalledApp( state, row, primary );
					return;
				}
				mutate( state, primary, __( update ? 'Updating…' : 'Installing…' ), function () {
					return request( state.cfg, state.cfg.rest.install, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify( { slug: row.slug, allow_update: !! update } )
					} );
				}, {
					partialFailure: displayName( row ) + __( ' was installed, but OpenStation could not refresh its launcher. Try Open app again; if it still fails, reload once.' ),
					afterCommit: async function ( payload ) {
						var installedRow = validateInstallResult( payload, row.slug );
						if ( ! installed ) { seedLivePlacement( installedRow ); }
						await refreshOpenStation();
						if ( ! state.installed.some( function ( app ) { return app.slug === row.slug; } ) ) {
							throw new Error( __( 'The app was installed but is missing from the installed-app registry.' ) );
						}
					}
				} );
			} );
		}
		actions.appendChild( primary );

		if ( installed && state.cfg.canInstall ) {
			var remove = el( 'button', 'odd-app-card__button odd-app-card__button--remove', __( 'Remove' ) );
			remove.type = 'button';
			remove.addEventListener( 'click', async function () {
				var confirmed;
				try {
					if ( typeof api().confirm !== 'function' ) {
						throw new Error( __( 'OpenStation confirmation is unavailable.' ) );
					}
					confirmed = await api().confirm( {
						title: __( 'Remove this app?' ),
						message: __( 'Remove ' ) + titleText + __( ' from this site?' ),
						confirmLabel: __( 'Remove' ),
						cancelLabel: __( 'Keep it' ),
						danger: true
					} );
				} catch ( error ) {
					setStatus( state, error && error.message ? error.message : __( 'Could not open the confirmation dialog.' ), 'error' );
					return;
				}
				if ( ! confirmed ) { return; }
				mutate( state, remove, __( 'Removing…' ), function () {
					return request( state.cfg, state.cfg.rest.bundles + encodeURIComponent( row.slug ), { method: 'DELETE' } );
				}, {
					partialFailure: displayName( row ) + __( ' was removed, but OpenStation could not refresh its launcher.' ),
					afterCommit: async function ( payload ) {
						if ( ! payload || payload.uninstalled !== true ) {
							throw new Error( __( 'The app remover returned an incomplete result.' ) );
						}
						removeLivePlacement( row.slug );
						await refreshOpenStation();
					}
				} );
			} );
			actions.appendChild( remove );
		}
		footer.appendChild( actions );
		footer.appendChild( el(
			'p',
			'odd-app-card__version',
			installed && ! update
				? __( 'Ready in OpenStation · v' ) + ( installed.version || row.version || '1.0.0' )
				: __( 'Verified ODD catalog · v' ) + ( row.version || '1.0.0' )
		) );
		body.appendChild( footer );
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

	async function mutate( state, button, busyText, operation, options ) {
		options = options || {};
		var label = buttonLabel( button );
		var prior = label.textContent;
		var committed = false;
		button.disabled = true;
		label.textContent = busyText;
		setStatus( state, busyText, 'busy' );
		try {
			var payload = await operation();
			committed = true;
			await reloadState( state );
			if ( typeof options.afterCommit === 'function' ) {
				await options.afterCommit( payload );
			}
			render( state );
			setStatus( state, __( 'Everything is up to date.' ), 'success' );
		} catch ( error ) {
			if ( committed ) {
				try { await reloadState( state ); } catch ( _reloadError ) {}
				render( state );
				setStatus( state, options.partialFailure || error.message || __( 'The change was saved, but the desktop could not refresh.' ), 'error' );
			} else {
				button.disabled = false;
				label.textContent = prior;
				setStatus( state, error.message || __( 'Something went wrong.' ), 'error' );
			}
		}
	}

	function renderHeader( state, rows ) {
		var top = el( 'header', 'odd-shop__top' );
		var topInner = el( 'div', 'odd-shop__top-inner' );
		var brand = el( 'div', 'odd-shop__brand' );
		var markWrap = el( 'span', 'odd-shop__mark-wrap' );
		if ( state.cfg.iconUrl ) {
			var mark = el( 'img', 'odd-shop__mark' );
			mark.src = state.cfg.iconUrl;
			mark.alt = '';
			markWrap.appendChild( mark );
		}
		brand.appendChild( markWrap );
		var brandCopy = el( 'span', 'odd-shop__brand-copy' );
		brandCopy.appendChild( el( 'strong', '', __( 'ODD Shop' ) ) );
		brandCopy.appendChild( el( 'span', '', __( 'Apps for OpenStation' ) ) );
		brand.appendChild( brandCopy );
		topInner.appendChild( brand );

		var tools = el( 'div', 'odd-shop__tools' );
		var count = el( 'span', 'odd-shop__count' );
		count.appendChild( el( 'span', 'odd-shop__count-dot' ) );
		count.appendChild( el( 'span', '', rows.length + ( rows.length === 1 ? __( ' app' ) : __( ' apps' ) ) ) );
		tools.appendChild( count );
		var refresh = el( 'button', 'odd-shop__refresh' );
		refresh.type = 'button';
		refresh.disabled = ! state.cfg.canInstall;
		refresh.title = __( 'Refresh catalog' );
		refresh.setAttribute( 'aria-label', __( 'Refresh catalog' ) );
		refresh.appendChild( el( 'span', 'odd-shop__refresh-icon', '↻' ) );
		var refreshLabel = el( 'span', 'odd-shop__refresh-label', __( 'Refresh' ) );
		refreshLabel.dataset.oddButtonLabel = '1';
		refresh.appendChild( refreshLabel );
		refresh.addEventListener( 'click', function () {
			mutate( state, refresh, __( 'Refreshing…' ), function () {
				return request( state.cfg, state.cfg.rest.refresh, { method: 'POST' } );
			} );
		} );
		tools.appendChild( refresh );
		topInner.appendChild( tools );
		top.appendChild( topInner );
		return top;
	}

	function render( state ) {
		var root = state.root;
		var rows = appRows( state );
		root.replaceChildren();
		root.appendChild( renderHeader( state, rows ) );

		var main = el( 'main', 'odd-shop__main' );
		var intro = el( 'section', 'odd-shop__intro' );
		var introCopy = el( 'div', 'odd-shop__intro-copy' );
		introCopy.appendChild( el( 'p', 'odd-shop__eyebrow', __( 'ODD / APPS' ) ) );
		introCopy.appendChild( el( 'h1', '', __( 'Small tools. Strange polish.' ) ) );
		introCopy.appendChild( el( 'p', 'odd-shop__lede', __( 'A growing collection of useful things made to feel completely at home in OpenStation.' ) ) );
		intro.appendChild( introCopy );
		var orbit = el( 'div', 'odd-shop__orbit' );
		orbit.setAttribute( 'aria-hidden', 'true' );
		orbit.appendChild( el( 'span', 'odd-shop__orbit-ring' ) );
		orbit.appendChild( el( 'span', 'odd-shop__orbit-eye' ) );
		intro.appendChild( orbit );
		main.appendChild( intro );

		var shelf = el( 'section', 'odd-shop__shelf' );
		var shelfHead = el( 'div', 'odd-shop__shelf-head' );
		var shelfCopy = el( 'div' );
		shelfCopy.appendChild( el( 'h2', '', __( 'Apps' ) ) );
		shelfCopy.appendChild( el( 'p', '', __( 'Install what you need. New apps arrive through the catalog.' ) ) );
		shelfHead.appendChild( shelfCopy );
		var signal = el( 'span', 'odd-shop__signal', __( 'Catalog online' ) );
		signal.insertBefore( el( 'span', 'odd-shop__signal-dot' ), signal.firstChild );
		if ( ! state.catalog.length ) {
			signal.replaceChildren( el( 'span', 'odd-shop__signal-dot' ), document.createTextNode( __( 'Using saved apps' ) ) );
			signal.classList.add( 'is-offline' );
		}
		shelfHead.appendChild( signal );
		shelf.appendChild( shelfHead );

		var grid = el( 'div', 'odd-shop__grid' );
		if ( rows.length ) {
			rows.forEach( function ( row ) { grid.appendChild( renderCard( state, row ) ); } );
		} else {
			var empty = el( 'div', 'odd-shop__empty' );
			empty.appendChild( el( 'span', 'odd-shop__empty-eye', '◉' ) );
			empty.appendChild( el( 'h2', '', __( 'The shelf is resting.' ) ) );
			empty.appendChild( el( 'p', '', __( 'The app catalog is temporarily unavailable. Refresh it in a moment.' ) ) );
			grid.appendChild( empty );
			signal.replaceChildren( el( 'span', 'odd-shop__signal-dot' ), document.createTextNode( __( 'Catalog unavailable' ) ) );
		}
		shelf.appendChild( grid );
		main.appendChild( shelf );
		main.appendChild( state.status );
		root.appendChild( main );
	}

	window.openStationNativeWindows.odd = function ( body, context ) {
		var root = body.querySelector( '[data-odd-shop]' ) || body;
		var cfg = api().getWindowConfig( 'odd' ) || {};
		cfg.iconUrl = cfg.iconUrl || '';
		var status = el( 'p', 'odd-shop__status' );
		status.setAttribute( 'role', 'status' );
		status.setAttribute( 'aria-live', 'polite' );
		var state = { root: root, cfg: cfg, status: status, installed: cfg.installedApps || [], catalog: cfg.catalogApps || [] };
		if ( context && context.markLoading ) { context.markLoading(); }
		render( state );
		if ( context && context.markReady ) { context.markReady(); }
		return function () { root.replaceChildren(); };
	};
} )();
