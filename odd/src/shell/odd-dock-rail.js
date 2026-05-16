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
				hooks.addAction( name, OWNER + '/sync-system-icons', syncSystemTileRegistry );
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
		syncSystemTileRegistry();
	}

	if ( window.wp && window.wp.desktop && typeof window.wp.desktop.ready === 'function' ) {
		window.wp.desktop.ready( boot );
	} else {
		boot();
	}
} )();
