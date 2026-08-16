import type { Note, NoteFilter, NoteId, TagSummary } from './types';

export function isLocalId( id: NoteId ): id is `local-${ string }` {
	return typeof id === 'string' && id.startsWith( 'local-' );
}

export function upsertNote( notes: Note[], note: Note ): Note[] {
	const without = notes.filter( ( item ) => item.id !== note.id );
	return [ note, ...without ].sort(
		( a, b ) => Date.parse( b.updatedAt ) - Date.parse( a.updatedAt ),
	);
}

export function replaceNoteStable( notes: Note[], note: Note ): Note[] {
	const index = notes.findIndex( ( item ) => item.id === note.id );
	if ( index === -1 ) {
		return upsertNote( notes, note );
	}
	const next = [ ...notes ];
	next[ index ] = note;
	return next;
}

export function updateNoteLocally(
	note: Note,
	patch: Partial< Note >,
	clientUpdatedAt = Date.now(),
): Note {
	const next = {
		...note,
		...patch,
		updatedAt: new Date( clientUpdatedAt ).toISOString(),
		updatedAtMs: note.updatedAtMs,
		version: note.version,
	};
	next.excerpt = next.body.trim().replace( /\s+/g, ' ' ).slice( 0, 150 );
	const words = next.body.trim().match( /\S+/g );
	next.wordCount = words ? words.length : 0;
	return next;
}

export function removeNote( notes: Note[], id: NoteId ): Note[] {
	return notes.filter( ( note ) => note.id !== id );
}

export function filterNotes(
	notes: Note[],
	filter: NoteFilter,
	query: string,
	tag: string | null,
): Note[] {
	const needle = query.trim().toLocaleLowerCase();
	const tokens = needle
		? needle.split( /\s+/ ).map( ( token ) => token.replace( /^#/, '' ) )
		: [];
	const normalizedTag = tag?.toLocaleLowerCase() ?? null;

	return notes.filter( ( note ) => {
		if ( filter === 'archive' ? ! note.archived : note.archived ) {
			return false;
		}
		if ( filter === 'favorite' && ( ! note.favorite || ! note.canEdit ) ) {
			return false;
		}
		if ( filter === 'desktop' && ( ! note.onDesktop || ! note.canEdit ) ) {
			return false;
		}
		if ( filter === 'shared' && note.canEdit ) {
			return false;
		}
		if ( filter === 'all' && ! note.canEdit ) {
			return false;
		}
		if (
			normalizedTag &&
			! note.tags.some( ( item ) => item.toLocaleLowerCase() === normalizedTag )
		) {
			return false;
		}
		if ( ! needle ) {
			return true;
		}
		const haystack = [ note.title, note.body, note.ownerName, ...note.tags ]
			.join( '\n' )
			.toLocaleLowerCase();
		return tokens.every( ( token ) => haystack.includes( token ) );
	} );
}

export function noteCounts( notes: Note[] ): Record< NoteFilter, number > {
	const counts: Record< NoteFilter, number > = {
		all: 0,
		favorite: 0,
		desktop: 0,
		shared: 0,
		archive: 0,
	};
	for ( const note of notes ) {
		if ( note.archived ) {
			if ( note.canEdit ) {
				counts.archive++;
			}
			continue;
		}
		if ( ! note.canEdit ) {
			counts.shared++;
			continue;
		}
		counts.all++;
		if ( note.favorite ) {
			counts.favorite++;
		}
		if ( note.onDesktop ) {
			counts.desktop++;
		}
	}
	return counts;
}

export function buildTagIndex( notes: Note[] ): TagSummary[] {
	const counts = new Map< string, TagSummary >();
	for ( const note of notes ) {
		if ( ! note.canEdit || note.archived ) {
			continue;
		}
		for ( const label of note.tags ) {
			const key = label.toLocaleLowerCase();
			const current = counts.get( key );
			counts.set( key, {
				label: current?.label ?? label,
				count: ( current?.count ?? 0 ) + 1,
			} );
		}
	}
	return [ ...counts.values() ].sort( ( a, b ) =>
		a.label.localeCompare( b.label ),
	);
}
