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
			return window.wp.i18n.__( text, 'odd' );
		}
		return text;
	}

	function dashIconMarkup( klass ) {
		var sp = document.createElement( 'span' );
		sp.className = 'dashicons ' + klass;
		sp.setAttribute( 'aria-hidden', 'true' );
		return sp;
	}

	function thumbForItem( icon ) {
		icon = typeof icon === 'string' ? icon : '';
		if ( icon.slice( 0, 12 ) === 'dashicons-' ) {
			return dashIconMarkup( icon );
		}
		if ( icon.slice( 0, 5 ) === 'http' || icon.slice( 0, 5 ) === 'data:' ) {
			var img = document.createElement( 'img' );
			img.loading = 'lazy';
			img.decoding = 'async';
			img.src = icon;
			img.alt = '';
			return img;
		}
		var fallback = dashIconMarkup( 'dashicons-admin-plugins' );
		return fallback;
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
				btn.appendChild( thumbForItem( item.icon ) );
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

				btn.appendChild( thumbForItem( item.icon ) );
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
				description: __( 'High-contrast icon mosaic with violet hover motion — swaps with the shipped strip in OS Settings → Dock.', 'odd' ),
				icon:        'dashicons-art',
				apiVersion:  1,
				owner:       OWNER,
				mount:       function ( deps ) {
					return mountMount( deps );
				},
			} );
		} catch ( _ ) {}
	}

	if ( window.wp && window.wp.desktop && typeof window.wp.desktop.ready === 'function' ) {
		window.wp.desktop.ready( registerRenderer );
	} else {
		registerRenderer();
	}
} )();
