/**
 * ODD custom cursor runtime.
 * ---------------------------------------------------------------
 * Owns native cursor roles and the decorative live cursor layer for
 * the shell, wp-admin, Desktop Mode windows, open shadow roots, and
 * same-origin iframe documents. The actual cursor remains the browser
 * cursor; ODD themes the lightweight aura that follows it.
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
	var effectRecipes = {
		default:           true,
		'signal-bloom':    true,
		'gel-pop':         true,
		'paper-sparks':    true,
		'solar-orbit':     true,
		'moonlight-focus': true,
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
			recipe:      'default',
			trail:       [],
			queued:      false,
			pending:     null,
			resolved:    null,
			path:        [],
			target:      null,
			vars:        {},
			bound:       false,
		},
	};
	var bridged = [];
	var documents = [];
	var docSeq = 0;
	var controllerId = 'odd-cursors-' + Math.random().toString( 36 ).slice( 2 );

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

	function nativeCursorValue( kind ) {
		kind = semanticKinds[ kind ] ? kind : 'default';
		if ( kind === 'grabbing' ) return 'grabbing';
		if ( kind === 'grab' ) return 'grab';
		if ( kind === 'text' ) return 'text';
		if ( kind === 'pointer' ) return 'pointer';
		if ( kind === 'crosshair' ) return 'crosshair';
		if ( kind === 'not-allowed' ) return 'not-allowed';
		if ( kind === 'wait' ) return 'wait';
		if ( kind === 'progress' ) return 'progress';
		if ( kind === 'help' ) return 'help';
		return 'default';
	}

	function cleanHexColor( value, fallback ) {
		value = typeof value === 'string' ? value.trim() : '';
		return /^#[0-9A-Fa-f]{3,8}$/.test( value ) ? value : fallback;
	}

	function cleanEffectRecipe( value ) {
		value = typeof value === 'string' ? value.trim() : '';
		return effectRecipes[ value ] ? value : 'default';
	}

	function liveCursorTheme() {
		var set = activeSet() || {};
		var effects = set.effects && typeof set.effects === 'object' ? set.effects : {};
		var tokens = configuredTokens();
		if ( ! effects.accent && ! effects.spark && ! effects.warm && ! effects.ink && ! effects.recipe && tokens && typeof tokens === 'object' ) {
			effects = tokens;
		}
		return {
			accent: cleanHexColor( effects.accent || set.accent, '#42d9d2' ),
			spark:  cleanHexColor( effects.spark, '#ff4f8b' ),
			warm:   cleanHexColor( effects.warm, '#f6b73c' ),
			ink:    cleanHexColor( effects.ink, '#19091f' ),
			recipe: cleanEffectRecipe( effects.recipe ),
		};
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
		if ( ! ( state.slug || configuredSlug() ) || ! resolved || ! resolved.node || ! resolved.node.style ) return null;
		var value = nativeCursorValue( resolved.kind );
		var target = resolved.target && resolved.target.nodeType === 1 ? resolved.target : resolved.node;
		rememberBridge( target, value, resolved.kind );
		if ( target !== resolved.node ) {
			rememberBridge( resolved.node, value, resolved.kind );
		}
		state.lastResolved = Object.assign( nodeSummary( target ), {
			role: resolved.kind,
			source: resolved.source,
			roleOwner: nodeSummary( resolved.node ),
			cursor: value,
			nativeCursor: value,
			liveLayer: false,
			time: Date.now ? Date.now() : 0,
		} );
		return resolved;
	}

	function resolveAndApplyEvent( event ) {
		var path = pathFromEvent( event );
		var resolved = resolvePath( path );
		captureDragPointer( event, resolved );
		var applied = applyResolved( resolved );
		rememberLiveCursorResolved( applied || resolved, path, event && event.target );
		queueLiveCursorLayerUpdate( event, applied || resolved, path );
		return applied;
	}

	function rememberLiveCursorResolved( resolved, path, target ) {
		state.layer.resolved = resolved || null;
		state.layer.path = path || [];
		state.layer.target = target || null;
	}

	function handleCursorMove( event ) {
		var resolved = state.layer.resolved;
		if ( ! resolved || ! resolved.node || ! resolved.node.isConnected || state.layer.target !== ( event && event.target ) ) {
			return resolveAndApplyEvent( event );
		}
		queueLiveCursorLayerUpdate( event, resolved, state.layer.path || [] );
		return resolved;
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
		return 'aura';
	}

	function liveCursorUsesPrediction() {
		var c = cfg();
		var shell = shellConfig();
		return c.cursorLayerPrediction === true || c.liveCursorPrediction === true || shell.oddCursorLayerPrediction === true;
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
		if ( ! ( state.slug || configuredSlug() ) || ! liveCursorEnabledByConfig() ) return false;
		if ( doc !== document ) return false;
		if ( reducedMotion( doc ) || ! finePointer( doc ) ) return false;
		if ( pointerType === 'touch' ) return false;
		return !! liveCursorSurfaceFromPath( path || [], resolved );
	}

	function liveCursorCss() {
		return (
			'#' + LAYER_ID + '{--odd-live-accent:#42d9d2;--odd-live-spark:#ff4f8b;--odd-live-warm:#f6b73c;--odd-live-ink:#19091f;--odd-cursor-x:0px;--odd-cursor-y:0px;--odd-cursor-aura-scale:1;--odd-cursor-eye-scale:1;--odd-cursor-pen-tilt:0deg;--odd-wake-x:0px;--odd-wake-y:0px;--odd-wake-opacity:.12;position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;contain:layout style;overflow:visible;opacity:0;transform:translate3d(var(--odd-cursor-x),var(--odd-cursor-y),0);transition:opacity .08s ease;will-change:transform,opacity;}' +
			'#' + LAYER_ID + '[data-visible="true"]{opacity:1;}' +
			'#' + LAYER_ID + ' span{position:absolute;display:block;pointer-events:none;}' +
			'#' + LAYER_ID + ' .odd-live-cursor__wake{left:-7px;top:-7px;width:14px;height:14px;border-radius:999px;background:var(--odd-live-accent);opacity:var(--odd-wake-opacity);transform:translate3d(var(--odd-wake-x),var(--odd-wake-y),0) scale(.78);will-change:transform,opacity;}' +
			'#' + LAYER_ID + ' .odd-live-cursor__aura{left:-14px;top:-14px;width:28px;height:28px;border-radius:999px;border:2px solid var(--odd-live-accent);background:color-mix(in srgb,var(--odd-live-accent) 12%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--odd-live-accent) 8%,transparent);transform:rotate(var(--odd-cursor-pen-tilt)) scale(var(--odd-cursor-aura-scale));will-change:transform;}' +
			'#' + LAYER_ID + ' .odd-live-cursor__eye{left:-3px;top:-3px;width:6px;height:6px;border-radius:999px;background:var(--odd-live-ink);box-shadow:0 0 0 3px var(--odd-live-accent);transform:scale(var(--odd-cursor-eye-scale));}' +
			'#' + LAYER_ID + ' .odd-live-cursor__spark{left:15px;top:-17px;width:10px;height:10px;opacity:0;transform:rotate(45deg);border:2px solid var(--odd-live-spark);border-radius:3px;}' +
			'#' + LAYER_ID + ' .odd-live-cursor__vein{left:-1px;top:-20px;width:3px;height:40px;border-radius:999px;background:var(--odd-live-accent);opacity:0;transform:scaleY(.72);}' +
			'#' + LAYER_ID + ' .odd-live-cursor__orbit{left:-20px;top:-20px;width:40px;height:40px;border-radius:999px;border:3px solid transparent;border-top-color:var(--odd-live-accent);border-right-color:var(--odd-live-warm);opacity:0;animation:oddLiveCursorSpin .84s linear infinite;}' +
			'#' + LAYER_ID + ' .odd-live-cursor__slash{left:-18px;top:-2px;width:36px;height:4px;border-radius:999px;background:var(--odd-live-spark);opacity:0;transform:rotate(-43deg);}' +
			'#' + LAYER_ID + '[data-role="pointer"] .odd-live-cursor__aura,#' + LAYER_ID + '[data-role="help"] .odd-live-cursor__aura{border-color:var(--odd-live-spark);background:color-mix(in srgb,var(--odd-live-spark) 10%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--odd-live-spark) 7%,transparent);}' +
			'#' + LAYER_ID + '[data-role="pointer"] .odd-live-cursor__spark,#' + LAYER_ID + '[data-role="help"] .odd-live-cursor__spark{opacity:.9;animation:oddLiveCursorSpark .9s ease-in-out infinite;}' +
			'#' + LAYER_ID + '[data-role="text"] .odd-live-cursor__vein{opacity:.72;animation:oddLiveCursorPulse .95s ease-in-out infinite;}' +
			'#' + LAYER_ID + '[data-role="text"] .odd-live-cursor__aura{width:18px;height:34px;left:-9px;top:-17px;border-radius:999px;background:color-mix(in srgb,var(--odd-live-accent) 7%,transparent);}' +
			'#' + LAYER_ID + '[data-role="grab"] .odd-live-cursor__aura{border-radius:42% 58% 50% 50%;}' +
			'#' + LAYER_ID + '[data-role="grabbing"] .odd-live-cursor__aura,#' + LAYER_ID + '[data-pressed="true"] .odd-live-cursor__aura{border-radius:45% 55% 62% 38%;background:color-mix(in srgb,var(--odd-live-warm) 13%,transparent);border-color:var(--odd-live-warm);}' +
			'#' + LAYER_ID + '[data-role="wait"] .odd-live-cursor__orbit,#' + LAYER_ID + '[data-role="progress"] .odd-live-cursor__orbit{opacity:.86;}' +
			'#' + LAYER_ID + '[data-role="wait"] .odd-live-cursor__aura,#' + LAYER_ID + '[data-role="progress"] .odd-live-cursor__aura{border-color:var(--odd-live-warm);background:color-mix(in srgb,var(--odd-live-warm) 10%,transparent);}' +
			'#' + LAYER_ID + '[data-role="not-allowed"] .odd-live-cursor__aura{border-color:var(--odd-live-spark);background:color-mix(in srgb,var(--odd-live-spark) 10%,transparent);}' +
			'#' + LAYER_ID + '[data-role="not-allowed"] .odd-live-cursor__slash{opacity:.88;animation:oddLiveCursorBite .48s ease-out;}' +
			'#' + LAYER_ID + '[data-soft="true"] .odd-live-cursor__spark,#' + LAYER_ID + '[data-soft="true"] .odd-live-cursor__wake,#' + LAYER_ID + '[data-soft="true"] .odd-live-cursor__orbit{display:none;}' +
			'#' + LAYER_ID + '[data-soft="true"] .odd-live-cursor__aura{box-shadow:none;background:color-mix(in srgb,var(--odd-live-accent) 6%,transparent);}' +
			'#' + LAYER_ID + '[data-recipe="signal-bloom"] .odd-live-cursor__aura{border-radius:999px;border-style:double;box-shadow:0 0 0 8px color-mix(in srgb,var(--odd-live-accent) 13%,transparent),0 0 0 18px color-mix(in srgb,var(--odd-live-accent) 7%,transparent);}' +
			'#' + LAYER_ID + '[data-recipe="signal-bloom"] .odd-live-cursor__wake{width:8px;height:8px;left:-4px;top:-4px;border-radius:2px;}' +
			'#' + LAYER_ID + '[data-recipe="signal-bloom"] .odd-live-cursor__vein{width:2px;background:repeating-linear-gradient(to bottom,var(--odd-live-accent) 0 4px,transparent 4px 7px);}' +
			'#' + LAYER_ID + '[data-recipe="gel-pop"] .odd-live-cursor__aura{width:34px;height:30px;left:-17px;top:-15px;border-radius:58% 42% 54% 46%;border-width:3px;box-shadow:0 0 0 7px color-mix(in srgb,var(--odd-live-accent) 10%,transparent);}' +
			'#' + LAYER_ID + '[data-recipe="gel-pop"] .odd-live-cursor__wake{width:18px;height:18px;left:-9px;top:-9px;border-radius:58% 42% 54% 46%;}' +
			'#' + LAYER_ID + '[data-recipe="gel-pop"] .odd-live-cursor__spark{border-radius:999px;}' +
			'#' + LAYER_ID + '[data-recipe="paper-sparks"] .odd-live-cursor__aura{border-radius:4px;transform:rotate(calc(var(--odd-cursor-pen-tilt) + 10deg)) scale(var(--odd-cursor-aura-scale));background:transparent;box-shadow:10px -8px 0 -5px var(--odd-live-spark),-9px 10px 0 -6px var(--odd-live-warm);}' +
			'#' + LAYER_ID + '[data-recipe="paper-sparks"] .odd-live-cursor__wake{border-radius:3px;transform:translate3d(var(--odd-wake-x),var(--odd-wake-y),0) rotate(12deg) scale(.78);}' +
			'#' + LAYER_ID + '[data-recipe="paper-sparks"] .odd-live-cursor__spark{border-radius:2px;border-width:0;background:var(--odd-live-spark);}' +
			'#' + LAYER_ID + '[data-recipe="solar-orbit"] .odd-live-cursor__aura{border-color:var(--odd-live-warm);box-shadow:0 0 0 6px color-mix(in srgb,var(--odd-live-warm) 14%,transparent),0 0 18px 4px color-mix(in srgb,var(--odd-live-warm) 22%,transparent);}' +
			'#' + LAYER_ID + '[data-recipe="solar-orbit"] .odd-live-cursor__orbit{opacity:.72;width:48px;height:48px;left:-24px;top:-24px;border-width:4px;}' +
			'#' + LAYER_ID + '[data-recipe="solar-orbit"] .odd-live-cursor__wake{width:20px;height:7px;left:-10px;top:-3px;border-radius:999px;}' +
			'#' + LAYER_ID + '[data-recipe="moonlight-focus"] .odd-live-cursor__aura{width:24px;height:24px;left:-12px;top:-12px;border-radius:999px;border-width:1px;box-shadow:0 0 0 10px color-mix(in srgb,var(--odd-live-accent) 6%,transparent);}' +
			'#' + LAYER_ID + '[data-recipe="moonlight-focus"] .odd-live-cursor__eye{width:4px;height:4px;left:-2px;top:-2px;box-shadow:0 0 0 2px var(--odd-live-accent);}' +
			'#' + LAYER_ID + '[data-recipe="moonlight-focus"] .odd-live-cursor__spark,#' + LAYER_ID + '[data-recipe="moonlight-focus"] .odd-live-cursor__wake{opacity:.42;}' +
			'@keyframes oddLiveCursorSpark{0%,100%{transform:rotate(45deg) translate3d(0,0,0) scale(.72);opacity:.25;}45%{transform:rotate(45deg) translate3d(2px,-3px,0) scale(1.08);opacity:.9;}}' +
			'@keyframes oddLiveCursorPulse{0%,100%{transform:scaleY(.65);opacity:.45;}50%{transform:scaleY(1.05);opacity:.9;}}' +
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
				layer.innerHTML = '<span class="odd-live-cursor__wake"></span><span class="odd-live-cursor__aura"></span><span class="odd-live-cursor__vein"></span><span class="odd-live-cursor__eye"></span><span class="odd-live-cursor__spark"></span><span class="odd-live-cursor__orbit"></span><span class="odd-live-cursor__slash"></span>';
				doc.body.appendChild( layer );
			}
			state.layer.el = layer;
			state.layer.doc = doc;
			state.layer.vars = {};
		}
		if ( ! state.layer.bound ) {
			state.layer.bound = true;
			try { doc.addEventListener( 'pointerleave', hideLiveCursorLayer, true ); } catch ( e ) {}
			try { doc.addEventListener( 'mouseleave', hideLiveCursorLayer, true ); } catch ( e ) {}
			try { window.addEventListener( 'blur', hideLiveCursorLayer, true ); } catch ( e ) {}
		}
		return state.layer.el;
	}

	function eventSample( event, usePredicted ) {
		var coalesced = [];
		var predicted = [];
		try {
			if ( event && typeof event.getCoalescedEvents === 'function' ) coalesced = event.getCoalescedEvents() || [];
		} catch ( e ) {}
		try {
			if ( usePredicted && event && typeof event.getPredictedEvents === 'function' ) predicted = event.getPredictedEvents() || [];
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

	function liveEventFrame( event ) {
		var mode = liveCursorMode();
		var sample = eventSample( event, liveCursorUsesPrediction() );
		return {
			type:        event && event.type || '',
			target:      event && event.target || null,
			sample:      sample,
			mode:        mode,
			pointerType: pointerTypeForEvent( event ),
			pressure:    event && typeof event.pressure === 'number' ? event.pressure : null,
			tiltX:       event && typeof event.tiltX === 'number' ? event.tiltX : 0,
			tiltY:       event && typeof event.tiltY === 'number' ? event.tiltY : 0,
			twist:       event && typeof event.twist === 'number' ? event.twist : 0,
			width:       event && typeof event.width === 'number' ? event.width : 0,
			height:      event && typeof event.height === 'number' ? event.height : 0,
			hasCoords:   !! ( event && typeof event.clientX === 'number' ),
		};
	}

	function updateLayerPressedFromEvent( event ) {
		var type = event && event.type || '';
		if ( type === 'pointerdown' || type === 'mousedown' ) state.layer.pressed = true;
		if ( type === 'pointerup' || type === 'pointercancel' || type === 'mouseup' ) state.layer.pressed = false;
	}

	function hideLiveCursorLayer() {
		if ( state.layer.el ) state.layer.el.setAttribute( 'data-visible', 'false' );
		state.layer.visible = false;
		state.layer.pressed = false;
		state.layer.pending = null;
		rememberLiveCursorResolved( null, [], null );
	}

	function captureDragPointer( event, resolved ) {
		if ( ! event || event.type !== 'pointerdown' || ! resolved ) return;
		if ( resolved.kind !== 'grab' && resolved.kind !== 'grabbing' && ! dragLike( resolved.node ) ) return;
		var target = resolved.target && resolved.target.setPointerCapture ? resolved.target : resolved.node;
		if ( ! target || typeof target.setPointerCapture !== 'function' || typeof event.pointerId === 'undefined' ) return;
		try { target.setPointerCapture( event.pointerId ); } catch ( e ) {}
	}

	function scheduleLiveCursorPaint() {
		if ( state.layer.queued ) return;
		state.layer.queued = true;
		var raf = window.requestAnimationFrame || function ( callback ) { return window.setTimeout( callback, 16 ); };
		raf( function () {
			var pending = state.layer.pending;
			state.layer.pending = null;
			state.layer.queued = false;
			if ( pending ) paintLiveCursorLayer( pending.frame, pending.resolved, pending.path );
		} );
	}

	function queueLiveCursorLayerUpdate( event, resolved, path ) {
		updateLayerPressedFromEvent( event );
		if ( ! event ) {
			hideLiveCursorLayer();
			return;
		}
		var frame = liveEventFrame( event );
		if ( ( event.type === 'pointermove' || event.type === 'mousemove' ) && state.layer.visible ) {
			state.layer.pending = { frame: frame, resolved: resolved, path: path || [] };
			scheduleLiveCursorPaint();
			return;
		}
		paintLiveCursorLayer( frame, resolved, path );
	}

	function round( value, places ) {
		var scale = places === 1 ? 10 : 100;
		return Math.round( value * scale ) / scale;
	}

	function px( value ) {
		return round( value, 1 ) + 'px';
	}

	function scalar( value ) {
		return String( round( value, 2 ) );
	}

	function setLayerVar( layer, name, value ) {
		value = String( value );
		if ( state.layer.vars && state.layer.vars[ name ] === value ) return;
		layer.style.setProperty( name, value );
		state.layer.vars[ name ] = value;
	}

	function setLayerAttr( layer, name, value ) {
		value = String( value );
		if ( layer.getAttribute( name ) !== value ) layer.setAttribute( name, value );
	}

	function paintLiveCursorLayer( frame, resolved, path ) {
		if ( ! resolved || ! frame ) {
			hideLiveCursorLayer();
			return;
		}
		if ( ! frame.hasCoords && ! /^(pointer|mouse)/.test( frame.type || '' ) ) return;
		if ( ! liveCursorAllowed( frame, resolved, path ) ) {
			hideLiveCursorLayer();
			return;
		}
		var sample = frame.sample;
		var doc = nodeDoc( resolved.target || resolved.node );
		var layer = ensureLiveCursorLayer( doc );
		if ( ! layer ) return;
		var now = ( window.performance && window.performance.now ) ? window.performance.now() : Date.now();
		var previousX = state.layer.time ? state.layer.x : sample.x;
		var previousY = state.layer.time ? state.layer.y : sample.y;
		var dx = sample.x - previousX;
		var dy = sample.y - previousY;
		var dt = Math.max( 8, now - ( state.layer.time || now ) );
		var velocity = Math.sqrt( dx * dx + dy * dy ) / dt;
		var speed = Math.max( 0, Math.min( 1, velocity / 1.15 ) );
		var role = resolved.kind || 'default';
		if ( state.layer.pressed && role === 'grab' ) role = 'grabbing';
		var soft = liveCursorSoftRole( role, resolved );
		var pressure = typeof frame.pressure === 'number' ? frame.pressure : ( state.layer.pressed ? 0.45 : 0 );
		var tiltX = frame.tiltX || 0;
		var tiltY = frame.tiltY || 0;
		var twist = frame.twist || 0;
		var width = frame.width || 0;
		var height = frame.height || 0;
		var contact = Math.max( 0, Math.min( 32, Math.max( width, height ) ) );
		var wakeX = Math.max( -22, Math.min( 22, previousX - sample.x ) ) * 0.55;
		var wakeY = Math.max( -22, Math.min( 22, previousY - sample.y ) ) * 0.55;
		var theme = liveCursorTheme();
		state.layer.trail[ 0 ] = { x: previousX, y: previousY };
		state.layer.x = sample.x;
		state.layer.y = sample.y;
		state.layer.time = now;
		state.layer.speed = speed;
		state.layer.role = role;
		state.layer.mode = frame.mode;
		state.layer.pointerType = frame.pointerType;
		state.layer.pressure = pressure;
		state.layer.tiltX = tiltX;
		state.layer.tiltY = tiltY;
		state.layer.twist = twist;
		state.layer.contact = contact;
		state.layer.coalesced = sample.coalesced;
		state.layer.predicted = sample.predicted;
		state.layer.recipe = theme.recipe;
		setLayerAttr( layer, 'data-visible', 'true' );
		setLayerAttr( layer, 'data-role', role );
		setLayerAttr( layer, 'data-recipe', theme.recipe );
		setLayerAttr( layer, 'data-mode', state.layer.mode );
		setLayerAttr( layer, 'data-pointer', state.layer.pointerType || 'mouse' );
		setLayerAttr( layer, 'data-pressed', state.layer.pressed ? 'true' : 'false' );
		setLayerAttr( layer, 'data-soft', soft ? 'true' : 'false' );
		setLayerVar( layer, '--odd-cursor-x', px( sample.x ) );
		setLayerVar( layer, '--odd-cursor-y', px( sample.y ) );
		setLayerVar( layer, '--odd-cursor-pen-tilt', round( tiltX * 0.18 + tiltY * 0.12 + twist * 0.02, 1 ) + 'deg' );
		setLayerVar( layer, '--odd-cursor-aura-scale', scalar( 0.98 + speed * 0.28 + pressure * 0.14 + contact * 0.005 ) );
		setLayerVar( layer, '--odd-cursor-eye-scale', scalar( 1 + pressure * 0.22 ) );
		setLayerVar( layer, '--odd-live-accent', theme.accent );
		setLayerVar( layer, '--odd-live-spark', theme.spark );
		setLayerVar( layer, '--odd-live-warm', theme.warm );
		setLayerVar( layer, '--odd-live-ink', theme.ink );
		setLayerVar( layer, '--odd-wake-x', px( wakeX ) );
		setLayerVar( layer, '--odd-wake-y', px( wakeY ) );
		setLayerVar( layer, '--odd-wake-opacity', scalar( 0.08 + speed * 0.22 ) );
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
		if ( ! target || ! target.addEventListener || target.__oddCursorController === controllerId ) return;
		target.__oddCursorController = controllerId;
		[ 'pointerover', 'pointerdown', 'pointerup', 'pointercancel', 'focusin', 'mouseover', 'mousedown', 'mouseup' ].forEach( function ( name ) {
			try { target.addEventListener( name, resolveAndApplyEvent, true ); } catch ( e ) {}
		} );
		try { target.addEventListener( 'pointermove', handleCursorMove, true ); } catch ( e ) {}
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
				enabled:     !! ( ( state.slug || configuredSlug() ) && liveCursorEnabledByConfig() && ! reducedMotion( document ) && finePointer( document ) ),
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
				recipe:      state.layer.recipe,
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
