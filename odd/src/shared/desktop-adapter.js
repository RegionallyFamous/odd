/**
 * ODD — Desktop Mode adapter (window.__odd.desktop)
 * ---------------------------------------------------------------
 * Single boundary for talking to WP Desktop Mode. Feature surfaces
 * should use this instead of reaching directly into `wp.desktop.*`
 * so capability checks, diagnostics, and host-version fallbacks stay
 * in one place.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	window.__odd = window.__odd || {};
	if ( window.__odd.desktop ) return;

	var NS = 'odd.desktop-adapter';
	var INSTALLED = [];

	function host() {
		return ( window.wp && window.wp.desktop ) || null;
	}

	function hooks() {
		var d = host();
		return ( d && d.hooks ) || ( window.wp && window.wp.hooks ) || null;
	}

	function diagnostics() {
		return window.__odd && window.__odd.diagnostics;
	}

	function record( level, label, payload ) {
		var d = diagnostics();
		if ( d && typeof d.record === 'function' ) {
			try { d.record( level || 'info', [ label, payload || {} ] ); } catch ( _ ) {}
		}
	}

	function events() {
		return window.__odd && window.__odd.events;
	}

	function emit( name, payload ) {
		var e = events();
		if ( e && typeof e.emit === 'function' ) {
			try { e.emit( name, payload || {} ); } catch ( _ ) {}
		}
	}

	function ready( cb ) {
		var d = host();
		if ( d && typeof d.ready === 'function' ) {
			d.ready( cb );
			return;
		}
		if ( d && typeof d.whenReady === 'function' ) {
			d.whenReady( cb );
			return;
		}
		if ( d && typeof d.isReady === 'function' && d.isReady() ) {
			cb();
			return;
		}
		if ( document && document.readyState === 'loading' ) {
			document.addEventListener( 'DOMContentLoaded', cb, { once: true } );
			return;
		}
		cb();
	}

	function normalizeFallbacks( fallback ) {
		if ( Array.isArray( fallback ) ) return fallback.slice();
		return fallback ? [ fallback ] : [];
	}

	function hookNames( key, fallback ) {
		var out = [];
		var d = host();
		function add( name ) {
			if ( name && out.indexOf( name ) === -1 ) out.push( name );
		}
		if ( key && d && d.HOOKS && d.HOOKS[ key ] ) {
			add( d.HOOKS[ key ] );
			return out;
		}
		normalizeFallbacks( fallback ).forEach( add );
		return out;
	}

	function addAction( name, cb, namespace ) {
		var h = hooks();
		if ( ! name || ! h || typeof h.addAction !== 'function' ) return function () {};
		var ns = namespace || NS;
		try {
			h.addAction( name, ns, cb );
			var off = function () {
				try { h.removeAction( name, ns ); } catch ( _ ) {}
			};
			INSTALLED.push( off );
			return off;
		} catch ( _ ) {
			return function () {};
		}
	}

	function addActionFor( key, fallback, cb, namespace ) {
		var offs = hookNames( key, fallback ).map( function ( name ) {
			return addAction( name, cb, namespace );
		} );
		return function () {
			offs.forEach( function ( off ) { try { off(); } catch ( _ ) {} } );
		};
	}

	function doAction( name ) {
		var h = hooks();
		if ( ! h || typeof h.doAction !== 'function' ) return false;
		var args = Array.prototype.slice.call( arguments, 1 );
		try {
			h.doAction.apply( h, [ name ].concat( args ) );
			return true;
		} catch ( _ ) {
			return false;
		}
	}

	function addFilter( name, cb, namespace ) {
		var h = hooks();
		if ( ! name || ! h || typeof h.addFilter !== 'function' ) return function () {};
		var ns = namespace || NS;
		try {
			h.addFilter( name, ns, cb );
			var off = function () {
				try { h.removeFilter( name, ns ); } catch ( _ ) {}
			};
			INSTALLED.push( off );
			return off;
		} catch ( _ ) {
			return function () {};
		}
	}

	function addFilterFor( key, fallback, cb, namespace ) {
		var offs = hookNames( key, fallback ).map( function ( name ) {
			return addFilter( name, cb, namespace );
		} );
		return function () {
			offs.forEach( function ( off ) { try { off(); } catch ( _ ) {} } );
		};
	}

	function applyFilters( name, value ) {
		var h = hooks();
		if ( ! h || typeof h.applyFilters !== 'function' ) return value;
		var args = Array.prototype.slice.call( arguments, 2 );
		try {
			return h.applyFilters.apply( h, [ name, value ].concat( args ) );
		} catch ( _ ) {
			return value;
		}
	}

	function addDomEvent( name, cb, target ) {
		target = target || document;
		if ( ! target || typeof target.addEventListener !== 'function' ) return function () {};
		target.addEventListener( name, cb );
		var off = function () {
			try { target.removeEventListener( name, cb ); } catch ( _ ) {}
		};
		INSTALLED.push( off );
		return off;
	}

	function addActivity( channel, cb ) {
		var d = host();
		if ( ! d || ! d.activity || typeof d.activity.subscribe !== 'function' ) return function () {};
		try {
			var off = d.activity.subscribe( channel, cb );
			if ( typeof off === 'function' ) {
				INSTALLED.push( off );
				return off;
			}
		} catch ( _ ) {}
		return function () {};
	}

	function callHost( method ) {
		var d = host();
		if ( ! d || typeof d[ method ] !== 'function' ) return undefined;
		var args = Array.prototype.slice.call( arguments, 1 );
		try {
			return d[ method ].apply( d, args );
		} catch ( err ) {
			record( 'warn', 'wp.desktop.' + method + '.failed', { message: err && err.message || '' } );
			return undefined;
		}
	}

	function rememberDisposer( value ) {
		if ( typeof value === 'function' ) {
			INSTALLED.push( value );
		}
		return value;
	}

	function registerWithHost( method, def, label ) {
		var d = host();
		if ( ! d || typeof d[ method ] !== 'function' ) return false;
		try {
			var result = d[ method ]( def );
			rememberDisposer( result );
			record( 'info', label || 'wp.desktop.' + method, { id: def && ( def.id || def.slug || def.label ) || '' } );
			return typeof result === 'undefined' ? true : result;
		} catch ( err ) {
			record( 'warn', ( label || 'wp.desktop.' + method ) + '.failed', { message: err && err.message || '' } );
			return false;
		}
	}

	function filesApi() {
		var d = host();
		return d && d.files || null;
	}

	function registerFileType( def ) {
		var f = filesApi();
		if ( ! f || typeof f.registerType !== 'function' ) return false;
		try {
			f.registerType( def );
			record( 'info', 'wp.desktop.files.registerType', { type: def && def.type || '' } );
			return true;
		} catch ( err ) {
			record( 'warn', 'wp.desktop.files.registerType.failed', { type: def && def.type || '', message: err && err.message || '' } );
			return false;
		}
	}

	function registerFileOpener( def ) {
		var f = filesApi();
		if ( ! f || typeof f.registerOpener !== 'function' ) return false;
		try {
			f.registerOpener( def );
			record( 'info', 'wp.desktop.files.registerOpener', { id: def && def.id || '' } );
			return true;
		} catch ( err ) {
			record( 'warn', 'wp.desktop.files.registerOpener.failed', { id: def && def.id || '', message: err && err.message || '' } );
			return false;
		}
	}

	function registerNamespace( name, api ) {
		var d = host();
		if ( ! d || typeof d.registerNamespace !== 'function' ) return false;
		try {
			d.registerNamespace( name, api );
			record( 'info', 'wp.desktop.registerNamespace', { name: name } );
			return true;
		} catch ( err ) {
			record( 'warn', 'wp.desktop.registerNamespace.failed', { name: name, message: err && err.message || '' } );
			return false;
		}
	}

	function showToast( message, opts ) {
		var d = host();
		if ( ! d || typeof d.showToast !== 'function' ) return false;
		opts = opts || {};
		try {
			d.showToast( {
				message: String( message || '' ),
				duration: typeof opts.duration === 'number' ? opts.duration : 2400,
				source: opts.source || 'odd',
				meta: opts.meta || { tone: opts.tone || 'odd-muse' },
				action: opts.action,
			} );
			return true;
		} catch ( _ ) {
			return false;
		}
	}

	function getWindow( id ) {
		var d = host();
		return d && d.windowManager && typeof d.windowManager.getById === 'function'
			? d.windowManager.getById( id )
			: null;
	}

	function openWindow( id, opts ) {
		var d = host();
		if ( ! d || typeof d.openWindow !== 'function' ) return false;
		try {
			d.openWindow( id, opts );
			return true;
		} catch ( err ) {
			record( 'warn', 'wp.desktop.openWindow.failed', { id: id || '', message: err && err.message || '' } );
			return false;
		}
	}

	function redockWidget( id ) {
		var d = host();
		if ( ! d || ! id ) return null;
		var api = null;
		if ( d.widgets && typeof d.widgets.redock === 'function' ) {
			api = { owner: d.widgets, fn: d.widgets.redock };
		} else if ( d.widgetLayer && typeof d.widgetLayer.redock === 'function' ) {
			api = { owner: d.widgetLayer, fn: d.widgetLayer.redock };
		} else if ( d.widgetLayer && typeof d.widgetLayer.redockWidget === 'function' ) {
			api = { owner: d.widgetLayer, fn: d.widgetLayer.redockWidget };
		}
		if ( ! api ) return null;
		try {
			return api.fn.call( api.owner, id );
		} catch ( err ) {
			record( 'warn', 'wp.desktop.widget.redock.failed', { id: id, message: err && err.message || '' } );
			return false;
		}
	}

	function mountWidget( id ) {
		var d = host();
		var layer = d && d.widgetLayer;
		if ( ! layer || ! id ) return false;
		try {
			if ( typeof layer.ensureMounted === 'function' ) {
				var ok = !! layer.ensureMounted( id );
				if ( ok && typeof layer.mountIfEnabled === 'function' ) {
					layer.mountIfEnabled( id );
				}
				return ok;
			}
			if ( typeof layer.add === 'function' ) {
				layer.add( id );
				return true;
			}
		} catch ( err ) {
			record( 'warn', 'wp.desktop.widget.mount.failed', { id: id, message: err && err.message || '' } );
		}
		return false;
	}

	function openOsSettings() {
		var d = host();
		if ( ! d ) return false;
		if ( typeof d.openOsSettings === 'function' ) {
			try { d.openOsSettings(); return true; } catch ( _ ) {}
		}
		if ( typeof d.getSystemTile === 'function' ) {
			try {
				var tile = d.getSystemTile( 'desktop-mode-os-settings' );
				if ( tile && typeof tile.onOpen === 'function' ) {
					tile.onOpen();
					return true;
				}
			} catch ( _ ) {}
		}
		return false;
	}

	function capabilities() {
		var d = host();
		var f = d && d.files || {};
		return {
			active: !! d,
			ready: !! ( d && ( typeof d.isReady !== 'function' || d.isReady() ) ),
			hooks: !! hooks(),
			commands: !! ( d && typeof d.registerCommand === 'function' ),
			palettes: !! ( d && typeof d.registerPalette === 'function' ),
			settingsTabs: !! ( d && typeof d.registerSettingsTab === 'function' ),
			titlebarButtons: !! ( d && typeof d.registerTitleBarButton === 'function' ),
			modules: !! ( d && typeof d.registerModule === 'function' && typeof d.loadModules === 'function' ),
			namespaces: !! ( d && typeof d.registerNamespace === 'function' ),
			windows: !! ( d && ( typeof d.registerWindow === 'function' || typeof d.openWindow === 'function' ) ),
			windowManager: !! ( d && d.windowManager ),
			widgets: !! ( d && d.widgetLayer ),
			widgetRedock: !! ( d && ( d.widgets && typeof d.widgets.redock === 'function' || d.widgetLayer && ( typeof d.widgetLayer.redock === 'function' || typeof d.widgetLayer.redockWidget === 'function' ) ) ),
			files: !! f,
			fileTypes: !! ( f && typeof f.registerType === 'function' ),
			fileOpeners: !! ( f && typeof f.registerOpener === 'function' ),
			fileTileMenus: !! hooks(),
			wallpaperMenus: !! hooks(),
			activity: !! ( d && d.activity && typeof d.activity.subscribe === 'function' ),
			toasts: !! ( d && typeof d.showToast === 'function' ),
			osSettings: !! ( d && ( typeof d.openOsSettings === 'function' || typeof d.getSystemTile === 'function' ) ),
		};
	}

	function snapshot() {
		var d = host();
		var caps = capabilities();
		return {
			capabilities: caps,
			settingsTabs: d && typeof d.listSettingsTabs === 'function' ? d.listSettingsTabs() : null,
			commands: d && typeof d.listCommands === 'function' ? d.listCommands() : null,
			palettes: d && typeof d.listPalettes === 'function' ? d.listPalettes() : null,
			fileTypes: d && d.files && typeof d.files.getTypes === 'function' ? d.files.getTypes() : null,
			fileOpeners: d && d.files && typeof d.files.getOpeners === 'function' ? d.files.getOpeners() : null,
		};
	}

	function uninstall() {
		while ( INSTALLED.length ) {
			try { INSTALLED.pop()(); } catch ( _ ) {}
		}
	}

	window.__odd.desktop = {
		version: '1.0.0',
		host: host,
		hooks: hooks,
		ready: ready,
		hookNames: hookNames,
		addAction: addAction,
		addActionFor: addActionFor,
		doAction: doAction,
		addFilter: addFilter,
		addFilterFor: addFilterFor,
		applyFilters: applyFilters,
		addDomEvent: addDomEvent,
		addActivity: addActivity,
		call: callHost,
		registerWindow: function ( def ) { return registerWithHost( 'registerWindow', def, 'wp.desktop.registerWindow' ); },
		openWindow: openWindow,
		registerCommand: function ( def ) { return registerWithHost( 'registerCommand', def, 'wp.desktop.registerCommand' ); },
		registerPalette: function ( def ) { return registerWithHost( 'registerPalette', def, 'wp.desktop.registerPalette' ); },
		registerSettingsTab: function ( def ) { return registerWithHost( 'registerSettingsTab', def, 'wp.desktop.registerSettingsTab' ); },
		registerTitleBarButton: function ( def ) { return registerWithHost( 'registerTitleBarButton', def, 'wp.desktop.registerTitleBarButton' ); },
		registerModule: function ( def ) { return registerWithHost( 'registerModule', def, 'wp.desktop.registerModule' ); },
		registerNamespace: registerNamespace,
		registerFileType: registerFileType,
		registerFileOpener: registerFileOpener,
		showToast: showToast,
		openOsSettings: openOsSettings,
		getWindow: getWindow,
		mountWidget: mountWidget,
		redockWidget: redockWidget,
		capabilities: capabilities,
		snapshot: snapshot,
		record: record,
		emit: emit,
		uninstall: uninstall,
	};
} )();
