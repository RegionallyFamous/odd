( () => {
	'use strict';
	const APP_SLUG = 'airdate';
	const MAX_PAGES = 20;
	const VALID_VIEWS = new Set( [ 'calendar', 'agenda' ] );
	const VALID_TYPES = new Set( [ 'all', 'posts', 'pages' ] );
	const state = { items: [], view: 'calendar', typeFilter: 'all', month: monthKey( new Date() ), loading: false, busy: false, dialogKey: '' };
	const dom = {};
	let runtime; let readController = null; let readSequence = 0; let disposed = false;
	let mutationQueue = Promise.resolve(); let preferenceQueue = Promise.resolve(); let toastTimer = 0; let dialogFocusTimer = 0; let dialogReturnTarget = null; let dialogReturnKey = '';

	class AppError extends Error { constructor( message, status = 500, code = '' ) { super( message ); this.name = 'AirdateError'; this.status = Number( status ) || 500; this.code = String( code || '' ); } }

	function cacheDom() {
		[
			'workspace','previous-month','today-month','month-heading','next-month','refresh-schedule','global-notice','view-filter','type-filter','partial-warning','calendar-view','calendar-grid','agenda-view','agenda-list','schedule-empty','schedule-error','schedule-error-copy','retry-schedule','schedule-heading','queue-heading','queue-count','timezone-label','queue-list','queue-empty','schedule-dialog','schedule-form','dialog-eyebrow','dialog-title','dialog-copy','airdate-input','airdate-error','cancel-airdate','schedule-submit','toast',
		].forEach( ( id ) => { dom[ id ] = document.getElementById( id ); } );
	}

	function requireRuntime() {
		const candidate = window.oddApp;
		if ( ! candidate || candidate.apiVersion !== 1 || candidate.slug !== APP_SLUG || typeof candidate.request !== 'function' || typeof candidate.confirm !== 'function' || ! candidate.storage || typeof candidate.storage.get !== 'function' || typeof candidate.storage.set !== 'function' ) {
			throw new AppError( 'ODD Airdate needs the ODD app runtime v1. Update ODD, then reopen this app.', 500, 'odd_runtime_unavailable' );
		}
		return candidate;
	}

	async function api( path, options = {} ) {
		try { return await runtime.request( path, options ); }
		catch ( error ) {
			if ( error?.name === 'AbortError' ) throw error;
			throw new AppError( error?.message || error?.payload?.message || 'WordPress request failed.', error?.status || error?.payload?.data?.status || 500, error?.code || error?.payload?.code || '' );
		}
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

	function monthKey( date ) { return `${ date.getFullYear() }-${ String( date.getMonth() + 1 ).padStart( 2, '0' ) }`; }
	function validMonth( value ) { return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test( value ); }
	function monthDate() { const [ year, month ] = state.month.split( '-' ).map( Number ); return new Date( year, month - 1, 1 ); }
	function wpGmtDate( value ) { const raw = String( value || '' ); if ( ! raw ) return new Date( NaN ); return new Date( /(?:Z|[+-]\d\d:\d\d)$/.test( raw ) ? raw : `${ raw }Z` ); }
	function modifiedDate( item ) { return item?.modified_gmt ? wpGmtDate( item.modified_gmt ) : new Date( item?.modified || '' ); }
	function localInputValue( date ) { const pad = ( value ) => String( value ).padStart( 2, '0' ); return `${ date.getFullYear() }-${ pad( date.getMonth() + 1 ) }-${ pad( date.getDate() ) }T${ pad( date.getHours() ) }:${ pad( date.getMinutes() ) }`; }
	function toWpGmt( localValue ) { const date = new Date( localValue ); return Number.isNaN( date.getTime() ) ? '' : date.toISOString().replace( /\.\d{3}Z$/, '' ); }
	function titleOf( item ) { return String( item?.title?.raw || item?.title?.rendered || 'Untitled' ).replace( /<[^>]*>/g, '' ).trim() || 'Untitled'; }
	function stampOf( item ) { const raw = String( item?.modified_gmt || item?.modified || '' ); const date = modifiedDate( item ); return Number.isNaN( date.getTime() ) ? raw : date.toISOString(); }
	function keyOf( item ) { return `${ item.oddType }:${ Number( item.id ) }`; }
	function itemByKey( key ) { return state.items.find( ( item ) => keyOf( item ) === key ) || null; }
	function typeName( type ) { return type === 'pages' ? 'Page' : 'Post'; }
	function filtered( items ) { return state.typeFilter === 'all' ? items : items.filter( ( item ) => item.oddType === state.typeFilter ); }
	function scheduledItems() { return filtered( state.items.filter( ( item ) => item.status === 'future' && ! Number.isNaN( wpGmtDate( item.date_gmt ).getTime() ) ) ).sort( ( a, b ) => wpGmtDate( a.date_gmt ) - wpGmtDate( b.date_gmt ) ); }
	function queueItems() { return filtered( state.items.filter( ( item ) => item.status === 'draft' || item.status === 'pending' ) ).sort( ( a, b ) => modifiedDate( b ) - modifiedDate( a ) ); }
	function inSelectedMonth( item ) { return monthKey( wpGmtDate( item.date_gmt ) ) === state.month; }
	function formatDate( date, options ) { return new Intl.DateTimeFormat( undefined, options ).format( date ); }

	function headerNumber( headers, name ) { const wanted = name.toLowerCase(); for ( const [ key, value ] of Object.entries( headers || {} ) ) if ( key.toLowerCase() === wanted ) return Number( value ) || 0; return 0; }
	function showNotice( message = '' ) { dom[ 'global-notice' ].hidden = ! message; dom[ 'global-notice' ].textContent = message; }
	function toast( message, isError = false ) { window.clearTimeout( toastTimer ); dom.toast.textContent = message; dom.toast.classList.toggle( 'is-error', isError ); dom.toast.classList.add( 'is-visible' ); toastTimer = window.setTimeout( () => dom.toast.classList.remove( 'is-visible' ), 4200 ); }

	async function loadType( type, signal ) {
		const items = []; let page = 1; let pages = 1; let capped = false;
		do {
			const query = new URLSearchParams( { context:'edit', per_page:'100', page:String( page ), orderby:'modified', order:'desc', _envelope:'1' } );
			[ 'future','draft','pending' ].forEach( ( status ) => query.append( 'status[]',status ) );
			const response = readEnvelope( await api( `wp/v2/${ type }?${ query }`, { signal } ), `${ type } response` );
			if ( ! Array.isArray( response?.body ) ) throw new AppError( `WordPress returned an unexpected ${ type } response.` );
			items.push( ...response.body.map( ( item ) => ( { ...item, oddType:type } ) ) );
			const actual = Math.max( 1, headerNumber( response.headers, 'x-wp-totalpages' ) || 1 ); capped = actual > MAX_PAGES; pages = Math.min( actual, MAX_PAGES ); page++;
		} while ( page <= pages );
		return { type, items, capped };
	}

	async function loadPreferences() {
		try {
			const value = await runtime.storage.get( 'preferences' );
			if ( value && typeof value === 'object' ) {
				if ( VALID_VIEWS.has( value.view ) ) state.view = value.view;
				if ( VALID_TYPES.has( value.typeFilter ) ) state.typeFilter = value.typeFilter;
				if ( validMonth( value.month ) ) state.month = value.month;
			}
			dom[ 'view-filter' ].querySelector( `input[value="${ state.view }"]` ).checked = true; dom[ 'type-filter' ].value = state.typeFilter;
		} catch ( error ) { showNotice( `View preference could not be loaded: ${ errorMessage( error, 'storage unavailable' ) }` ); }
	}

	function savePreferences() {
		const value = { view:state.view, typeFilter:state.typeFilter, month:state.month };
		preferenceQueue = preferenceQueue.then( () => runtime.storage.set( 'preferences', value ) ).catch( ( error ) => showNotice( `View preference could not be saved: ${ errorMessage( error, 'storage unavailable' ) }` ) );
	}

	function renderEventButton( item ) {
		const button = document.createElement( 'button' ); button.type = 'button'; button.className = `event-button ${ item.oddType === 'pages' ? 'page' : 'post' }`; button.dataset.scheduleKey = keyOf( item );
		button.setAttribute( 'aria-label', `Reschedule ${ titleOf( item ) }, ${ formatDate( wpGmtDate( item.date_gmt ), { dateStyle:'medium', timeStyle:'short' } ) }` );
		const strong = document.createElement( 'strong' ); strong.textContent = titleOf( item ); const small = document.createElement( 'small' ); small.textContent = formatDate( wpGmtDate( item.date_gmt ), { hour:'numeric', minute:'2-digit' } ); button.append( strong, small ); return button;
	}

	function renderCalendar() {
		dom[ 'calendar-grid' ].replaceChildren(); const base = monthDate(); const start = new Date( base ); start.setDate( 1 - base.getDay() ); const today = new Date(); const items = scheduledItems();
		for ( let offset = 0; offset < 42; offset++ ) {
			const date = new Date( start ); date.setDate( start.getDate() + offset ); const cell = document.createElement( 'div' ); cell.className = 'calendar-day';
			if ( date.getMonth() !== base.getMonth() ) cell.classList.add( 'is-outside' );
			if ( date.toDateString() === today.toDateString() ) cell.classList.add( 'is-today' );
			const label = document.createElement( 'span' ); label.className = 'day-number'; label.textContent = String( date.getDate() ); cell.appendChild( label );
			for ( const item of items.filter( ( candidate ) => wpGmtDate( candidate.date_gmt ).toDateString() === date.toDateString() ) ) cell.appendChild( renderEventButton( item ) );
			dom[ 'calendar-grid' ].appendChild( cell );
		}
	}

	function renderAgenda() {
		dom[ 'agenda-list' ].replaceChildren(); const groups = new Map();
		for ( const item of scheduledItems().filter( inSelectedMonth ) ) { const date = wpGmtDate( item.date_gmt ); const key = date.toDateString(); if ( ! groups.has( key ) ) groups.set( key, [] ); groups.get( key ).push( item ); }
		for ( const items of groups.values() ) {
			const section = document.createElement( 'section' ); section.className = 'agenda-day'; const heading = document.createElement( 'h3' ); heading.textContent = formatDate( wpGmtDate( items[ 0 ].date_gmt ), { weekday:'long', month:'long', day:'numeric' } ); section.appendChild( heading );
			for ( const item of items ) {
				const row = document.createElement( 'div' ); row.className = 'agenda-row'; const time = document.createElement( 'time' ); time.dateTime = `${ item.date_gmt }Z`; time.textContent = formatDate( wpGmtDate( item.date_gmt ), { hour:'numeric', minute:'2-digit' } );
				const title = document.createElement( 'strong' ); title.textContent = titleOf( item ); const button = document.createElement( 'button' ); button.type = 'button'; button.className = 'action-button'; button.dataset.scheduleKey = keyOf( item ); button.textContent = 'Reschedule'; row.append( time, title, button ); section.appendChild( row );
			} dom[ 'agenda-list' ].appendChild( section );
		}
	}

	function renderQueue() {
		const items = queueItems(); dom[ 'queue-list' ].replaceChildren(); dom[ 'queue-count' ].textContent = state.loading ? 'Loading…' : String( items.length );
		for ( const item of items ) {
			const card = document.createElement( 'article' ); card.className = 'queue-card'; const top = document.createElement( 'div' ); top.className = 'item-top'; const title = document.createElement( 'strong' ); title.textContent = titleOf( item ); const type = document.createElement( 'span' ); type.className = 'type-chip'; type.textContent = typeName( item.oddType ); top.append( title, type );
			const meta = document.createElement( 'p' ); meta.textContent = `${ item.status === 'pending' ? 'Pending review' : 'Draft' } · changed ${ formatDate( modifiedDate( item ), { dateStyle:'medium' } ) }`; const action = document.createElement( 'button' ); action.type = 'button'; action.className = 'queue-action'; action.dataset.scheduleKey = keyOf( item ); action.textContent = 'Choose air date'; card.append( top, meta, action ); dom[ 'queue-list' ].appendChild( card );
		}
		dom[ 'queue-empty' ].hidden = state.loading || items.length > 0;
	}

	function render() {
		const base = monthDate(); dom[ 'month-heading' ].textContent = formatDate( base, { month:'long', year:'numeric' } );
		dom[ 'calendar-view' ].hidden = state.view !== 'calendar'; dom[ 'agenda-view' ].hidden = state.view !== 'agenda'; renderCalendar(); renderAgenda(); renderQueue();
		const monthItems = scheduledItems().filter( inSelectedMonth ); dom[ 'schedule-empty' ].hidden = state.loading || monthItems.length > 0 || ! dom[ 'schedule-error' ].hidden;
	}

	async function refresh( announce = false ) {
		readController?.abort(); readController = new AbortController(); const sequence = ++readSequence; state.loading = true; dom.workspace.setAttribute( 'aria-busy', 'true' ); dom[ 'schedule-error' ].hidden = true; dom[ 'partial-warning' ].hidden = true; render();
		const results = await Promise.allSettled( [ loadType( 'posts', readController.signal ), loadType( 'pages', readController.signal ) ] );
		if ( disposed || sequence !== readSequence ) return;
		const succeeded = new Set(); const failures = []; let next = []; let capped = false;
		for ( const result of results ) if ( result.status === 'fulfilled' ) { succeeded.add( result.value.type ); next.push( ...result.value.items ); capped ||= result.value.capped; } else if ( result.reason?.name !== 'AbortError' ) failures.push( result.reason );
		for ( const type of [ 'posts','pages' ] ) if ( ! succeeded.has( type ) ) next.push( ...state.items.filter( ( item ) => item.oddType === type ) );
		if ( succeeded.size ) state.items = next;
		state.loading = false; dom.workspace.setAttribute( 'aria-busy', 'false' );
		if ( ! succeeded.size ) { dom[ 'schedule-error' ].hidden = false; dom[ 'schedule-error-copy' ].textContent = errorMessage( failures[ 0 ], 'WordPress returned an unexpected response.' ); }
		else if ( failures.length || capped ) { dom[ 'partial-warning' ].hidden = false; dom[ 'partial-warning' ].textContent = failures.length ? `Showing the content type WordPress returned. Another type could not be loaded: ${ errorMessage( failures[ 0 ],'WordPress returned an unexpected response.' ) }` : `Showing the first ${ MAX_PAGES * 100 } items per type. Some content may be omitted.`; }
		render(); if ( announce && succeeded.size ) toast( 'Publishing schedule refreshed.' );
	}

	function openScheduleDialog( key ) {
		const item = itemByKey( key ); if ( ! item || state.busy ) return; state.dialogKey = key; dialogReturnTarget = document.activeElement; dialogReturnKey = key;
		const existing = item.status === 'future'; dom[ 'dialog-eyebrow' ].textContent = existing ? 'Move the broadcast' : 'Choose an air date'; dom[ 'dialog-title' ].textContent = existing ? `Reschedule ${ titleOf( item ) }` : `Schedule ${ titleOf( item ) }`; dom[ 'dialog-copy' ].textContent = `Times use ${ Intl.DateTimeFormat().resolvedOptions().timeZone || 'your device timezone' }. WordPress stores the exact UTC instant.`;
		const initial = existing ? wpGmtDate( item.date_gmt ) : new Date( Date.now() + 24 * 60 * 60 * 1000 ); dom[ 'airdate-input' ].value = localInputValue( initial ); dom[ 'airdate-error' ].hidden = true; dom[ 'cancel-airdate' ].hidden = ! existing; dom[ 'schedule-submit' ].textContent = existing ? 'Reschedule' : 'Schedule'; dom[ 'schedule-dialog' ].showModal(); window.clearTimeout( dialogFocusTimer ); dialogFocusTimer = window.setTimeout( () => { if ( ! disposed && dom[ 'schedule-dialog' ].open ) dom[ 'airdate-input' ].focus(); },0 );
	}

	function closeScheduleDialog() {
		window.clearTimeout( dialogFocusTimer ); dialogFocusTimer = 0;
		if ( dom[ 'schedule-dialog' ].open ) dom[ 'schedule-dialog' ].close();
		let target = dialogReturnTarget?.isConnected ? dialogReturnTarget : null;
		if ( ! target && dialogReturnKey ) target = [ ...document.querySelectorAll( '[data-schedule-key]' ) ].find( ( element ) => element.dataset.scheduleKey === dialogReturnKey && element.getClientRects().length ) || null;
		if ( ! target ) target = dom[ 'refresh-schedule' ] || dom[ 'queue-heading' ] || dom[ 'schedule-heading' ];
		dialogReturnTarget = null; dialogReturnKey = ''; target?.focus?.( { preventScroll:true } );
	}
	function setBusy( busy ) { state.busy = busy; dom.workspace.setAttribute( 'aria-busy', busy ? 'true' : 'false' ); document.querySelectorAll( 'button,input,select' ).forEach( ( element ) => { if ( ! element.closest( '.schedule-dialog' ) || element.id === 'schedule-submit' ) element.disabled = busy; } ); dom[ 'schedule-submit' ].disabled = busy; }
	function enqueueMutation( operation ) { const run = mutationQueue.then( operation, operation ); mutationQueue = run.catch( () => undefined ); return run; }

	async function mutateWithConflictCheck( item, payload, successMessage, confirmation = null ) {
		return enqueueMutation( async () => {
			if ( state.busy ) return; setBusy( true );
			try {
				const latest = await api( `wp/v2/${ item.oddType }/${ item.id }?context=edit` );
				if ( stampOf( latest ) !== stampOf( item ) ) { showNotice( 'This document changed in WordPress after Airdate loaded it. Nothing was changed; refresh and try again.' ); toast( 'Action stopped because the document changed.', true ); return false; }
				if ( confirmation && ! await runtime.confirm( confirmation ) ) return false;
				await api( `wp/v2/${ item.oddType }/${ item.id }`, { method:'POST', body:payload } ); toast( successMessage ); showNotice( '' ); await refresh(); return true;
			} catch ( error ) { toast( errorMessage( error, 'WordPress could not update the schedule.' ), true ); return false; }
			finally { setBusy( false ); }
		} );
	}

	async function submitSchedule() {
		const item = itemByKey( state.dialogKey ); if ( ! item ) return;
		const local = new Date( dom[ 'airdate-input' ].value );
		if ( Number.isNaN( local.getTime() ) || local.getTime() <= Date.now() + 60000 ) { dom[ 'airdate-error' ].textContent = 'Choose a valid time at least one minute in the future.'; dom[ 'airdate-error' ].hidden = false; dom[ 'airdate-input' ].focus(); return; }
		const dateGmt = toWpGmt( dom[ 'airdate-input' ].value ); const completed = await mutateWithConflictCheck( item, { date_gmt:dateGmt, status:'future' }, `${ titleOf( item ) } is scheduled for ${ formatDate( local, { dateStyle:'medium', timeStyle:'short' } ) }.` ); if ( completed ) closeScheduleDialog();
	}

	async function cancelSchedule( key ) {
		const item = itemByKey( key ); if ( ! item ) return;
		return mutateWithConflictCheck( item, { status:'draft' }, `${ titleOf( item ) } returned to drafts.`, { title:'Cancel this air date?', message:`Return “${ titleOf( item ) }” to drafts? Its content will not change.`, confirmLabel:'Return to drafts', cancelLabel:'Keep scheduled', danger:true } );
	}

	function changeMonth( delta ) { const date = monthDate(); date.setMonth( date.getMonth() + delta ); state.month = monthKey( date ); render(); savePreferences(); }
	function bindEvents() {
		dom[ 'previous-month' ].addEventListener( 'click', () => changeMonth( -1 ) ); dom[ 'next-month' ].addEventListener( 'click', () => changeMonth( 1 ) ); dom[ 'today-month' ].addEventListener( 'click', () => { state.month = monthKey( new Date() ); render(); savePreferences(); } );
		dom[ 'refresh-schedule' ].addEventListener( 'click', () => refresh( true ) ); dom[ 'retry-schedule' ].addEventListener( 'click', () => refresh() );
		dom[ 'view-filter' ].addEventListener( 'change', ( event ) => { if ( VALID_VIEWS.has( event.target.value ) ) { state.view = event.target.value; render(); savePreferences(); } } ); dom[ 'type-filter' ].addEventListener( 'change', ( event ) => { if ( VALID_TYPES.has( event.target.value ) ) { state.typeFilter = event.target.value; render(); savePreferences(); } } );
		dom.workspace.addEventListener( 'click', ( event ) => { const schedule = event.target.closest( '[data-schedule-key]' ); if ( schedule ) openScheduleDialog( schedule.dataset.scheduleKey ); const cancel = event.target.closest( '[data-cancel-key]' ); if ( cancel ) cancelSchedule( cancel.dataset.cancelKey ); } );
		dom[ 'schedule-form' ].addEventListener( 'submit', ( event ) => { event.preventDefault(); if ( event.submitter?.value === 'schedule' ) submitSchedule(); else closeScheduleDialog(); } );
		dom[ 'cancel-airdate' ].addEventListener( 'click', async () => { const completed = await cancelSchedule( state.dialogKey ); if ( completed ) closeScheduleDialog(); } );
		dom[ 'schedule-dialog' ].addEventListener( 'cancel', ( event ) => { event.preventDefault(); closeScheduleDialog(); } );
		window.addEventListener( 'pagehide', dispose, { once:true } );
	}

	function dispose() { disposed = true; readController?.abort(); window.clearTimeout( toastTimer ); window.clearTimeout( dialogFocusTimer ); }
	async function boot() {
		cacheDom(); bindEvents(); dom[ 'timezone-label' ].textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your device timezone';
		try { runtime = requireRuntime(); await loadPreferences(); await refresh(); }
		catch ( error ) { state.loading = false; dom.workspace.setAttribute( 'aria-busy','false' ); dom[ 'schedule-error' ].hidden = false; dom[ 'schedule-error-copy' ].textContent = errorMessage( error, 'ODD Airdate could not start.' ); dom[ 'retry-schedule' ].hidden = error?.code === 'odd_runtime_unavailable'; render(); }
	}
	if ( document.readyState === 'loading' ) document.addEventListener( 'DOMContentLoaded', boot, { once:true } ); else boot();
} )();
