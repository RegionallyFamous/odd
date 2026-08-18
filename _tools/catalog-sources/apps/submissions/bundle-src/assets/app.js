( () => {
	'use strict';
	const APP_SLUG = 'submissions';
	const MAX_PAGES = 20;
	const MAX_PREVIEW_CHARS = 200000;
	const VALID_TYPES = new Set( [ 'all', 'posts', 'pages' ] );
	const ALLOWED_TAGS = new Set( [ 'article','aside','blockquote','br','caption','cite','code','col','colgroup','dd','del','div','dl','dt','em','figcaption','figure','h1','h2','h3','h4','h5','h6','hr','img','li','main','mark','ol','p','pre','q','s','section','small','span','strong','sub','sup','table','tbody','td','tfoot','th','thead','tr','ul' ] );
	const BLOCKED_TAGS = new Set( [ 'audio','base','button','canvas','embed','form','iframe','input','link','math','meta','noscript','object','script','select','source','style','svg','template','textarea','video' ] );
	const state = { items:[], selectedKey:'', query:'', typeFilter:'all', loading:false, busy:false };
	const dom = {};
	let runtime; let adminBase; let readController = null; let readSequence = 0; let disposed = false;
	let mutationQueue = Promise.resolve(); let preferenceQueue = Promise.resolve(); let toastTimer = 0; let inspectorReturnTarget = null; let inspectorModal = false; let inspectorMedia = null;

	class AppError extends Error { constructor( message, status = 500, code = '' ) { super( message ); this.name = 'SubmissionsError'; this.status = Number( status ) || 500; this.code = String( code || '' ); } }

	function cacheDom() {
		[ 'topbar','workspace','inbox','inbox-heading','submission-search','refresh-submissions','global-notice','submission-count','type-filter','partial-warning','submission-list','submission-empty','submission-error','submission-error-copy','retry-submissions','submission-inspector','close-inspector','submission-type','submission-title','submission-excerpt','submission-author','submission-modified','submission-preview','approve-submission','return-submission','open-submission','toast' ].forEach( ( id ) => { dom[ id ] = document.getElementById( id ); } );
	}

	function requireRuntime() {
		const candidate = window.oddApp; let base;
		try { base = new URL( candidate?.adminUrl || '' ); } catch ( _error ) { base = null; }
		if ( ! candidate || candidate.apiVersion !== 1 || candidate.slug !== APP_SLUG || typeof candidate.request !== 'function' || typeof candidate.confirm !== 'function' || ! candidate.storage || typeof candidate.storage.get !== 'function' || typeof candidate.storage.set !== 'function' || ! base || base.origin !== window.location.origin || ! base.pathname.startsWith( '/' ) ) {
			throw new AppError( 'ODD Submissions needs the ODD app runtime v1 and a same-site WordPress admin URL. Update ODD, then reopen this app.', 500, 'odd_runtime_unavailable' );
		}
		adminBase = base; return candidate;
	}

	async function api( path, options = {} ) {
		try { return await runtime.request( path, options ); }
		catch ( error ) { if ( error?.name === 'AbortError' ) throw error; throw new AppError( error?.message || error?.payload?.message || 'WordPress request failed.', error?.status || error?.payload?.data?.status || 500, error?.code || error?.payload?.code || '' ); }
	}

	function errorMessage( error, fallback ) {
		if ( /nonce|rest_cookie_invalid_nonce/i.test( `${ error?.code } ${ error?.message }` ) ) return 'WordPress could not verify this request. Refresh the app and try again.';
		if ( error?.status === 401 ) return 'Your WordPress session expired. Sign in again, then retry.';
		if ( error?.status === 403 ) return 'WordPress denied this action. Your account may not have permission.';
		if ( error?.status === 404 ) return 'That WordPress item no longer exists. Refresh to continue.';
		return error?.message || fallback;
	}

	function readEnvelope( response, label ) {
		const plainHeaders = Object.prototype.toString.call( response?.headers ) === '[object Object]'; const emptyHeaderList = Array.isArray( response?.headers ) && response.headers.length === 0;
		if ( ! response || typeof response !== 'object' || Array.isArray( response ) || ! Object.hasOwn( response, 'body' ) || ! Object.hasOwn( response, 'status' ) || ( ! plainHeaders && ! emptyHeaderList ) ) throw new AppError( `WordPress returned an unexpected ${ label } envelope.` );
		const status = Number( response.status );
		if ( ! Number.isInteger( status ) || status < 100 || status > 599 ) throw new AppError( `WordPress returned an unexpected ${ label } envelope.` );
		if ( status < 200 || status >= 300 ) { const body = response.body && typeof response.body === 'object' && ! Array.isArray( response.body ) ? response.body : {}; throw new AppError( body.message || `WordPress request failed with status ${ status }.`,status,body.code || '' ); }
		return emptyHeaderList ? { ...response,headers:{} } : response;
	}

	function showNotice( message = '' ) { dom[ 'global-notice' ].hidden = ! message; dom[ 'global-notice' ].textContent = message; }
	function toast( message, isError = false ) { window.clearTimeout( toastTimer ); dom.toast.textContent = message; dom.toast.classList.toggle( 'is-error', isError ); dom.toast.classList.add( 'is-visible' ); toastTimer = window.setTimeout( () => dom.toast.classList.remove( 'is-visible' ), 4200 ); }
	function titleOf( item ) { return String( item?.title?.raw || item?.title?.rendered || 'Untitled' ).replace( /<[^>]*>/g, '' ).trim() || 'Untitled'; }
	function plainText( html ) { const parsed = new DOMParser().parseFromString( String( html || '' ), 'text/html' ); return ( parsed.body.textContent || '' ).replace( /\s+/g, ' ' ).trim(); }
	function excerptOf( item ) { return plainText( item?.excerpt?.rendered || item?.excerpt?.raw || item?.content?.rendered || '' ).slice( 0, 260 ) || 'No excerpt was provided.'; }
	function authorOf( item ) { const author = item?._embedded?.author?.[ 0 ]?.name; return typeof author === 'string' && author.trim() ? author.trim() : 'Author unavailable'; }
	function wpGmtDate( value ) { const raw = String( value || '' ); return new Date( raw && ! /(?:Z|[+-]\d\d:\d\d)$/.test( raw ) ? `${ raw }Z` : raw ); }
	function modifiedDate( item ) { return item?.modified_gmt ? wpGmtDate( item.modified_gmt ) : new Date( item?.modified || '' ); }
	function stampOf( item ) { const raw = String( item?.modified_gmt || item?.modified || '' ); const date = modifiedDate( item ); return Number.isNaN( date.getTime() ) ? raw : date.toISOString(); }
	function keyOf( item ) { return `${ item.oddType }:${ Number( item.id ) }`; }
	function selectedItem() { return state.items.find( ( item ) => keyOf( item ) === state.selectedKey ) || null; }
	function typeName( type ) { return type === 'pages' ? 'Page' : 'Post'; }
	function formatModifiedDate( item ) { const date = modifiedDate( item ); return Number.isNaN( date.getTime() ) ? 'Date unavailable' : new Intl.DateTimeFormat( undefined, { dateStyle:'medium', timeStyle:'short' } ).format( date ); }
	function headerNumber( headers, name ) { const wanted = name.toLowerCase(); for ( const [ key, value ] of Object.entries( headers || {} ) ) if ( key.toLowerCase() === wanted ) return Number( value ) || 0; return 0; }

	async function loadType( type, signal ) {
		const items = []; let page = 1; let pages = 1; let capped = false;
		do {
			const query = new URLSearchParams( { context:'edit', per_page:'100', page:String( page ), status:'pending', orderby:'modified', order:'desc', _embed:'author', _envelope:'1' } );
			const response = readEnvelope( await api( `wp/v2/${ type }?${ query }`, { signal } ), `${ type } response` );
			if ( ! Array.isArray( response?.body ) ) throw new AppError( `WordPress returned an unexpected ${ type } response.` );
			items.push( ...response.body.map( ( item ) => ( { ...item, oddType:type } ) ) ); const actual = Math.max( 1, headerNumber( response.headers, 'x-wp-totalpages' ) || 1 ); capped = actual > MAX_PAGES; pages = Math.min( actual, MAX_PAGES ); page++;
		} while ( page <= pages );
		return { type, items, capped };
	}

	async function loadPreferences() {
		try { const value = await runtime.storage.get( 'preferences' ); if ( value && typeof value === 'object' && VALID_TYPES.has( value.typeFilter ) ) { state.typeFilter = value.typeFilter; dom[ 'type-filter' ].querySelector( `input[value="${ state.typeFilter }"]` ).checked = true; } }
		catch ( error ) { showNotice( `View preference could not be loaded: ${ errorMessage( error, 'storage unavailable' ) }` ); }
	}

	function savePreferences() { const value = { typeFilter:state.typeFilter }; preferenceQueue = preferenceQueue.then( () => runtime.storage.set( 'preferences', value ) ).catch( ( error ) => showNotice( `View preference could not be saved: ${ errorMessage( error, 'storage unavailable' ) }` ) ); }
	function filteredItems() { const words = state.query.toLocaleLowerCase().split( /\s+/ ).filter( Boolean ); return state.items.filter( ( item ) => ( state.typeFilter === 'all' || item.oddType === state.typeFilter ) && words.every( ( word ) => `${ titleOf( item ) } ${ excerptOf( item ) } ${ authorOf( item ) }`.toLocaleLowerCase().includes( word ) ) ); }

	function mobileInspector() { return inspectorMedia ? inspectorMedia.matches : window.matchMedia( '(max-width: 780px)' ).matches; }
	function focusWithoutScroll( element ) { if ( ! element ) return false; try { element.focus( { preventScroll:true } ); } catch ( _error ) { element.focus(); } return document.activeElement === element; }
	function syncInspector() {
		const open = Boolean( selectedItem() ); const compact = mobileInspector(); const modal = open && compact; const enteringModal = modal && ! inspectorModal; const leavingModal = ! modal && inspectorModal && open; dom[ 'submission-inspector' ].setAttribute( 'aria-hidden', compact && ! open ? 'true' : 'false' );
		dom.inbox.toggleAttribute( 'inert', modal ); dom.topbar.toggleAttribute( 'inert', modal );
		if ( modal ) { dom[ 'submission-inspector' ].setAttribute( 'role','dialog' ); dom[ 'submission-inspector' ].setAttribute( 'aria-modal','true' ); if ( enteringModal ) { inspectorReturnTarget = inspectorReturnTarget || [ ...dom[ 'submission-list' ].querySelectorAll( '[data-submission-key]' ) ].find( ( button ) => button.dataset.submissionKey === state.selectedKey ) || null; dom[ 'submission-inspector' ].scrollTop = 0; focusWithoutScroll( dom[ 'close-inspector' ] ); } }
		else { dom[ 'submission-inspector' ].removeAttribute( 'role' ); dom[ 'submission-inspector' ].removeAttribute( 'aria-modal' ); }
		if ( leavingModal ) focusWithoutScroll( dom[ 'submission-title' ] ) || focusWithoutScroll( dom[ 'approve-submission' ] );
		inspectorModal = modal;
	}
	function handleInspectorViewportChange() { if ( ! disposed ) syncInspector(); }
	function focusInboxAfterDecision() { const target = dom[ 'submission-list' ].querySelector( '[data-submission-key]' ) || dom[ 'inbox-heading' ] || dom[ 'refresh-submissions' ]; focusWithoutScroll( target ); }

	function renderList() {
		const focused = document.activeElement?.dataset?.submissionKey || ''; const items = filteredItems(); dom[ 'submission-list' ].replaceChildren();
		for ( const item of items ) {
			const button = document.createElement( 'button' ); button.type = 'button'; button.className = 'submission-item'; button.dataset.submissionKey = keyOf( item ); button.setAttribute( 'aria-pressed', keyOf( item ) === state.selectedKey ? 'true':'false' ); button.setAttribute( 'aria-label', `Review ${ titleOf( item ) }, ${ typeName( item.oddType ) }, by ${ authorOf( item ) }` );
			const top = document.createElement( 'span' ); top.className = 'item-top'; const title = document.createElement( 'strong' ); title.textContent = titleOf( item ); const type = document.createElement( 'span' ); type.className = 'type-chip'; type.textContent = typeName( item.oddType ); top.append( title,type );
			const excerpt = document.createElement( 'p' ); excerpt.textContent = excerptOf( item ); const meta = document.createElement( 'span' ); meta.className = 'item-meta'; const author = document.createElement( 'span' ); author.textContent = authorOf( item ); const modified = document.createElement( 'span' ); modified.textContent = formatModifiedDate( item ); meta.append( author,modified ); button.append( top,excerpt,meta ); const listItem = document.createElement( 'li' ); listItem.appendChild( button ); dom[ 'submission-list' ].appendChild( listItem );
		}
		dom[ 'submission-count' ].textContent = state.loading ? 'Loading…' : `${ items.length } waiting`; dom[ 'submission-empty' ].hidden = state.loading || items.length > 0 || ! dom[ 'submission-error' ].hidden;
		if ( focused ) [ ...dom[ 'submission-list' ].querySelectorAll( '[data-submission-key]' ) ].find( ( button ) => button.dataset.submissionKey === focused )?.focus( { preventScroll:true } );
	}

	function safeImageSource( raw ) {
		try { const url = new URL( raw, window.location.origin ); if ( url.origin === window.location.origin && [ 'http:','https:' ].includes( url.protocol ) ) return url.href; }
		catch ( _error ) { /* Invalid URLs are removed. */ }
		return /^data:image\/(?:png|gif|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test( String( raw ) ) ? String( raw ) : '';
	}

	function sanitizePreview( raw ) {
		if ( String( raw ).length > MAX_PREVIEW_CHARS ) return '<p>This preview is too large to display safely. Open it in WordPress to continue reviewing.</p>';
		const parsed = new DOMParser().parseFromString( String( raw || '' ), 'text/html' ); const output = document.implementation.createHTMLDocument( '' );
		function copyNode( node, parent ) {
			if ( node.nodeType === Node.TEXT_NODE ) { parent.appendChild( output.createTextNode( node.textContent || '' ) ); return; }
			if ( node.nodeType !== Node.ELEMENT_NODE ) return;
			const tag = node.localName.toLowerCase(); if ( BLOCKED_TAGS.has( tag ) ) return;
			if ( ! ALLOWED_TAGS.has( tag ) ) { [ ...node.childNodes ].forEach( ( child ) => copyNode( child,parent ) ); return; }
			const clean = output.createElement( tag );
			if ( tag === 'img' ) { const src = safeImageSource( node.getAttribute( 'src' ) || '' ); if ( ! src ) return; clean.setAttribute( 'src',src ); clean.setAttribute( 'alt',node.getAttribute( 'alt' ) || '' ); clean.setAttribute( 'loading','lazy' ); }
			if ( tag === 'td' || tag === 'th' ) for ( const attr of [ 'colspan','rowspan' ] ) { const value = Number( node.getAttribute( attr ) ); if ( Number.isInteger( value ) && value > 0 && value <= 20 ) clean.setAttribute( attr,String( value ) ); }
			[ ...node.childNodes ].forEach( ( child ) => copyNode( child,clean ) ); parent.appendChild( clean );
		}
		[ ...parsed.body.childNodes ].forEach( ( node ) => copyNode( node,output.body ) ); return output.body.innerHTML;
	}

	function renderPreview( item ) {
		dom[ 'submission-preview' ].replaceChildren(); const frame = document.createElement( 'iframe' ); frame.setAttribute( 'sandbox','' ); frame.setAttribute( 'referrerpolicy','no-referrer' ); frame.setAttribute( 'title',`Preview of ${ titleOf( item ) }` ); const csp = `default-src 'none'; img-src data: ${ window.location.origin }; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`; frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${ csp }"><meta name="referrer" content="no-referrer"><style>body{margin:0;padding:22px;color:#20242b;background:#fff;font:16px/1.65 system-ui,sans-serif;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{border-collapse:collapse;max-width:100%}td,th{border:1px solid #ccd0d6;padding:6px}pre{white-space:pre-wrap}blockquote{margin-left:0;padding-left:16px;border-left:4px solid #31bca9}</style></head><body>${ sanitizePreview( item?.content?.rendered || '' ) }</body></html>`; dom[ 'submission-preview' ].appendChild( frame );
	}

	function renderInspector() {
		const item = selectedItem(); syncInspector();
		if ( ! item ) {
			dom[ 'submission-type' ].textContent = 'Pending Review'; dom[ 'submission-title' ].textContent = 'Choose a submission'; dom[ 'submission-excerpt' ].textContent = 'Select a pending post or page from the inbox to inspect its metadata and safe preview.'; dom[ 'submission-author' ].textContent = '—'; dom[ 'submission-modified' ].textContent = '—';
			const message = document.createElement( 'p' ); message.textContent = 'Nothing is on the review desk yet.'; message.style.cssText = 'margin:0;padding:28px;color:#626b77;text-align:center;font:14px/1.5 system-ui,sans-serif'; dom[ 'submission-preview' ].replaceChildren( message );
			dom[ 'approve-submission' ].disabled = true; dom[ 'return-submission' ].disabled = true; dom[ 'open-submission' ].disabled = true; return;
		}
		dom[ 'submission-type' ].textContent = typeName( item.oddType ); dom[ 'submission-title' ].textContent = titleOf( item ); dom[ 'submission-excerpt' ].textContent = excerptOf( item ); dom[ 'submission-author' ].textContent = authorOf( item ); dom[ 'submission-modified' ].textContent = formatModifiedDate( item ); dom[ 'approve-submission' ].disabled = state.busy; dom[ 'return-submission' ].disabled = state.busy; dom[ 'open-submission' ].disabled = state.busy; renderPreview( item );
	}

	async function refresh( announce = false ) {
		readController?.abort(); readController = new AbortController(); const sequence = ++readSequence; state.loading = true; dom.workspace.setAttribute( 'aria-busy','true' ); dom[ 'submission-error' ].hidden = true; dom[ 'partial-warning' ].hidden = true; renderList();
		const results = await Promise.allSettled( [ loadType( 'posts',readController.signal ), loadType( 'pages',readController.signal ) ] ); if ( disposed || sequence !== readSequence ) return;
		const succeeded = new Set(); const failures = []; let next = []; let capped = false;
		for ( const result of results ) if ( result.status === 'fulfilled' ) { succeeded.add( result.value.type ); next.push( ...result.value.items ); capped ||= result.value.capped; } else if ( result.reason?.name !== 'AbortError' ) failures.push( result.reason );
		for ( const type of [ 'posts','pages' ] ) if ( ! succeeded.has( type ) ) next.push( ...state.items.filter( ( item ) => item.oddType === type ) );
		if ( succeeded.size ) { state.items = next.sort( ( a,b ) => modifiedDate( b ) - modifiedDate( a ) ); if ( state.selectedKey && ! selectedItem() ) state.selectedKey = ''; }
		state.loading = false; dom.workspace.setAttribute( 'aria-busy','false' );
		if ( ! succeeded.size ) { dom[ 'submission-error' ].hidden = false; dom[ 'submission-error-copy' ].textContent = errorMessage( failures[ 0 ], 'WordPress returned an unexpected response.' ); }
		else if ( failures.length || capped ) { dom[ 'partial-warning' ].hidden = false; dom[ 'partial-warning' ].textContent = failures.length ? `Showing the content type WordPress returned. Another type could not be loaded: ${ errorMessage( failures[ 0 ],'WordPress returned an unexpected response.' ) }` : `Showing the first ${ MAX_PAGES * 100 } pending items per type. Some content may be omitted.`; }
		renderList(); renderInspector(); if ( announce && succeeded.size ) toast( 'Pending Review inbox refreshed.' );
	}

	function setBusy( busy ) { state.busy = busy; dom.workspace.setAttribute( 'aria-busy',busy?'true':'false' ); dom[ 'refresh-submissions' ].disabled = busy; dom[ 'submission-search' ].disabled = busy; dom[ 'type-filter' ].querySelectorAll( 'input' ).forEach( ( input ) => { input.disabled = busy; } ); renderInspector(); }
	function enqueueMutation( operation ) { const run = mutationQueue.then( operation,operation ); mutationQueue = run.catch( () => undefined ); return run; }
	async function decide( status ) {
		return enqueueMutation( async () => {
			const item = selectedItem(); if ( ! item || state.busy ) return; setBusy( true );
			try {
				const latest = await api( `wp/v2/${ item.oddType }/${ item.id }?context=edit` );
				if ( stampOf( latest ) !== stampOf( item ) ) { showNotice( 'This submission changed in WordPress after you opened it. Nothing was changed; refresh and review it again.' ); toast( 'Decision stopped because the submission changed.',true ); return; }
				const approving = status === 'publish'; const confirmed = await runtime.confirm( { title:approving?'Approve and publish?':'Return to drafts?', message:approving?`Publish “${ titleOf( item ) }” now?`:`Send “${ titleOf( item ) }” back to drafts for more work?`, confirmLabel:approving?'Publish now':'Return to drafts', cancelLabel:'Keep pending', danger:! approving } ); if ( ! confirmed ) return;
				await api( `wp/v2/${ item.oddType }/${ item.id }`, { method:'POST', body:{ status } } ); toast( approving ? `${ titleOf( item ) } is published.` : `${ titleOf( item ) } returned to drafts.` ); showNotice( '' ); state.selectedKey = ''; inspectorReturnTarget = null; await refresh(); focusInboxAfterDecision();
			} catch ( error ) { toast( errorMessage( error,'WordPress could not save that decision.' ),true ); }
			finally { setBusy( false ); }
		} );
	}

	function openWordPress() {
		const item = selectedItem(); if ( ! item ) return; const url = new URL( 'post.php',adminBase ); url.searchParams.set( 'post',String( item.id ) ); url.searchParams.set( 'action','edit' ); if ( url.origin !== window.location.origin ) { toast( 'WordPress admin URL failed the same-site safety check.',true ); return; } const opened = window.open( url.href,'_blank','noopener,noreferrer' ); if ( ! opened ) toast( 'WordPress could not open a new tab. Allow pop-ups for this site, then try again.',true );
	}

	function closeInspector() { const returnKey = inspectorReturnTarget?.dataset?.submissionKey || ''; state.selectedKey = ''; inspectorReturnTarget = null; renderList(); renderInspector(); const target = [ ...dom[ 'submission-list' ].querySelectorAll( '[data-submission-key]' ) ].find( ( button ) => button.dataset.submissionKey === returnKey ); focusWithoutScroll( target ) || focusInboxAfterDecision(); }
	function bindEvents() {
		inspectorMedia = window.matchMedia( '(max-width: 780px)' );
		if ( typeof inspectorMedia.addEventListener === 'function' ) inspectorMedia.addEventListener( 'change',handleInspectorViewportChange );
		else inspectorMedia.addListener?.( handleInspectorViewportChange );
		window.addEventListener( 'resize',handleInspectorViewportChange );
		dom[ 'submission-search' ].addEventListener( 'input',( event ) => { state.query = event.target.value.trim(); renderList(); } ); dom[ 'type-filter' ].addEventListener( 'change',( event ) => { if ( VALID_TYPES.has( event.target.value ) ) { state.typeFilter = event.target.value; renderList(); savePreferences(); } } );
		dom[ 'submission-list' ].addEventListener( 'click',( event ) => { const button = event.target.closest( '[data-submission-key]' ); if ( ! button ) return; inspectorReturnTarget = button; state.selectedKey = button.dataset.submissionKey; renderList(); renderInspector(); if ( ! mobileInspector() ) focusWithoutScroll( dom[ 'submission-title' ] ); } );
		dom[ 'close-inspector' ].addEventListener( 'click',closeInspector ); dom[ 'refresh-submissions' ].addEventListener( 'click',() => refresh( true ) ); dom[ 'retry-submissions' ].addEventListener( 'click',() => refresh() ); dom[ 'approve-submission' ].addEventListener( 'click',() => decide( 'publish' ) ); dom[ 'return-submission' ].addEventListener( 'click',() => decide( 'draft' ) ); dom[ 'open-submission' ].addEventListener( 'click',openWordPress );
		dom[ 'submission-inspector' ].addEventListener( 'keydown',( event ) => {
			if ( event.key === 'Escape' && mobileInspector() ) { event.preventDefault(); closeInspector(); return; }
			if ( event.key !== 'Tab' || ! inspectorModal ) return;
			const controls = [ ...dom[ 'submission-inspector' ].querySelectorAll( 'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])' ) ].filter( ( element ) => ! element.hidden );
			if ( ! controls.length ) return;
			const first = controls[ 0 ]; const last = controls[ controls.length - 1 ];
			if ( event.shiftKey && document.activeElement === first ) { event.preventDefault(); last.focus(); }
			else if ( ! event.shiftKey && document.activeElement === last ) { event.preventDefault(); first.focus(); }
		} ); window.addEventListener( 'pagehide',dispose,{ once:true } );
	}
	function dispose() { disposed = true; readController?.abort(); window.clearTimeout( toastTimer ); if ( typeof inspectorMedia?.removeEventListener === 'function' ) inspectorMedia.removeEventListener( 'change',handleInspectorViewportChange ); else inspectorMedia?.removeListener?.( handleInspectorViewportChange ); window.removeEventListener( 'resize',handleInspectorViewportChange ); }
	async function boot() { cacheDom(); bindEvents(); try { runtime = requireRuntime(); await loadPreferences(); await refresh(); } catch ( error ) { state.loading = false; dom.workspace.setAttribute( 'aria-busy','false' ); dom[ 'submission-error' ].hidden = false; dom[ 'submission-error-copy' ].textContent = errorMessage( error,'ODD Submissions could not start.' ); dom[ 'retry-submissions' ].hidden = error?.code === 'odd_runtime_unavailable'; renderList(); } }
	if ( document.readyState === 'loading' ) document.addEventListener( 'DOMContentLoaded',boot,{ once:true } ); else boot();
} )();
