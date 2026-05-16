<?php
/**
 * ODD — script + style enqueues.
 *
 * All handles share a single localized `window.oddout` config blob.
 *
 * Foundation modules — no user-visible behavior, but every feature
 * shipped on top of ODD should read through them:
 *
 *   - `odd-store`      window.__odd.store — typed state container
 *   - `odd-events`     window.__odd.events — typed event bus on wp.hooks
 *   - `odd-registries` window.__odd.registries — filter-aware readers
 *   - `odd-lifecycle`  window.__odd.lifecycle — explicit boot phases
 *   - `odd-safecall`   window.__odd.safeCall — error boundary helper
 *   - `odd-debug`      window.__odd.debug — inspector (self-gates)
 *
 * Apps: `?odd-apps-debug=1` on wp-admin traces `[ODD apps]` iframe
 * hydration in the console without enabling full odd-debug store mode.
 *
 * Feature surfaces:
 *
 *   - `odd-api`       shared client helpers on window.__odd.api
 *                     (setScene / setIconSet / shuffle / toast /
 *                     onSceneChange). All other surfaces depend on it.
 *   - `odd-sdk`       stable facade on window.__odd.sdk for integrations
 *                     that need storage, prefs, diagnostics, and teardown.
 *   - `odd-cursors`   installs/updates the active cursor stylesheet
 *                     link in the current shell/admin document.
 *   - `odd-icon-effects` CSS-only hover/focus treatment for raster
 *                     icon-set images; keeps the source glyph intact.
 *   - `odd`           wallpaper engine boot (Pixi + scene registrar).
 *                     Registers the `odd` wallpaper with WP Desktop Mode.
 *   - `odd-shop-flow` Pure card-state/trust helpers used by the Shop.
 *   - `odd-panel`     ODD Shop native-window render callback,
 *                     declared on `window.desktopModeNativeWindows.odd`.
 *                     (1.0+: the stock Sticky Note + Magic 8-Ball
 *                     widgets ship as remote catalog bundles and
 *                     self-enqueue from uploads/odd/widgets/ when
 *                     installed — the plugin emits no stock widgets.)
 *   - `odd-commands`  registers slash commands (/odd, /odd-icons,
 *                     /shuffle, /odd-panel) via registerCommand().
 *
 * All handles load only when WP Desktop Mode is active.
 */

defined( 'ABSPATH' ) || exit;

add_action(
	'admin_enqueue_scripts',
	function () {
		if ( ! oddout_desktop_mode_available() ) {
			return;
		}

		$asset_version = static function ( $relative_path ) {
			$path = ODDOUT_DIR . ltrim( $relative_path, '/' );
			if ( is_readable( $path ) ) {
				return ODDOUT_VERSION . '-' . filemtime( $path );
			}
			return ODDOUT_VERSION;
		};

		// Foundation modules. Strictly ordered: store → events → the
		// rest. Each is a small IIFE that installs onto window.__odd
		// and returns. Any of them can be loaded on its own without
		// waiting on feature surfaces.
		wp_enqueue_script(
			'odd-store',
			ODDOUT_URL . '/src/shared/store.js',
			array(),
			ODDOUT_VERSION,
			true
		);
		wp_enqueue_script(
			'odd-events',
			ODDOUT_URL . '/src/shared/events.js',
			array( 'wp-hooks', 'odd-store' ),
			ODDOUT_VERSION,
			true
		);
		wp_enqueue_script(
			'odd-registries',
			ODDOUT_URL . '/src/shared/registries.js',
			array( 'wp-hooks', 'odd-store' ),
			ODDOUT_VERSION,
			true
		);
		wp_enqueue_script(
			'odd-lifecycle',
			ODDOUT_URL . '/src/shared/lifecycle.js',
			array( 'odd-store', 'odd-events' ),
			ODDOUT_VERSION,
			true
		);
		wp_enqueue_script(
			'odd-safecall',
			ODDOUT_URL . '/src/shared/safecall.js',
			array( 'odd-store', 'odd-events' ),
			ODDOUT_VERSION,
			true
		);
		wp_enqueue_script(
			'odd-debug',
			ODDOUT_URL . '/src/shared/debug.js',
			array( 'odd-store', 'odd-events', 'odd-registries', 'odd-lifecycle' ),
			ODDOUT_VERSION,
			true
		);
		wp_enqueue_script(
			'odd-diagnostics',
			ODDOUT_URL . '/src/shared/diagnostics.js',
			array( 'odd-events' ),
			$asset_version( 'src/shared/diagnostics.js' ),
			true
		);

		// Feature surfaces. `odd-api` depends on every foundation
		// module so downstream scripts can assume the full stack is
		// installed before their IIFE runs.
		$foundation_deps = array(
			'desktop-mode',
			'wp-hooks',
			'odd-store',
			'odd-events',
			'odd-registries',
			'odd-lifecycle',
			'odd-safecall',
			'odd-debug',
			'odd-diagnostics',
		);

		wp_enqueue_script(
			'odd-api',
			ODDOUT_URL . '/src/shared/api.js',
			$foundation_deps,
			ODDOUT_VERSION,
			true
		);
		wp_enqueue_script(
			'odd-sdk',
			ODDOUT_URL . '/src/shared/sdk.js',
			array_merge( $foundation_deps, array( 'odd-api' ) ),
			$asset_version( 'src/shared/sdk.js' ),
			true
		);
		wp_enqueue_script(
			'odd-workspace',
			ODDOUT_URL . '/src/shared/workspace.js',
			array_merge( $foundation_deps, array( 'odd-api' ) ),
			$asset_version( 'src/shared/workspace.js' ),
			true
		);
		wp_enqueue_script(
			'odd-shop-flow',
			ODDOUT_URL . '/src/panel/shop-flow.js',
			array_merge( $foundation_deps, array( 'odd-api' ) ),
			$asset_version( 'src/panel/shop-flow.js' ),
			true
		);
		wp_enqueue_script(
			'odd-cursors',
			ODDOUT_URL . '/src/cursors/index.js',
			$foundation_deps,
			ODDOUT_VERSION,
			true
		);
		wp_enqueue_script(
			'odd',
			ODDOUT_URL . '/src/wallpaper/index.js',
			array_merge( $foundation_deps, array( 'odd-api', 'odd-cursors' ) ),
			$asset_version( 'src/wallpaper/index.js' ),
			true
		);
		wp_enqueue_script(
			'odd-panel',
			ODDOUT_URL . '/src/panel/index.js',
			array_merge( $foundation_deps, array( 'odd-api', 'odd-workspace', 'odd-shop-flow', 'odd-cursors', 'wp-i18n' ) ),
			$asset_version( 'src/panel/index.js' ),
			true
		);
		wp_enqueue_script(
			'odd-shop-cast',
			ODDOUT_URL . '/src/shop/cast.js',
			array( 'odd-panel' ),
			ODDOUT_VERSION,
			true
		);
		// Extracted from the 500-line `injectStyles()` string that used
		// to live in odd/src/panel/index.js. Ships as a real
		// stylesheet now so the browser can cache it and editors
		// can highlight it. The JS still lazy-loads a `<link>` in
		// contexts where `wp_enqueue_style` didn't run (tests,
		// standalone), keyed off the localized pluginUrl value.
		wp_enqueue_style(
			'odd-panel-style',
			ODDOUT_URL . '/src/panel/styles.css',
			array(),
			$asset_version( 'src/panel/styles.css' )
		);
		// ODD 1.0 ships no stock widgets. Sticky Note and Magic
		// 8-Ball moved to the remote catalog as `widget-sticky` +
		// `widget-eight-ball`. Installed widget bundles self-enqueue
		// through content/widgets.php, so there's nothing for the
		// plugin core to emit here any more.
		wp_enqueue_script(
			'odd-commands',
			ODDOUT_URL . '/src/commands/index.js',
			array_merge( $foundation_deps, array( 'odd-api', 'wp-i18n' ) ),
			ODDOUT_VERSION,
			true
		);
		wp_enqueue_script(
			'odd-desktop-hooks',
			ODDOUT_URL . '/src/shared/desktop-hooks.js',
			array_merge( $foundation_deps, array( 'odd-api', 'odd-commands' ) ),
			ODDOUT_VERSION,
			true
		);
		if ( function_exists( 'desktop_mode_register_command_script' ) ) {
			desktop_mode_register_command_script( 'odd-commands' );
		}
		if ( function_exists( 'desktop_mode_register_settings_tab_script' ) ) {
			desktop_mode_register_settings_tab_script( 'odd-desktop-hooks' );
		}
		if ( function_exists( 'desktop_mode_register_titlebar_button_script' ) ) {
			desktop_mode_register_titlebar_button_script( 'odd-desktop-hooks' );
		}
		if ( function_exists( 'desktop_mode_register_settings_tab' ) ) {
			desktop_mode_register_settings_tab(
				array(
					'id'         => 'odd',
					'label'      => __( 'ODD', 'odd-outlandish-desktop-decorator' ),
					'capability' => 'manage_options',
					'order'      => 50,
					'script'     => 'odd-desktop-hooks',
				)
			);
		}
		// Screensaver: idle-detector + fullscreen scene overlay.
		// Self-contained — only depends on odd-store (for the
		// localized prefs) and odd-events (for panel echoes).
		wp_enqueue_script(
			'odd-screensaver',
			ODDOUT_URL . '/src/screensaver/index.js',
			array( 'odd-store', 'odd-events' ),
			ODDOUT_VERSION,
			true
		);
		wp_enqueue_style(
			'odd-icon-contrast',
			ODDOUT_URL . '/src/icons/contrast.css',
			array( 'desktop-mode' ),
			ODDOUT_VERSION
		);
		wp_enqueue_style(
			'odd-dm-integration-hints',
			ODDOUT_URL . '/src/shell/desktop-mode-integration-hints.css',
			array(),
			$asset_version( 'src/shell/desktop-mode-integration-hints.css' )
		);
		if ( function_exists( 'oddout_desktop_mode_supports' ) && oddout_desktop_mode_supports( 'dock_rail' ) ) {
			wp_enqueue_style(
				'odd-dock-rail',
				ODDOUT_URL . '/src/shell/odd-dock-rail.css',
				array( 'desktop-mode' ),
				$asset_version( 'src/shell/odd-dock-rail.css' )
			);
			wp_enqueue_script(
				'odd-dock-rail',
				ODDOUT_URL . '/src/shell/odd-dock-rail.js',
				array( 'desktop-mode', 'wp-i18n' ),
				$asset_version( 'src/shell/odd-dock-rail.js' ),
				true
			);
			if ( function_exists( 'desktop_mode_register_dock_rail_renderer_script' ) ) {
				desktop_mode_register_dock_rail_renderer_script( 'odd-dock-rail' );
			}
		}
		wp_enqueue_style(
			'odd-icon-effects',
			ODDOUT_URL . '/src/icons/effects.css',
			array( 'desktop-mode', 'odd-icon-contrast' ),
			$asset_version( 'src/icons/effects.css' )
		);

		// ---- Apps ---- //
		//
		// Single JS handle `odd-apps` hosts the sandboxed iframe for
		// every installed app. Listens to odd.window-* and re-emits
		// the canonical odd.app-* events. Feature-flagged server-side
		// via ODDOUT_APPS_ENABLED; we still enqueue the listener so that
		// manually-registered apps (via oddout_register_app from another
		// plugin) work even when uploads are off.
		//
		// `wp-dom-ready` guarantees DOM readiness before window-host.js
		// hydrates native window bodies. We used to also depend on
		// `wp-element` because the runtime shim proxied through
		// `window.parent.wp.element`, but v1.5.6 ships real React 19
		// from /odd-app-runtime/*.js so that proxy (and its version
		// skew against React 18 wp-element) is no longer relevant.
		wp_enqueue_script(
			'odd-apps',
			ODDOUT_URL . '/src/apps/window-host.js',
			array_merge( $foundation_deps, array( 'odd-api', 'odd-cursors', 'wp-dom-ready' ) ),
			$asset_version( 'src/apps/window-host.js' ),
			true
		);

		// ---- Iris personality ---- //
		//
		// Five small modules, each strict IIFE, each registering a
		// muse / motion / ritual / reactivity / eye layer. Order
		// matters only inasmuch as muse + motion must install
		// before reactivity + rituals start emitting. The first-run
		// onboarding card was retired in v1.0.3 — the panel now
		// opens directly on the Wallpaper section.
		//
		// Keep Iris modules as first-class enqueued files so the
		// distributed plugin stays easy to inspect and Plugin Check
		// can reason about the scripts without an inline bundle.
		$iris_deps    = array_merge( $foundation_deps, array( 'odd-api' ) );
		$iris_modules = array( 'muse.js', 'motion.js', 'rituals.js', 'reactivity.js', 'eye.js' );
		$iris_prev    = $iris_deps;
		foreach ( $iris_modules as $mod ) {
			$handle = 'odd-iris-' . sanitize_key( basename( $mod, '.js' ) );
			wp_enqueue_script(
				$handle,
				ODDOUT_URL . '/src/iris/' . $mod,
				$iris_prev,
				$asset_version( 'src/iris/' . $mod ),
				true
			);
			$iris_prev = array( $handle );
		}
		// Compatibility umbrella for downstream dependencies that
		// expect `odd-iris` to exist after the module chain has run.
		wp_register_script( 'odd-iris', false, $iris_prev, ODDOUT_VERSION, true );
		wp_enqueue_script( 'odd-iris' );

		$uid = get_current_user_id();

		$sets = array();
		foreach ( oddout_icons_get_sets() as $set ) {
			$sets[] = array(
				'slug'        => $set['slug'],
				'label'       => $set['label'],
				'category'    => $set['category'],
				'accent'      => $set['accent'],
				'description' => $set['description'],
				'preview'     => $set['preview'],
				'icons'       => $set['icons'],
			);
		}

		$cursor_sets = array();
		foreach ( oddout_cursors_get_sets() as $set ) {
			$cursor_sets[] = array(
				'slug'        => $set['slug'],
				'label'       => $set['label'],
				'category'    => $set['category'],
				'accent'      => $set['accent'],
				'description' => $set['description'],
				'preview'     => $set['preview'],
				'effects'     => isset( $set['effects'] ) && is_array( $set['effects'] ) ? $set['effects'] : array(),
				'cursors'     => isset( $set['cursors'] ) && is_array( $set['cursors'] ) ? $set['cursors'] : array(),
			);
		}

		// Resolve once, reuse — the panel reads both `scene` (canonical)
		// and `wallpaper` (alias for older consumers) off the same key.
		$scenes       = oddout_wallpaper_scenes();
		$active_scene = oddout_wallpaper_get_user_scene( $uid );
		$apps_enabled = defined( 'ODDOUT_APPS_ENABLED' ) && ODDOUT_APPS_ENABLED;
		$installed    = ( $apps_enabled && function_exists( 'oddout_apps_list' ) ) ? wp_list_pluck( oddout_apps_list(), 'slug' ) : array();
		$has_ext      = function_exists( 'oddout_extensions_collect' );

		// Per-slug serve URLs for client-side hydration. We bake one
		// fresh `_wpnonce` into each URL so the app can, if it wants,
		// read it back via URLSearchParams and use it for REST calls
		// back into /wp-json/odd/v1/. The cookie-auth serve path
		// itself doesn't require the nonce; it's there purely as a
		// convenience for the app's own fetches.
		//
		// Emitted under `appServeUrls` so window-host.js can register
		// a `desktopModeNativeWindows[id]` render callback that builds
		// the iframe directly in JS — independent of any server-
		// rendered <template> being present in the DOM.
		$app_serve_urls = array();
		if ( $apps_enabled && function_exists( 'oddout_apps_cookieauth_url_for' ) && is_array( $installed ) ) {
			foreach ( $installed as $_slug ) {
				$app_serve_urls[ $_slug ] = esc_url_raw(
					add_query_arg(
						array( '_wpnonce' => wp_create_nonce( 'wp_rest' ) ),
						oddout_apps_cookieauth_url_for( $_slug )
					)
				);
			}
		}

		$config = array(
			'pluginUrl'         => ODDOUT_URL,
			'version'           => ODDOUT_VERSION,
			'schemaVersion'     => defined( 'ODDOUT_SCHEMA_VERSION' ) ? ODDOUT_SCHEMA_VERSION : 0,
			'restUrl'           => esc_url_raw( oddout_https_rest_url( 'odd/v1/prefs' ) ),
			'restNonce'         => wp_create_nonce( 'wp_rest' ),

			// Wallpaper. `scenes` is the array shape the panel needs;
			// `sceneMap` is a slug→descriptor dict installed scene.js
			// bundles read to resolve their `wallpaperUrl` + `previewUrl`
			// without having to scan `scenes` on every frame.
			'scenes'            => $scenes,
			'sceneMap'          => array_column( $scenes, null, 'slug' ),
			'scene'             => $active_scene,
			'wallpaper'         => $active_scene,
			'favorites'         => oddout_wallpaper_get_user_slug_list( $uid, 'oddout_favorites' ),
			'recents'           => oddout_wallpaper_get_user_slug_list( $uid, 'oddout_recents' ),
			'shuffle'           => oddout_wallpaper_get_user_shuffle( $uid ),
			'screensaver'       => oddout_wallpaper_get_user_screensaver( $uid ),
			'audioReactive'     => oddout_wallpaper_get_user_audio_reactive( $uid ),
			'shopTaskbar'       => function_exists( 'oddout_shop_taskbar_enabled' ) ? oddout_shop_taskbar_enabled( $uid ) : false,
			'shopDesktopPinned' => function_exists( 'oddout_shop_desktop_pinned' ) ? oddout_shop_desktop_pinned( $uid ) : false,
			'shopV2'            => apply_filters( 'oddout_shop_v2', true ),
			'theme'             => function_exists( 'oddout_shop_get_theme' ) ? oddout_shop_get_theme( $uid ) : 'auto',
			'chaosMode'         => (bool) get_user_meta( $uid, 'oddout_chaos', true ),

			// Iris personality prefs.
			'initiated'         => (bool) get_user_meta( $uid, 'oddout_initiated', true ),
			'mascotQuiet'       => (bool) get_user_meta( $uid, 'oddout_mascot_quiet', true ),
			'winkUnlocked'      => (bool) get_user_meta( $uid, 'oddout_wink_unlocked', true ),

			// Icons.
			'iconSets'          => $sets,
			'iconSet'           => oddout_icons_get_active_slug( $uid ),

			// Cursors.
			'cursorSets'        => $cursor_sets,
			'cursorSet'         => oddout_cursors_get_active_slug( $uid ),
			'cursorStylesheet'  => oddout_cursors_active_stylesheet_url(),

			// Registries for extension authors. Keys are *only* emitted
			// when a third-party plugin has actually filtered them to
			// non-empty; otherwise they're omitted from the localized
			// blob entirely and the localized config value is undefined.
			// shared/store.js already normalizes `undefined` to `[]`,
			// so surfaces that depend on the registry still behave. The
			// `$registry_slices` list below is appended to `$config`
			// after the base array is assembled (see below).

			// Apps (v0.16.0). `apps` is the installed + enabled list
			// filtered through oddout_app_registry. `userApps` is the
			// current user's personal slice — which apps they chose
			// to pin, and which they've installed themselves. Both
				// ship only when the apps feature is flag-enabled so the
				// JS store stays empty when apps are disabled.
			'appsEnabled'       => $apps_enabled,
			'apps'              => ( $apps_enabled && $has_ext ) ? oddout_extensions_collect( 'apps' ) : array(),
			'appServeUrls'      => $app_serve_urls,
			'userApps'          => array(
				'installed' => $installed,
				'pinned'    => (array) get_user_meta( $uid, 'oddout_apps_pinned', true ),
			),

			// Installed widget bundles (type: widget). Panel reads
			// these to merge user-installed widgets into the catalog
			// on the Widgets department. Empty when no widgets have
			// been installed — the built-in sticky + eight-ball live
			// entirely client-side.
			'installedWidgets'  => function_exists( 'oddout_widgets_index_load' ) ? array_values(
				array_map(
					function ( $row ) {
						return array(
							'id'          => 'odd/' . $row['slug'],
							'slug'        => $row['slug'],
							'label'       => isset( $row['label'] ) ? $row['label'] : $row['slug'],
							'description' => isset( $row['name'] ) ? $row['name'] : '',
							'category'    => isset( $row['category'] ) ? $row['category'] : 'Community',
							'installed'   => true,
						);
					},
					oddout_widgets_index_load()
				)
			) : array(),

			// Capability flags the Shop UI keys off when deciding
			// whether to render install affordances.
			'canInstall'        => current_user_can( 'manage_options' ),
			'bundlesUploadUrl'  => esc_url_raw( oddout_https_rest_url( 'odd/v1/bundles/upload' ) ),
			'bundleCatalogUrl'  => esc_url_raw( oddout_https_rest_url( 'odd/v1/bundles/catalog' ) ),
			'bundleInstallUrl'  => esc_url_raw( oddout_https_rest_url( 'odd/v1/bundles/install-from-catalog' ) ),
			'systemHealth'      => array(
				'catalog'     => function_exists( 'oddout_catalog_meta' ) ? oddout_catalog_meta() : array(),
				'starter'     => function_exists( 'oddout_starter_get_state_for_rest' ) ? oddout_starter_get_state_for_rest() : array(),
				'apps'        => array(
					'installed'  => is_array( $installed ) ? count( $installed ) : 0,
					'lastRepair' => function_exists( 'oddout_apps_repair_meta_all' ) ? oddout_apps_repair_meta_all() : array(),
				),
				'content'     => array(
					'scenes'     => is_array( $scenes ) ? count( $scenes ) : 0,
					'iconSets'   => is_array( $sets ) ? count( $sets ) : 0,
					'cursorSets' => is_array( $cursor_sets ) ? count( $cursor_sets ) : 0,
					'widgets'    => function_exists( 'oddout_widgets_index_load' ) ? count( oddout_widgets_index_load() ) : 0,
				),
				'cursors'     => array(
					'active'          => oddout_cursors_get_active_slug( $uid ),
					'stylesheet'      => oddout_cursors_active_stylesheet_url(),
					'registeredSets'  => is_array( $cursor_sets ) ? count( $cursor_sets ) : 0,
					'runtimeExpected' => true,
				),
				'desktopMode' => array(
					'version'              => oddout_desktop_mode_version(),
					'minimumVersion'       => oddout_desktop_mode_min_version(),
					'baseline'             => oddout_desktop_mode_available(),
					'commandScripts'       => oddout_desktop_mode_supports( 'commands' ),
					'settingsTabs'         => oddout_desktop_mode_supports( 'settings' ),
					'titlebarButtons'      => oddout_desktop_mode_supports( 'titlebar' ),
					'dockRailRenderers'    => oddout_desktop_mode_supports( 'dock_rail' ),
					'windowChromeThemes'   => oddout_desktop_mode_supports( 'window_chrome' ),
					'hostWidgets'          => oddout_desktop_mode_supports( 'host_widgets' ),
					'desktopFiles'         => oddout_desktop_mode_supports( 'desktop_files' ),
					'shortcutFileLayer'    => oddout_desktop_mode_version_at_least( '0.8.5' ),
					'sharedFolders'        => oddout_desktop_mode_supports( 'shared_folders' ),
					'presence'             => oddout_desktop_mode_supports( 'presence' ),
					'heartbeatWidget'      => oddout_desktop_mode_supports( 'heartbeat' ),
					'arrangeMenu'          => oddout_desktop_mode_version_at_least( '0.8.5' ),
					'debugSessions'        => oddout_desktop_mode_supports( 'debug' ),
					'aiTools'              => oddout_desktop_mode_supports( 'ai' ),
					'jsHookBridge'         => true,
					'dockRendererProvided' => function_exists( 'oddout_desktop_mode_supports' ) && oddout_desktop_mode_supports( 'dock_rail' ),
				),
			),
			// Pre-compute the Discover shelves by type so the panel
			// can render the catalog without a REST round-trip on
			// first paint. The `installed` flag is annotated so the
			// "Install" -> "Installed" state is decided server-side.
			'bundleCatalog'     => function_exists( 'oddout_bundle_catalog' ) ? array(
				'scene'     => oddout_bundle_catalog_for_type( 'scene' ),
				'iconSet'   => oddout_bundle_catalog_for_type( 'icon-set' ),
				'cursorSet' => oddout_bundle_catalog_for_type( 'cursor-set' ),
				'widget'    => oddout_bundle_catalog_for_type( 'widget' ),
				'app'       => oddout_bundle_catalog_for_type( 'app' ),
			) : array(),
		);

		// Only ship registry slices that a third-party plugin has
		// filled. Every empty one used to cost ~60 bytes of JSON even
		// when no extensions were active; in a default install that
		// was ~5 fields × every admin pageload.
		if ( $has_ext ) {
			foreach ( array( 'muses', 'commands', 'widgets', 'rituals', 'motionPrimitives' ) as $_slice ) {
				$entries = oddout_extensions_collect( $_slice );
				if ( ! empty( $entries ) ) {
					$config[ $_slice ] = $entries;
				}
			}
		}

		// The store and the feature surfaces read from the same
		// `window.oddout` global. Localizing once on `odd-store` puts
		// the inline <script> tag at the very start of the ODD
		// script chain so everything else sees a fully-populated
		// config blob.
		wp_localize_script( 'odd-store', 'oddout', $config );
	}
);
