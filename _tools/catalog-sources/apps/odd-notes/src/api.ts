import type {
	Note,
	NoteMutation,
	NoteRevision,
	NotesConfig,
	NotesLibrary,
} from './types';

export const WINDOW_ID = 'odd-app-odd-notes';

export class NotesApiError extends Error {
	status: number;
	data: { current?: Note };

	constructor( message: string, status: number, data: { current?: Note } = {} ) {
		super( message );
		this.name = 'NotesApiError';
		this.status = status;
		this.data = data;
	}
}

export function desktop() {
	const api = window.wp?.os;
	if ( ! api ) {
		throw new Error( 'ODD Notes requires the OpenStation public API.' );
	}
	return api;
}

export function config(): NotesConfig {
	const value = desktop().getWindowConfig( WINDOW_ID );
	if ( ! value?.restBase || ! value.restNonce ) {
		throw new Error( 'Notes window config is missing.' );
	}
	return value;
}

interface RequestOptions {
	method?: 'GET' | 'POST' | 'DELETE';
	body?: unknown;
	signal?: AbortSignal;
	silent?: boolean;
}

async function request< T >( path: string, options: RequestOptions = {} ): Promise< T > {
	const cfg = config();
	const url = new URL( path.replace( /^\//, '' ), cfg.restBase );
	const response = await desktop().fetch(
		url,
		{
			method: options.method ?? 'GET',
			credentials: 'same-origin',
			signal: options.signal,
			headers: {
				Accept: 'application/json',
				'X-WP-Nonce': cfg.restNonce,
				...( options.body !== undefined
					? { 'Content-Type': 'application/json' }
					: {} ),
			},
			body: options.body !== undefined ? JSON.stringify( options.body ) : undefined,
		},
		{
			windowId: WINDOW_ID,
			source: 'odd-app-odd-notes',
			silent: options.silent,
		},
	);

	if ( ! response.ok ) {
		let message = `${ response.status } ${ response.statusText }`;
		let data: { current?: Note } = {};
		try {
			const error = ( await response.json() ) as {
				message?: string;
				data?: { current?: Note };
			};
			message = error.message || message;
			data = error.data ?? {};
		} catch {
			// The bounded HTTP status message is enough when JSON parsing fails.
		}
		throw new NotesApiError( message, response.status, data );
	}

	return ( await response.json() ) as T;
}

export function fetchLibrary( signal?: AbortSignal ): Promise< NotesLibrary > {
	return request< NotesLibrary >( 'notes', { signal } );
}

export function createNote( note: NoteMutation, signal?: AbortSignal ): Promise< Note > {
	return request< Note >( 'notes', {
		method: 'POST',
		body: note,
		signal,
	} );
}

export function updateNote(
	id: number,
	note: NoteMutation,
	signal?: AbortSignal,
): Promise< Note > {
	return request< Note >( `notes/${ id }`, {
		// WordPress REST editable routes accept POST. Playground's request bridge
		// currently preserves POST JSON bodies but can drop PATCH bodies.
		method: 'POST',
		body: note,
		signal,
	} );
}

export function deleteNote( id: number, signal?: AbortSignal ): Promise< void > {
	return request< void >( `notes/${ id }`, { method: 'DELETE', signal } );
}

export async function fetchRevisions(
	id: number,
	signal?: AbortSignal,
): Promise< NoteRevision[] > {
	const result = await request< { revisions: NoteRevision[] } >(
		`notes/${ id }/revisions`,
		{ signal, silent: true },
	);
	return result.revisions;
}

export function restoreRevision(
	noteId: number,
	revisionId: number,
	signal?: AbortSignal,
): Promise< Note > {
	return request< Note >( `notes/${ noteId }/revisions/${ revisionId }/restore`, {
		method: 'POST',
		signal,
	} );
}
