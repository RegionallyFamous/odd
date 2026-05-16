/**
 * ODD custom cursor runtime.
 * ---------------------------------------------------------------
 * Owns active cursor state for the shell, wp-admin, Desktop Mode
 * windows, open shadow roots, and same-origin iframe documents.
 * The stylesheet is kept as a broad fallback; pointer-time role
 * resolution applies the active cursor directly to the hovered target.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' || typeof document === 'undefined' ) return;

	window.__odd = window.__odd || {};

	var LINK_ID = 'odd-cursors-css';
	var LAYER_ID = 'odd-live-cursor';
	var LAYER_STYLE_ID = 'odd-live-cursor-style';
	var lastWarningHref = '';
	var semanticKinds = {
		default:       true,
		pointer:       true,
		text:          true,
		grab:          true,
		grabbing:      true,
		crosshair:     true,
		'not-allowed': true,
		wait:          true,
		help:          true,
		progress:      true,
	};
	var state = {
		slug:             '',
		href:             '',
		status:           'idle',
		error:            '',
		iframeInjections: [],
		surfaces:         [],
		shadowRoots:      [],
		failures:         [],
		lastResolved:     null,
		layer:            {
			el:          null,
			style:       null,
			doc:         null,
			visible:     false,
			role:        'default',
			mode:        'aura',
			pointerType: '',
			pressed:     false,
			x:           0,
			y:           0,
			time:        0,
			speed:       0,
			pressure:    0,
			tiltX:       0,
			tiltY:       0,
			twist:       0,
			contact:     0,
			coalesced:   0,
			predicted:   0,
			trail:       [],
			bound:       false,
		},
	};
	var bridged = [];
	var documents = [];
	var docSeq = 0;

	function cfg() {
		return ( window.odd && typeof window.odd === 'object' ) ? window.odd : {};
	}

	function shellConfig() {
		return ( window.desktopModeConfig && typeof window.desktopModeConfig === 'object' ) ? window.desktopModeConfig : {};
	}

	function configuredHref() {
		var c = cfg();
		var shell = shellConfig();
		if ( typeof c.cursorStylesheet === 'string' && c.cursorStylesheet ) return c.cursorStylesheet;
		if ( typeof shell.oddCursorStylesheet === 'string' && shell.oddCursorStylesheet ) return shell.oddCursorStylesheet;
		if ( typeof shell.cursorStylesheet === 'string' && shell.cursorStylesheet ) return shell.cursorStylesheet;
		return '';
	}

	function configuredSlug() {
		var c = cfg();
		var shell = shellConfig();
		if ( typeof c.cursorSet === 'string' ) return c.cursorSet;
		if ( typeof shell.oddCursorSet === 'string' ) return shell.oddCursorSet;
		return '';
	}

	function configuredTokens() {
		var shell = shellConfig();
		if ( shell.oddCursor && shell.oddCursor.tokens && typeof shell.oddCursor.tokens === 'object' ) {
			return shell.oddCursor.tokens;
		}
		return {};
	}

	function activeSet() {
		var slug = state.slug || configuredSlug();
		var sets = cfg().cursorSets;
		if ( ! slug || ! Array.isArray( sets ) ) return null;
		for ( var i = 0; i < sets.length; i++ ) {
			if ( sets[ i ] && sets[ i ].slug === slug ) return sets[ i ];
		}
		return null;
	}

	function cssVarCursorValue( kind, node ) {
		var doc = nodeDoc( node );
		var view = doc && doc.defaultView ? doc.defaultView : window;
		var root = doc && doc.documentElement ? doc.documentElement : document.documentElement;
		if ( ! view || ! view.getComputedStyle || ! root ) return '';
		try {
			var value = view.getComputedStyle( root ).getPropertyValue( '--odd-cursor-' + kind );
			value = typeof value === 'string' ? value.trim() : '';
			if ( value ) return value;
			if ( kind !== 'default' ) {
				value = view.getComputedStyle( root ).getPropertyValue( '--odd-cursor-default' );
				return typeof value === 'string' ? value.trim() : '';
			}
		} catch ( e ) {}
		return '';
	}

	function cleanHotspot( hotspot ) {
		var x = Array.isArray( hotspot ) ? parseInt( hotspot[ 0 ], 10 ) : 0;
		var y = Array.isArray( hotspot ) ? parseInt( hotspot[ 1 ], 10 ) : 0;
		if ( isNaN( x ) ) x = 0;
		if ( isNaN( y ) ) y = 0;
		return [ x, y ];
	}

	function parseCursorValue( value ) {
		value = typeof value === 'string' ? value : '';
		var match = value.match( /url\(\s*(?:"([^"]+)"|'([^']+)'|([^)\s]+))\s*\)\s*(-?\d+)?\s*(-?\d+)?/i );
		if ( ! match ) {
			return { value: value, url: '', hotspot: [ 0, 0 ] };
		}
		return {
			value:   value,
			url:     match[ 1 ] || match[ 2 ] || match[ 3 ] || '',
			hotspot: cleanHotspot( [ match[ 4 ], match[ 5 ] ] ),
		};
	}

	function cursorMeta( kind, node ) {
		kind = semanticKinds[ kind ] ? kind : 'default';
		var set = activeSet();
		var cursors = set && set.cursors;
		var spec = cursors && ( cursors[ kind ] || cursors.default );
		if ( ! spec || ! spec.url ) {
			var tokens = configuredTokens();
			var fallback = '';
			if ( typeof tokens[ kind ] === 'string' && tokens[ kind ] ) {
				fallback = tokens[ kind ];
			} else {
				fallback = cssVarCursorValue( kind, node );
			}
			var parsed = parseCursorValue( fallback );
			parsed.kind = kind;
			return parsed;
		}
		var hotspot = cleanHotspot( spec.hotspot );
		return {
			kind:    kind,
			value:   'url("' + spec.url + '") ' + hotspot[ 0 ] + ' ' + hotspot[ 1 ] + ', ' + kind,
			url:     spec.url,
			hotspot: hotspot,
		};
	}

	function cursorValue( kind, node ) {
		return cursorMeta( kind, node ).value;
	}

	function nodeDoc( node ) {
		return node && node.ownerDocument ? node.ownerDocument : document;
	}

	function nodeView( node ) {
		var doc = nodeDoc( node );
		return doc && doc.defaultView ? doc.defaultView : window;
	}

	function headFor( doc ) {
		if ( ! doc ) return null;
		return doc.head || doc.getElementsByTagName( 'head' )[ 0 ] || doc.documentElement || null;
	}

	function linkFor( doc, create ) {
		doc = doc || document;
		var link = doc.getElementById ? doc.getElementById( LINK_ID ) : null;
		if ( ! link && create ) {
			var head = headFor( doc );
			if ( ! head || ! doc.createElement ) return null;
			link = doc.createElement( 'link' );
			link.id = LINK_ID;
			link.rel = 'stylesheet';
			link.setAttribute( 'data-odd-cursors', '1' );
			head.appendChild( link );
		}
		return link;
	}

	function removeLink( doc ) {
		var link = linkFor( doc || document, false );
		if ( link && link.parentNode ) link.parentNode.removeChild( link );
	}

	function bindLinkEvents( link, href ) {
		if ( ! link || link.__oddCursorHref === href ) return;
		link.__oddCursorHref = href;
		link.onload = function () {
			state.status = 'loaded';
			state.error = '';
		};
		link.onerror = function () {
			state.status = 'error';
			state.error = 'Stylesheet failed to load';
			if ( href && lastWarningHref !== href ) {
				lastWarningHref = href;
				try { window.console.warn( '[ODD] Cursor stylesheet failed to load:', href ); } catch ( e ) {}
			}
		};
	}

	function shouldClear( href, slug ) {
		return ! href || slug === '' || slug === 'none';
	}

	function setConfig( href, slug ) {
		if ( window.odd && typeof window.odd === 'object' ) {
			window.odd.cursorStylesheet = href || '';
			if ( typeof slug === 'string' ) window.odd.cursorSet = slug === 'none' ? '' : slug;
		}
	}

	function docRecord( doc, create ) {
		doc = doc || document;
		for ( var i = 0; i < documents.length; i++ ) {
			if ( documents[ i ].doc === doc ) return documents[ i ];
		}
		if ( ! create ) return null;
		var rec = {
			id: ++docSeq,
			doc: doc,
			surfaces: [],
			observers: [],
			listeners: false,
			dispose: [],
		};
		documents.push( rec );
		return rec;
	}

	function rememberBridge( node, value, kind ) {
		if ( ! node || ! node.style ) return;
		if ( ! node.__oddCursorBridged ) {
			node.__oddCursorBridged = true;
			node.__oddCursorOriginal = node.style.cursor || '';
			node.__oddCursorOriginalPriority = node.style.getPropertyPriority ? node.style.getPropertyPriority( 'cursor' ) || '' : '';
			bridged.push( node );
		}
		if ( node.__oddCursorValue !== value ) {
			if ( node.style.setProperty ) {
				node.style.setProperty( 'cursor', value, 'important' );
			} else {
				node.style.cursor = value;
			}
			node.__oddCursorValue = value;
			node.__oddCursorKind = kind || '';
		}
	}

	function restoreNode( node ) {
		if ( ! node || ! node.style || ! node.__oddCursorBridged ) return;
		if ( node.__oddCursorOriginal ) {
			if ( node.style.setProperty ) {
				node.style.setProperty( 'cursor', node.__oddCursorOriginal, node.__oddCursorOriginalPriority || '' );
			} else {
				node.style.cursor = node.__oddCursorOriginal || '';
			}
		} else if ( node.style.removeProperty ) {
			node.style.removeProperty( 'cursor' );
		} else {
			node.style.cursor = '';
		}
		try {
			delete node.__oddCursorBridged;
			delete node.__oddCursorOriginal;
			delete node.__oddCursorOriginalPriority;
			delete node.__oddCursorValue;
			delete node.__oddCursorKind;
		} catch ( e ) {
			node.__oddCursorBridged = false;
			node.__oddCursorOriginal = '';
			node.__oddCursorOriginalPriority = '';
			node.__oddCursorValue = '';
			node.__oddCursorKind = '';
		}
	}

	function clearBridged( doc ) {
		var next = [];
		for ( var i = 0; i < bridged.length; i++ ) {
			var node = bridged[ i ];
			if ( ! doc || nodeDoc( node ) === doc ) {
				restoreNode( node );
			} else {
				next.push( node );
			}
		}
		bridged = next;
	}

	function failure( reason, meta ) {
		state.failures.push( {
			time: Date.now ? Date.now() : 0,
			reason: reason || 'unknown',
			meta: meta || {},
		} );
		if ( state.failures.length > 20 ) state.failures.shift();
	}

	function nodeSummary( node ) {
		if ( ! node || node.nodeType !== 1 ) return {};
		return {
			tag:   String( node.tagName || '' ).toLowerCase(),
			id:    node.id || '',
			className: typeof node.className === 'string' ? node.className : '',
			ariaLabel: node.getAttribute ? node.getAttribute( 'aria-label' ) || '' : '',
		};
	}

	function cleanupRemovedNodes( doc ) {
		var next = [];
		for ( var i = 0; i < bridged.length; i++ ) {
			var node = bridged[ i ];
			if ( doc && nodeDoc( node ) !== doc ) {
				next.push( node );
				continue;
			}
			if ( ! node || ! node.isConnected ) {
				restoreNode( node );
			} else {
				next.push( node );
			}
		}
		bridged = next;
	}

	function matches( node, selector ) {
		if ( ! node || node.nodeType !== 1 || ! node.matches ) return false;
		try { return node.matches( selector ); } catch ( e ) { return false; }
	}

	function attr( node, name ) {
		if ( ! node || ! node.getAttribute ) return '';
		try { return node.getAttribute( name ) || ''; } catch ( e ) { return ''; }
	}

	function hasAttr( node, name ) {
		if ( ! node || ! node.hasAttribute ) return false;
		try { return node.hasAttribute( name ); } catch ( e ) { return false; }
	}

	function textLike( node ) {
		return matches( node, 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="password"], textarea, [contenteditable="true"], [contenteditable=""], .CodeMirror, .components-text-control__input, .components-textarea-control__input, .block-editor-rich-text__editable, .editor-post-title__input' );
	}

	function disabledLike( node ) {
		return matches( node, '[disabled], [aria-disabled="true"], :disabled, .disabled, .is-disabled, .components-disabled, .odd-is-disabled' );
	}

	function busyLike( node ) {
		return matches( node, '[aria-busy="true"], .is-busy, .updating-message, .spinner.is-active, .components-spinner' );
	}

	function buttonLike( node ) {
		var label = attr( node, 'aria-label' ).toLowerCase();
		if ( matches( node, 'a[href], button, .button, .button-primary, .button-secondary, [role="button"], [role="menuitem"], [role="option"], summary, label[for], input[type="button"], input[type="submit"], input[type="reset"], select, option, .ab-item, .components-button, wpd-button, wpd-tab, wpd-context-menu-item, wpd-menu-item, [data-window-control], [data-window-action], [data-context-menu-item], .desktop-mode-icon, .desktop-mode-file, .desktop-mode-file-tile, .desktop-mode-file__tile, .desktop-mode-files__item, .desktop-mode-files__tile, .desktop-mode-folder, .desktop-mode-folder-tile, .desktop-mode-context-menu__item, .desktop-mode-dock__item, .desktop-mode-dock__button, .desktop-mode-window__btn, .desktop-mode-window__tab, .desktop-mode-window__control, .desktop-mode-plugins__row, .desktop-mode-plugins__action, .desktop-mode-heartbeat__button, .desktop-mode-widgets__card-redock, .desktop-mode-widgets__card-close, .desktop-mode-widgets__add, .wp-desktop-icon, .wp-desktop-file, .wp-desktop-file-tile, .wp-desktop-folder, .wp-desktop-folder-tile, .wp-desktop-dock__item, .wp-desktop-dock__item-primary, .wp-desktop-dock__item-new, .wp-desktop-window__btn, .wp-desktop-window__tab, .wp-desktop-window__meta-btn, .wp-desktop-window__menu-btn, .wp-desktop-window__menu-item, .wp-desktop-widgets__card-redock, .wp-desktop-widgets__card-close, .wp-desktop-widgets__add' ) ) {
			return true;
		}
		return label === 'close' || label === 'minimize' || label === 'maximize' || label === 'restore';
	}

	function resizeLike( node ) {
		return matches( node, '[data-resize-handle], [data-window-resize-handle], .ui-resizable-handle, .resize-handle, .desktop-mode-window__resize-handle, .desktop-mode-window-resizer, .desktop-mode-widgets__resize, .desktop-mode-widget__resize-handle, .desktop-mode-heartbeat__resize, .wp-desktop-window__resize-handle, .wp-desktop-window-resizer, .wp-desktop-widgets__resize' );
	}

	function dragLike( node ) {
		return matches( node, '[draggable="true"], [data-drag], [data-drag-handle], [data-window-drag-handle], [data-window-titlebar], [data-window-header], [data-file-drag-handle], .desktop-mode-window-titlebar, .desktop-mode-window-header, .window-titlebar, .native-window-titlebar, .desktop-mode-window__titlebar, .desktop-mode-file, .desktop-mode-file-tile, .desktop-mode-file__tile, .desktop-mode-files__item, .desktop-mode-files__tile, .desktop-mode-folder, .desktop-mode-folder-tile, .desktop-mode-plugins__detail-hero, .desktop-mode-widgets__chrome, .desktop-mode-widgets__grip, .desktop-window__titlebar, .wp-desktop-window__titlebar, .wp-desktop-file, .wp-desktop-file-tile, .wp-desktop-folder, .wp-desktop-folder-tile, .wp-desktop-widgets__chrome, .wp-desktop-widgets__grip' );
	}

	function nativeKind( cursor ) {
		cursor = typeof cursor === 'string' ? cursor : '';
		if ( cursor.indexOf( 'url(' ) !== -1 ) return '';
		if ( cursor === 'pointer' ) return 'pointer';
		if ( cursor === 'text' || cursor === 'vertical-text' ) return 'text';
		if ( cursor === 'grab' || cursor === 'move' ) return 'grab';
		if ( cursor === 'grabbing' ) return 'grabbing';
		if ( cursor === 'crosshair' ) return 'crosshair';
		if ( cursor === 'not-allowed' || cursor === 'no-drop' ) return 'not-allowed';
		if ( cursor === 'wait' ) return 'wait';
		if ( cursor === 'progress' ) return 'progress';
		if ( cursor === 'help' ) return 'help';
		if ( /(^|-)resize$/.test( cursor ) || cursor === 'col-resize' || cursor === 'row-resize' ) return 'grab';
		return '';
	}

	function computedKind( node ) {
		var view = nodeView( node );
		var computed = '';
		try { computed = view && view.getComputedStyle ? view.getComputedStyle( node ).cursor : ''; } catch ( e ) {}
		return nativeKind( computed );
	}

	function roleForNode( node ) {
		if ( ! node || node.nodeType !== 1 ) return null;
		var explicit = attr( node, 'data-odd-cursor' );
		if ( explicit && semanticKinds[ explicit ] ) return { kind: explicit, source: 'explicit', node: node };
		if ( disabledLike( node ) ) return { kind: 'not-allowed', source: 'semantic', node: node };
		if ( busyLike( node ) ) return { kind: 'progress', source: 'semantic', node: node };
		if ( textLike( node ) ) return { kind: 'text', source: 'semantic', node: node };
		if ( buttonLike( node ) ) return { kind: 'pointer', source: 'semantic', node: node };
		if ( resizeLike( node ) ) return { kind: 'grab', source: 'semantic', node: node };
		if ( dragLike( node ) ) return { kind: 'grab', source: 'semantic', node: node };
		var computed = computedKind( node );
		if ( computed ) return { kind: computed, source: 'computed', node: node };
		return null;
	}

	function pathFromEvent( event ) {
		if ( event && typeof event.composedPath === 'function' ) {
			try {
				var p = event.composedPath();
				if ( p && p.length ) return p;
			} catch ( e ) {}
		}
		var out = [];
		var node = event && event.target;
		while ( node ) {
			out.push( node );
			node = node.parentNode || node.host || null;
		}
		return out;
	}

	function pathFromNode( node ) {
		var out = [];
		while ( node ) {
			out.push( node );
			node = node.parentNode || node.host || null;
		}
		return out;
	}

	function resolvePath( path ) {
		var target = null;
		for ( var t = 0; t < path.length; t++ ) {
			if ( path[ t ] && path[ t ].nodeType === 1 ) {
				target = path[ t ];
				break;
			}
		}
		for ( var i = 0; i < path.length; i++ ) {
			var node = path[ i ];
			if ( ! node || node.nodeType !== 1 ) continue;
			var role = roleForNode( node );
			if ( role ) {
				role.target = target || role.node;
				return role;
			}
		}
		for ( var j = 0; j < path.length; j++ ) {
			if ( path[ j ] && path[ j ].nodeType === 1 ) {
				return { kind: 'default', source: 'fallback', node: path[ j ], target: target || path[ j ] };
			}
		}
		return null;
	}

	function applyResolved( resolved, options ) {
		if ( ! state.href || ! resolved || ! resolved.node || ! resolved.node.style ) return null;
		options = options || {};
		var meta = cursorMeta( resolved.kind, resolved.node );
		if ( ! meta.value ) return null;
		var value = options.hideNative ? 'none' : meta.value;
		var target = resolved.target && resolved.target.nodeType === 1 ? resolved.target : resolved.node;
		rememberBridge( target, value, resolved.kind );
		if ( target !== resolved.node ) {
			rememberBridge( resolved.node, value, resolved.kind );
		}
		state.lastResolved = Object.assign( nodeSummary( target ), {
			role: resolved.kind,
			source: resolved.source,
			roleOwner: nodeSummary( resolved.node ),
			cursor: meta.value,
			nativeCursor: value,
			liveLayer: !! options.hideNative,
			time: Date.now ? Date.now() : 0,
		} );
		return resolved;
	}

	function resolveAndApplyEvent( event ) {
		var path = pathFromEvent( event );
		var resolved = resolvePath( path );
		captureDragPointer( event, resolved );
		var applied = applyResolved( resolved, { hideNative: shouldHideNativeForLayer( event, resolved, path ) } );
		updateLiveCursorLayer( event, applied || resolved, path );
		return applied;
	}

	function resolveAndApplyNode( node ) {
		return applyResolved( resolvePath( pathFromNode( node ) ) );
	}

	function rememberShadowRoot( root, meta ) {
		if ( ! root || ! root.addEventListener ) return false;
		for ( var i = 0; i < state.shadowRoots.length; i++ ) {
			if ( state.shadowRoots[ i ].root === root ) return true;
		}
		state.shadowRoots.push( { root: root, meta: meta || {}, time: Date.now ? Date.now() : 0 } );
		installListeners( root );
		return true;
	}

	function scanShadowRoots( root, meta ) {
		if ( ! root ) return 0;
		var count = 0;
		function visit( node ) {
			if ( ! node || node.nodeType !== 1 ) return;
			if ( node.shadowRoot ) {
				if ( rememberShadowRoot( node.shadowRoot, meta ) ) count++;
				scanShadowRoots( node.shadowRoot, meta );
			}
			if ( ! node.children ) return;
			for ( var i = 0; i < node.children.length; i++ ) visit( node.children[ i ] );
		}
		if ( root.querySelectorAll ) {
			var nodes = root.querySelectorAll( '*' );
			for ( var i = 0; i < nodes.length; i++ ) visit( nodes[ i ] );
		} else if ( root.host ) {
			visit( root.host );
		}
		return count;
	}

	function sweepSurface( root ) {
		if ( ! root || ! root.querySelectorAll ) return;
		markDesktopSurfaces( root );
		scanShadowRoots( root );
		cleanupRemovedNodes( root.ownerDocument || document );
	}

	function desktopSurfaceSelector() {
		return [
			'#wp-desktop-shell',
			'.wp-desktop-shell',
			'.wp-desktop-shell__body',
			'#wp-desktop-area',
			'.wp-desktop-area',
			'#wp-desktop-wallpaper',
			'.wp-desktop-wallpaper',
			'#wp-desktop-dock',
			'.wp-desktop-dock',
			'#wp-desktop-widgets',
			'.wp-desktop-widgets',
			'.wp-desktop-widgets__list',
			'.wp-desktop-window',
			'.wp-desktop-icons',
			'.desktop-mode',
			'.desktop-mode-shell',
			'#desktop-mode-shell',
			'.desktop-mode-shell__body',
			'#desktop-mode-area',
			'.desktop-mode-area',
			'.desktop-mode-icons',
			'#desktop-mode-wallpaper',
			'.desktop-mode-wallpaper',
			'#desktop-mode-side-dock',
			'.desktop-mode-dock',
			'.desktop-mode-widgets',
			'.desktop-mode-widgets__list',
			'.desktop-mode-window',
		].join( ',' );
	}

	function markDesktopSurfaces( root ) {
		if ( ! root || ! root.querySelectorAll ) return 0;
		var selector = desktopSurfaceSelector();
		var count = 0;
		var nodes = [];
		if ( matches( root, selector ) ) nodes.push( root );
		var found = root.querySelectorAll( selector );
		for ( var i = 0; i < found.length; i++ ) nodes.push( found[ i ] );
		for ( var j = 0; j < nodes.length; j++ ) {
			var node = markRoot( nodes[ j ] );
			installListeners( node );
			markInteractiveDescendants( node );
			count++;
		}
		return count;
	}

	function mediaMatches( doc, query ) {
		var view = doc && doc.defaultView ? doc.defaultView : window;
		try {
			return !! ( view && view.matchMedia && view.matchMedia( query ).matches );
		} catch ( e ) {
			return false;
		}
	}

	function reducedMotion( doc ) {
		return mediaMatches( doc, '(prefers-reduced-motion: reduce)' );
	}

	function finePointer( doc ) {
		var view = doc && doc.defaultView ? doc.defaultView : window;
		if ( ! view || ! view.matchMedia ) return true;
		return mediaMatches( doc, '(pointer: fine)' ) || mediaMatches( doc, '(any-pointer: fine)' );
	}

	function liveCursorEnabledByConfig() {
		var c = cfg();
		var shell = shellConfig();
		return ! (
			c.cursorEffects === false ||
			c.liveCursor === false ||
			c.cursorLayer === false ||
			c.cursorAura === false ||
			shell.oddCursorEffects === false ||
			shell.oddLiveCursor === false ||
			shell.oddCursorLayer === false
		);
	}

	function liveCursorMode() {
		var c = cfg();
		var shell = shellConfig();
		var mode = c.cursorLayerMode || c.cursorOverlayMode || shell.oddCursorLayerMode || shell.cursorLayerMode || '';
		return mode === 'replace' ? 'replace' : 'aura';
	}

	function liveCursorEverywhere() {
		var c = cfg();
		var shell = shellConfig();
		return c.cursorLayerEverywhere === true || c.liveCursorEverywhere === true || shell.oddCursorLayerEverywhere === true;
	}

	function pointerTypeForEvent( event ) {
		if ( event && typeof event.pointerType === 'string' && event.pointerType ) return event.pointerType;
		if ( event && /^mouse/.test( event.type || '' ) ) return 'mouse';
		return '';
	}

	function pathOptedOutOfLiveCursor( path ) {
		for ( var i = 0; i < path.length; i++ ) {
			var node = path[ i ];
			if ( ! node || node.nodeType !== 1 ) continue;
			var value = attr( node, 'data-odd-live-cursor' ) || attr( node, 'data-odd-cursor-layer' );
			if ( value === 'off' || value === 'false' || value === 'none' ) return true;
		}
		return false;
	}

	function liveCursorSurfaceFromPath( path, resolved ) {
		if ( pathOptedOutOfLiveCursor( path ) ) return null;
		if ( liveCursorEverywhere() ) return document.body || document.documentElement;
		for ( var i = 0; i < path.length; i++ ) {
			var node = path[ i ];
			if ( ! node || node.nodeType !== 1 ) continue;
			if ( hasAttr( node, 'data-odd-cursor' ) ) return node;
			if ( hasAttr( node, 'data-odd-cursor-root' ) || matches( node, desktopSurfaceSelector() ) ) return node;
			if ( matches( node, '.odd-shell, .odd-panel, .odd-shop, .odd-shop__card, .odd-catalog-row, .odd-command-palette, .odd-toast, .odd-dock-rail, .odd-app-host, .odd-window-host' ) ) return node;
			if ( node === document.body && /\b(desktop-mode-active|wp-desktop-active|odd-desktop-active)\b/.test( node.className || '' ) ) return node;
		}
		if ( resolved && resolved.source && resolved.source !== 'fallback' ) return resolved.target || resolved.node || null;
		return null;
	}

	function liveCursorSoftRole( role, resolved ) {
		if ( role === 'text' ) return true;
		return !! ( resolved && resolved.target && textLike( resolved.target ) );
	}

	function liveCursorAllowed( event, resolved, path ) {
		var doc = nodeDoc( resolved && ( resolved.target || resolved.node ) || event && event.target );
		var pointerType = pointerTypeForEvent( event );
		if ( ! state.href || ! liveCursorEnabledByConfig() ) return false;
		if ( doc !== document ) return false;
		if ( reducedMotion( doc ) || ! finePointer( doc ) ) return false;
		if ( pointerType === 'touch' ) return false;
		return !! liveCursorSurfaceFromPath( path || [], resolved );
	}

	function liveCursorCss() {
		return (
			'#' + LAYER_ID + '{--odd-cursor-x:0px;--odd-cursor-y:0px;--odd-cursor-speed:0;--odd-cursor-angle:0deg;--odd-cursor-tilt:0deg;--odd-cursor-pen-tilt:0deg;--odd-cursor-stretch:1;--odd-cursor-pressure:0;--odd-cursor-aura-scale:1;--odd-cursor-eye-scale:1;--odd-trail-opacity1:.30;--odd-trail-opacity2:.22;--odd-trail-opacity3:.14;--odd-hot-x:0;--odd-hot-y:0;--odd-hot-x-px:0px;--odd-hot-y-px:0px;--odd-hot-x-neg:0px;--odd-hot-y-neg:0px;--odd-trail-x1:0px;--odd-trail-y1:0px;--odd-trail-x2:0px;--odd-trail-y2:0px;--odd-trail-x3:0px;--odd-trail-y3:0px;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;contain:layout style paint;opacity:0;transform:translate3d(var(--odd-cursor-x),var(--odd-cursor-y),0);transition:opacity .08s ease;}' +
			'#' + LAYER_ID + '[data-visible="true"]{opacity:1;}' +
			'#' + LAYER_ID + ' span{position:absolute;display:block;pointer-events:none;}' +
			'#' + LAYER_ID + ' .odd-live-cursor__aura{left:-21px;top:-21px;width:42px;height:42px;border-radius:999px;border:3px solid rgba(66,217,210,.92);background:rgba(66,217,210,.26);box-shadow:0 0 0 9px rgba(66,217,210,.12),0 0 34px rgba(66,217,210,.45);transform:rotate(var(--odd-cursor-pen-tilt)) scale(var(--odd-cursor-aura-scale));animation:oddLiveCursorBreathe 1.9s ease-in-out infinite;}' +
			'#' + LAYER_ID + ' .odd-live-cursor__eye{left:-6px;top:-6px;width:12px;height:12px;border-radius:999px;background:#19091f;box-shadow:0 0 0 6px #42d9d2,0 0 0 9px rgba(25,9,31,.13);transform:scale(var(--odd-cursor-eye-scale));}' +
			'#' + LAYER_ID + ' .odd-live-cursor__trail{left:-8px;top:-8px;width:16px;height:16px;border-radius:999px;background:#42d9d2;box-shadow:0 0 18px rgba(66,217,210,.35);opacity:var(--odd-trail-opacity1);}' +
			'#' + LAYER_ID + ' .odd-live-cursor__trail--one{transform:translate3d(var(--odd-trail-x1),var(--odd-trail-y1),0) scale(1);}' +
			'#' + LAYER_ID + ' .odd-live-cursor__trail--two{transform:translate3d(var(--odd-trail-x2),var(--odd-trail-y2),0) scale(.72);opacity:var(--odd-trail-opacity2);}' +
			'#' + LAYER_ID + ' .odd-live-cursor__trail--three{transform:translate3d(var(--odd-trail-x3),var(--odd-trail-y3),0) scale(.52);opacity:var(--odd-trail-opacity3);}' +
			'#' + LAYER_ID + ' .odd-live-cursor__spark{left:17px;top:-26px;width:18px;height:18px;opacity:0;transform:rotate(45deg);border:4px solid #ff4f8b;border-radius:5px;box-shadow:0 0 16px rgba(255,79,139,.35);}' +
			'#' + LAYER_ID + ' .odd-live-cursor__spark--two{left:34px;top:10px;width:12px;height:12px;border-color:#f6b73c;animation-delay:.14s;}' +
			'#' + LAYER_ID + ' .odd-live-cursor__vein{left:-2px;top:-29px;width:5px;height:58px;border-radius:999px;background:#42d9d2;opacity:0;box-shadow:0 0 14px rgba(66,217,210,.42);animation:oddLiveCursorPulse .92s ease-in-out infinite;}' +
			'#' + LAYER_ID + ' .odd-live-cursor__orbit{left:-28px;top:-28px;width:56px;height:56px;border-radius:999px;border:4px solid transparent;border-top-color:#42d9d2;border-right-color:#f6b73c;border-bottom-color:rgba(255,79,139,.62);opacity:0;animation:oddLiveCursorSpin .72s linear infinite;}' +
			'#' + LAYER_ID + ' .odd-live-cursor__slash{left:-25px;top:-3px;width:50px;height:6px;border-radius:999px;background:#ff4f8b;opacity:0;box-shadow:0 0 14px rgba(255,79,139,.4);transform:rotate(-43deg);}' +
			'#' + LAYER_ID + ' .odd-live-cursor__shape{display:block;left:0;top:0;width:64px;height:64px;background-image:var(--odd-cursor-image);background-repeat:no-repeat;background-size:contain;opacity:.22;transform-origin:var(--odd-hot-x-px) var(--odd-hot-y-px);transform:translate3d(var(--odd-hot-x-neg),var(--odd-hot-y-neg),0) rotate(var(--odd-cursor-tilt)) scaleX(var(--odd-cursor-stretch));filter:drop-shadow(0 9px 10px rgba(25,9,31,.18));}' +
			'#' + LAYER_ID + '[data-mode="replace"] .odd-live-cursor__shape{opacity:1;}' +
			'#' + LAYER_ID + '[data-role="pointer"] .odd-live-cursor__spark,#' + LAYER_ID + '[data-role="help"] .odd-live-cursor__spark{opacity:1;animation:oddLiveCursorSpark .92s ease-in-out infinite;}' +
			'#' + LAYER_ID + '[data-role="text"] .odd-live-cursor__vein{opacity:.78;}' +
			'#' + LAYER_ID + '[data-role="grab"] .odd-live-cursor__aura{border-radius:42% 58% 50% 50%;}' +
			'#' + LAYER_ID + '[data-role="grabbing"] .odd-live-cursor__aura,#' + LAYER_ID + '[data-pressed="true"] .odd-live-cursor__aura{transform:scaleX(.78) scaleY(1.18);}' +
			'#' + LAYER_ID + '[data-role="wait"] .odd-live-cursor__orbit,#' + LAYER_ID + '[data-role="progress"] .odd-live-cursor__orbit{opacity:.9;}' +
			'#' + LAYER_ID + '[data-role="not-allowed"] .odd-live-cursor__slash{opacity:.92;animation:oddLiveCursorBite .48s ease-out;}' +
			'#' + LAYER_ID + '[data-soft="true"] .odd-live-cursor__spark,#' + LAYER_ID + '[data-soft="true"] .odd-live-cursor__trail,#' + LAYER_ID + '[data-soft="true"] .odd-live-cursor__orbit{display:none;}' +
			'#' + LAYER_ID + '[data-soft="true"] .odd-live-cursor__aura{width:24px;height:44px;left:-12px;top:-22px;border-radius:999px;box-shadow:0 0 18px rgba(66,217,210,.2);background:rgba(66,217,210,.12);}' +
			'#' + LAYER_ID + '[data-soft="true"] .odd-live-cursor__shape{opacity:.12;}' +
			'@keyframes oddLiveCursorBreathe{0%,100%{filter:saturate(1);opacity:.9;}50%{filter:saturate(1.28);opacity:1;}}' +
			'@keyframes oddLiveCursorSpark{0%,100%{transform:rotate(45deg) translate3d(0,0,0) scale(.72);opacity:.28;}45%{transform:rotate(45deg) translate3d(3px,-4px,0) scale(1.18);opacity:1;}}' +
			'@keyframes oddLiveCursorPulse{0%,100%{transform:scaleY(.62);opacity:.5;}50%{transform:scaleY(1.08);opacity:1;}}' +
			'@keyframes oddLiveCursorSpin{to{transform:rotate(360deg);}}' +
			'@keyframes oddLiveCursorBite{0%{transform:rotate(-43deg) translateX(-5px);}60%{transform:rotate(-43deg) translateX(4px);}100%{transform:rotate(-43deg) translateX(0);}}' +
			'@media (prefers-reduced-motion: reduce){#' + LAYER_ID + '{display:none!important;}}'
		);
	}

	function ensureLiveCursorLayer( doc ) {
		doc = doc || document;
		if ( doc !== document || ! doc.documentElement || ! doc.body ) return null;
		if ( ! state.layer.style || ! state.layer.style.isConnected ) {
			var style = doc.getElementById ? doc.getElementById( LAYER_STYLE_ID ) : null;
			if ( ! style && doc.createElement ) {
				style = doc.createElement( 'style' );
				style.id = LAYER_STYLE_ID;
				style.textContent = liveCursorCss();
				var head = headFor( doc );
				if ( head ) head.appendChild( style );
			}
			state.layer.style = style;
		}
		if ( ! state.layer.el || ! state.layer.el.isConnected ) {
			var layer = doc.getElementById ? doc.getElementById( LAYER_ID ) : null;
			if ( ! layer && doc.createElement ) {
				layer = doc.createElement( 'div' );
				layer.id = LAYER_ID;
				layer.setAttribute( 'aria-hidden', 'true' );
				layer.setAttribute( 'data-visible', 'false' );
				layer.setAttribute( 'data-mode', liveCursorMode() );
				layer.setAttribute( 'data-role', 'default' );
				layer.innerHTML = '<span class="odd-live-cursor__trail odd-live-cursor__trail--three"></span><span class="odd-live-cursor__trail odd-live-cursor__trail--two"></span><span class="odd-live-cursor__trail odd-live-cursor__trail--one"></span><span class="odd-live-cursor__aura"></span><span class="odd-live-cursor__vein"></span><span class="odd-live-cursor__eye"></span><span class="odd-live-cursor__spark odd-live-cursor__spark--one"></span><span class="odd-live-cursor__spark odd-live-cursor__spark--two"></span><span class="odd-live-cursor__orbit"></span><span class="odd-live-cursor__slash"></span><span class="odd-live-cursor__shape"></span>';
				doc.body.appendChild( layer );
			}
			state.layer.el = layer;
			state.layer.doc = doc;
		}
		if ( ! state.layer.bound ) {
			state.layer.bound = true;
			try { doc.addEventListener( 'pointerleave', hideLiveCursorLayer, true ); } catch ( e ) {}
			try { doc.addEventListener( 'mouseleave', hideLiveCursorLayer, true ); } catch ( e ) {}
			try { window.addEventListener( 'blur', hideLiveCursorLayer, true ); } catch ( e ) {}
		}
		return state.layer.el;
	}

	function cssUrlValue( url ) {
		url = typeof url === 'string' ? url : '';
		return 'url("' + url.replace( /\\/g, '\\\\' ).replace( /"/g, '\\"' ) + '")';
	}

	function eventSample( event ) {
		var coalesced = [];
		var predicted = [];
		try {
			if ( event && typeof event.getCoalescedEvents === 'function' ) coalesced = event.getCoalescedEvents() || [];
		} catch ( e ) {}
		try {
			if ( event && typeof event.getPredictedEvents === 'function' ) predicted = event.getPredictedEvents() || [];
		} catch ( e ) {}
		var base = coalesced.length ? coalesced[ coalesced.length - 1 ] : event;
		var lead = predicted.length ? predicted[ predicted.length - 1 ] : base;
		var x = lead && typeof lead.clientX === 'number' ? lead.clientX : state.layer.x;
		var y = lead && typeof lead.clientY === 'number' ? lead.clientY : state.layer.y;
		return {
			x:         x,
			y:         y,
			coalesced: coalesced.length,
			predicted: predicted.length,
		};
	}

	function hideLiveCursorLayer() {
		if ( state.layer.el ) state.layer.el.setAttribute( 'data-visible', 'false' );
		state.layer.visible = false;
		state.layer.pressed = false;
	}

	function captureDragPointer( event, resolved ) {
		if ( ! event || event.type !== 'pointerdown' || ! resolved ) return;
		if ( resolved.kind !== 'grab' && resolved.kind !== 'grabbing' && ! dragLike( resolved.node ) ) return;
		var target = resolved.target && resolved.target.setPointerCapture ? resolved.target : resolved.node;
		if ( ! target || typeof target.setPointerCapture !== 'function' || typeof event.pointerId === 'undefined' ) return;
		try { target.setPointerCapture( event.pointerId ); } catch ( e ) {}
	}

	function shouldHideNativeForLayer( event, resolved, path ) {
		var role = resolved && resolved.kind || 'default';
		if ( liveCursorMode() !== 'replace' ) return false;
		if ( ! liveCursorAllowed( event, resolved, path ) ) return false;
		if ( liveCursorSoftRole( role, resolved ) ) return false;
		return pointerTypeForEvent( event ) !== 'pen';
	}

	function updateLiveCursorLayer( event, resolved, path ) {
		if ( ! resolved || ! event ) {
			hideLiveCursorLayer();
			return;
		}
		if ( typeof event.clientX !== 'number' && ! /^(pointer|mouse)/.test( event.type || '' ) ) return;
		if ( event.type === 'pointerdown' || event.type === 'mousedown' ) state.layer.pressed = true;
		if ( event.type === 'pointerup' || event.type === 'pointercancel' || event.type === 'mouseup' ) state.layer.pressed = false;
		if ( ! liveCursorAllowed( event, resolved, path ) ) {
			hideLiveCursorLayer();
			return;
		}
		var sample = eventSample( event );
		var doc = nodeDoc( resolved.target || resolved.node );
		var layer = ensureLiveCursorLayer( doc );
		if ( ! layer ) return;
		var now = ( window.performance && window.performance.now ) ? window.performance.now() : Date.now();
		var dx = sample.x - state.layer.x;
		var dy = sample.y - state.layer.y;
		var dt = Math.max( 8, now - ( state.layer.time || now ) );
		var velocity = Math.sqrt( dx * dx + dy * dy ) / dt;
		var speed = Math.max( 0, Math.min( 1, velocity / 1.15 ) );
		var angle = Math.atan2( dy || 0, dx || 0 ) * 180 / Math.PI;
		var role = resolved.kind || 'default';
		if ( state.layer.pressed && role === 'grab' ) role = 'grabbing';
		var soft = liveCursorSoftRole( role, resolved );
		var meta = cursorMeta( role, resolved.node );
		var pressure = typeof event.pressure === 'number' ? event.pressure : ( state.layer.pressed ? 0.45 : 0 );
		var tiltX = typeof event.tiltX === 'number' ? event.tiltX : 0;
		var tiltY = typeof event.tiltY === 'number' ? event.tiltY : 0;
		var twist = typeof event.twist === 'number' ? event.twist : 0;
		var width = typeof event.width === 'number' ? event.width : 0;
		var height = typeof event.height === 'number' ? event.height : 0;
		var contact = Math.max( 0, Math.min( 32, Math.max( width, height ) ) );
		state.layer.trail.unshift( { x: state.layer.x || sample.x, y: state.layer.y || sample.y } );
		if ( state.layer.trail.length > 3 ) state.layer.trail.length = 3;
		state.layer.x = sample.x;
		state.layer.y = sample.y;
		state.layer.time = now;
		state.layer.speed = speed;
		state.layer.role = role;
		state.layer.mode = liveCursorMode();
		state.layer.pointerType = pointerTypeForEvent( event );
		state.layer.pressure = pressure;
		state.layer.tiltX = tiltX;
		state.layer.tiltY = tiltY;
		state.layer.twist = twist;
		state.layer.contact = contact;
		state.layer.coalesced = sample.coalesced;
		state.layer.predicted = sample.predicted;
		layer.setAttribute( 'data-visible', 'true' );
		layer.setAttribute( 'data-role', role );
		layer.setAttribute( 'data-mode', state.layer.mode );
		layer.setAttribute( 'data-pointer', state.layer.pointerType || 'mouse' );
		layer.setAttribute( 'data-pressed', state.layer.pressed ? 'true' : 'false' );
		layer.setAttribute( 'data-soft', soft ? 'true' : 'false' );
		layer.style.setProperty( '--odd-cursor-x', sample.x + 'px' );
		layer.style.setProperty( '--odd-cursor-y', sample.y + 'px' );
		layer.style.setProperty( '--odd-cursor-speed', String( speed ) );
		layer.style.setProperty( '--odd-cursor-angle', angle + 'deg' );
		layer.style.setProperty( '--odd-cursor-tilt', ( angle * 0.035 ) + 'deg' );
		layer.style.setProperty( '--odd-cursor-stretch', String( 1 + speed * 0.24 ) );
		layer.style.setProperty( '--odd-cursor-pressure', String( pressure ) );
		layer.style.setProperty( '--odd-cursor-pen-tilt', ( tiltX * 0.18 + tiltY * 0.12 + twist * 0.02 ) + 'deg' );
		layer.style.setProperty( '--odd-cursor-aura-scale', String( 1.05 + speed * 0.45 + pressure * 0.24 + contact * 0.012 ) );
		layer.style.setProperty( '--odd-cursor-eye-scale', String( 1 + pressure * 0.36 ) );
		layer.style.setProperty( '--odd-trail-opacity1', String( 0.30 + speed * 0.55 ) );
		layer.style.setProperty( '--odd-trail-opacity2', String( 0.22 + speed * 0.36 ) );
		layer.style.setProperty( '--odd-trail-opacity3', String( 0.14 + speed * 0.24 ) );
		layer.style.setProperty( '--odd-hot-x', String( meta.hotspot[ 0 ] || 0 ) );
		layer.style.setProperty( '--odd-hot-y', String( meta.hotspot[ 1 ] || 0 ) );
		layer.style.setProperty( '--odd-hot-x-px', ( meta.hotspot[ 0 ] || 0 ) + 'px' );
		layer.style.setProperty( '--odd-hot-y-px', ( meta.hotspot[ 1 ] || 0 ) + 'px' );
		layer.style.setProperty( '--odd-hot-x-neg', ( -1 * ( meta.hotspot[ 0 ] || 0 ) ) + 'px' );
		layer.style.setProperty( '--odd-hot-y-neg', ( -1 * ( meta.hotspot[ 1 ] || 0 ) ) + 'px' );
		layer.style.setProperty( '--odd-cursor-image', meta.url ? cssUrlValue( meta.url ) : 'none' );
		for ( var i = 0; i < 3; i++ ) {
			var point = state.layer.trail[ i ] || { x: sample.x, y: sample.y };
			layer.style.setProperty( '--odd-trail-x' + ( i + 1 ), ( point.x - sample.x ) + 'px' );
			layer.style.setProperty( '--odd-trail-y' + ( i + 1 ), ( point.y - sample.y ) + 'px' );
		}
		state.layer.visible = true;
	}

	function observeSurface( root, meta ) {
		if ( ! root || ! root.addEventListener ) return false;
		var doc = root.ownerDocument || ( root.nodeType === 9 ? root : document );
		var rec = docRecord( doc, true );
		for ( var i = 0; i < rec.surfaces.length; i++ ) {
			if ( rec.surfaces[ i ].root === root ) {
				scanShadowRoots( root, meta );
				sweepSurface( root );
				return true;
			}
		}
		var row = {
			root: root,
			meta: meta || {},
			time: Date.now ? Date.now() : 0,
		};
		rec.surfaces.push( row );
		state.surfaces.push( row );
		installListeners( root );
		scanShadowRoots( root, meta );
		if ( typeof MutationObserver !== 'undefined' && root.nodeType === 1 ) {
			try {
				var observer = new MutationObserver( function () {
					sweepSurface( root );
				} );
				observer.observe( root, { childList: true, subtree: true } );
				rec.observers.push( observer );
			} catch ( e ) {
				failure( 'observe-failed', { message: e && e.message || '' } );
			}
		}
		sweepSurface( root );
		return true;
	}

	function installListeners( target ) {
		if ( ! target || ! target.addEventListener || target.__oddCursorController ) return;
		target.__oddCursorController = true;
		[ 'pointerover', 'pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'focusin', 'mouseover', 'mousedown', 'mouseup' ].forEach( function ( name ) {
			try { target.addEventListener( name, resolveAndApplyEvent, true ); } catch ( e ) {}
		} );
	}

	function mark( node, kind ) {
		if ( ! node || node.nodeType !== 1 ) return node;
		kind = semanticKinds[ kind ] ? kind : 'default';
		try {
			node.setAttribute( 'data-odd-cursor', kind );
		} catch ( e ) {}
		return node;
	}

	function markRoot( node ) {
		if ( ! node || node.nodeType !== 1 ) return node;
		try {
			node.setAttribute( 'data-odd-cursor-root', 'true' );
		} catch ( e ) {}
		return node;
	}

	function markInteractiveDescendants( root ) {
		if ( ! root || ! root.querySelectorAll ) return 0;
		var count = 0;
		var selectors = [
			'a[href]',
			'button',
			'[role="button"]',
			'[role="menuitem"]',
			'[role="option"]',
			'[tabindex]:not([tabindex="-1"])',
			'summary',
			'label[for]',
			'select',
			'input[type="button"]',
			'input[type="submit"]',
			'input[type="reset"]',
			'input:not([type])',
			'input[type="text"]',
			'input[type="search"]',
			'input[type="email"]',
			'input[type="url"]',
			'input[type="password"]',
			'textarea',
			'[contenteditable="true"]',
			'[contenteditable=""]',
			'[draggable="true"]',
			'[data-drag]',
			'[data-drag-handle]',
			'[aria-disabled="true"]',
			'[disabled]',
			'[aria-busy="true"]',
			'.desktop-mode-icon',
			'.desktop-mode-file',
			'.desktop-mode-file-tile',
			'.desktop-mode-file__tile',
			'.desktop-mode-files__item',
			'.desktop-mode-files__tile',
			'.desktop-mode-folder',
			'.desktop-mode-folder-tile',
			'.desktop-mode-context-menu__item',
			'.desktop-mode-dock__item',
			'.desktop-mode-dock__button',
			'.desktop-mode-window__btn',
			'.desktop-mode-window__tab',
			'.desktop-mode-window__control',
			'.desktop-mode-window__titlebar',
			'.desktop-mode-window__resize-handle',
			'.desktop-mode-window-resizer',
			'.desktop-mode-plugins__row',
			'.desktop-mode-plugins__action',
			'.desktop-mode-heartbeat__button',
			'.desktop-mode-widgets__chrome',
			'.desktop-mode-widgets__grip',
			'.desktop-mode-widgets__resize',
			'.desktop-mode-widget__resize-handle',
			'wpd-tab',
			'wpd-context-menu-item',
			'wpd-menu-item',
			'.desktop-mode-widgets__card-redock',
			'.desktop-mode-widgets__card-close',
			'.desktop-mode-widgets__add',
			'.wp-desktop-icon',
			'.wp-desktop-file',
			'.wp-desktop-file-tile',
			'.wp-desktop-folder',
			'.wp-desktop-folder-tile',
			'.wp-desktop-dock__item-primary',
			'.wp-desktop-dock__item-new',
			'.wp-desktop-window__btn',
			'.wp-desktop-window__tab',
			'.wp-desktop-window__meta-btn',
			'.wp-desktop-window__menu-btn',
			'.wp-desktop-window__menu-item',
			'.wp-desktop-window__titlebar',
			'.wp-desktop-window__resize-handle',
			'.wp-desktop-widgets__chrome',
			'.wp-desktop-widgets__grip',
			'.wp-desktop-widgets__resize',
			'.wp-desktop-widgets__card-redock',
			'.wp-desktop-widgets__card-close',
			'.wp-desktop-widgets__add',
		].join( ',' );
		var nodes = root.querySelectorAll( selectors );
		for ( var i = 0; i < nodes.length; i++ ) {
			var n = nodes[ i ];
			if ( n.hasAttribute && n.hasAttribute( 'data-odd-cursor' ) ) continue;
			if ( n.matches && n.matches( 'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="url"], input[type="password"], textarea, [contenteditable="true"], [contenteditable=""]' ) ) {
				mark( n, 'text' );
			} else if ( n.matches && n.matches( '[draggable="true"], [data-drag], [data-drag-handle], [data-file-drag-handle], .desktop-mode-window__titlebar, .desktop-mode-window__resize-handle, .desktop-mode-window-resizer, .desktop-mode-widgets__chrome, .desktop-mode-widgets__grip, .desktop-mode-widgets__resize, .desktop-mode-widget__resize-handle, .wp-desktop-window__titlebar, .wp-desktop-window__resize-handle, .wp-desktop-widgets__chrome, .wp-desktop-widgets__grip, .wp-desktop-widgets__resize' ) ) {
				mark( n, 'grab' );
			} else if ( n.matches && n.matches( '[disabled], [aria-disabled="true"]' ) ) {
				mark( n, 'not-allowed' );
			} else if ( n.matches && n.matches( '[aria-busy="true"]' ) ) {
				mark( n, 'progress' );
			} else {
				mark( n, 'pointer' );
			}
			count++;
		}
		return count;
	}

	function apply( href, slug, doc ) {
		doc = doc || document;
		href = typeof href === 'string' ? href : configuredHref();
		slug = typeof slug === 'string' ? slug : configuredSlug();
		clearBridged( doc );

		if ( shouldClear( href, slug ) ) {
			removeLink( doc );
			if ( doc === document ) hideLiveCursorLayer();
			state.slug = slug === 'none' ? '' : slug;
			state.href = '';
			state.status = 'idle';
			state.error = '';
			if ( doc === document ) setConfig( '', state.slug );
			return null;
		}

		var link = linkFor( doc, true );
		if ( ! link ) return null;
		bindLinkEvents( link, href );
		if ( link.getAttribute( 'href' ) !== href ) {
			state.status = 'loading';
			state.error = '';
			link.setAttribute( 'href', href );
		}
		state.slug = slug;
		state.href = href;
		if ( doc === document ) {
			setConfig( href, slug );
		}
		installListeners( doc );
		if ( doc.body ) {
			observeSurface( doc.body, { source: 'document' } );
			markDesktopSurfaces( doc.body );
		}
		return link;
	}

	function clear( doc ) {
		return apply( '', 'none', doc || document );
	}

	function injectInto( doc, href ) {
		if ( ! doc ) return null;
		href = typeof href === 'string' ? href : ( state.href || configuredHref() );
		var slug = state.slug || configuredSlug();
		var link = apply( href, slug, doc );
		installListeners( doc );
		if ( doc.body ) observeSurface( doc.body, { source: 'iframe' } );
		if ( doc !== document ) {
			state.iframeInjections.push( {
				time: Date.now ? Date.now() : 0,
				href: link ? link.getAttribute( 'href' ) || '' : '',
				ok:   !! link,
			} );
			if ( state.iframeInjections.length > 20 ) state.iframeInjections.shift();
		}
		return link;
	}

	function sampleCursor( selector ) {
		try {
			var node = document.querySelector( selector );
			return node ? window.getComputedStyle( node ).cursor : '';
		} catch ( e ) {
			return '';
		}
	}

	function bridgeNativeCursor( event ) {
		resolveAndApplyEvent( event );
	}

	function bridgeTarget( node ) {
		return resolveAndApplyNode( node );
	}

	function iframeStatuses() {
		var out = [];
		var frames = document.querySelectorAll ? document.querySelectorAll( 'iframe.odd-app-frame' ) : [];
		for ( var i = 0; i < frames.length; i++ ) {
			var doc = null;
			try { doc = frames[ i ].contentDocument; } catch ( e ) {}
			var link = doc ? linkFor( doc, false ) : null;
			out.push( {
				index: i,
				link:  !! link,
				href:  link ? link.getAttribute( 'href' ) || '' : '',
			} );
		}
		return out;
	}

	function semanticCoverage() {
		var out = {};
		if ( ! document.querySelectorAll ) return out;
		Object.keys( semanticKinds ).forEach( function ( kind ) {
			out[ kind ] = document.querySelectorAll( '[data-odd-cursor="' + kind + '"]' ).length;
		} );
		out.roots = document.querySelectorAll( '[data-odd-cursor-root]' ).length;
		return out;
	}

	function desktopCoverage() {
		if ( ! document.querySelectorAll ) return { roots: 0, icons: 0 };
		return {
			roots: document.querySelectorAll( '#desktop-mode-shell[data-odd-cursor-root], .desktop-mode-shell[data-odd-cursor-root], #desktop-mode-area[data-odd-cursor-root], .desktop-mode-area[data-odd-cursor-root], #wp-desktop-shell[data-odd-cursor-root], .wp-desktop-shell[data-odd-cursor-root], #wp-desktop-area[data-odd-cursor-root], .wp-desktop-area[data-odd-cursor-root]' ).length,
			icons: document.querySelectorAll( '.desktop-mode-icon[data-odd-cursor="pointer"], .desktop-mode-dock__item[data-odd-cursor="pointer"], .wp-desktop-icon[data-odd-cursor="pointer"], .wp-desktop-dock__item-primary[data-odd-cursor="pointer"]' ).length,
		};
	}

	function windowCoverage() {
		if ( ! document.querySelectorAll ) return { roots: 0, iframes: 0 };
		return {
			roots: document.querySelectorAll( '[data-window-id][data-odd-cursor-root], [data-windowid][data-odd-cursor-root], [data-desktop-window-id][data-odd-cursor-root], [data-native-window-id][data-odd-cursor-root]' ).length,
			iframes: iframeStatuses().filter( function ( row ) { return row.link; } ).length,
		};
	}

	function status() {
		var link = linkFor( document, false );
		return {
			activeSlug:     state.slug || configuredSlug(),
			configuredHref: configuredHref(),
			href:           state.href,
			link:           !! link,
			linkHref:        link ? link.getAttribute( 'href' ) || '' : '',
			status:         state.status,
			error:          state.error,
			iframes:        iframeStatuses(),
			iframeInjections: state.iframeInjections.slice(),
			observedSurfaces: state.surfaces.length,
			shadowRoots:    state.shadowRoots.length,
			bridged:        bridged.length,
			semantics:      semanticCoverage(),
			desktop:        desktopCoverage(),
			windows:        windowCoverage(),
			tokens:         configuredTokens(),
			lastResolved:   state.lastResolved,
			layer:          {
				enabled:     !! ( state.href && liveCursorEnabledByConfig() && ! reducedMotion( document ) && finePointer( document ) ),
				active:      !! ( state.layer.el && state.layer.el.isConnected ),
				visible:     state.layer.visible,
				role:        state.layer.role,
				mode:        liveCursorMode(),
				pointerType: state.layer.pointerType,
				pressed:     state.layer.pressed,
				speed:       state.layer.speed,
				pressure:    state.layer.pressure,
				tiltX:       state.layer.tiltX,
				tiltY:       state.layer.tiltY,
				twist:       state.layer.twist,
				contact:     state.layer.contact,
				coalesced:   state.layer.coalesced,
				predicted:   state.layer.predicted,
			},
			failures:       state.failures.slice(),
			samples:        {
				body:   sampleCursor( 'body' ),
				desktop: sampleCursor( '#desktop-mode-area, .desktop-mode-area, #wp-desktop-area, .wp-desktop-area' ),
				button: sampleCursor( 'button, a, [role="button"]' ),
				input:  sampleCursor( 'input, textarea, [contenteditable="true"]' ),
				card:   sampleCursor( '.odd-shop__card, .odd-catalog-row' ),
			},
		};
	}

	function boot() {
		apply( configuredHref(), configuredSlug(), document );
		installListeners( document );
		if ( document.body ) {
			observeSurface( document.body, { source: 'boot' } );
			markDesktopSurfaces( document.body );
		}
	}

	window.__odd.cursors = {
		apply:      apply,
		bridgeTarget: bridgeTarget,
		clear:      clear,
		injectInto: injectInto,
		mark:       mark,
		markRoot:   markRoot,
		markInteractiveDescendants: markInteractiveDescendants,
		observeSurface: observeSurface,
		status:     status,
	};

	if ( window.__odd.debug && typeof window.__odd.debug === 'object' ) {
		window.__odd.debug.cursors = status;
	}

	if ( window.wp && window.wp.hooks && typeof window.wp.hooks.addAction === 'function' ) {
		try {
			window.wp.hooks.addAction( 'odd.cursorSet', 'odd.cursors', function ( slug, href ) {
				if ( slug === 'none' || slug === '' ) clear();
				else apply( href || configuredHref(), slug );
			} );
		} catch ( e ) {}
	}

	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', boot, { once: true } );
	} else {
		boot();
	}
} )();
