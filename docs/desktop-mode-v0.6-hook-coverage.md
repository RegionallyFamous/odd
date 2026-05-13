# Desktop Mode hook coverage

ODD targets WP Desktop Mode v0.8.0+ for its desktop integration. This
matrix tracks every Desktop Mode hook/API family that matters to ODD and
states whether ODD uses it for product behavior, diagnostics, or
documented non-participation.

Status values:

- `supported` - ODD uses the surface for user-visible behavior or a
  first-class integration.
- `diagnostics-only` - ODD records the surface in local diagnostics but
  does not change behavior.
- `not applicable` - the surface does not map to ODD's product model.
- `planned upstream` - Desktop Mode documents the surface as planned, so
  ODD intentionally does not depend on it yet.

## PHP Hooks And Helpers

| Desktop Mode family | ODD status | Notes |
|---|---|---|
| Shell lifecycle: `desktop_mode_mode_init`, `desktop_mode_shell_before`, `desktop_mode_shell_after`, `desktop_mode_mode_enabled` | diagnostics-only | ODD depends on the rendered shell but does not need to alter shell boot. |
| Shell config: `desktop_mode_shell_config` | supported | Used for cursor stylesheet and native ODD config. |
| Portal redirects: `desktop_mode_portal_auto_enable`, `desktop_mode_admin_redirect_to_portal` | not applicable | ODD does not own admin routing. |
| Window/icon/widget/wallpaper registration and `*_registered` actions | supported | ODD registers the Shop, app windows, desktop icons, and the wallpaper host. |
| Command script registration: `desktop_mode_register_command_script()` | supported | ODD registers the command script for live plugin activation/deactivation. |
| Settings tab registration: `desktop_mode_register_settings_tab_script()`, `desktop_mode_register_settings_tab()` | supported | ODD adds a Desktop Mode settings tab. |
| Title-bar button script registration: `desktop_mode_register_titlebar_button_script()` | supported | ODD registers a diagnostics title-bar button script. |
| Dock rail renderer registration: `desktop_mode_register_dock_rail_renderer_script()` | supported | ODD registers `odd-compact` via `odd-dock-rail.js` — pickable in OS Settings → Dock style alongside the default strip. |
| Dock filters: `desktop_mode_dock_items`, `desktop_mode_dock_item`, `desktop_mode_dock_item_multi`, `desktop_mode_dock_placement`, `desktop_mode_arrange_menu_items` | supported | ODD uses dock/icon filters and app placement. |
| Appearance filters: `desktop_mode_accent_colors`, `desktop_mode_toast_types`, `desktop_mode_default_wallpaper`, `desktop_mode_wallpapers`, `desktop_mode_icons`, `desktop_mode_window_tabs` | supported | ODD contributes accents, toast tone, wallpapers, icon sets, and native surfaces. |
| AI provider/tool hooks | diagnostics-only | ODD can expose catalog/shop actions only when Desktop Mode's experimental AI APIs are present. |
| Debug helpers: `desktop_mode_debug_publish()`, `desktop_mode_debug_session_for_request()` | diagnostics-only | ODD publishes local diagnostics into debug sessions when available. |
| Recycle Bin hooks | supported | ODD adds a cross-link hint (`Open ODD Shop`) in the recycle bin + My WordPress templates; click handling lives in `odd-desktop-hooks`. |
| Window chrome theme registration | supported | ODD registers PHP theme `odd/shop-chrome` (CSS token map) when `oddout_desktop_mode_supports( 'window_chrome' )`. |
| My WordPress hooks | supported | ODD injects a Shop cross-link via `desktop_mode_my_wordpress_template_html`. |
| Presence hooks | diagnostics-only | ODD records presence transitions for debugging only. |
| Planned window/body/context hooks | planned upstream | ODD will not ship dependencies on planned-only contracts. |

## JavaScript Hooks And APIs

| Desktop Mode family | ODD status | Notes |
|---|---|---|
| Bootstrap: `wp.desktop.ready()`, `isReady()`, `desktop-mode-init` | supported | ODD uses Desktop Mode readiness for commands, settings, and hook registration. |
| Window lifecycle: `desktop-mode.window.opened`, `reopened`, `content-loading`, `content-loaded`, `closing`, `closed`, `focused`, `blurred`, `changed`, `detached`, `bounds-changed`, `body-resized` | supported | ODD normalizes ODD Shop/app window events and records all relevant lifecycle data. |
| Window APIs: `openWindow()`, `getWindowConfig()`, `debug.window()`, `Window.markContentLoading()`, `Window.markContentLoaded()`, `Window.send()`, `Window.on()` | supported | ODD uses these for Shop/app opening, app loading state, and diagnostics snapshots. |
| Native-window hooks: `desktop-mode.native-window.before-render`, `after-render`, `before-close` | supported | ODD decorates ODD native surfaces and records lifecycle events. |
| Iframe hooks: `desktop-mode.iframe.ready`, `error`, `network-completed` | supported | ODD app failures and network errors flow into diagnostics. |
| Widget hooks: `desktop-mode.widget.mounting`, `mounted`, `unmounting`, `mount-failed`, `added`, `removed` | supported | ODD records installed widget lifecycle and surfaces mount failures. |
| Wallpaper hooks: `desktop-mode.wallpapers`, `desktop-mode.wallpaper.mounting`, `mounted`, `unmounting`, `mount-failed`, `visibility`, `surfaces` | supported | ODD uses visibility and records lifecycle/surface data for scene reliability. |
| Dock hooks: `desktop-mode.dock.before-render`, `tile-class`, `tile-element`, `tile-tooltip`, `tile-rendered`, `after-render`, `item-appended`, `item-removed` | supported | ODD decorates ODD tiles and records dock rendering behavior. |
| Dock APIs: `openOsSettings()`, `listSystemTiles()`, `getSystemTile()`, `getMenuItems()`, `renderIcon()`, `isDockElement()` | supported | ODD uses these where available for settings, diagnostics, and launcher integration. |
| Command APIs and hooks: `registerCommand()`, `desktop-mode.command.before-run`, `after-run`, `error`, `desktop-mode.open-command.items` | supported | ODD registers commands, contributes `/open` items, and records command lifecycle. |
| Settings tabs: `registerSettingsTab()`, `listSettingsTabs()` | supported | ODD renders an OS Settings tab with health and diagnostics actions. |
| Activity channels: toast, attention, badge, open-requested, presence-changed, presence-snapshot-applied | diagnostics-only | ODD records activity and uses toast/attention/badge helpers when relevant. |
| Toast API: `wp.desktop.showToast()` and `desktop-mode.shell.toast` | supported | ODD uses the host toast API from its shared client API. |
| Broadcast, subscribe, shared store, heartbeat, presence | diagnostics-only | ODD records these surfaces but does not introduce cross-window state yet. |
| Palette APIs | diagnostics-only | ODD documents palette presence; commands remain the product surface. |
| DevTools APIs | diagnostics-only | ODD observes app-window requests when available for local bug reports. |
| Debug bus | diagnostics-only | ODD can publish copied diagnostics into a Desktop Mode debug session. |
| Window chrome controls/slots/themes | supported | ODD registers a window **theme** (`odd/shop-chrome`); title-bar integration remains as before. |
| Recycle Bin JS/REST APIs | diagnostics-only | ODD records signals but does not change content lifecycle. |
