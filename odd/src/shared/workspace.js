/**
 * ODD workspace files (.odd)
 * ---------------------------------------------------------------
 * A .odd file is a small, portable JSON preset. It stores user
 * choices and catalog slugs, never executable bundle contents.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	window.__odd = window.__odd || {};
	if ( window.__odd.workspace ) return;

	var FORMAT = 'com.regionallyfamous.odd.workspace';
	var SCHEMA = 1;
	var MAX_BYTES = 512 * 1024;
	var SLUG_RE = /^[a-z0-9][a-z0-9-]{0,79}$/;
	var TYPES = {
		scene: true,
		'icon-set': true,
		'cursor-set': true,
		widget: true,
		app: true,
	};
	var TYPE_ALIASES = {
		wallpaper: 'scene',
		iconSet: 'icon-set',
		iconset: 'icon-set',
		icons: 'icon-set',
		cursorSet: 'cursor-set',
		cursors: 'cursor-set',
	};

	function cfg() {
		return window.odd || {};
	}

	function clone( value ) {
		if ( value === undefined || value === null ) return value;
		try {
			return JSON.parse( JSON.stringify( value ) );
		} catch ( e ) {
			if ( Array.isArray( value ) ) return value.slice();
			if ( typeof value === 'object' ) return Object.assign( {}, value );
			return value;
		}
	}

	function cleanString( value, max ) {
		if ( typeof value !== 'string' ) return '';
		var out = value.replace( /[\u0000-\u001f\u007f]/g, '' ).trim();
		if ( max && out.length > max ) out = out.slice( 0, max );
		return out;
	}

	function cleanSlug( value ) {
		value = cleanString( value, 96 ).toLowerCase();
		if ( value === 'none' || value === 'current' ) return value;
		return SLUG_RE.test( value ) ? value : '';
	}

	function cleanRealSlug( value ) {
		value = cleanSlug( value );
		return value && value !== 'none' && value !== 'current' ? value : '';
	}

	function cleanType( value ) {
		value = cleanString( value, 40 );
		value = TYPE_ALIASES[ value ] || value;
		return TYPES[ value ] ? value : '';
	}

	function uniqPush( list, value ) {
		if ( value && list.indexOf( value ) === -1 ) list.push( value );
	}

	function cleanSlugList( value, max ) {
		var out = [];
		if ( ! Array.isArray( value ) ) return out;
		for ( var i = 0; i < value.length; i++ ) {
			uniqPush( out, cleanRealSlug( value[ i ] ) );
			if ( max && out.length >= max ) break;
		}
		return out;
	}

	function cleanBool( value ) {
		return value === true || value === 1 || value === '1';
	}

	function cleanMinutes( value, fallback, min, max ) {
		var n = parseInt( value, 10 );
		if ( isNaN( n ) ) n = fallback;
		if ( n < min ) n = min;
		if ( n > max ) n = max;
		return n;
	}

	function cleanShuffle( value ) {
		if ( ! value || typeof value !== 'object' ) return null;
		return {
			enabled: cleanBool( value.enabled ),
			minutes: cleanMinutes( value.minutes, 15, 1, 240 ),
		};
	}

	function cleanScreensaver( value ) {
		if ( ! value || typeof value !== 'object' ) return null;
		var scene = cleanSlug( value.scene || 'current' );
		if ( ! scene ) scene = 'current';
		return {
			enabled: cleanBool( value.enabled ),
			minutes: cleanMinutes( value.minutes, 10, 1, 240 ),
			scene: scene,
		};
	}

	function cleanTheme( value ) {
		value = cleanString( value, 12 ).toLowerCase();
		return value === 'light' || value === 'dark' ? value : 'auto';
	}

	function normalizeWidgetId( value ) {
		value = cleanString( value, 96 );
		value = value.replace( /^odd\//, '' );
		return cleanRealSlug( value );
	}

	function enabledWidgetIds() {
		try {
			var layer = window.wp && window.wp.desktop && window.wp.desktop.widgetLayer;
			if ( layer && typeof layer.getEnabledIds === 'function' ) {
				return cleanSlugList( ( layer.getEnabledIds() || [] ).map( normalizeWidgetId ), 50 );
			}
		} catch ( e ) {}
		try {
			var raw = window.localStorage && window.localStorage.getItem( 'desktop-mode-widgets' );
			if ( ! raw ) return [];
			return cleanSlugList( JSON.parse( raw ).map( normalizeWidgetId ), 50 );
		} catch ( e2 ) {
			return [];
		}
	}

	function cleanContentItem( value ) {
		if ( ! value || typeof value !== 'object' ) return null;
		var type = cleanType( value.type || value.kind );
		var slug = cleanRealSlug( value.slug || value.id );
		if ( ! type || ! slug ) return null;
		return { type: type, slug: slug };
	}

	function contentKey( item ) {
		return item.type + ':' + item.slug;
	}

	function addContent( map, type, slug ) {
		type = cleanType( type );
		slug = cleanRealSlug( slug );
		if ( ! type || ! slug ) return;
		var item = { type: type, slug: slug };
		map[ contentKey( item ) ] = item;
	}

	function cleanContent( value ) {
		var map = {};
		if ( Array.isArray( value ) ) {
			for ( var i = 0; i < value.length; i++ ) {
				var item = cleanContentItem( value[ i ] );
				if ( item ) map[ contentKey( item ) ] = item;
			}
		}
		return Object.keys( map ).sort().map( function ( key ) { return map[ key ]; } );
	}

	function cleanPrefs( input ) {
		input = input && typeof input === 'object' ? input : {};
		var out = {};
		var wallpaper = cleanRealSlug( input.wallpaper || input.scene );
		if ( wallpaper ) out.wallpaper = wallpaper;
		if ( input.iconSet !== undefined ) {
			var iconSet = cleanSlug( input.iconSet );
			if ( iconSet || input.iconSet === '' ) out.iconSet = iconSet === 'none' ? '' : iconSet;
		}
		if ( input.cursorSet !== undefined ) {
			var cursorSet = cleanSlug( input.cursorSet );
			if ( cursorSet || input.cursorSet === '' ) out.cursorSet = cursorSet === 'none' ? '' : cursorSet;
		}
		if ( input.theme !== undefined ) out.theme = cleanTheme( input.theme );
		if ( input.chaosMode !== undefined ) out.chaosMode = cleanBool( input.chaosMode );
		if ( input.audioReactive !== undefined ) out.audioReactive = cleanBool( input.audioReactive );
		if ( input.shopTaskbar !== undefined ) out.shopTaskbar = cleanBool( input.shopTaskbar );
		if ( input.shopDesktopPinned !== undefined ) out.shopDesktopPinned = cleanBool( input.shopDesktopPinned );
		if ( input.shuffle !== undefined ) {
			var shuffle = cleanShuffle( input.shuffle );
			if ( shuffle ) out.shuffle = shuffle;
		}
		if ( input.screensaver !== undefined ) {
			var screensaver = cleanScreensaver( input.screensaver );
			if ( screensaver ) out.screensaver = screensaver;
		}
		if ( input.favorites !== undefined ) out.favorites = cleanSlugList( input.favorites, 24 );
		if ( input.recents !== undefined ) out.recents = cleanSlugList( input.recents, 24 );
		if ( input.appsPinned !== undefined ) out.appsPinned = cleanSlugList( input.appsPinned, 50 );
		return out;
	}

	function widgetIdsFromPayload( payload ) {
		var widgets = payload && payload.desktop && payload.desktop.widgets;
		var raw = widgets && Array.isArray( widgets.enabled ) ? widgets.enabled : [];
		return cleanSlugList( raw.map( normalizeWidgetId ), 50 );
	}

	function appsPinnedFromConfig( c ) {
		var userApps = c.userApps || {};
		var pinned = Array.isArray( userApps.pinned ) ? userApps.pinned : [];
		return cleanSlugList( pinned, 50 );
	}

	function exportData( options ) {
		options = options || {};
		var c = cfg();
		var widgets = enabledWidgetIds();
		var appsPinned = appsPinnedFromConfig( c );
		var prefs = cleanPrefs( {
			wallpaper: stateValue( c, 'wallpaper', 'scene' ),
			iconSet: c.iconSet || '',
			cursorSet: c.cursorSet || '',
			theme: c.theme || 'auto',
			chaosMode: c.chaosMode,
			shuffle: c.shuffle,
			screensaver: c.screensaver,
			audioReactive: c.audioReactive,
			shopTaskbar: c.shopTaskbar,
			shopDesktopPinned: c.shopDesktopPinned,
			favorites: c.favorites,
			recents: c.recents,
			appsPinned: appsPinned,
		} );
		var content = {};
		addContent( content, 'scene', prefs.wallpaper );
		if ( prefs.screensaver && prefs.screensaver.scene !== 'current' ) {
			addContent( content, 'scene', prefs.screensaver.scene );
		}
		( prefs.favorites || [] ).forEach( function ( slug ) { addContent( content, 'scene', slug ); } );
		( prefs.recents || [] ).forEach( function ( slug ) { addContent( content, 'scene', slug ); } );
		addContent( content, 'icon-set', prefs.iconSet );
		addContent( content, 'cursor-set', prefs.cursorSet );
		widgets.forEach( function ( slug ) { addContent( content, 'widget', slug ); } );
		appsPinned.forEach( function ( slug ) { addContent( content, 'app', slug ); } );
		return {
			format: FORMAT,
			schema: SCHEMA,
			name: cleanString( options.name || 'ODD Workspace', 80 ) || 'ODD Workspace',
			exportedAt: new Date().toISOString(),
			source: {
				oddVersion: cleanString( c.version || '', 40 ),
			},
			prefs: prefs,
			desktop: {
				widgets: { enabled: widgets.map( function ( slug ) { return 'odd/' + slug; } ) },
				apps: { pinned: appsPinned },
			},
			content: Object.keys( content ).sort().map( function ( key ) { return content[ key ]; } ),
		};
	}

	function stateValue( object, primary, fallback ) {
		return object && ( object[ primary ] || object[ fallback ] || '' );
	}

	function validate( payload ) {
		if ( ! payload || typeof payload !== 'object' ) {
			throw new Error( 'That is not an ODD workspace file.' );
		}
		if ( payload.format !== FORMAT ) {
			throw new Error( 'That .odd file is not an ODD workspace.' );
		}
		if ( parseInt( payload.schema, 10 ) !== SCHEMA ) {
			throw new Error( 'This ODD workspace format is not supported yet.' );
		}
		var prefs = cleanPrefs( payload.prefs || {} );
		var desktop = {
			widgets: { enabled: widgetIdsFromPayload( payload ).map( function ( slug ) { return 'odd/' + slug; } ) },
			apps: {
				pinned: cleanSlugList(
					payload.desktop && payload.desktop.apps ? payload.desktop.apps.pinned : [],
					50
				),
			},
		};
		if ( ! prefs.appsPinned && desktop.apps.pinned.length ) {
			prefs.appsPinned = desktop.apps.pinned.slice();
		}
		var contentMap = {};
		cleanContent( payload.content ).forEach( function ( item ) {
			contentMap[ contentKey( item ) ] = item;
		} );
		addContent( contentMap, 'scene', prefs.wallpaper );
		if ( prefs.screensaver && prefs.screensaver.scene !== 'current' ) {
			addContent( contentMap, 'scene', prefs.screensaver.scene );
		}
		( prefs.favorites || [] ).forEach( function ( slug ) { addContent( contentMap, 'scene', slug ); } );
		( prefs.recents || [] ).forEach( function ( slug ) { addContent( contentMap, 'scene', slug ); } );
		addContent( contentMap, 'icon-set', prefs.iconSet );
		addContent( contentMap, 'cursor-set', prefs.cursorSet );
		widgetIdsFromPayload( payload ).forEach( function ( slug ) { addContent( contentMap, 'widget', slug ); } );
		( prefs.appsPinned || desktop.apps.pinned || [] ).forEach( function ( slug ) { addContent( contentMap, 'app', slug ); } );

		return {
			format: FORMAT,
			schema: SCHEMA,
			name: cleanString( payload.name || 'ODD Workspace', 80 ) || 'ODD Workspace',
			exportedAt: cleanString( payload.exportedAt || '', 40 ),
			source: clone( payload.source || {} ) || {},
			prefs: prefs,
			desktop: desktop,
			content: Object.keys( contentMap ).sort().map( function ( key ) { return contentMap[ key ]; } ),
		};
	}

	function parseText( text ) {
		var raw = cleanString( text || '', MAX_BYTES + 1 );
		if ( raw.length > MAX_BYTES ) throw new Error( 'That .odd file is too large.' );
		try {
			return validate( JSON.parse( raw ) );
		} catch ( e ) {
			if ( e && e.message && /ODD workspace|supported|large/.test( e.message ) ) throw e;
			throw new Error( 'That .odd file could not be read.' );
		}
	}

	function readFile( file ) {
		return new Promise( function ( resolve, reject ) {
			if ( ! file ) { reject( new Error( 'Choose a .odd workspace file.' ) ); return; }
			if ( ! /\.odd$/i.test( file.name || '' ) ) {
				reject( new Error( 'Choose a .odd workspace file.' ) );
				return;
			}
			if ( typeof file.size === 'number' && file.size > MAX_BYTES ) {
				reject( new Error( 'That .odd file is too large.' ) );
				return;
			}
			if ( typeof file.text === 'function' ) {
				file.text().then( function ( text ) {
					resolve( parseText( text ) );
				}, reject );
				return;
			}
			var reader = new FileReader();
			reader.onload = function () {
				try { resolve( parseText( String( reader.result || '' ) ) ); } catch ( e ) { reject( e ); }
			};
			reader.onerror = function () { reject( new Error( 'That .odd file could not be read.' ) ); };
			reader.readAsText( file );
		} );
	}

	function requiredContent( payload ) {
		return validate( payload ).content;
	}

	function buildPrefsPatch( payload ) {
		var prefs = validate( payload ).prefs;
		var out = {};
		Object.keys( prefs ).forEach( function ( key ) {
			out[ key ] = clone( prefs[ key ] );
		} );
		return out;
	}

	function filenameFor( payload ) {
		var base = cleanString( payload && payload.name ? payload.name : 'odd-workspace', 80 )
			.toLowerCase()
			.replace( /[^a-z0-9]+/g, '-' )
			.replace( /^-+|-+$/g, '' );
		if ( ! base ) base = 'odd-workspace';
		return base + '.odd';
	}

	function download( payload, filename ) {
		var workspace = validate( payload || exportData() );
		var blob = new Blob( [ JSON.stringify( workspace, null, 2 ) + '\n' ], {
			type: 'application/json',
		} );
		var url = URL.createObjectURL( blob );
		var a = document.createElement( 'a' );
		a.href = url;
		a.download = filename || filenameFor( workspace );
		a.rel = 'noopener';
		document.body.appendChild( a );
		a.click();
		setTimeout( function () {
			try { URL.revokeObjectURL( url ); } catch ( e ) {}
			if ( a.parentNode ) a.parentNode.removeChild( a );
		}, 0 );
		return workspace;
	}

	window.__odd.workspace = {
		version: '1.0.0',
		format: FORMAT,
		schema: SCHEMA,
		extension: '.odd',
		maxBytes: MAX_BYTES,
		exportData: exportData,
		download: download,
		parseText: parseText,
		readFile: readFile,
		validate: validate,
		requiredContent: requiredContent,
		buildPrefsPatch: buildPrefsPatch,
		widgetIds: function ( payload ) { return widgetIdsFromPayload( validate( payload ) ); },
		sanitizeSlug: cleanSlug,
	};
} )();
