<?php
/**
 * ODD Notes native-window template.
 */

defined( 'ABSPATH' ) || exit;

function oddout_notes_render_template() {
	?>
	<div class="os-notes-app" data-notes-app>
		<aside class="os-notes-app__sidebar" aria-label="<?php esc_attr_e( 'ODD Notes navigation', 'odd-outlandish-desktop-decorator' ); ?>">
			<div class="os-notes-app__brand">
				<span class="os-notes-app__brand-mark dashicons dashicons-media-text" aria-hidden="true"></span>
				<div>
					<strong><?php esc_html_e( 'ODD Notes', 'odd-outlandish-desktop-decorator' ); ?></strong>
					<span><?php esc_html_e( 'Private by default', 'odd-outlandish-desktop-decorator' ); ?></span>
				</div>
			</div>

			<os-button variant="holo" data-notes-new>
				<span class="dashicons dashicons-plus-alt2" aria-hidden="true"></span>
				<?php esc_html_e( 'New note', 'odd-outlandish-desktop-decorator' ); ?>
			</os-button>

			<os-text-field type="search" label="<?php esc_attr_e( 'Search notes', 'odd-outlandish-desktop-decorator' ); ?>" placeholder="<?php esc_attr_e( 'Title, words, or #tag', 'odd-outlandish-desktop-decorator' ); ?>" data-notes-search></os-text-field>

			<nav class="os-notes-app__filters" aria-label="<?php esc_attr_e( 'Smart lists', 'odd-outlandish-desktop-decorator' ); ?>">
				<button type="button" class="is-active" data-notes-filter="all">
					<span class="dashicons dashicons-media-text" aria-hidden="true"></span>
					<span><?php esc_html_e( 'All notes', 'odd-outlandish-desktop-decorator' ); ?></span>
					<small data-notes-count="all">0</small>
				</button>
				<button type="button" data-notes-filter="favorite">
					<span class="dashicons dashicons-star-filled" aria-hidden="true"></span>
					<span><?php esc_html_e( 'Favorites', 'odd-outlandish-desktop-decorator' ); ?></span>
					<small data-notes-count="favorite">0</small>
				</button>
				<button type="button" data-notes-filter="desktop">
					<span class="dashicons dashicons-desktop" aria-hidden="true"></span>
					<span><?php esc_html_e( 'On desktop', 'odd-outlandish-desktop-decorator' ); ?></span>
					<small data-notes-count="desktop">0</small>
				</button>
				<button type="button" data-notes-filter="shared">
					<span class="dashicons dashicons-groups" aria-hidden="true"></span>
					<span><?php esc_html_e( 'Shared', 'odd-outlandish-desktop-decorator' ); ?></span>
					<small data-notes-count="shared">0</small>
				</button>
				<button type="button" data-notes-filter="archive">
					<span class="dashicons dashicons-archive" aria-hidden="true"></span>
					<span><?php esc_html_e( 'Archive', 'odd-outlandish-desktop-decorator' ); ?></span>
					<small data-notes-count="archive">0</small>
				</button>
			</nav>

			<div class="os-notes-app__tag-nav">
				<div class="os-notes-app__section-label"><?php esc_html_e( 'Tags', 'odd-outlandish-desktop-decorator' ); ?></div>
				<div data-notes-tag-list></div>
			</div>

			<div class="os-notes-app__sidebar-foot">
				<span class="os-notes-app__sync-dot" data-notes-online-dot aria-hidden="true"></span>
				<span data-notes-online-label><?php esc_html_e( 'WordPress connected', 'odd-outlandish-desktop-decorator' ); ?></span>
			</div>
		</aside>

		<section class="os-notes-app__list-pane" aria-label="<?php esc_attr_e( 'Note list', 'odd-outlandish-desktop-decorator' ); ?>">
			<header>
				<div>
					<h2 data-notes-list-title><?php esc_html_e( 'All notes', 'odd-outlandish-desktop-decorator' ); ?></h2>
					<p data-notes-list-summary><?php esc_html_e( 'Loading your library…', 'odd-outlandish-desktop-decorator' ); ?></p>
				</div>
				<os-button variant="ghost" data-notes-refresh title="<?php esc_attr_e( 'Refresh', 'odd-outlandish-desktop-decorator' ); ?>">
					<span class="dashicons dashicons-update" aria-hidden="true"></span>
					<span class="screen-reader-text"><?php esc_html_e( 'Refresh', 'odd-outlandish-desktop-decorator' ); ?></span>
				</os-button>
			</header>
			<div class="os-notes-app__list" data-notes-list></div>
			<div class="os-notes-app__loading" data-notes-loading>
				<os-spinner preset="orbit"></os-spinner>
				<span><?php esc_html_e( 'Opening the notebook…', 'odd-outlandish-desktop-decorator' ); ?></span>
			</div>
		</section>

		<main class="os-notes-app__editor-pane">
			<div class="os-notes-app__empty" data-notes-empty>
				<div class="os-notes-app__empty-paper" aria-hidden="true"><span></span><span></span><span></span></div>
				<h2><?php esc_html_e( 'Catch the thought before it escapes.', 'odd-outlandish-desktop-decorator' ); ?></h2>
				<p><?php esc_html_e( 'Your drafts land here first, then tuck themselves safely into WordPress.', 'odd-outlandish-desktop-decorator' ); ?></p>
				<os-button variant="holo" data-notes-empty-new><?php esc_html_e( 'Write a note', 'odd-outlandish-desktop-decorator' ); ?></os-button>
			</div>

			<article class="os-notes-app__editor" data-notes-editor hidden>
				<header class="os-notes-app__editor-toolbar">
					<div class="os-notes-app__owner" data-notes-owner></div>
					<div class="os-notes-app__editor-actions">
						<os-button variant="ghost" data-notes-favorite title="<?php esc_attr_e( 'Favorite', 'odd-outlandish-desktop-decorator' ); ?>"><span class="dashicons dashicons-star-empty" aria-hidden="true"></span></os-button>
						<os-button variant="ghost" data-notes-duplicate title="<?php esc_attr_e( 'Duplicate', 'odd-outlandish-desktop-decorator' ); ?>"><span class="dashicons dashicons-admin-page" aria-hidden="true"></span></os-button>
						<os-button variant="ghost" data-notes-history title="<?php esc_attr_e( 'Version history', 'odd-outlandish-desktop-decorator' ); ?>"><span class="dashicons dashicons-backup" aria-hidden="true"></span></os-button>
						<os-button variant="ghost" data-notes-archive title="<?php esc_attr_e( 'Archive', 'odd-outlandish-desktop-decorator' ); ?>"><span class="dashicons dashicons-archive" aria-hidden="true"></span></os-button>
						<os-button variant="ghost" data-notes-delete title="<?php esc_attr_e( 'Move to Trash', 'odd-outlandish-desktop-decorator' ); ?>"><span class="dashicons dashicons-trash" aria-hidden="true"></span></os-button>
					</div>
				</header>

				<div class="os-notes-app__writing" data-notes-paper-color="butter">
					<os-text-field class="os-notes-app__title" label="<?php esc_attr_e( 'Title', 'odd-outlandish-desktop-decorator' ); ?>" placeholder="<?php esc_attr_e( 'Untitled note', 'odd-outlandish-desktop-decorator' ); ?>" maxlength="120" data-notes-title></os-text-field>
					<os-textarea class="os-notes-app__body" aria-label="<?php esc_attr_e( 'Note body', 'odd-outlandish-desktop-decorator' ); ?>" placeholder="<?php esc_attr_e( 'Start writing…', 'odd-outlandish-desktop-decorator' ); ?>" rows="18" maxlength="100000" data-notes-body></os-textarea>
				</div>

				<footer class="os-notes-app__meta" aria-label="<?php esc_attr_e( 'Note details', 'odd-outlandish-desktop-decorator' ); ?>">
					<div class="os-notes-app__meta-heading">
						<div>
							<strong><?php esc_html_e( 'Note details', 'odd-outlandish-desktop-decorator' ); ?></strong>
							<span><?php esc_html_e( 'Make this thought easy to find and share.', 'odd-outlandish-desktop-decorator' ); ?></span>
						</div>
						<div class="os-notes-app__status-row">
							<os-save-status mode="pill" idle-label="<?php esc_attr_e( 'Saved to WordPress', 'odd-outlandish-desktop-decorator' ); ?>" saving-label="<?php esc_attr_e( 'Saving…', 'odd-outlandish-desktop-decorator' ); ?>" saved-label="<?php esc_attr_e( 'Saved', 'odd-outlandish-desktop-decorator' ); ?>" data-notes-save-status></os-save-status>
							<span data-notes-stats></span>
						</div>
					</div>
					<div class="os-notes-app__tags-row os-notes-app__setting-card">
						<div class="os-notes-app__setting-copy">
							<strong><?php esc_html_e( 'Tags', 'odd-outlandish-desktop-decorator' ); ?></strong>
							<span><?php esc_html_e( 'Group related notes', 'odd-outlandish-desktop-decorator' ); ?></span>
						</div>
						<os-tag-input label="<?php esc_attr_e( 'Tags', 'odd-outlandish-desktop-decorator' ); ?>" placeholder="<?php esc_attr_e( 'Add a tag…', 'odd-outlandish-desktop-decorator' ); ?>" add-label="<?php esc_attr_e( 'Add', 'odd-outlandish-desktop-decorator' ); ?>" creatable data-notes-tags></os-tag-input>
					</div>
					<div class="os-notes-app__options-row os-notes-app__setting-card">
						<div class="os-notes-app__paper-colors">
							<div class="os-notes-app__setting-copy">
								<strong><?php esc_html_e( 'Paper', 'odd-outlandish-desktop-decorator' ); ?></strong>
								<span><?php esc_html_e( 'Pick a shade', 'odd-outlandish-desktop-decorator' ); ?></span>
							</div>
							<os-swatch-grid mode="row" label="<?php esc_attr_e( 'Paper color', 'odd-outlandish-desktop-decorator' ); ?>" data-notes-colors></os-swatch-grid>
						</div>
						<div class="os-notes-app__placement">
							<div class="os-notes-app__toggle-setting">
								<os-checkbox-label label="<?php esc_attr_e( 'Pin to desktop', 'odd-outlandish-desktop-decorator' ); ?>" data-notes-desktop></os-checkbox-label>
								<span><?php esc_html_e( 'Show it on your station', 'odd-outlandish-desktop-decorator' ); ?></span>
							</div>
							<div class="os-notes-app__toggle-setting">
								<os-checkbox-label label="<?php esc_attr_e( 'Share with site', 'odd-outlandish-desktop-decorator' ); ?>" data-notes-public></os-checkbox-label>
								<span><?php esc_html_e( 'Requires a desktop pin', 'odd-outlandish-desktop-decorator' ); ?></span>
							</div>
						</div>
					</div>
					<span class="os-notes-app__shortcut"><?php esc_html_e( '⌘S to save', 'odd-outlandish-desktop-decorator' ); ?></span>
				</footer>
			</article>

			<aside class="os-notes-app__history" data-notes-history-panel hidden aria-label="<?php esc_attr_e( 'Version history', 'odd-outlandish-desktop-decorator' ); ?>">
				<header>
					<div><h2><?php esc_html_e( 'Version history', 'odd-outlandish-desktop-decorator' ); ?></h2><p><?php esc_html_e( 'WordPress keeps the earlier words.', 'odd-outlandish-desktop-decorator' ); ?></p></div>
					<os-button variant="ghost" data-notes-history-close><?php esc_html_e( 'Close', 'odd-outlandish-desktop-decorator' ); ?></os-button>
				</header>
				<div data-notes-history-list></div>
			</aside>

			<div class="os-notes-app__toast" data-notes-toast role="status" aria-live="polite" hidden></div>
		</main>
	</div>
	<?php
}
