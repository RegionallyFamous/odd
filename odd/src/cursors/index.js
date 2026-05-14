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

	function cursorValue( kind, node ) {
		kind = semanticKinds[ kind ] ? kind : 'default';
		var set = activeSet();
		var cursors = set && set.cursors;
		var spec = cursors && ( cursors[ kind ] || cursors.default );
		if ( ! spec || ! spec.url ) {
			var tokens = configuredTokens();
			if ( typeof tokens[ kind ] === 'string' && tokens[ kind ] ) return tokens[ kind ];
			return cssVarCursorValue( kind, node );
		}
		var hotspot = Array.isArray( spec.hotspot ) ? spec.hotspot : [ 0, 0 ];
		var x = parseInt( hotspot[ 0 ], 10 );
		var y = parseInt( hotspot[ 1 ], 10 );
		if ( isNaN( x ) ) x = 0;
		if ( isNaN( y ) ) y = 0;
		return 'url("' + spec.url + '") ' + x + ' ' + y + ', ' + kind;
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
		if ( matches( node, 'a[href], button, .button, .button-primary, .button-secondary, [role="button"], summary, label[for], input[type="button"], input[type="submit"], input[type="reset"], select, option, .ab-item, .components-button, wpd-button, [data-window-control], [data-window-action], .desktop-mode-icon, .desktop-mode-file-tile, .desktop-mode-dock__item, .desktop-mode-dock__button, .desktop-mode-window__btn, .desktop-mode-window__tab, .desktop-mode-window__control, .desktop-mode-widgets__card-redock, .desktop-mode-widgets__card-close, .desktop-mode-widgets__add, .wp-desktop-icon, .wp-desktop-dock__item, .wp-desktop-dock__item-primary, .wp-desktop-dock__item-new, .wp-desktop-window__btn, .wp-desktop-window__tab, .wp-desktop-window__meta-btn, .wp-desktop-window__menu-btn, .wp-desktop-window__menu-item, .wp-desktop-widgets__card-redock, .wp-desktop-widgets__card-close, .wp-desktop-widgets__add' ) ) {
			return true;
		}
		return label === 'close' || label === 'minimize' || label === 'maximize' || label === 'restore';
	}

	function resizeLike( node ) {
		return matches( node, '[data-resize-handle], [data-window-resize-handle], .ui-resizable-handle, .resize-handle, .desktop-mode-window__resize-handle, .desktop-mode-widgets__resize, .wp-desktop-window__resize-handle, .wp-desktop-widgets__resize' );
	}

	function dragLike( node ) {
		return matches( node, '[draggable="true"], [data-drag], [data-drag-handle], [data-window-drag-handle], [data-window-titlebar], [data-window-header], .desktop-mode-window-titlebar, .desktop-mode-window-header, .window-titlebar, .native-window-titlebar, .desktop-mode-window__titlebar, .desktop-mode-widgets__chrome, .desktop-mode-widgets__grip, .desktop-window__titlebar, .wp-desktop-window__titlebar, .wp-desktop-widgets__chrome, .wp-desktop-widgets__grip' );
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
		for ( var i = 0; i < path.length; i++ ) {
			var node = path[ i ];
			if ( ! node || node.nodeType !== 1 ) continue;
			var role = roleForNode( node );
			if ( role ) return role;
		}
		for ( var j = 0; j < path.length; j++ ) {
			if ( path[ j ] && path[ j ].nodeType === 1 ) {
				return { kind: 'default', source: 'fallback', node: path[ j ] };
			}
		}
		return null;
	}

	function applyResolved( resolved ) {
		if ( ! state.href || ! resolved || ! resolved.node || ! resolved.node.style ) return null;
		var value = cursorValue( resolved.kind, resolved.node );
		if ( ! value ) return null;
		rememberBridge( resolved.node, value, resolved.kind );
		state.lastResolved = Object.assign( nodeSummary( resolved.node ), {
			role: resolved.kind,
			source: resolved.source,
			cursor: value,
			time: Date.now ? Date.now() : 0,
		} );
		return resolved;
	}

	function resolveAndApplyEvent( event ) {
		return applyResolved( resolvePath( pathFromEvent( event ) ) );
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
		[ 'pointerover', 'pointermove', 'pointerdown', 'pointerup', 'focusin', 'mouseover' ].forEach( function ( name ) {
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
			'.desktop-mode-file-tile',
			'.desktop-mode-dock__item',
			'.desktop-mode-dock__button',
			'.desktop-mode-window__btn',
			'.desktop-mode-window__tab',
			'.desktop-mode-window__control',
			'.desktop-mode-window__titlebar',
			'.desktop-mode-window__resize-handle',
			'.desktop-mode-widgets__chrome',
			'.desktop-mode-widgets__grip',
			'.desktop-mode-widgets__resize',
			'.desktop-mode-widgets__card-redock',
			'.desktop-mode-widgets__card-close',
			'.desktop-mode-widgets__add',
			'.wp-desktop-icon',
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
			} else if ( n.matches && n.matches( '[draggable="true"], [data-drag], [data-drag-handle], .desktop-mode-window__titlebar, .desktop-mode-window__resize-handle, .desktop-mode-widgets__chrome, .desktop-mode-widgets__grip, .desktop-mode-widgets__resize, .wp-desktop-window__titlebar, .wp-desktop-window__resize-handle, .wp-desktop-widgets__chrome, .wp-desktop-widgets__grip, .wp-desktop-widgets__resize' ) ) {
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
