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

	function thumbForItem( icon ) {
		icon = typeof icon === 'string' ? icon : '';
		if ( icon.slice( 0, 10 ) === 'dashicons-' ) {
			return dashIconMarkup( icon );
		}
		if ( isIconImgSrc( icon ) ) {
			return imageMarkup( icon );
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

	function oddDockMenuBridge() {
		return window.__odd && window.__odd.desktopHooks || null;
	}

	function itemId( item ) {
		if ( ! item || typeof item !== 'object' ) {
			return '';
		}
		return String( item.id || item.windowId || item.baseId || item.slug || '' );
	}

	function isOddDockItem( item ) {
		var id = itemId( item );
		if ( id === 'odd' || id.indexOf( 'odd-app-' ) === 0 || id.indexOf( 'odd/' ) === 0 ) {
			return true;
		}
		return !! ( item && typeof item.title === 'string' && item.title.indexOf( 'ODD' ) === 0 );
	}

	function keyboardMenuPoint( tile ) {
		if ( ! tile || typeof tile.getBoundingClientRect !== 'function' ) {
			return { x: 16, y: 16 };
		}
		var rect = tile.getBoundingClientRect();
		return {
			x: rect.left + Math.max( 12, Math.min( rect.width - 8, 28 ) ),
			y: rect.top + Math.max( 12, Math.min( rect.height - 8, 28 ) ),
		};
	}

	function openOddDockMenu( eventOrPoint, item ) {
		if ( ! isOddDockItem( item ) ) {
			return false;
		}
		var bridge = oddDockMenuBridge();
		if ( ! bridge || typeof bridge.openDockTileMenu !== 'function' ) {
			return false;
		}
		var point = eventOrPoint || {};
		bridge.openDockTileMenu( {
			x:      point.clientX != null ? point.clientX : point.x,
			y:      point.clientY != null ? point.clientY : point.y,
			item:   item,
			source: 'desktop-mode.dock-rail.context-menu',
		} );
		return true;
	}

	function attachOddDockMenu( tile, item ) {
		if ( ! tile || ! isOddDockItem( item ) || typeof tile.addEventListener !== 'function' ) {
			return;
		}
		tile.setAttribute( 'aria-haspopup', 'menu' );
		tile.addEventListener( 'contextmenu', function ( ev ) {
			if ( ev.defaultPrevented ) return;
			if ( openOddDockMenu( ev, item ) ) {
				ev.preventDefault();
				ev.stopPropagation();
			}
		} );
		tile.addEventListener( 'keydown', function ( ev ) {
			if ( ev.key !== 'ContextMenu' && ! ( ev.shiftKey && ev.key === 'F10' ) ) {
				return;
			}
			var point = keyboardMenuPoint( tile );
			if ( openOddDockMenu( point, item ) ) {
				ev.preventDefault();
			}
		} );
	}

	function uniquePush( list, value ) {
		value = value == null ? '' : String( value );
		if ( value && list.indexOf( value ) === -1 ) {
			list.push( value );
		}
	}

	function tileIdsForItem( item ) {
		var ids = [];
		if ( ! item || typeof item !== 'object' ) {
			return ids;
		}
		uniquePush( ids, itemId( item ) );
		uniquePush( ids, item.id );
		uniquePush( ids, item.windowId );
		uniquePush( ids, item.baseId );
		uniquePush( ids, item.slug );
		uniquePush( ids, dockKeyUrl( item ) );
		return ids;
	}

	function safeBadgeCount( count ) {
		return Math.max( 0, Math.floor( Number( count ) || 0 ) );
	}

	function badgeLabel( count ) {
		return count === 1 ? '1 notification' : count + ' notifications';
	}

	function applyBadgeNode( tile, count ) {
		if ( ! tile || typeof tile.querySelector !== 'function' ) {
			return;
		}
		var existing = tile.querySelector( ':scope > .desktop-mode-dock__badge' );
		if ( count <= 0 ) {
			if ( existing && existing.parentNode ) {
				existing.parentNode.removeChild( existing );
			}
			return;
		}
		var display = count > 99 ? '99+' : String( count );
		if ( existing ) {
			existing.textContent = display;
			existing.setAttribute( 'aria-label', badgeLabel( count ) );
			return;
		}
		var badge = document.createElement( 'span' );
		badge.className = 'desktop-mode-dock__badge';
		badge.textContent = display;
		badge.setAttribute( 'aria-label', badgeLabel( count ) );
		tile.appendChild( badge );
	}

	var ATTENTION_MODES = [ 'pulse', 'shake', 'bounce' ];
	var ATTENTION_CLASSES = [
		'odd-dock-rail-mount__tile--attention-pulse',
		'odd-dock-rail-mount__tile--attention-shake',
		'odd-dock-rail-mount__tile--attention-bounce',
		'odd-dock-rail-mount__tile--intensity-subtle',
		'odd-dock-rail-mount__tile--intensity-normal',
		'odd-dock-rail-mount__tile--intensity-strong',
	];

	function cleanAttention( mode, opts ) {
		if ( mode == null ) {
			return null;
		}
		mode = String( mode || 'pulse' );
		if ( ATTENTION_MODES.indexOf( mode ) === -1 ) {
			mode = 'pulse';
		}
		opts = opts || {};
		var intensity = String( opts.intensity || 'normal' );
		if ( [ 'subtle', 'normal', 'strong' ].indexOf( intensity ) === -1 ) {
			intensity = 'normal';
		}
		return {
			mode: mode,
			intensity: intensity,
		};
	}

	function applyAttentionNode( tile, attention ) {
		if ( ! tile || ! tile.classList ) {
			return;
		}
		ATTENTION_CLASSES.forEach( function ( klass ) {
			tile.classList.remove( klass );
		} );
		if ( ! attention ) {
			return;
		}
		tile.classList.add( 'odd-dock-rail-mount__tile--attention-' + attention.mode );
		tile.classList.add( 'odd-dock-rail-mount__tile--intensity-' + attention.intensity );
	}

	function storeTile( state, bucket, item, tile ) {
		var ids = tileIdsForItem( item );
		tile.__oddDockIds = ids;
		ids.forEach( function ( id ) {
			state[ bucket ][ id ] = tile;
		} );
		return ids;
	}

	function tileForId( state, id ) {
		var key = String( id || '' );
		return key ? ( state.menuById[ key ] || state.sysById[ key ] || null ) : null;
	}

	function applyStoredTileState( state, item, tile ) {
		var ids = tileIdsForItem( item );
		for ( var i = 0; i < ids.length; i++ ) {
			if ( Object.prototype.hasOwnProperty.call( state.badges, ids[ i ] ) ) {
				applyBadgeNode( tile, state.badges[ ids[ i ] ] );
				break;
			}
		}
		for ( var j = 0; j < ids.length; j++ ) {
			if ( Object.prototype.hasOwnProperty.call( state.attention, ids[ j ] ) ) {
				applyAttentionNode( tile, state.attention[ ids[ j ] ] );
				break;
			}
		}
	}

	function publishRailController( controller ) {
		window.__odd = window.__odd || {};
		var rails = Array.isArray( window.__odd.dockRails ) ? window.__odd.dockRails : [];
		if ( rails.indexOf( controller ) === -1 ) {
			rails.push( controller );
		}
		window.__odd.dockRails = rails;
		window.__odd.dockRail = controller;
		return function () {
			var list = Array.isArray( window.__odd && window.__odd.dockRails ) ? window.__odd.dockRails : [];
			var index = list.indexOf( controller );
			if ( index !== -1 ) {
				list.splice( index, 1 );
			}
			if ( window.__odd && window.__odd.dockRail === controller ) {
				window.__odd.dockRail = list[ 0 ] || null;
			}
		};
	}

	function rebuildMenuTiles( deps, menuRow, state ) {
		var frag = document.createDocumentFragment();
		state.menuById = {};
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
				attachOddDockMenu( btn, item );
				storeTile( state, 'menuById', item, btn );
				applyStoredTileState( state, item, btn );
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

			var state = {
				menuById: {},
				sysById: {},
				badges: {},
				attention: {},
				attentionTimers: {},
			};
			rebuildMenuTiles( deps, menuRow, state );

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
				attachOddDockMenu( btn, item );
				storeTile( state, 'sysById', item, btn );
				applyStoredTileState( state, item, btn );
				return btn;
			}

			var unregisterLocalRail = function () {};
			var controller = {
				replaceItems: function ( items ) {
					deps.items = Array.isArray( items ) ? items : [];
					rebuildMenuTiles( deps, menuRow, state );
				},
				appendSystemItem: function ( wrapped ) {
					sysRow.appendChild( makeSystemBtn( wrapped ) );
				},
				removeSystemItem: function ( id ) {
					var key = String( id );
					var el = state.sysById[ key ];
					if ( el && el.parentNode ) {
						el.parentNode.removeChild( el );
					}
					if ( el && Array.isArray( el.__oddDockIds ) ) {
						el.__oddDockIds.forEach( function ( tileId ) {
							delete state.sysById[ tileId ];
						} );
					} else {
						delete state.sysById[ key ];
					}
				},
				setBadge: function ( id, count ) {
					var key = String( id || '' );
					if ( ! key ) {
						return;
					}
					var safe = safeBadgeCount( count );
					if ( safe > 0 ) {
						state.badges[ key ] = safe;
					} else {
						delete state.badges[ key ];
					}
					applyBadgeNode( tileForId( state, key ), safe );
				},
				setAttention: function ( id, mode, opts ) {
					var key = String( id || '' );
					if ( ! key ) {
						return;
					}
					if ( state.attentionTimers[ key ] ) {
						window.clearTimeout( state.attentionTimers[ key ] );
						delete state.attentionTimers[ key ];
					}
					var attention = cleanAttention( mode, opts );
					if ( attention ) {
						state.attention[ key ] = attention;
					} else {
						delete state.attention[ key ];
					}
					applyAttentionNode( tileForId( state, key ), attention );
					var duration = opts && typeof opts.durationMs === 'number' ? opts.durationMs : 4000;
					if ( attention && duration > 0 ) {
						state.attentionTimers[ key ] = window.setTimeout( function () {
							delete state.attentionTimers[ key ];
							delete state.attention[ key ];
							applyAttentionNode( tileForId( state, key ), null );
						}, duration );
					}
				},
				setOrientation: function ( next ) {
					applyOrientation( next );
				},
				destroy: function () {
					unregisterLocalRail();
					Object.keys( state.attentionTimers ).forEach( function ( key ) {
						window.clearTimeout( state.attentionTimers[ key ] );
					} );
					state.attentionTimers = {};
					wrapper.innerHTML = '';
				},
			};
			unregisterLocalRail = publishRailController( controller );
			return controller;
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
	}

	if ( window.wp && window.wp.desktop && typeof window.wp.desktop.ready === 'function' ) {
		window.wp.desktop.ready( boot );
	} else {
		boot();
	}
} )();
