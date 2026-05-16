# Desktop Mode hook coverage

ODD targets WP Desktop Mode v0.8.5+ for its minimum desktop integration.
The stable hosted Playground installs the current WordPress.org Desktop Mode
release, while the dev Playground pins the release zip declared by
`ODDOUT_DESKTOP_MODE_PLAYGROUND_VERSION`. This matrix
tracks every Desktop Mode hook/API family that matters to ODD and states
whether ODD uses it for product behavior, diagnostics, or documented
non-participation.

Status values:

- `supported` - ODD uses the surface for user-visible behavior or a
  first-class integration.
- `diagnostics-only` - ODD records the surface in local diagnostics but
  does not change behavior.
- `not applicable` - the surface does not map to ODD's product model.
- `planned upstream` - Desktop Mode documents the surface as planned, so
  ODD intentionally does not depend on it yet.

## 0.8.5 Surface Notes

Desktop Mode 0.8.5 exposes the current `desktop-mode.*` JavaScript hook catalog
through `wp.desktop.HOOKS`, alongside the public `wp.desktop.*` APIs for
commands, palettes, modules, wallpaper surfaces, native windows, system tiles,
AI, and drag bridging. ODD registers through those native hooks/contracts when
they are present. It does not register old hook aliases or pre-0.8.5 PHP
fallbacks. Host-owned surfaces stay host-owned: ODD
observes and annotates, but does not live-swap dock DOM, restyle the host rails,
or move host window geometry.

## PHP Hooks And Helpers

| Desktop Mode family | ODD status | Notes |
|---|---|---|
| Shell lifecycle: `desktop_mode_mode_init`, `desktop_mode_shell_before`, `desktop_mode_shell_after`, `desktop_mode_mode_enabled` | diagnostics-only | ODD depends on the rendered shell but does not need to alter shell boot. |
| Shell config: `desktop_mode_shell_config` | supported | Used for cursor stylesheet and native ODD config. |
| Portal redirects: `desktop_mode_portal_auto_enable`, `desktop_mode_admin_redirect_to_portal` | not applicable | ODD does not own admin routing. |
| Window/icon/widget/wallpaper registration and `*_registered` actions | supported | ODD registers the Shop, app windows, desktop icons, installed widget metadata, and the wallpaper host. |
| Command script registration: `desktop_mode_register_command_script()` | supported | ODD registers the command script for live plugin activation/deactivation. |
| Settings tab registration: `desktop_mode_register_settings_tab_script()`, `desktop_mode_register_settings_tab()` | supported | ODD adds a Desktop Mode settings tab. |
| Title-bar button script registration: `desktop_mode_register_titlebar_button_script()` | supported | ODD registers a diagnostics title-bar button script. |
| Dock rail renderer registration: `desktop_mode_register_dock_rail_renderer_script()` | supported | ODD registers `odd-compact` via `odd-dock-rail.js`; it is pickable in OS Settings alongside the default strip. |
| Dock filters: `desktop_mode_dock_items`, `desktop_mode_dock_item`, `desktop_mode_dock_item_multi`, `desktop_mode_dock_placement`, `desktop_mode_arrange_menu_items`, shell-config system tile payloads | supported | ODD uses native dock/icon data filters for icon sets and placement/config hooks. System tile icons are supplied through Desktop Mode data first; `odd-dock-rail.js` also skins already-rendered system tile glyphs when the host rail has emitted Dashicons before the active raster set is available. |
| Appearance filters: `desktop_mode_accent_colors`, `desktop_mode_toast_types`, `desktop_mode_default_wallpaper`, `desktop_mode_wallpapers`, `desktop_mode_icons`, `desktop_mode_window_tabs` | supported | ODD contributes accents, toast tone, wallpapers, icon sets, and native surfaces. |
| Desktop files: `desktop_mode_register_file_type()`, `desktop_mode_register_file_opener()`, `desktop_mode_resolve_file()` | diagnostics-only | ODD detects the 0.8.5 file layer and extends cursor coverage across file/folder tiles, but does not register its own file type yet. |
| Shared folders: `desktop_mode_files_sharing_enabled_for()`, visible-folder helpers | diagnostics-only | ODD records capability presence only; shared-folder product behavior stays host-owned. |
| Host widgets / heartbeat widget helpers | supported | ODD ships installable widgets through its catalog, registers installed widgets with Desktop Mode's server-driven widget registry, uses native widget storage/sizing/dragging, and hot-loads companion widget CSS after upload. Heartbeat remains diagnostics-only. |
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
| Bootstrap: `wp.desktop.whenReady()`, `ready()`, `isReady()`, `desktop-mode-init` | supported | ODD uses Desktop Mode readiness for commands, settings, and hook registration. |
| Window lifecycle: `desktop-mode.window.*` opened, closing, closed, focused, detached, bounds/body/state hooks | supported | ODD normalizes ODD Shop/app window events and records lifecycle data without changing host window placement. |
| Window APIs: `registerWindow()`, `windowManager`, `openWindow()`, `getWindowConfig()`, `debug.window()`, `Window.markContentLoading()`, `Window.markContentLoaded()`, `Window.send()`, `Window.on()` | supported | ODD uses these for Shop/app opening, app loading state, and diagnostics snapshots. |
| Native-window hooks: `desktop-mode.native-window.before-render`, `after-render`, `before-close` | supported | ODD decorates ODD native surfaces and records lifecycle events. |
| Iframe hooks: `desktop-mode.iframe.ready`, `error`, `network-completed` | supported | ODD app failures and network errors flow into diagnostics. |
| Widget hooks: `desktop-mode.widget.mounting`, `mounted`, `unmounting`, `mount-failed`, `added`, `removed` | supported | ODD records installed widget lifecycle and surfaces mount failures. |
| File/folder hooks: `desktop-mode.files.*` file-type, opener, opening/opened, tile, grid, placement, and folder-dialog events | diagnostics-only | ODD records 0.8.5 file/folder activity and marks payload elements as cursor roots so custom cursors work on host-owned file surfaces. |
| Wallpaper hooks: `desktop-mode.wallpapers`, `desktop-mode.wallpaper.mounting`, `mounted`, `unmounting`, `mount-failed`, `visibility`, `surfaces` | supported | ODD uses visibility, records lifecycle/surface data, and exposes a Desktop Mode wallpaper editor for scene/shuffle/audio controls. |
| Dock hooks: `desktop-mode.dock.item-appended`, `desktop-mode.dock.before-render`, `tile-class`, `tile-element`, `tile-tooltip`, `tile-rendered`, `after-render`, `item-removed` | supported | ODD decorates only ODD tile data/elements returned by hooks and records dock behavior. It does not replace host dock icon DOM. |
| Dock APIs: `registerSystemTile()`, `listSystemTiles()`, `getSystemTile()`, `openOsSettings()`, `getMenuItems()`, `renderIcon()`, `isDockElement()` | supported | ODD uses these where available for settings, diagnostics, and launcher integration. |
| Command APIs and hooks: `registerCommand()`, `listCommands()`, `registerPalette()`, `listPalettes()`, `desktop-mode.command.before-run`, `after-run`, `error`, `desktop-mode.open-command.items` | supported | ODD registers commands, contributes `/open` items, registers an ODD palette, and records command lifecycle. |
| Settings tabs: `registerSettingsTab()`, `listSettingsTabs()` | supported | ODD renders an OS Settings tab with health and diagnostics actions. |
| Activity channels: toast, attention, badge, open-requested, presence-changed, presence-snapshot-applied | diagnostics-only | ODD records activity and uses toast/attention/badge helpers when relevant. |
| Toast API: `wp.desktop.showToast()` and `desktop-mode.shell.toast` | supported | ODD uses the host toast API from its shared client API. |
| Broadcast, subscribe, shared store, heartbeat, presence, AI, drag bridge, module loader, menu refresh | diagnostics-only | ODD records these surfaces but does not introduce cross-window state yet. |
| Arrange menu | supported | ODD contributes custom Arrange actions for shuffle, widget gathering, Shop opening, and decoration reset while leaving host window layout operations to Desktop Mode. |
| Palette APIs | supported | ODD registers a searchable ODD palette for wallpapers, icon sets, cursor sets, widgets, apps, and settings. |
| DevTools APIs | diagnostics-only | ODD observes app-window requests when available for local bug reports. |
| Debug bus | diagnostics-only | ODD can publish copied diagnostics into a Desktop Mode debug session. |
| Window chrome controls/slots/themes | supported | ODD registers a window **theme** (`odd/shop-chrome`); title-bar integration remains as before. |
| Recycle Bin JS/REST APIs | diagnostics-only | ODD records signals but does not change content lifecycle. |
