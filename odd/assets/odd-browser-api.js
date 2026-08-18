(function () {
	'use strict';

	if (window.oddApp) {
		return;
	}

	var node = document.getElementById('odd-browser-api-config');
	if (!node) {
		return;
	}

	var config;
	try {
		config = JSON.parse(node.textContent || '{}');
	} catch (error) {
		throw new Error('ODD app runtime configuration is invalid.');
	}

	var restRoot = new URL(String(config.restRoot || ''), window.location.href);
	if (restRoot.origin !== window.location.origin) {
		throw new Error('ODD app REST root must be same-origin.');
	}
	if (restRoot.pathname.slice(-1) !== '/') {
		restRoot.pathname += '/';
	}

	function targetFor(path) {
		var raw = String(path || '').replace(/^\.\//, '');
		var target = new URL(raw, restRoot.href);
		if (
			target.origin !== restRoot.origin ||
			target.pathname.indexOf(restRoot.pathname) !== 0 ||
			target.username || target.password
		) {
			throw new Error('ODD app requests must stay beneath the WordPress REST root.');
		}
		return target;
	}

	async function request(path, init) {
		var target = targetFor(path);
		var options = Object.assign({}, init || {});
		var headers = new Headers(options.headers || {});
		var body = options.body;
		var nativeBody = typeof body === 'string' ||
			(typeof FormData !== 'undefined' && body instanceof FormData) ||
			(typeof Blob !== 'undefined' && body instanceof Blob) ||
			(typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
			(typeof ArrayBuffer !== 'undefined' && (body instanceof ArrayBuffer || ArrayBuffer.isView(body)));
		if (body !== undefined && body !== null && !nativeBody) {
			options.body = JSON.stringify(body);
			if (!headers.has('Content-Type')) {
				headers.set('Content-Type', 'application/json');
			}
		}
		headers.set('X-WP-Nonce', String(config.restNonce || ''));
		options.headers = headers;
		options.credentials = 'same-origin';
		var hostFetch = window.parent && window.parent.wp && window.parent.wp.os && window.parent.wp.os.fetch;
		var response = await (typeof hostFetch === 'function'
			? hostFetch.call(window.parent.wp.os, target.href, options)
			: window.fetch(target.href, options));
		var contentType = response.headers && response.headers.get('content-type') || '';
		var raw = response.status === 204 ? '' : await response.text();
		var payload = raw === '' ? null : (contentType.indexOf('json') !== -1 ? JSON.parse(raw) : raw);
		if (!response.ok) {
			var message = payload && payload.message ? payload.message : 'WordPress request failed (' + response.status + ').';
			var error = new Error(message);
			error.status = response.status;
			error.payload = payload;
			throw error;
		}
		return payload;
	}

	function segment(value) {
		var clean = String(value || '');
		if (!/^[a-z0-9-]{1,64}$/.test(clean)) {
			throw new Error('Storage segment must be a lowercase slug.');
		}
		return clean;
	}

	var storeRoot = 'odd/v1/apps/store/' + encodeURIComponent(String(config.slug || ''));
	var storage = Object.freeze({
		list: function () { return request(storeRoot); },
		get: async function (key) {
			var result = await request(storeRoot + '/' + encodeURIComponent(segment(key)));
			return result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : null;
		},
		set: async function (key, value) {
			var result = await request(storeRoot + '/' + encodeURIComponent(segment(key)), {
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ value: value })
			});
			return result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : value;
		},
		remove: function (key) {
			return request(storeRoot + '/' + encodeURIComponent(segment(key)), { method: 'DELETE' });
		},
		clear: function () { return request(storeRoot, { method: 'DELETE' }); }
	});

	function confirm(options) {
		var api = window.parent && window.parent.wp && window.parent.wp.os;
		if (!api || typeof api.confirm !== 'function') {
			return Promise.reject(new Error('OpenStation confirmation is unavailable.'));
		}
		return Promise.resolve(api.confirm(options || {}));
	}

	window.oddApp = Object.freeze({
		apiVersion: 1,
		slug: String(config.slug || ''),
		windowId: String(config.windowId || ''),
		restRoot: restRoot.href,
		restNonce: String(config.restNonce || ''),
		adminUrl: String(config.adminUrl || ''),
		request: request,
		confirm: confirm,
		storage: storage
	});
}());
