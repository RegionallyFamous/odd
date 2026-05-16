/**
 * Dock rail renderer — “ODD compact rail”.
 *
 * Contributes wp.desktop.registerDockRailRenderer({ id:'odd-compact', … }) so OS
 * Settings → Dock style can swap to a high-legibility mosaic row.
 *
 * Mirrors the Desktop Mode dispatcher contract returned by default Icon strip's
 * mount(): replaceItems / appendSystemItem / removeSystemItem / setBadge /
 * setAttention / setOrientation / destroy (see wordpress.org/desktop-mode trunk
 * desktop.js mountRail helpers).
 *
 * @since ODD bundling Desktop Mode surface expansion
 */
( function () {
	'use strict';

	var OWNER = 'odd-dock-rail';

	function __( text ) {
		if ( window.wp && window.wp.i18n && typeof window.wp.i18n.__ === 'function' ) {
			return window.wp.i18n.__( text, 'odd-outlandish-desktop-decorator' );
		}
		return text;
	}

	function dashIconMarkup( klass ) {
		var sp = document.createElement( 'span' );
		sp.className = 'dashicons ' + klass;
		sp.setAttribute( 'aria-hidden', 'true' );
		return sp;
	}

	function activeIconSetIcons() {
		var cfg = window.oddout || {};
		var slug = typeof cfg.iconSet === 'string' ? cfg.iconSet : '';
		var sets = Array.isArray( cfg.iconSets ) ? cfg.iconSets : [];
		if ( ! slug || ! sets.length ) {
			return {};
		}
		for ( var i = 0; i < sets.length; i++ ) {
			if ( sets[ i ] && sets[ i ].slug === slug && sets[ i ].icons ) {
				return sets[ i ].icons;
			}
		}
		return {};
	}

	function currentIconSetSlug() {
		var cfg = window.oddout || {};
		return typeof cfg.iconSet === 'string' ? cfg.iconSet : '';
	}

	function firstIconMatchForKeys( keys ) {
		var icons = activeIconSetIcons();
		for ( var i = 0; i < keys.length; i++ ) {
			if ( icons[ keys[ i ] ] ) {
				return { key: keys[ i ], url: icons[ keys[ i ] ] };
			}
		}
		return null;
	}

	function firstIconUrlForKeys( keys ) {
		var match = firstIconMatchForKeys( keys );
		return match ? match.url : '';
	}

	function iconKeysForItem( icon, item ) {
		var keys = [];
		var title = '';
		var id = '';
		try {
			title = String( ( item && ( item.title || item.label ) ) || '' ).toLowerCase();
			id = String( ( item && item.id ) || '' ).toLowerCase();
		} catch ( _ ) {}

		if (
			id === 'desktop-mode-os-settings' ||
			id === 'wp-desktop-os-settings' ||
			title.indexOf( 'os settings' ) !== -1
		) {
			keys.push( 'os-settings', 'settings' );
		}
		if (
			id === 'desktop-mode-pwa-install' ||
			title.indexOf( 'install my wordpress' ) !== -1 ||
			title.indexOf( ' as an app' ) !== -1
		) {
			keys.push( 'import', 'tools' );
		}
		if (
			id === 'desktop-mode-bug-report' ||
			title.indexOf( 'report a bug' ) !== -1 ||
			title.indexOf( 'bug report' ) !== -1
		) {
			keys.push( 'plugins' );
		}
		if (
			id === 'desktop-mode-exit' ||
			title.indexOf( 'classic' ) !== -1 ||
			title.indexOf( 'exit desktop' ) !== -1 ||
			title.indexOf( 'exit' ) !== -1 ||
			title.indexOf( 'logout' ) !== -1 ||
			title.indexOf( 'log out' ) !== -1
		) {
			keys.push( 'classic-admin', 'fallback' );
		}
		if ( title.indexOf( 'import' ) !== -1 || title.indexOf( 'download' ) !== -1 ) {
			keys.push( 'import', 'tools' );
		}

		switch ( icon ) {
			case 'dashicons-desktop':
			case 'dashicons-admin-site':
			case 'dashicons-welcome-view-site':
				keys.push( 'os-settings', 'settings' );
				break;
			case 'dashicons-download':
			case 'dashicons-upload':
			case 'dashicons-migrate':
				keys.push( 'import', 'tools' );
				break;
			case 'dashicons-buddicons-replies':
			case 'dashicons-admin-plugins':
				keys.push( 'plugins' );
				break;
			case 'dashicons-exit':
			case 'dashicons-exit-alt':
			case 'dashicons-arrow-left-alt':
			case 'dashicons-arrow-left-alt2':
				keys.push( 'classic-admin', 'fallback' );
				break;
			default:
				break;
		}
		return keys;
	}

	/** True when `src` belongs on `<img>` (absolute URL, proto-relative, site-relative SVG, data URI). */
	function isIconImgSrc( u ) {
		if ( typeof u !== 'string' || '' === u ) {
			return false;
		}
		if ( /^https?:\/\//i.test( u ) ) {
			return true;
		}
		if ( u.slice( 0, 2 ) === '//' ) {
			return true;
		}
		if ( u.slice( 0, 5 ) === 'data:' ) {
			return true;
		}
		if ( u.slice( 0, 1 ) === '/' ) {
			return true;
		}
		return false;
	}

	function imageMarkup( src, klass ) {
		var img = document.createElement( 'img' );
		if ( klass ) {
			img.className = klass;
		}
		img.loading = 'lazy';
		img.decoding = 'async';
		img.src = src;
		img.alt = '';
		return img;
	}

	function thumbForItem( icon, item ) {
		icon = typeof icon === 'string' ? icon : '';
		var themed = firstIconUrlForKeys( iconKeysForItem( icon, item ) );
		if ( themed ) {
			return imageMarkup( themed );
		}
		if ( icon.slice( 0, 12 ) === 'dashicons-' ) {
			return dashIconMarkup( icon );
		}
		if ( isIconImgSrc( icon ) ) {
			return imageMarkup( icon );
		}
		var fallback = dashIconMarkup( 'dashicons-admin-plugins' );
		return fallback;
	}

	function syncSystemTileItem( item ) {
		if ( ! item || typeof item !== 'object' ) {
			return false;
		}
		var match = firstIconMatchForKeys( iconKeysForItem( item.icon, item ) );
		if ( ! match ) {
			return false;
		}
		try {
			item.icon = match.url;
			item.oddIconSet = currentIconSetSlug();
			item.oddIconKey = match.key;
		} catch ( _ ) {}
		return true;
	}

	function syncSystemTileRegistry() {
		var d = window.wp && window.wp.desktop;
		if ( ! d || typeof d.listSystemTiles !== 'function' ) {
			return;
		}
		var list = [];
		try {
			list = d.listSystemTiles() || [];
		} catch ( _ ) {
			list = [];
		}
		list.forEach( function ( item ) {
			if ( ! item || ! item.id ) {
				return;
			}
			var target = item;
			try {
				if ( typeof d.getSystemTile === 'function' ) {
					target = d.getSystemTile( item.id ) || item;
				}
			} catch ( _ ) {}
			if ( target ) {
				syncSystemTileItem( target );
			}
			if ( target !== item ) {
				syncSystemTileItem( item );
			}
		} );
	}

	var systemTileObserver = null;
	var SYSTEM_TILE_SELECTOR = [
		'.desktop-mode-dock__item--system',
		'.wp-desktop-dock__item--system',
		'[data-system-id]',
		'[data-desktop-mode-system-id]',
		'[data-wp-desktop-system-id]',
	].join( ',' );

	function systemTileIdForElement( tile ) {
		if ( ! tile || ! tile.getAttribute ) {
			return '';
		}
		return tile.getAttribute( 'data-system-id' ) ||
			tile.getAttribute( 'data-desktop-mode-system-id' ) ||
			tile.getAttribute( 'data-wp-desktop-system-id' ) ||
			tile.id ||
			'';
	}

	function primaryButtonForTile( tile ) {
		if ( ! tile || ! tile.querySelector ) {
			return null;
		}
		if (
			tile.matches &&
			(
				tile.matches( '.desktop-mode-dock__item-primary' ) ||
				tile.matches( '.wp-desktop-dock__item-primary' )
			)
		) {
			return tile;
		}
		return tile.querySelector( '.desktop-mode-dock__item-primary, .wp-desktop-dock__item-primary, button, [role="button"]' );
	}

	function dashiconClassForTile( button ) {
		var span = button && button.querySelector ? button.querySelector( '.dashicons' ) : null;
		if ( ! span || ! span.classList ) {
			return '';
		}
		for ( var i = 0; i < span.classList.length; i++ ) {
			if ( span.classList[ i ] && span.classList[ i ].indexOf( 'dashicons-' ) === 0 ) {
				return span.classList[ i ];
			}
		}
		return '';
	}

	function systemItemForTile( id ) {
		var d = window.wp && window.wp.desktop;
		if ( ! d || ! id || typeof d.getSystemTile !== 'function' ) {
			return null;
		}
		try {
			return d.getSystemTile( id );
		} catch ( _ ) {}
		return null;
	}

	function skinHostSystemTile( tile ) {
		if ( ! tile || ! tile.matches || ! tile.matches( SYSTEM_TILE_SELECTOR ) ) {
			return false;
		}

		var button = primaryButtonForTile( tile );
		if ( ! button ) {
			return false;
		}

		var id = systemTileIdForElement( tile );
		var item = systemItemForTile( id ) || {};
		var label = button.getAttribute( 'aria-label' ) ||
			tile.getAttribute( 'aria-label' ) ||
			button.getAttribute( 'title' ) ||
			tile.getAttribute( 'title' ) ||
			item.title ||
			item.label ||
			'';
		var icon = dashiconClassForTile( button ) || ( typeof item.icon === 'string' ? item.icon : '' );
		var match = firstIconMatchForKeys( iconKeysForItem( icon, {
			id:    id || item.id || '',
			title: label,
			label: label,
		} ) );

		if ( ! match ) {
			return false;
		}

		if ( button.classList ) {
			button.classList.add( 'odd-system-icon-skinned' );
		}

		var existingImg = button.querySelector( 'img[data-odd-skinned-system-icon], img.desktop-mode-dock__item-img, img.wp-desktop-dock__item-img' );
		var imgClass = button.classList && button.classList.contains( 'wp-desktop-dock__item-primary' )
			? 'wp-desktop-dock__item-img'
			: 'desktop-mode-dock__item-img';
		var img = existingImg || imageMarkup( match.url, imgClass );
		img.className = imgClass;
		img.src = match.url;
		img.alt = '';
		img.loading = 'lazy';
		img.decoding = 'async';
		img.setAttribute( 'data-odd-skinned-system-icon', match.key );
		img.setAttribute( 'data-odd-icon-set', currentIconSetSlug() );

		if ( ! existingImg ) {
			var target = button.querySelector( '.dashicons' );
			if ( target && typeof target.replaceWith === 'function' ) {
				target.replaceWith( img );
			} else if ( target && target.parentNode ) {
				target.parentNode.insertBefore( img, target );
				target.parentNode.removeChild( target );
			} else {
				button.insertBefore( img, button.firstChild );
			}
		}

		return true;
	}

	function skinHostSystemTiles( root ) {
		var scope = root && ( root.nodeType === 1 || root.nodeType === 9 || root.nodeType === 11 ) ? root : document;
		var tiles = [];
		if ( scope.matches && scope.matches( SYSTEM_TILE_SELECTOR ) ) {
			tiles.push( scope );
		}
		if ( scope.querySelectorAll ) {
			tiles = tiles.concat( Array.prototype.slice.call( scope.querySelectorAll( SYSTEM_TILE_SELECTOR ) ) );
		}
		tiles.forEach( skinHostSystemTile );
	}

	function syncAndSkinSystemTiles() {
		syncSystemTileRegistry();
		skinHostSystemTiles( document );
	}

	function observeSystemTiles() {
		if ( systemTileObserver || typeof MutationObserver === 'undefined' ) {
			return;
		}
		var root = document.body || document.documentElement;
		if ( ! root ) {
			return;
		}
		systemTileObserver = new MutationObserver( function ( mutations ) {
			mutations.forEach( function ( mutation ) {
				Array.prototype.forEach.call( mutation.addedNodes || [], function ( node ) {
					skinHostSystemTiles( node );
				} );
			} );
		} );
		systemTileObserver.observe( root, { childList: true, subtree: true } );
	}

	var systemTileHooksBound = false;
	function bindSystemTileHooks() {
		if ( systemTileHooksBound ) {
			return;
		}
		systemTileHooksBound = true;
		var hooks = window.wp && window.wp.hooks;
		if ( ! hooks || typeof hooks.addAction !== 'function' ) {
			return;
		}
		var d = window.wp && window.wp.desktop;
		var names = [
			d && d.HOOKS && d.HOOKS.DOCK_ITEM_APPENDED,
			'wp-desktop.dock.item-appended',
			'desktop-mode.dock.item-appended',
		];
		names.forEach( function ( name ) {
			if ( ! name ) {
				return;
			}
			try {
				hooks.addAction( name, OWNER + '/sync-system-icons', syncAndSkinSystemTiles );
			} catch ( _ ) {}
		} );
	}

	function dockKeyUrl( item ) {
		var u = '';
		try {
			if ( item.url ) {
				u = item.url + '';
			}
		} catch ( _ ) {}
		try {
			if ( ! u && typeof item.slug === 'string' ) {
				u = item.slug + '';
			}
		} catch ( __ ) {}
		return u ? u : '_' + JSON.stringify( { t: item.title || '' } ).slice( 0, 80 );
	}

	function openMenuTile( deps, item ) {
		try {
			if ( item.multi && deps.requestSubmenu && typeof deps.requestSubmenu === 'function' ) {
				deps.requestSubmenu( item );
				return;
			}
			if ( deps.openItem && typeof deps.openItem === 'function' ) {
				deps.openItem( item );
			}
		} catch ( _ ) {}
	}

	function rebuildMenuTiles( deps, menuRow ) {
		var frag = document.createDocumentFragment();
		( deps.items || [] ).forEach(
			function ( item ) {
				var btn = document.createElement( 'button' );
				btn.type = 'button';
				btn.className = 'odd-dock-rail-mount__tile';
				btn.setAttribute( 'data-odd-kind', 'menu' );
				btn.setAttribute( 'data-odd-ref', dockKeyUrl( item ) );
				btn.setAttribute( 'aria-label', item.title || '' );
				btn.appendChild( thumbForItem( item.icon, item ) );
				btn.addEventListener( 'click', function () {
					openMenuTile( deps, item );
				} );
				frag.appendChild( btn );
			}
		);
		menuRow.textContent = '';
		menuRow.appendChild( frag );
	}

	function registerRenderer() {
		var d = window.wp && window.wp.desktop;
		if ( ! d || typeof d.registerDockRailRenderer !== 'function' ) {
			return;
		}

		function mountMount( deps ) {
			var wrapper = deps.container;
			wrapper.innerHTML = '';
			wrapper.classList.add( 'odd-dock-rail-mount' );

			var menuRow = document.createElement( 'div' );
			menuRow.className = 'odd-dock-rail-mount__menu';

			var div = document.createElement( 'div' );
			div.className = 'odd-dock-rail-mount__divider';
			div.setAttribute( 'aria-hidden', 'true' );

			var sysRow = document.createElement( 'div' );
			sysRow.className = 'odd-dock-rail-mount__system';

			wrapper.appendChild( menuRow );
			wrapper.appendChild( div );
			wrapper.appendChild( sysRow );

			function applyOrientation( next ) {
				deps.orientation = next != null ? next : deps.orientation;
				var o = deps.orientation;
				if ( o === 'left' || o === 'right' ) {
					wrapper.setAttribute( 'data-odd-orient', 'side' );
				} else {
					wrapper.setAttribute( 'data-odd-orient', 'horizontal' );
				}
			}
			applyOrientation( deps.orientation );
			rebuildMenuTiles( deps, menuRow );

			var sysById = {};

			function makeSystemBtn( item ) {
				var idRaw = '';
				try {
					if ( item.id != null ) {
						idRaw = String( item.id );
					}
				} catch ( __ ) {}

				var btn = document.createElement( 'button' );
				btn.type = 'button';
				btn.className = 'odd-dock-rail-mount__tile odd-dock-rail-mount__tile--system';
				btn.setAttribute( 'data-odd-kind', 'system' );
				if ( idRaw ) {
					btn.setAttribute( 'data-odd-system-id', idRaw );
					sysById[ idRaw ] = btn;
				}
				btn.setAttribute(
					'aria-label',
					item.title ||
						item.label ||
						( item.window ? String( item.window ) : 'App' )
				);

				btn.appendChild( thumbForItem( item.icon, item ) );
				btn.addEventListener(
					'click',
					function () {
						try {
							if ( typeof item.onOpen === 'function' ) {
								item.onOpen();
							} else if ( deps.openSystemItem && typeof deps.openSystemItem === 'function' ) {
								deps.openSystemItem( item );
							}
						} catch ( _ ) {}
					}
				);
				return btn;
			}

			return {
				replaceItems: function ( items ) {
					deps.items = Array.isArray( items ) ? items : [];
					rebuildMenuTiles( deps, menuRow );
				},
				appendSystemItem: function ( wrapped ) {
					sysRow.appendChild( makeSystemBtn( wrapped ) );
				},
				removeSystemItem: function ( id ) {
					var key = String( id );
					var el = sysById[ key ];
					if ( el && el.parentNode ) {
						el.parentNode.removeChild( el );
					}
					delete sysById[ key ];
				},
				setBadge: function () {
				},
				setAttention: function () {
				},
				setOrientation: function ( next ) {
					applyOrientation( next );
				},
				destroy: function () {
					wrapper.innerHTML = '';
				},
			};
		}

		try {
			d.registerDockRailRenderer( {
				id:          'odd-compact',
				label:       __( 'ODD compact rail' ),
				description: __( 'High-contrast icon mosaic selectable alongside the shipped strip in OS Settings.', 'odd-outlandish-desktop-decorator' ),
				icon:        'dashicons-art',
				apiVersion:  1,
				owner:       OWNER,
				mount:       function ( deps ) {
					return mountMount( deps );
				},
			} );
		} catch ( _ ) {}
	}

	function boot() {
		registerRenderer();
		bindSystemTileHooks();
		syncAndSkinSystemTiles();
		observeSystemTiles();
	}

	if ( window.wp && window.wp.desktop && typeof window.wp.desktop.ready === 'function' ) {
		window.wp.desktop.ready( boot );
	} else {
		boot();
	}
} )();
