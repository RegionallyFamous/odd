export type NoteFilter = 'all' | 'favorite' | 'desktop' | 'shared' | 'archive';
export type NoteId = number | `local-${ string }`;

export interface NotesConfig {
	restBase: string;
	restNonce: string;
	userId: number;
	draftScope?: string;
	colors: string[];
}

export interface Note {
	id: NoteId;
	title: string;
	body: string;
	excerpt: string;
	color: string;
	tags: string[];
	favorite: boolean;
	archived: boolean;
	onDesktop: boolean;
	public: boolean;
	ownerId: number;
	ownerName: string;
	ownerAvatar: string;
	canEdit: boolean;
	createdAt: string;
	updatedAt: string;
	updatedAtMs: number;
	version: number;
	wordCount: number;
}

export interface TagSummary {
	label: string;
	count: number;
}

export interface NotesLibrary {
	notes: Note[];
	tags: TagSummary[];
}

export interface NoteRevision {
	id: number;
	title: string;
	body: string;
	createdAt: string;
}

export interface NoteMutation {
	title: string;
	body: string;
	color: string;
	tags: string[];
	favorite: boolean;
	archived: boolean;
	onDesktop: boolean;
	public: boolean;
	version?: number;
	updatedAtMs?: number;
}

export interface DraftEntry extends NoteMutation {
	id: NoteId;
	clientUpdatedAt: number;
}

export interface NotesDraftJournal {
	entries: Record< string, DraftEntry >;
}

export interface NativeRenderContext {
	signal: AbortSignal;
	markLoading(): void;
	markReady(): void;
}

export interface OsTagItem {
	id?: string;
	label: string;
}

export interface OsTagInputElement extends HTMLElement {
	value: OsTagItem[];
	suggestions: OsTagItem[];
	readonly?: boolean;
}

export interface DesktopApi {
	ready( callback: () => void ): void;
	getWindowConfig( id: string ): NotesConfig | undefined;
	fetch(
		input: RequestInfo | URL,
		init?: RequestInit,
		options?: { windowId?: string; source?: string; silent?: boolean },
	): Promise< Response >;
	confirm( options: {
		title: string;
		message: string;
		confirmLabel?: string;
		cancelLabel?: string;
		danger?: boolean;
	} ): Promise< boolean >;
}

declare global {
	interface Window {
		wp?: {
			os?: DesktopApi;
			i18n?: {
				__( text: string, domain?: string ): string;
				sprintf( format: string, ...values: Array< string | number > ): string;
			};
		};
		openStationNativeWindows?: Record<
			string,
			(
				container: HTMLElement,
				context: NativeRenderContext,
			) => void | ( () => void ) | Promise< void | ( () => void ) >
		>;
	}
}

export {};
