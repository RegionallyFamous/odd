( () => {
	'use strict';

	const APP_SLUG = 'revision-room';
	const MAX_PAGES = 20;
	const MAX_DIFF_LINES = 350;
	const VALID_TYPES = new Set( [ 'all', 'posts', 'pages' ] );
	const state = {
		documents: [],
		selectedKey: '',
		revisions: [],
		selectedRevisionId: 0,
		query: '',
		typeFilter: 'all',
		field: 'title',
		loadingDocuments: false,
		loadingRevisions: false,
		busy: false,
	};
	const dom = {};
	let runtime;
	let readController = null;
	let revisionController = null;
	let readSequence = 0;
	let revisionSequence = 0;
	let mutationQueue = Promise.resolve();
	let preferenceQueue = Promise.resolve();
	let toastTimer = 0;
	let disposed = false;

	class AppError extends Error {
		constructor( message, status = 500, code = '' ) {
			super( message );
			this.name = 'RevisionRoomError';
			this.status = Number( status ) || 500;
			this.code = String( code || '' );
		}
	}

	function cacheDom() {
		[
			'workspace', 'document-search', 'refresh-documents', 'global-notice',
			'document-count', 'type-filter', 'partial-warning', 'document-list',
			'document-empty', 'document-error', 'document-error-copy', 'retry-documents',
			'revision-count', 'revision-list', 'revision-empty', 'revision-error',
			'revision-error-copy', 'retry-revisions', 'comparison-meta', 'field-tabs',
			'diff-output', 'diff-empty', 'diff-too-large', 'restore-revision', 'toast',
		].forEach( ( id ) => { dom[ id ] = document.getElementById( id ); } );
	}

	function requireRuntime() {
		const candidate = window.oddApp;
		if (
			! candidate || candidate.apiVersion !== 1 || candidate.slug !== APP_SLUG ||
			typeof candidate.request !== 'function' || typeof candidate.confirm !== 'function' ||
			! candidate.storage || typeof candidate.storage.get !== 'function' ||
			typeof candidate.storage.set !== 'function'
		) {
			throw new AppError( 'ODD Revision Room needs the ODD app runtime v1. Update ODD, then reopen this app.', 500, 'odd_runtime_unavailable' );
		}
		return candidate;
	}

	async function api( path, options = {} ) {
		try {
			return await runtime.request( path, options );
		} catch ( error ) {
			if ( error?.name === 'AbortError' ) throw error;
			throw new AppError(
				error?.message || error?.payload?.message || 'WordPress request failed.',
				error?.status || error?.payload?.data?.status || 500,
				error?.code || error?.payload?.code || ''
			);
		}
	}

	function errorMessage( error, fallback ) {
		if ( /nonce|rest_cookie_invalid_nonce/i.test( `${ error?.code } ${ error?.message }` ) ) return 'WordPress could not verify this request. Refresh the app and try again.';
		if ( error?.status === 401 ) return 'Your WordPress session has expired. Sign in again, then retry.';
		if ( error?.status === 403 ) return 'WordPress denied this action. Your account may not have permission.';
		if ( error?.status === 404 ) return 'That WordPress item no longer exists. Refresh to continue.';
		return error?.message || fallback;
	}

	function readEnvelope( response, label ) {
		const plainHeaders = Object.prototype.toString.call( response?.headers ) === '[object Object]';
		const emptyHeaderList = Array.isArray( response?.headers ) && response.headers.length === 0;
		if ( ! response || typeof response !== 'object' || Array.isArray( response ) || ! Object.hasOwn( response, 'body' ) || ! Object.hasOwn( response, 'status' ) || ( ! plainHeaders && ! emptyHeaderList ) ) {
			throw new AppError( `WordPress returned an unexpected ${ label } envelope.` );
		}
		const status = Number( response.status );
		if ( ! Number.isInteger( status ) || status < 100 || status > 599 ) throw new AppError( `WordPress returned an unexpected ${ label } envelope.` );
		if ( status < 200 || status >= 300 ) {
			const body = response.body && typeof response.body === 'object' && ! Array.isArray( response.body ) ? response.body : {};
			throw new AppError( body.message || `WordPress request failed with status ${ status }.`, status, body.code || '' );
		}
		return emptyHeaderList ? { ...response,headers:{} } : response;
	}

	function showNotice( message = '' ) {
		dom[ 'global-notice' ].hidden = ! message;
		dom[ 'global-notice' ].textContent = message;
	}

	function toast( message, isError = false ) {
		window.clearTimeout( toastTimer );
		dom.toast.textContent = message;
		dom.toast.classList.toggle( 'is-error', isError );
		dom.toast.classList.add( 'is-visible' );
		toastTimer = window.setTimeout( () => dom.toast.classList.remove( 'is-visible' ), 4200 );
	}

	function titleOf( item ) {
		return String( item?.title?.raw || item?.title?.rendered || 'Untitled' ).replace( /<[^>]*>/g, '' ).trim() || 'Untitled';
	}

	function wpGmtDate( value ) {
		const raw = String( value || '' );
		return new Date( raw && ! /(?:Z|[+-]\d\d:\d\d)$/.test( raw ) ? `${ raw }Z` : raw );
	}

	function modifiedDate( item ) { return item?.modified_gmt ? wpGmtDate( item.modified_gmt ) : new Date( item?.modified || '' ); }

	function stampOf( item ) {
		const raw = String( item?.modified_gmt || item?.modified || '' );
		const date = modifiedDate( item );
		return Number.isNaN( date.getTime() ) ? raw : date.toISOString();
	}

	function typeLabel( type ) { return type === 'pages' ? 'Page' : 'Post'; }
	function keyOf( item ) { return `${ item.oddType }:${ Number( item.id ) }`; }
	function selectedDocument() { return state.documents.find( ( item ) => keyOf( item ) === state.selectedKey ) || null; }
	function selectedRevision() { return state.revisions.find( ( item ) => Number( item.id ) === state.selectedRevisionId ) || null; }

	function formatDate( value, gmt = false ) {
		const date = gmt ? wpGmtDate( value ) : new Date( value || '' );
		return Number.isNaN( date.getTime() ) ? 'Date unavailable' : new Intl.DateTimeFormat( undefined, { dateStyle: 'medium', timeStyle: 'short' } ).format( date );
	}

	function headerNumber( headers, name ) {
		if ( ! headers ) return 0;
		const wanted = name.toLowerCase();
		for ( const [ key, value ] of Object.entries( headers ) ) {
			if ( key.toLowerCase() === wanted ) return Number( value ) || 0;
		}
		return 0;
	}

	async function loadType( type, signal ) {
		const rows = [];
		let page = 1;
		let totalPages = 1;
		let capped = false;
		do {
			const query = new URLSearchParams( {
				context: 'edit', per_page: '100', page: String( page ),
				orderby: 'modified', order: 'desc', _envelope: '1',
			} );
			[ 'publish', 'future', 'draft', 'pending', 'private' ].forEach( ( status ) => query.append( 'status[]', status ) );
			const response = readEnvelope( await api( `wp/v2/${ type }?${ query }`, { signal } ), `${ type } response` );
			if ( ! Array.isArray( response?.body ) ) throw new AppError( `WordPress returned an unexpected ${ type } response.` );
			rows.push( ...response.body.map( ( row ) => ( { ...row, oddType: type } ) ) );
			const actualPages = Math.max( 1, headerNumber( response.headers, 'x-wp-totalpages' ) || 1 );
			capped = actualPages > MAX_PAGES;
			totalPages = Math.min( MAX_PAGES, actualPages );
			page++;
		} while ( page <= totalPages );
		return { type, rows, capped };
	}

	async function loadPreferences() {
		try {
			const value = await runtime.storage.get( 'preferences' );
			if ( value && typeof value === 'object' && VALID_TYPES.has( value.typeFilter ) ) {
				state.typeFilter = value.typeFilter;
				const input = dom[ 'type-filter' ].querySelector( `input[value="${ state.typeFilter }"]` );
				if ( input ) input.checked = true;
			}
		} catch ( error ) {
			showNotice( `View preference could not be loaded: ${ errorMessage( error, 'storage unavailable' ) }` );
		}
	}

	function savePreferences() {
		const snapshot = { typeFilter: state.typeFilter };
		preferenceQueue = preferenceQueue.then( () => runtime.storage.set( 'preferences', snapshot ) ).catch( ( error ) => {
			showNotice( `View preference could not be saved: ${ errorMessage( error, 'storage unavailable' ) }` );
		} );
	}

	function filteredDocuments() {
		const words = state.query.toLocaleLowerCase().split( /\s+/ ).filter( Boolean );
		return state.documents.filter( ( item ) => {
			if ( state.typeFilter !== 'all' && item.oddType !== state.typeFilter ) return false;
			const haystack = `${ titleOf( item ) } ${ item.status || '' } ${ typeLabel( item.oddType ) }`.toLocaleLowerCase();
			return words.every( ( word ) => haystack.includes( word ) );
		} );
	}

	function restoreListFocus( key ) {
		if ( ! key ) return;
		const target = [ ...dom[ 'document-list' ].querySelectorAll( '[data-document-key]' ) ].find( ( button ) => button.dataset.documentKey === key );
		target?.focus( { preventScroll: true } );
	}

	function renderDocuments() {
		const focusedKey = document.activeElement?.dataset?.documentKey || '';
		const items = filteredDocuments();
		dom[ 'document-list' ].replaceChildren();
		for ( const item of items ) {
			const button = document.createElement( 'button' );
			button.type = 'button';
			button.className = 'document-item';
			button.dataset.documentKey = keyOf( item );
			button.setAttribute( 'aria-pressed', keyOf( item ) === state.selectedKey ? 'true' : 'false' );
			button.setAttribute( 'aria-label', `${ titleOf( item ) }, ${ typeLabel( item.oddType ) }, ${ item.status || 'unknown status' }` );
			const top = document.createElement( 'span' ); top.className = 'item-top';
			const strong = document.createElement( 'strong' ); strong.textContent = titleOf( item );
			const chip = document.createElement( 'span' ); chip.className = 'type-chip'; chip.textContent = typeLabel( item.oddType );
			top.append( strong, chip );
			const small = document.createElement( 'small' ); small.textContent = `${ item.status || 'unknown' } · ${ item.modified_gmt ? formatDate( item.modified_gmt, true ) : formatDate( item.modified ) }`;
			const listItem = document.createElement( 'li' ); button.append( top, small ); listItem.appendChild( button ); dom[ 'document-list' ].appendChild( listItem );
		}
		dom[ 'document-count' ].textContent = state.loadingDocuments ? 'Loading…' : `${ items.length } of ${ state.documents.length }`;
		dom[ 'document-empty' ].hidden = state.loadingDocuments || items.length > 0 || ! dom[ 'document-error' ].hidden;
		if ( focusedKey ) restoreListFocus( focusedKey );
	}

	function renderRevisions() {
		const focusedRevisionId = document.activeElement?.dataset?.revisionId || '';
		dom[ 'revision-list' ].replaceChildren();
		for ( const revision of state.revisions ) {
			const button = document.createElement( 'button' );
			button.type = 'button'; button.className = 'revision-item'; button.dataset.revisionId = String( revision.id );
			button.setAttribute( 'aria-pressed', Number( revision.id ) === state.selectedRevisionId ? 'true' : 'false' );
			const top = document.createElement( 'span' ); top.className = 'item-top';
			const strong = document.createElement( 'strong' ); strong.textContent = revision.date_gmt ? formatDate( revision.date_gmt, true ) : formatDate( revision.date );
			const chip = document.createElement( 'span' ); chip.className = 'status-chip'; chip.textContent = Number( revision.id ) === state.selectedRevisionId ? 'Comparing' : 'Saved';
			top.append( strong, chip );
			const small = document.createElement( 'small' ); small.className = 'revision-person'; small.textContent = revision?._embedded?.author?.[ 0 ]?.name || revision.author_name || 'Author unavailable';
			const listItem = document.createElement( 'li' ); button.append( top, small ); listItem.appendChild( button ); dom[ 'revision-list' ].appendChild( listItem );
		}
		dom[ 'revision-count' ].textContent = state.loadingRevisions ? 'Loading…' : String( state.revisions.length );
		const noDoc = ! selectedDocument();
		dom[ 'revision-empty' ].hidden = state.loadingRevisions || state.revisions.length > 0 || ! dom[ 'revision-error' ].hidden;
		if ( ! state.loadingRevisions && state.revisions.length === 0 && ! noDoc ) {
			dom[ 'revision-empty' ].querySelector( 'strong' ).textContent = 'No earlier revisions';
			dom[ 'revision-empty' ].querySelector( 'p' ).textContent = 'WordPress has not saved another version of this document yet.';
		} else if ( noDoc ) {
			dom[ 'revision-empty' ].querySelector( 'strong' ).textContent = 'Choose a document';
			dom[ 'revision-empty' ].querySelector( 'p' ).textContent = 'Its saved WordPress revisions will appear here.';
		}
		if ( focusedRevisionId ) {
			const target = [ ...dom[ 'revision-list' ].querySelectorAll( '[data-revision-id]' ) ].find( ( button ) => button.dataset.revisionId === focusedRevisionId );
			target?.focus( { preventScroll: true } );
		}
	}

	function fieldValue( item, field ) {
		if ( ! item ) return '';
		const value = item[ field ];
		if ( value && typeof value === 'object' ) return String( value.raw ?? value.rendered ?? '' );
		return String( value ?? '' );
	}

	function splitLines( value ) {
		const normalized = String( value ).replace( /\r\n?/g, '\n' );
		return normalized === '' ? [ '' ] : normalized.split( '\n' );
	}

	function lcsDiff( before, after ) {
		const rows = Array.from( { length: before.length + 1 }, () => new Uint16Array( after.length + 1 ) );
		for ( let i = before.length - 1; i >= 0; i-- ) {
			for ( let j = after.length - 1; j >= 0; j-- ) rows[ i ][ j ] = before[ i ] === after[ j ] ? rows[ i + 1 ][ j + 1 ] + 1 : Math.max( rows[ i + 1 ][ j ], rows[ i ][ j + 1 ] );
		}
		const output = [];
		let i = 0; let j = 0;
		while ( i < before.length || j < after.length ) {
			if ( i < before.length && j < after.length && before[ i ] === after[ j ] ) { output.push( { type: 'same', text: before[ i ] } ); i++; j++; }
			else if ( j < after.length && ( i === before.length || rows[ i ][ j + 1 ] >= rows[ i + 1 ][ j ] ) ) { output.push( { type: 'added', text: after[ j++ ] } ); }
			else { output.push( { type: 'removed', text: before[ i++ ] } ); }
		}
		return output;
	}

	function renderComparison() {
		const documentItem = selectedDocument();
		const revision = selectedRevision();
		dom[ 'diff-output' ].replaceChildren();
		dom[ 'diff-too-large' ].hidden = true;
		const ready = Boolean( documentItem && revision );
		dom[ 'restore-revision' ].disabled = ! ready || state.busy;
		if ( ! ready ) {
			dom[ 'diff-empty' ].hidden = false;
			dom[ 'comparison-meta' ].textContent = documentItem ? 'This document has no selected earlier revision.' : 'Select a document and revision to compare.';
			return;
		}
		dom[ 'diff-empty' ].hidden = true;
		dom[ 'comparison-meta' ].textContent = `${ titleOf( documentItem ) } · ${ revision.date_gmt ? formatDate( revision.date_gmt, true ) : formatDate( revision.date ) } compared with current`;
		const before = splitLines( fieldValue( revision, state.field ) );
		const after = splitLines( fieldValue( documentItem, state.field ) );
		if ( before.length > MAX_DIFF_LINES || after.length > MAX_DIFF_LINES ) {
			dom[ 'diff-too-large' ].hidden = false;
			return;
		}
		let line = 0;
		for ( const row of lcsDiff( before, after ) ) {
			const element = document.createElement( 'div' ); element.className = `diff-row diff-row--${ row.type }`;
			const marker = document.createElement( 'span' ); marker.textContent = row.type === 'same' ? String( ++line ) : row.type === 'added' ? '+' : '−';
			if ( row.type === 'added' ) line++;
			const text = document.createElement( 'span' ); text.textContent = row.text || ' ';
			element.append( marker, text ); dom[ 'diff-output' ].appendChild( element );
		}
	}

	async function refreshDocuments( announce = false ) {
		readController?.abort();
		readController = new AbortController();
		const sequence = ++readSequence;
		state.loadingDocuments = true;
		dom.workspace.setAttribute( 'aria-busy', 'true' );
		dom[ 'document-error' ].hidden = true;
		dom[ 'partial-warning' ].hidden = true;
		renderDocuments();
		const results = await Promise.allSettled( [ loadType( 'posts', readController.signal ), loadType( 'pages', readController.signal ) ] );
		if ( disposed || sequence !== readSequence ) return;
		const failures = [];
		const succeededTypes = new Set();
		let next = [];
		let capped = false;
		for ( const result of results ) {
			if ( result.status === 'fulfilled' ) {
				succeededTypes.add( result.value.type ); next.push( ...result.value.rows ); capped ||= result.value.capped;
			} else if ( result.reason?.name !== 'AbortError' ) failures.push( result.reason );
		}
		for ( const type of [ 'posts', 'pages' ] ) if ( ! succeededTypes.has( type ) ) next.push( ...state.documents.filter( ( item ) => item.oddType === type ) );
		if ( succeededTypes.size ) {
			state.documents = next.sort( ( a, b ) => modifiedDate( b ) - modifiedDate( a ) );
			if ( state.selectedKey && ! selectedDocument() ) state.selectedKey = '';
			if ( ! state.selectedKey && state.documents.length ) state.selectedKey = keyOf( state.documents[ 0 ] );
		}
		state.loadingDocuments = false;
		dom.workspace.setAttribute( 'aria-busy', 'false' );
		if ( ! succeededTypes.size ) {
			dom[ 'document-error' ].hidden = false;
			dom[ 'document-error-copy' ].textContent = errorMessage( failures[ 0 ], 'WordPress returned an unexpected response.' );
		} else if ( failures.length || capped ) {
			dom[ 'partial-warning' ].hidden = false;
			dom[ 'partial-warning' ].textContent = failures.length ? `Showing the document type WordPress returned. Another type could not be loaded: ${ errorMessage( failures[ 0 ], 'WordPress returned an unexpected response.' ) }` : `Showing the first ${ MAX_PAGES * 100 } items per type. Narrow your search if a document is missing.`;
		}
		renderDocuments();
		if ( selectedDocument() ) await loadRevisions(); else { state.revisions = []; state.selectedRevisionId = 0; renderRevisions(); renderComparison(); }
		if ( announce && succeededTypes.size ) toast( 'Documents refreshed from WordPress.' );
	}

	async function loadRevisions() {
		revisionController?.abort();
		revisionController = new AbortController();
		const sequence = ++revisionSequence;
		const documentItem = selectedDocument();
		state.revisions = []; state.selectedRevisionId = 0;
		dom[ 'revision-error' ].hidden = true;
		if ( ! documentItem ) { state.loadingRevisions = false; renderRevisions(); renderComparison(); return; }
		state.loadingRevisions = true; renderRevisions(); renderComparison();
		try {
			const query = new URLSearchParams( { context: 'edit', per_page: '100', _embed: 'author', _envelope: '1' } );
			const response = readEnvelope( await api( `wp/v2/${ documentItem.oddType }/${ documentItem.id }/revisions?${ query }`, { signal: revisionController.signal } ), 'revisions response' );
			if ( ! Array.isArray( response?.body ) ) throw new AppError( 'WordPress returned an unexpected revisions response.' );
			if ( disposed || sequence !== revisionSequence || keyOf( selectedDocument() || {} ) !== keyOf( documentItem ) ) return;
			state.revisions = response.body;
			state.selectedRevisionId = Number( state.revisions[ 0 ]?.id ) || 0;
			const totalPages = headerNumber( response.headers, 'x-wp-totalpages' );
			if ( totalPages > 1 ) showNotice( 'Only the newest 100 revisions are shown for this document.' );
		} catch ( error ) {
			if ( error?.name === 'AbortError' || sequence !== revisionSequence ) return;
			dom[ 'revision-error' ].hidden = false;
			dom[ 'revision-error-copy' ].textContent = errorMessage( error, 'Revisions could not be loaded.' );
		} finally {
			if ( sequence === revisionSequence ) { state.loadingRevisions = false; renderRevisions(); renderComparison(); }
		}
	}

	function setBusy( busy ) {
		state.busy = busy;
		dom.workspace.setAttribute( 'aria-busy', busy ? 'true' : 'false' );
		dom[ 'refresh-documents' ].disabled = busy;
		dom[ 'document-search' ].disabled = busy;
		dom[ 'type-filter' ].querySelectorAll( 'input' ).forEach( ( input ) => { input.disabled = busy; } );
		renderComparison();
	}

	function enqueueMutation( operation ) {
		const run = mutationQueue.then( operation, operation );
		mutationQueue = run.catch( () => undefined );
		return run;
	}

	async function restoreRevision() {
		return enqueueMutation( async () => {
			const documentItem = selectedDocument(); const revision = selectedRevision();
			if ( ! documentItem || ! revision || state.busy ) return;
			let restored = false;
			setBusy( true );
			try {
				const latest = await api( `wp/v2/${ documentItem.oddType }/${ documentItem.id }?context=edit` );
				if ( stampOf( latest ) !== stampOf( documentItem ) ) {
					showNotice( 'This document changed in WordPress after you opened it. Nothing was restored; refresh and compare again.' );
					toast( 'Restore stopped because the document changed.', true );
					return;
				}
				const confirmed = await runtime.confirm( {
					title: 'Restore this revision?',
					message: `Replace the current title, content, and excerpt for “${ titleOf( documentItem ) }”? WordPress will keep the current version in revision history.`,
					confirmLabel: 'Restore revision', cancelLabel: 'Keep current',
				} );
				if ( ! confirmed ) return;
				await api( `wp/v2/${ documentItem.oddType }/${ documentItem.id }`, {
					method: 'POST',
					body: {
						title: fieldValue( revision, 'title' ),
						content: fieldValue( revision, 'content' ),
						excerpt: fieldValue( revision, 'excerpt' ),
					},
				} );
				toast( 'Revision restored. WordPress kept the replaced version in history.' );
				showNotice( '' );
				await refreshDocuments();
				restored = true;
			} catch ( error ) {
				toast( errorMessage( error, 'The revision could not be restored.' ), true );
			} finally {
				setBusy( false );
				if ( restored ) dom[ 'restore-revision' ].focus( { preventScroll:true } );
			}
		} );
	}

	function bindEvents() {
		dom[ 'document-search' ].addEventListener( 'input', ( event ) => { state.query = event.target.value.trim(); renderDocuments(); } );
		dom[ 'type-filter' ].addEventListener( 'change', ( event ) => {
			if ( ! VALID_TYPES.has( event.target.value ) ) return;
			state.typeFilter = event.target.value; renderDocuments(); savePreferences();
		} );
		dom[ 'field-tabs' ].addEventListener( 'change', ( event ) => { state.field = event.target.value; renderComparison(); } );
		dom[ 'document-list' ].addEventListener( 'click', ( event ) => {
			const button = event.target.closest( '[data-document-key]' );
			if ( ! button || button.dataset.documentKey === state.selectedKey ) return;
			state.selectedKey = button.dataset.documentKey; renderDocuments(); loadRevisions();
		} );
		dom[ 'revision-list' ].addEventListener( 'click', ( event ) => {
			const button = event.target.closest( '[data-revision-id]' ); if ( ! button ) return;
			state.selectedRevisionId = Number( button.dataset.revisionId ); renderRevisions(); renderComparison();
		} );
		dom[ 'refresh-documents' ].addEventListener( 'click', () => refreshDocuments( true ) );
		dom[ 'retry-documents' ].addEventListener( 'click', () => refreshDocuments() );
		dom[ 'retry-revisions' ].addEventListener( 'click', () => loadRevisions() );
		dom[ 'restore-revision' ].addEventListener( 'click', restoreRevision );
		window.addEventListener( 'pagehide', dispose, { once: true } );
	}

	function dispose() {
		disposed = true; readController?.abort(); revisionController?.abort();
		window.clearTimeout( toastTimer );
	}

	async function boot() {
		cacheDom(); bindEvents();
		try {
			runtime = requireRuntime();
			await loadPreferences();
			await refreshDocuments();
		} catch ( error ) {
			state.loadingDocuments = false; dom.workspace.setAttribute( 'aria-busy', 'false' );
			dom[ 'document-error' ].hidden = false;
			dom[ 'document-error-copy' ].textContent = errorMessage( error, 'ODD Revision Room could not start.' );
			dom[ 'retry-documents' ].hidden = error?.code === 'odd_runtime_unavailable';
			renderDocuments();
		}
	}

	if ( document.readyState === 'loading' ) document.addEventListener( 'DOMContentLoaded', boot, { once: true } ); else boot();
} )();
