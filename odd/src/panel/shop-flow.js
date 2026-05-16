/**
 * ODD Shop flow helpers.
 *
 * Pure-ish card-state and trust classification helpers shared by the
 * panel renderer, tests, and future Shop slices. The module is a classic
 * IIFE because ODD ships unbundled in wp-admin.
 */
( function () {
	'use strict';
	if ( typeof window === 'undefined' ) return;

	window.__odd = window.__odd || {};
	if ( window.__odd.shopFlow ) return;

	function text( ctx, value ) {
		var t = ctx && typeof ctx.t === 'function' ? ctx.t : function ( s ) { return s; };
		return t( value );
	}

	function makeState( ctx, id, phase, statusLabel, badgeLabel, badgeMod, action, isActive ) {
		return {
			id: id,
			phase: phase,
			statusLabel: statusLabel,
			badge: { label: badgeLabel || statusLabel, mod: badgeMod || id },
			action: action,
			isActive: !! isActive,
		};
	}

	function cardState( row, ctx ) {
		ctx = ctx || {};
		var isActive = !! ctx.isActive;
		if ( row && row.incompatible ) {
			return makeState(
				ctx,
				'incompatible',
				'blocked',
				text( ctx, 'Incompatible' ),
				text( ctx, 'Requires newer host' ),
				'warning',
				{ label: text( ctx, 'Incompatible' ), kind: 'incompatible', disabled: true },
				isActive
			);
		}
		if ( ctx.isInstalling ) {
			var progress = ctx.progress || { label: text( ctx, 'Installing…' ), status: text( ctx, 'Installing' ) };
			var mode = ctx.installMode || 'install';
			var busyId = mode === 'update' ? 'updating' : ( mode === 'repair' ? 'repairing' : 'installing' );
			return makeState(
				ctx,
				busyId,
				'busy',
				progress.status,
				progress.status,
				'installing',
				{ label: progress.label, kind: 'installing', disabled: true, progress: true },
				isActive
			);
		}
		if ( ! row || ! row.installed ) {
			return makeState(
				ctx,
				'available',
				'available',
				text( ctx, 'Available' ),
				text( ctx, 'Available' ),
				'available',
				{ label: text( ctx, 'Install' ), kind: 'install', disabled: false },
				isActive
			);
		}
		if ( row.broken ) {
			return makeState(
				ctx,
				'repair',
				'attention',
				text( ctx, 'Needs repair' ),
				text( ctx, 'Needs repair' ),
				'warning',
				{ label: text( ctx, 'Repair' ), kind: 'repair', disabled: false },
				isActive
			);
		}
		if ( row.updateAvailable ) {
			return makeState(
				ctx,
				'update',
				'attention',
				text( ctx, 'Update available' ),
				text( ctx, 'Update' ),
				'update',
				{ label: text( ctx, 'Update' ), kind: 'update', disabled: false },
				isActive
			);
		}
		var pending = ctx.pendingReload;
		if ( pending && row.slug && row.installed && ( pending.slug === row.slug || pending.slug === '*' ) ) {
			return makeState(
				ctx,
				'applying',
				'busy',
				text( ctx, 'Applying changes' ),
				text( ctx, 'Applying' ),
				'applying',
				{ label: text( ctx, 'Applying…' ), kind: 'pending_reload', disabled: true },
				isActive
			);
		}
		if ( row.requiresReload ) {
			return makeState(
				ctx,
				'reload',
				'attention',
				text( ctx, 'Reload required' ),
				text( ctx, 'Reload required' ),
				'warning',
				{ label: text( ctx, 'Reload now' ), kind: 'reload', disabled: false },
				isActive
			);
		}
		if ( isActive ) {
			return makeState(
				ctx,
				'active',
				'active',
				text( ctx, 'Active' ),
				text( ctx, 'Active' ),
				'active',
				{ label: text( ctx, 'Active' ), kind: 'active', disabled: true },
				isActive
			);
		}
		if ( row.type === 'scene' || row.type === 'icon-set' || row.type === 'cursor-set' ) {
			return makeState(
				ctx,
				'ready',
				'ready',
				text( ctx, 'Ready to apply' ),
				text( ctx, 'Installed' ),
				'installed',
				{ label: text( ctx, 'Apply' ), kind: 'apply', disabled: false },
				isActive
			);
		}
		if ( row.type === 'widget' ) {
			return makeState(
				ctx,
				'ready',
				'ready',
				text( ctx, 'Ready to add' ),
				text( ctx, 'Installed' ),
				'installed',
				{ label: text( ctx, 'Add' ), kind: 'add', disabled: false },
				isActive
			);
		}
		return makeState(
			ctx,
			'installed',
			'installed',
			text( ctx, 'Installed' ),
			text( ctx, 'Installed' ),
			'installed',
			{ label: text( ctx, row.type === 'app' ? 'Open' : 'Open' ), kind: 'open', disabled: false },
			isActive
		);
	}

	function trustProfile( row, ctx ) {
		ctx = ctx || {};
		var type = row && row.type;
		if ( type === 'icon-set' ) {
			return {
				id: 'static-images',
				label: text( ctx, 'Static images' ),
				detail: text( ctx, 'Raster icon files only. ODD validates the image files and Desktop Mode renders them natively.' ),
			};
		}
		if ( type === 'cursor-set' ) {
			return {
				id: 'pointer-assets',
				label: text( ctx, 'Pointer assets' ),
				detail: text( ctx, 'Cursor files and generated CSS only. ODD validates paths, sizes, and cursor formats before install.' ),
			};
		}
		if ( type === 'scene' || type === 'widget' ) {
			return {
				id: 'local-code',
				label: text( ctx, 'Runs locally' ),
				detail: type === 'scene'
					? text( ctx, 'Wallpaper scenes run JavaScript locally in your admin session so they can animate the desktop canvas.' )
					: text( ctx, 'Widgets run JavaScript locally and use Desktop Mode widget teardown when they leave the desktop.' ),
			};
		}
		if ( type === 'app' ) {
			return {
				id: 'sandboxed-app',
				label: text( ctx, 'Sandboxed app' ),
				detail: text( ctx, 'Apps open inside a Desktop Mode window with ODD file serving, CSP headers, and local diagnostics.' ),
			};
		}
		return {
			id: 'bundle',
			label: text( ctx, 'ODD bundle' ),
			detail: text( ctx, 'Installed through the same validated ODD bundle pipeline as the rest of the Shop.' ),
		};
	}

	window.__odd.shopFlow = {
		version: '1.0.0',
		cardState: cardState,
		trustProfile: trustProfile,
	};
} )();
