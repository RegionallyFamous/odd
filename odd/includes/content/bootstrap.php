<?php
/**
 * ODD — universal `.wp` content installer bootstrap.
 *
 * Loaded from odd/odd.php after the Apps include so
 * {@see oddout_bundle_app_validate()} can delegate to the existing
 * Apps validator/installer without forward-declaration gymnastics.
 *
 * Load order:
 *
 *   archive.php   shared ZIP + manifest primitives
 *   bundle.php    oddout_bundle_install() / oddout_bundle_uninstall()
 *   iconsets.php  type: icon-set
 *   cursor-sets.php type: cursor-set
 *   scenes.php    type: scene
 *   widgets.php   type: widget
 *   rest.php      POST /odd/v1/bundles/upload + DELETE /.../<slug>
 */

defined( 'ABSPATH' ) || exit;

require_once ODDOUT_DIR . 'includes/content/archive.php';
require_once ODDOUT_DIR . 'includes/content/rate-limit.php';
require_once ODDOUT_DIR . 'includes/content/bundle.php';
require_once ODDOUT_DIR . 'includes/content/iconsets.php';
require_once ODDOUT_DIR . 'includes/content/cursor-sets.php';
require_once ODDOUT_DIR . 'includes/content/scenes.php';
require_once ODDOUT_DIR . 'includes/content/widgets.php';
require_once ODDOUT_DIR . 'includes/content/rest.php';
require_once ODDOUT_DIR . 'includes/content/catalog.php';
require_once ODDOUT_DIR . 'includes/content/catalog-fallback.php';
require_once ODDOUT_DIR . 'includes/content/reconcile.php';
