<?php
/**
 * ODD — Apps-only catalog and `.wp` installer bootstrap.
 */

defined( 'ABSPATH' ) || exit;

require_once ODDOUT_DIR . 'includes/content/archive.php';
require_once ODDOUT_DIR . 'includes/content/rate-limit.php';
require_once ODDOUT_DIR . 'includes/content/bundle.php';
require_once ODDOUT_DIR . 'includes/content/rest.php';
require_once ODDOUT_DIR . 'includes/content/catalog.php';
require_once ODDOUT_DIR . 'includes/content/catalog-fallback.php';
require_once ODDOUT_DIR . 'includes/content/reconcile.php';
