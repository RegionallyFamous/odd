<?php
/**
 * ODD Apps — registry + install/uninstall API.
 *
 * Public procedural surface:
 *
 *   oddout_apps_install( $tmp_path, $filename, $args = array() ) → manifest | WP_Error
 *   oddout_apps_uninstall( $slug )               → true | WP_Error
 *   oddout_apps_set_enabled( $slug, $bool )      → true | WP_Error
 *   oddout_apps_set_surfaces( $slug, $arr )      → true | WP_Error
 *   oddout_apps_row_surfaces( $row )             → { desktop: bool, taskbar: bool }
 *   oddout_apps_list()                           → array of index rows
 *   oddout_apps_get( $slug )                     → full manifest or array()
 *
 * Registry filter (PHP-side, seeds the JS `registries.apps` slice):
 *
 *   apply_filters( 'oddout_app_registry', [] ) → [ { slug, name, ...} ]
 *
 * The filter is populated from the on-disk index every request, so
 * installed apps "just appear" — no re-registration hook needed. The
 * same filter is open to third parties that want to register a
 * purely-in-memory app (future use).
 */

defined( 'ABSPATH' ) || exit;

/**
 * Minimum capability an installed app can require by default.
 *
 * App bundles are trusted code once installed, but their manifests must
 * not be able to broaden access to all logged-in users by declaring
 * `capability: "read"`. Hosts that intentionally run lower-privilege
 * internal apps can opt in via filters.
 *
 * @return string
 */
function oddout_apps_capability_floor() {
	$floor = (string) apply_filters( 'oddout_app_capability_floor', 'manage_options' );
	$floor = sanitize_key( $floor );
	return '' === $floor ? 'manage_options' : $floor;
}

/**
 * Normalize an app manifest/index capability against the capability floor.
 *
 * @param string $capability Manifest-supplied capability.
 * @param string $slug       App slug.
 * @return string Capability safe to pass to current_user_can().
 */
function oddout_apps_normalize_capability( $capability, $slug = '' ) {
	if ( 'odd-notes' === sanitize_key( (string) $slug ) ) {
		return 'read';
	}

	$floor     = oddout_apps_capability_floor();
	$requested = sanitize_key( (string) $capability );
	if ( '' === $requested ) {
		$requested = $floor;
	}

	$allowed = apply_filters( 'oddout_app_allowed_capabilities', array( $floor ), $floor );
	if ( ! is_array( $allowed ) ) {
		$allowed = array( $floor );
	}
	$allowed = array_values(
		array_unique(
			array_filter(
				array_map(
					static function ( $cap ) {
						return sanitize_key( (string) $cap );
					},
					$allowed
				)
			)
		)
	);
	if ( ! in_array( $floor, $allowed, true ) ) {
		$allowed[] = $floor;
	}

	return in_array( $requested, $allowed, true ) ? $requested : $floor;
}

/**
 * Install and activate an app archive.
 *
 * @return array|WP_Error The parsed manifest on success.
 */
function oddout_apps_install( $tmp_path, $filename, $args = array() ) {
	$manifest = oddout_apps_validate_archive( $tmp_path, $filename );
	if ( is_wp_error( $manifest ) ) {
		return $manifest;
	}
	return oddout_apps_install_validated_archive( $tmp_path, $manifest, $args );
}

function oddout_apps_transaction_option_key( $slug ) {
	return 'oddout_apps_transaction_' . sanitize_key( (string) $slug );
}

function oddout_apps_install_lock_key( $slug ) {
	return 'oddout_apps_install_lock_' . sanitize_key( (string) $slug );
}

function oddout_apps_index_lock_key() {
	return 'oddout_apps_index_lock';
}

/** Extract the timestamp from current and legacy lock values. */
function oddout_apps_lock_started( $value ) {
	$parts = explode( '|', (string) $value, 2 );
	return (int) $parts[0];
}

/** Extract the stable request identity from an owner token. */
function oddout_apps_lock_owner_id( $value ) {
	$parts = explode( '|', (string) $value, 2 );
	return isset( $parts[1] ) && '' !== $parts[1] ? $parts[1] : (string) $value;
}

/** Compare owner tokens by stable request identity, not lease timestamp. */
function oddout_apps_lock_same_owner( $left, $right ) {
	$left_owner  = oddout_apps_lock_owner_id( $left );
	$right_owner = oddout_apps_lock_owner_id( $right );
	return '' !== $left_owner && '' !== $right_owner && hash_equals( $left_owner, $right_owner );
}

/**
 * Atomically acquire an owner-token lock, optionally replacing a stale owner.
 *
 * Direct compare-and-swap is required here: delete_option() followed by
 * add_option() would let two recovery requests both believe they own a lock.
 *
 * @return string|WP_Error Owner token on success.
 */
function oddout_apps_atomic_lock_acquire( $key, $ttl = 600, $replace_stale = false, $owner_id = '' ) {
	global $wpdb;
	$owner_id = '' !== (string) $owner_id ? oddout_apps_lock_owner_id( $owner_id ) : wp_generate_uuid4();
	$owner    = time() . '|' . $owner_id;
	if ( add_option( $key, $owner, '', false ) ) {
		return $owner;
	}

	$current = get_option( $key, false );
	$started = oddout_apps_lock_started( $current );
	if ( ! $replace_stale || false === $current || $started <= 0 || ( time() - $started ) <= (int) $ttl ) {
		return new WP_Error(
			'app_change_in_progress',
			__( 'Another app registry change is already in progress.', 'odd-outlandish-desktop-decorator' ),
			array(
				'status'     => 409,
				'started_at' => $started,
			)
		);
	}

	$updated = $wpdb->query(
		$wpdb->prepare(
			"UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$owner,
			$key,
			(string) $current
		)
	);
	wp_cache_delete( $key, 'options' );
	return 1 === $updated
		? $owner
		: new WP_Error( 'app_change_in_progress', __( 'Another app registry change is already in progress.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 409 ) );
}

/**
 * Assert and refresh a lease without changing its stable owner identity.
 *
 * @return string|WP_Error Refreshed owner token on success.
 */
function oddout_apps_atomic_lock_refresh( $key, $owner ) {
	global $wpdb;
	$owner_id = oddout_apps_lock_owner_id( $owner );
	$current  = get_option( $key, false );
	if ( false === $current || '' === $owner_id || ! oddout_apps_lock_same_owner( $current, $owner_id ) ) {
		return new WP_Error( 'transaction_lease_lost', __( 'This app change no longer owns its transaction lease.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 409 ) );
	}

	$refreshed = time() . '|' . $owner_id;
	if ( hash_equals( (string) $current, $refreshed ) ) {
		return $refreshed;
	}
	$updated = $wpdb->query(
		$wpdb->prepare(
			"UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$refreshed,
			$key,
			(string) $current
		)
	);
	wp_cache_delete( $key, 'options' );
	return 1 === $updated
		? $refreshed
		: new WP_Error( 'transaction_lease_lost', __( 'This app change no longer owns its transaction lease.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 409 ) );
}

/** Release a lock only when this request still owns its stable identity. */
function oddout_apps_atomic_lock_release( $key, $owner ) {
	global $wpdb;
	$current = get_option( $key, false );
	if ( false === $current || ! oddout_apps_lock_same_owner( $current, $owner ) ) {
		return false;
	}
	$deleted = $wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$key,
			(string) $current
		)
	);
	wp_cache_delete( $key, 'options' );
	return 1 === $deleted;
}

/** Release the per-slug and whole-index locks owned by one mutation. */
function oddout_apps_mutation_locks_release( $slug, array $locks ) {
	$owner = isset( $locks['owner'] ) ? $locks['owner'] : '';
	if ( ! empty( $locks['index'] ) ) {
		oddout_apps_atomic_lock_release( oddout_apps_index_lock_key(), $owner ? $owner : $locks['index'] );
	}
	if ( ! empty( $locks['slug'] ) ) {
		oddout_apps_atomic_lock_release( oddout_apps_install_lock_key( $slug ), $owner ? $owner : $locks['slug'] );
	}
}

/** Refresh both leases held by one app mutation. */
function oddout_apps_mutation_lease_refresh( $slug, $owner ) {
	$slug_owner = oddout_apps_atomic_lock_refresh( oddout_apps_install_lock_key( $slug ), $owner );
	if ( is_wp_error( $slug_owner ) ) {
		return $slug_owner;
	}
	$index_owner = oddout_apps_atomic_lock_refresh( oddout_apps_index_lock_key(), $owner );
	if ( is_wp_error( $index_owner ) ) {
		return $index_owner;
	}
	return true;
}

/** Resolve a transaction slug from its journal option key. */
function oddout_apps_journal_slug( $key ) {
	$prefix = oddout_apps_transaction_option_key( '' );
	return 0 === strpos( (string) $key, $prefix ) ? sanitize_key( substr( (string) $key, strlen( $prefix ) ) ) : '';
}

/** Atomically replace an option value when its serialized value is unchanged. */
function oddout_apps_option_compare_and_swap( $key, $current, $next ) {
	global $wpdb;
	$updated = $wpdb->query(
		$wpdb->prepare(
			"UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			maybe_serialize( $next ),
			$key,
			maybe_serialize( $current )
		)
	);
	wp_cache_delete( $key, 'options' );
	return 1 === $updated;
}

/** Persist a transaction journal only while its owner holds both leases. */
function oddout_apps_journal_write( $key, array $journal, $owner ) {
	$slug = oddout_apps_journal_slug( $key );
	if ( '' === $slug || is_wp_error( oddout_apps_mutation_lease_refresh( $slug, $owner ) ) ) {
		return false;
	}
	$owner_id         = oddout_apps_lock_owner_id( $owner );
	$journal['owner'] = $owner_id;
	$current          = get_option( $key, false );
	if ( false === $current ) {
		return add_option( $key, $journal, '', false );
	}
	if ( ! is_array( $current ) || ! isset( $current['owner'] ) || ! oddout_apps_lock_same_owner( $current['owner'], $owner_id ) ) {
		return false;
	}
	if ( $current === $journal ) {
		return true;
	}
	return oddout_apps_option_compare_and_swap( $key, $current, $journal );
}

/** Atomically transfer an interrupted journal to the current lease owner. */
function oddout_apps_journal_claim( $key, $owner ) {
	$slug  = oddout_apps_journal_slug( $key );
	$lease = '' === $slug ? new WP_Error( 'invalid_transaction_journal', __( 'The app transaction journal is invalid.', 'odd-outlandish-desktop-decorator' ) ) : oddout_apps_mutation_lease_refresh( $slug, $owner );
	if ( is_wp_error( $lease ) ) {
		return $lease;
	}
	$current = get_option( $key, false );
	if ( ! is_array( $current ) || empty( $current['phase'] ) ) {
		return array();
	}
	$claimed          = $current;
	$claimed['owner'] = oddout_apps_lock_owner_id( $owner );
	if ( isset( $current['owner'] ) && oddout_apps_lock_same_owner( $current['owner'], $claimed['owner'] ) ) {
		return $claimed;
	}
	return oddout_apps_option_compare_and_swap( $key, $current, $claimed )
		? $claimed
		: new WP_Error( 'transaction_journal_claim_failed', __( 'Another request changed the app transaction journal.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 409 ) );
}

/** Advance an owned transaction journal without dropping recovery data. */
function oddout_apps_journal_phase( $key, $phase, $owner ) {
	$journal = get_option( $key, array() );
	if ( ! is_array( $journal ) || empty( $journal ) ) {
		return false;
	}
	$journal['phase'] = sanitize_key( (string) $phase );
	return oddout_apps_journal_write( $key, $journal, $owner );
}

/** Delete an owned transaction journal only while both leases are current. */
function oddout_apps_journal_delete( $key, $owner ) {
	global $wpdb;
	$slug = oddout_apps_journal_slug( $key );
	if ( '' === $slug || is_wp_error( oddout_apps_mutation_lease_refresh( $slug, $owner ) ) ) {
		return false;
	}
	$current = get_option( $key, false );
	if ( false === $current ) {
		return true;
	}
	if ( ! is_array( $current ) || ! isset( $current['owner'] ) || ! oddout_apps_lock_same_owner( $current['owner'], $owner ) ) {
		return false;
	}
	$deleted = $wpdb->query(
		$wpdb->prepare(
			"DELETE FROM {$wpdb->options} WHERE option_name = %s AND option_value = %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$key,
			maybe_serialize( $current )
		)
	);
	wp_cache_delete( $key, 'options' );
	return 1 === $deleted;
}

/** Restore and verify the registry records captured by a transaction journal. */
function oddout_apps_restore_transaction_metadata( $slug, array $journal, $lease_check = null ) {
	$lease_check = is_callable( $lease_check ) ? $lease_check : null;
	$index       = oddout_apps_index_load();
	if ( isset( $journal['old_row'] ) && is_array( $journal['old_row'] ) ) {
		if ( $lease_check ) {
			$lease = $lease_check();
			if ( is_wp_error( $lease ) ) {
				return $lease;
			}
		}
		$index[ $slug ] = $journal['old_row'];
		oddout_apps_index_save( $index );
		$old_manifest = isset( $journal['old_manifest'] ) && is_array( $journal['old_manifest'] ) ? $journal['old_manifest'] : array();
		if ( $lease_check ) {
			$lease = $lease_check();
			if ( is_wp_error( $lease ) ) {
				return $lease;
			}
		}
		oddout_apps_manifest_save( $slug, $old_manifest );
		$stored_index = oddout_apps_index_load();
		if ( ! isset( $stored_index[ $slug ] ) || $stored_index[ $slug ] !== $journal['old_row'] || oddout_apps_manifest_load( $slug ) !== $old_manifest ) {
			return new WP_Error( 'transaction_metadata_restore_failed', __( 'Could not restore the previous app registry records.', 'odd-outlandish-desktop-decorator' ) );
		}
		return true;
	}

	if ( $lease_check ) {
		$lease = $lease_check();
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
	}
	unset( $index[ $slug ] );
	oddout_apps_index_save( $index );
	if ( $lease_check ) {
		$lease = $lease_check();
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
	}
	oddout_apps_manifest_delete( $slug );
	if ( isset( oddout_apps_index_load()[ $slug ] ) || array() !== oddout_apps_manifest_load( $slug ) ) {
		return new WP_Error( 'transaction_metadata_cleanup_failed', __( 'Could not remove incomplete app registry records.', 'odd-outlandish-desktop-decorator' ) );
	}
	return true;
}

/** Recover a transaction interrupted between promotion and cleanup. */
function oddout_apps_recover_transaction( $slug ) {
	$slug        = sanitize_key( (string) $slug );
	$lock_key    = oddout_apps_install_lock_key( $slug );
	$journal_key = oddout_apps_transaction_option_key( $slug );
	$journal     = get_option( $journal_key, array() );
	$current     = get_option( $lock_key, false );

	if ( ( ! is_array( $journal ) || empty( $journal['phase'] ) ) && false === $current ) {
		return true;
	}

	// Claim stale recovery with one compare-and-swap owner token. A competing
	// bootstrap request or a new mutation cannot process this journal in parallel.
	$owner_id   = wp_generate_uuid4();
	$slug_owner = oddout_apps_atomic_lock_acquire( $lock_key, 10 * MINUTE_IN_SECONDS, true, $owner_id );
	if ( is_wp_error( $slug_owner ) ) {
		$started = oddout_apps_lock_started( $current );
		return new WP_Error(
			'install_in_progress',
			__( 'An installation of this app is already in progress.', 'odd-outlandish-desktop-decorator' ),
			array(
				'status'     => 409,
				'started_at' => $started,
			)
		);
	}

	$index_owner = oddout_apps_atomic_lock_acquire( oddout_apps_index_lock_key(), 10 * MINUTE_IN_SECONDS, true, $owner_id );
	if ( is_wp_error( $index_owner ) ) {
		oddout_apps_atomic_lock_release( $lock_key, $slug_owner );
		return $index_owner;
	}
	$locks       = array(
		'slug'  => $slug_owner,
		'index' => $index_owner,
		'owner' => $owner_id,
	);
	$lease_check = static function () use ( $slug, $owner_id ) {
		return oddout_apps_mutation_lease_refresh( $slug, $owner_id );
	};

	try {
		// Claim the exact journal snapshot after both locks. An expired owner
		// cannot advance or delete the successor journal after this CAS.
		$journal = oddout_apps_journal_claim( $journal_key, $owner_id );
		if ( is_wp_error( $journal ) ) {
			return $journal;
		}
		if ( ! is_array( $journal ) || empty( $journal['phase'] ) ) {
			return true;
		}
		if ( 'metadata_committed' === $journal['phase'] ) {
			if ( isset( $journal['promotion'] ) && is_array( $journal['promotion'] ) ) {
				$committed = oddout_apps_commit_promoted_archive( $journal['promotion'], $lease_check );
				if ( is_wp_error( $committed ) ) {
					return $committed;
				}
			}
			return oddout_apps_journal_delete( $journal_key, $owner_id )
				? true
				: new WP_Error( 'transaction_journal_delete_failed', __( 'Could not finish the app transaction journal.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( isset( $journal['promotion'] ) && is_array( $journal['promotion'] ) ) {
			$rolled_back = oddout_apps_rollback_promoted_archive( $journal['promotion'], $lease_check );
			if ( is_wp_error( $rolled_back ) ) {
				return $rolled_back;
			}
		} elseif ( ! empty( $journal['staging'] ) && ( file_exists( $journal['staging'] ) || is_link( $journal['staging'] ) ) ) {
			$lease = $lease_check();
			if ( is_wp_error( $lease ) ) {
				return $lease;
			}
			$cleaned = oddout_apps_cleanup_staging( $journal['staging'], $lease_check );
			if ( is_wp_error( $cleaned ) ) {
				return $cleaned;
			}
		}
		$restored = oddout_apps_restore_transaction_metadata( $slug, $journal, $lease_check );
		if ( is_wp_error( $restored ) ) {
			return $restored;
		}
		return oddout_apps_journal_delete( $journal_key, $owner_id )
			? true
			: new WP_Error( 'transaction_journal_delete_failed', __( 'Could not finish the app transaction journal.', 'odd-outlandish-desktop-decorator' ) );
	} finally {
		oddout_apps_mutation_locks_release( $slug, $locks );
	}
}

/** Recover stale app transactions during normal bootstrap, before app serving. */
function oddout_apps_recover_stale_transactions() {
	global $wpdb;
	$prefix = oddout_apps_transaction_option_key( '' );
	$names  = $wpdb->get_col(
		$wpdb->prepare(
			"SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", // phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
			$wpdb->esc_like( $prefix ) . '%'
		)
	);
	foreach ( is_array( $names ) ? $names : array() as $name ) {
		$slug = sanitize_key( substr( (string) $name, strlen( $prefix ) ) );
		if ( '' === $slug ) {
			continue;
		}
		$recovered = oddout_apps_recover_transaction( $slug );
		if ( is_wp_error( $recovered ) && 'install_in_progress' !== $recovered->get_error_code() ) {
			do_action( 'oddout_apps_transaction_recovery_failed', $slug, $recovered );
		}
	}
}
add_action( 'init', 'oddout_apps_recover_stale_transactions', 0 );

/** Acquire the per-app and whole-index locks shared by every registry writer. */
function oddout_apps_mutation_lock_acquire( $slug ) {
	$slug      = sanitize_key( (string) $slug );
	$recovered = oddout_apps_recover_transaction( $slug );
	if ( is_wp_error( $recovered ) ) {
		return $recovered;
	}
	$owner_id   = wp_generate_uuid4();
	$slug_owner = oddout_apps_atomic_lock_acquire( oddout_apps_install_lock_key( $slug ), 10 * MINUTE_IN_SECONDS, false, $owner_id );
	if ( is_wp_error( $slug_owner ) ) {
		return $slug_owner;
	}
	$index_owner = oddout_apps_atomic_lock_acquire( oddout_apps_index_lock_key(), 10 * MINUTE_IN_SECONDS, true, $owner_id );
	if ( is_wp_error( $index_owner ) ) {
		oddout_apps_atomic_lock_release( oddout_apps_install_lock_key( $slug ), $slug_owner );
		return $index_owner;
	}
	return array(
		'slug'  => $slug_owner,
		'index' => $index_owner,
		'owner' => $owner_id,
	);
}

/** Deterministic failure hook used by rollback regression tests. */
function oddout_apps_install_should_fail( $phase, $slug, $operation ) {
	return (bool) apply_filters( 'oddout_apps_install_should_fail', false, $phase, $slug, $operation );
}

/** Clean pre-promotion staging before deleting its only recovery journal. */
function oddout_apps_abandon_staged_transaction( $staging, $journal_key, $owner, $lease_check ) {
	$cleaned = oddout_apps_cleanup_staging( $staging, $lease_check );
	if ( is_wp_error( $cleaned ) ) {
		return $cleaned;
	}
	return oddout_apps_journal_delete( $journal_key, $owner )
		? true
		: new WP_Error( 'transaction_journal_delete_failed', __( 'Could not finish the app transaction journal.', 'odd-outlandish-desktop-decorator' ) );
}

/**
 * Install a fully validated archive with explicit install/update/repair rules.
 *
 * This is the single filesystem + registry transaction used by bundle uploads,
 * catalog updates, and repairs. The old app remains recoverable until both the
 * new directory and WordPress registry records have been verified.
 *
 * @param string $tmp_path Validated archive path.
 * @param array  $manifest Normalized app manifest.
 * @param array  $args     operation plus optional expected_slug/type/version.
 * @return array|WP_Error
 */
function oddout_apps_install_validated_archive( $tmp_path, array $manifest, $args = array() ) {
	$args      = is_array( $args ) ? $args : array();
	$operation = isset( $args['operation'] ) ? sanitize_key( (string) $args['operation'] ) : 'install';
	if ( ! in_array( $operation, array( 'install', 'update', 'repair' ), true ) ) {
		return new WP_Error( 'invalid_install_operation', __( 'App operation must be install, update, or repair.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 400 ) );
	}

	$slug     = sanitize_key( $manifest['slug'] );
	$expected = array(
		'slug'    => isset( $args['expected_slug'] ) ? sanitize_key( (string) $args['expected_slug'] ) : '',
		'type'    => isset( $args['expected_type'] ) ? sanitize_key( (string) $args['expected_type'] ) : '',
		'version' => isset( $args['expected_version'] ) ? sanitize_text_field( (string) $args['expected_version'] ) : '',
	);
	foreach ( $expected as $field => $value ) {
		$actual = 'slug' === $field ? $slug : sanitize_text_field( (string) ( $manifest[ $field ] ?? '' ) );
		if ( '' !== $value && $value !== $actual ) {
			return new WP_Error(
				'expected_' . $field . '_mismatch',
				__( 'Validated app manifest does not match the requested bundle.', 'odd-outlandish-desktop-decorator' ),
				array(
					'status'   => 400,
					'field'    => $field,
					'expected' => $value,
					'actual'   => $actual,
				)
			);
		}
	}

	$recovered = oddout_apps_recover_transaction( $slug );
	if ( is_wp_error( $recovered ) ) {
		return $recovered;
	}

	$locks = oddout_apps_mutation_lock_acquire( $slug );
	if ( is_wp_error( $locks ) ) {
		return $locks;
	}
	$owner_id    = $locks['owner'];
	$lease_check = static function () use ( $slug, $owner_id ) {
		return oddout_apps_mutation_lease_refresh( $slug, $owner_id );
	};

	// Re-read state after winning the per-slug lock. Every mutator uses this
	// same lock, so user preferences cannot be overwritten by a stale snapshot.
	$index        = oddout_apps_index_load();
	$old_row      = isset( $index[ $slug ] ) && is_array( $index[ $slug ] ) ? $index[ $slug ] : null;
	$old_manifest = null === $old_row ? array() : oddout_apps_manifest_load( $slug );
	if ( 'install' === $operation && null !== $old_row ) {
		oddout_apps_mutation_locks_release( $slug, $locks );
		return new WP_Error(
			'slug_exists',
			sprintf( /* translators: %s app slug. */ __( 'App "%s" is already installed.', 'odd-outlandish-desktop-decorator' ), $slug ),
			array( 'status' => 409 )
		);
	}
	if ( 'install' !== $operation && null === $old_row ) {
		oddout_apps_mutation_locks_release( $slug, $locks );
		return new WP_Error( 'not_installed', __( 'The app must already be installed for this operation.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 409 ) );
	}
	if ( 'update' === $operation && ! version_compare( (string) $manifest['version'], (string) $old_row['version'], '>' ) ) {
		oddout_apps_mutation_locks_release( $slug, $locks );
		return new WP_Error( 'no_newer_version', __( 'An update must have a newer version than the installed app.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 409 ) );
	}
	if ( 'repair' === $operation && (string) $manifest['version'] !== (string) $old_row['version'] ) {
		oddout_apps_mutation_locks_release( $slug, $locks );
		return new WP_Error( 'repair_version_mismatch', __( 'Repair must use the exact installed app version.', 'odd-outlandish-desktop-decorator' ), array( 'status' => 409 ) );
	}

	$journal_key = oddout_apps_transaction_option_key( $slug );
	$staging     = oddout_apps_new_staging_path( $slug );
	$journal     = array(
		'phase'        => 'extracting',
		'operation'    => $operation,
		'old_row'      => $old_row,
		'old_manifest' => $old_manifest,
		'staging'      => $staging,
		'started'      => time(),
	);
	if ( ! oddout_apps_journal_write( $journal_key, $journal, $owner_id ) ) {
		oddout_apps_mutation_locks_release( $slug, $locks );
		return new WP_Error( 'transaction_journal_failed', __( 'Could not start the app installation transaction.', 'odd-outlandish-desktop-decorator' ) );
	}

	$staging = oddout_apps_stage_archive( $tmp_path, $slug, $staging, $lease_check );
	if ( is_wp_error( $staging ) ) {
		$lease = $lease_check();
		if ( is_wp_error( $lease ) ) {
			oddout_apps_mutation_locks_release( $slug, $locks );
			return $lease;
		}
		$cleaned = oddout_apps_abandon_staged_transaction( $journal['staging'], $journal_key, $owner_id, $lease_check );
		oddout_apps_mutation_locks_release( $slug, $locks );
		return is_wp_error( $cleaned ) ? $cleaned : $staging;
	}
	$promotion = oddout_apps_prepare_promotion( $staging, $slug );
	if ( is_wp_error( $promotion ) ) {
		$cleaned = oddout_apps_abandon_staged_transaction( $staging, $journal_key, $owner_id, $lease_check );
		oddout_apps_mutation_locks_release( $slug, $locks );
		return is_wp_error( $cleaned ) ? $cleaned : $promotion;
	}
	$journal['phase']     = 'promotion_prepared';
	$journal['staging']   = $staging;
	$journal['promotion'] = $promotion;
	if ( ! oddout_apps_journal_write( $journal_key, $journal, $owner_id ) ) {
		$cleaned = oddout_apps_abandon_staged_transaction( $staging, $journal_key, $owner_id, $lease_check );
		oddout_apps_mutation_locks_release( $slug, $locks );
		return is_wp_error( $cleaned ) ? $cleaned : new WP_Error( 'transaction_journal_failed', __( 'Could not record the prepared app transaction.', 'odd-outlandish-desktop-decorator' ) );
	}
	$promoted = oddout_apps_promote_staged_archive( $staging, $slug, $journal_key, $promotion, $owner_id, $lease_check );
	if ( is_wp_error( $promoted ) ) {
		$lease = $lease_check();
		if ( is_wp_error( $lease ) ) {
			oddout_apps_mutation_locks_release( $slug, $locks );
			return $lease;
		}
		$rolled_back = oddout_apps_rollback_promoted_archive( $promotion, $lease_check );
		if ( ! is_wp_error( $rolled_back ) ) {
			$deleted = oddout_apps_journal_delete( $journal_key, $owner_id );
			if ( ! $deleted ) {
				$rolled_back = new WP_Error( 'transaction_journal_delete_failed', __( 'Could not finish the app transaction journal.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
		oddout_apps_mutation_locks_release( $slug, $locks );
		return is_wp_error( $rolled_back ) ? $rolled_back : $promoted;
	}
	$promotion = $promoted;
	if ( oddout_apps_install_should_fail( 'after_promote', $slug, $operation ) ) {
		$rolled_back = oddout_apps_rollback_promoted_archive( $promotion, $lease_check );
		if ( ! is_wp_error( $rolled_back ) ) {
			$deleted = oddout_apps_journal_delete( $journal_key, $owner_id );
			if ( ! $deleted ) {
				$rolled_back = new WP_Error( 'transaction_journal_delete_failed', __( 'Could not finish the app transaction journal.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
		oddout_apps_mutation_locks_release( $slug, $locks );
		return is_wp_error( $rolled_back ) ? $rolled_back : new WP_Error( 'injected_install_failure', __( 'The app transaction was intentionally interrupted for a rollback check.', 'odd-outlandish-desktop-decorator' ) );
	}

	// Manifest authors can declare the default surfaces per app; users can
	// override them after install. Defaults favor a visible desktop launcher
	// and keep the dock quiet unless the manifest opts in.
	$surfaces = array(
		'desktop' => isset( $manifest['surfaces']['desktop'] ) ? (bool) $manifest['surfaces']['desktop'] : true,
		'taskbar' => isset( $manifest['surfaces']['taskbar'] ) ? (bool) $manifest['surfaces']['taskbar'] : false,
	);

	if ( null !== $old_row ) {
		$surfaces = oddout_apps_row_surfaces( $old_row );
	}
	$index[ $slug ] = array(
		'slug'        => $slug,
		'name'        => sanitize_text_field( $manifest['name'] ),
		'version'     => sanitize_text_field( $manifest['version'] ),
		'enabled'     => null !== $old_row ? ! empty( $old_row['enabled'] ) : true,
		'icon'        => isset( $manifest['icon'] ) ? sanitize_text_field( (string) $manifest['icon'] ) : '',
		'description' => isset( $manifest['description'] ) ? sanitize_text_field( (string) $manifest['description'] ) : '',
		'capability'  => oddout_apps_normalize_capability( isset( $manifest['capability'] ) ? (string) $manifest['capability'] : '', $slug ),
		'surfaces'    => $surfaces,
		'installed'   => null !== $old_row && ! empty( $old_row['installed'] ) ? (int) $old_row['installed'] : time(),
	);
	$lease          = $lease_check();
	if ( is_wp_error( $lease ) ) {
		oddout_apps_mutation_locks_release( $slug, $locks );
		return $lease;
	}
	oddout_apps_index_save( $index );

	$manifest['installed'] = $index[ $slug ]['installed'];
	$manifest['enabled']   = $index[ $slug ]['enabled'];
	$manifest['surfaces']  = $surfaces;
	$lease                 = $lease_check();
	if ( is_wp_error( $lease ) ) {
		oddout_apps_mutation_locks_release( $slug, $locks );
		return $lease;
	}
	oddout_apps_manifest_save( $slug, $manifest );

	$stored_index    = oddout_apps_index_load();
	$stored_manifest = oddout_apps_manifest_load( $slug );
	if ( ! isset( $stored_index[ $slug ] ) || $stored_index[ $slug ] !== $index[ $slug ] || $stored_manifest !== $manifest ) {
		$metadata_restored = oddout_apps_restore_transaction_metadata( $slug, $journal, $lease_check );
		$rolled_back       = oddout_apps_rollback_promoted_archive( $promotion, $lease_check );
		if ( ! is_wp_error( $metadata_restored ) && ! is_wp_error( $rolled_back ) ) {
			$deleted = oddout_apps_journal_delete( $journal_key, $owner_id );
			if ( ! $deleted ) {
				$rolled_back = new WP_Error( 'transaction_journal_delete_failed', __( 'Could not finish the app transaction journal.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
		oddout_apps_mutation_locks_release( $slug, $locks );
		if ( is_wp_error( $metadata_restored ) ) {
			return $metadata_restored;
		}
		if ( is_wp_error( $rolled_back ) ) {
			return $rolled_back;
		}
		return new WP_Error( 'registry_write_failed', __( 'Could not save the app registry; the previous app was restored.', 'odd-outlandish-desktop-decorator' ) );
	}

	if ( ! oddout_apps_journal_phase( $journal_key, 'metadata_committed', $owner_id ) ) {
		$lease = $lease_check();
		if ( is_wp_error( $lease ) ) {
			oddout_apps_mutation_locks_release( $slug, $locks );
			return $lease;
		}
		$metadata_restored = oddout_apps_restore_transaction_metadata( $slug, $journal, $lease_check );
		$rolled_back       = oddout_apps_rollback_promoted_archive( $promotion, $lease_check );
		if ( ! is_wp_error( $metadata_restored ) && ! is_wp_error( $rolled_back ) ) {
			$deleted = oddout_apps_journal_delete( $journal_key, $owner_id );
			if ( ! $deleted ) {
				$rolled_back = new WP_Error( 'transaction_journal_delete_failed', __( 'Could not finish the app transaction journal.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
		oddout_apps_mutation_locks_release( $slug, $locks );
		if ( is_wp_error( $metadata_restored ) ) {
			return $metadata_restored;
		}
		if ( is_wp_error( $rolled_back ) ) {
			return $rolled_back;
		}
		return new WP_Error( 'transaction_journal_failed', __( 'Could not commit the app registry transaction.', 'odd-outlandish-desktop-decorator' ) );
	}
	$committed = oddout_apps_commit_promoted_archive( $promotion, $lease_check );
	if ( is_wp_error( $committed ) ) {
		oddout_apps_mutation_locks_release( $slug, $locks );
		return $committed;
	}
	if ( ! oddout_apps_journal_delete( $journal_key, $owner_id ) ) {
		oddout_apps_mutation_locks_release( $slug, $locks );
		return new WP_Error( 'transaction_journal_delete_failed', __( 'Could not finish the app transaction journal.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( null === $old_row ) {
		$lease = $lease_check();
		if ( is_wp_error( $lease ) ) {
			oddout_apps_mutation_locks_release( $slug, $locks );
			return $lease;
		}
		oddout_apps_seed_core_item_visibility( $slug, $surfaces );
	}
	oddout_apps_mutation_locks_release( $slug, $locks );

	/**
	 * Fires after an app is successfully installed.
	 *
	 * @param string $slug
	 * @param array  $manifest
	 */
	do_action( 'oddout_app_installed', $slug, $manifest, $operation );

	return $manifest;
}

/**
 * Uninstall an app: removes its directory, per-slug option, and
 * index entry. Idempotent — returns true for missing apps.
 */
function oddout_apps_uninstall( $slug ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid app slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	$locks = oddout_apps_mutation_lock_acquire( $slug );
	if ( is_wp_error( $locks ) ) {
		return $locks;
	}
	$lease_check = static function () use ( $slug, $locks ) {
		return oddout_apps_mutation_lease_refresh( $slug, $locks['owner'] );
	};
	try {
		// State is intentionally read only after the shared per-slug lock.
		$index = oddout_apps_index_load();
		$dir   = oddout_apps_dir_for( $slug );
		if ( is_dir( $dir ) ) {
			$lease = $lease_check();
			if ( is_wp_error( $lease ) ) {
				return $lease;
			}
			oddout_apps_rrmdir( $dir );
			if ( is_dir( $dir ) ) {
				return new WP_Error( 'uninstall_files_failed', __( 'Could not remove the installed app files.', 'odd-outlandish-desktop-decorator' ) );
			}
		}
		$lease = $lease_check();
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
		oddout_apps_manifest_delete( $slug );
		if ( isset( $index[ $slug ] ) ) {
			$lease = $lease_check();
			if ( is_wp_error( $lease ) ) {
				return $lease;
			}
			unset( $index[ $slug ] );
			oddout_apps_index_save( $index );
		}
		if ( isset( oddout_apps_index_load()[ $slug ] ) || array() !== oddout_apps_manifest_load( $slug ) ) {
			return new WP_Error( 'uninstall_registry_failed', __( 'Could not remove the app registry records.', 'odd-outlandish-desktop-decorator' ) );
		}
		$lease = $lease_check();
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
		oddout_apps_remove_core_item_visibility( $slug );
		do_action( 'oddout_app_uninstalled', $slug );
		return true;
	} finally {
		oddout_apps_mutation_locks_release( $slug, $locks );
	}
}

function oddout_apps_set_enabled( $slug, $enabled ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid app slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	$locks = oddout_apps_mutation_lock_acquire( $slug );
	if ( is_wp_error( $locks ) ) {
		return $locks;
	}
	$lease_check = static function () use ( $slug, $locks ) {
		return oddout_apps_mutation_lease_refresh( $slug, $locks['owner'] );
	};
	try {
		$index = oddout_apps_index_load();
		if ( ! isset( $index[ $slug ] ) ) {
			return new WP_Error( 'not_installed', __( 'App is not installed.', 'odd-outlandish-desktop-decorator' ) );
		}
		$index[ $slug ]['enabled'] = (bool) $enabled;
		$lease                     = $lease_check();
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
		oddout_apps_index_save( $index );

		$manifest = oddout_apps_manifest_load( $slug );
		if ( $manifest ) {
			$manifest['enabled'] = (bool) $enabled;
			$lease               = $lease_check();
			if ( is_wp_error( $lease ) ) {
				return $lease;
			}
			oddout_apps_manifest_save( $slug, $manifest );
		}
		$stored = oddout_apps_index_load();
		if ( ! isset( $stored[ $slug ] ) || (bool) $stored[ $slug ]['enabled'] !== (bool) $enabled ) {
			return new WP_Error( 'app_setting_write_failed', __( 'Could not save the app setting.', 'odd-outlandish-desktop-decorator' ) );
		}
		if ( $enabled ) {
			do_action( 'oddout_app_enabled', $slug );
		} else {
			do_action( 'oddout_app_disabled', $slug );
		}
		return true;
	} finally {
		oddout_apps_mutation_locks_release( $slug, $locks );
	}
}

/**
 * Update the per-app `surfaces` preference.
 *
 * In current OpenStation, visible placement belongs to the host-owned
 * `itemVisibility` OS setting for the canonical `odd-app-{slug}` icon.
 * ODD still stores this normalized shape for install defaults, REST
 * compatibility, and older hosts that do not expose the OS-settings API.
 * Runtime registration always publishes the app window and launcher; it
 * does not use this row to add/remove OpenStation surfaces itself.
 *
 * @param string $slug
 * @param array  $surfaces { desktop?: bool, taskbar?: bool }
 * @return true|WP_Error
 */
function oddout_apps_set_surfaces( $slug, $surfaces ) {
	$slug = sanitize_key( (string) $slug );
	if ( '' === $slug ) {
		return new WP_Error( 'invalid_slug', __( 'Invalid app slug.', 'odd-outlandish-desktop-decorator' ) );
	}
	if ( ! is_array( $surfaces ) ) {
		return new WP_Error( 'invalid_surfaces', __( 'Invalid surfaces payload.', 'odd-outlandish-desktop-decorator' ) );
	}
	$locks = oddout_apps_mutation_lock_acquire( $slug );
	if ( is_wp_error( $locks ) ) {
		return $locks;
	}
	$lease_check = static function () use ( $slug, $locks ) {
		return oddout_apps_mutation_lease_refresh( $slug, $locks['owner'] );
	};
	try {
		$index = oddout_apps_index_load();
		if ( ! isset( $index[ $slug ] ) ) {
			return new WP_Error( 'not_installed', __( 'App is not installed.', 'odd-outlandish-desktop-decorator' ) );
		}

		// Merge onto the existing (or defaulted) surfaces so a partial
		// payload like { taskbar: true } leaves `desktop` untouched — the
		// Shop checkboxes are independent and shouldn't clobber each other.
		$current                    = oddout_apps_row_surfaces( $index[ $slug ] );
		$clean                      = array(
			'desktop' => isset( $surfaces['desktop'] ) ? ! empty( $surfaces['desktop'] ) : $current['desktop'],
			'taskbar' => isset( $surfaces['taskbar'] ) ? ! empty( $surfaces['taskbar'] ) : $current['taskbar'],
		);
		$index[ $slug ]['surfaces'] = $clean;
		$lease                      = $lease_check();
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
		oddout_apps_index_save( $index );

		$manifest = oddout_apps_manifest_load( $slug );
		if ( $manifest ) {
			$manifest['surfaces'] = $clean;
			$lease                = $lease_check();
			if ( is_wp_error( $lease ) ) {
				return $lease;
			}
			oddout_apps_manifest_save( $slug, $manifest );
		}
		$stored = oddout_apps_index_load();
		if ( ! isset( $stored[ $slug ] ) || oddout_apps_row_surfaces( $stored[ $slug ] ) !== $clean ) {
			return new WP_Error( 'app_surfaces_write_failed', __( 'Could not save the app placement.', 'odd-outlandish-desktop-decorator' ) );
		}
		$lease = $lease_check();
		if ( is_wp_error( $lease ) ) {
			return $lease;
		}
		oddout_apps_seed_core_item_visibility( $slug, $clean, 0, true );

		/**
		 * Fires after an app's surface preferences change.
		 *
		 * @param string $slug
		 * @param array  $surfaces { desktop: bool, taskbar: bool }
		 */
		do_action( 'oddout_app_surfaces_changed', $slug, $clean );

		return true;
	} finally {
		oddout_apps_mutation_locks_release( $slug, $locks );
	}
}

function oddout_apps_core_item_id( $slug ) {
	$slug = sanitize_key( (string) $slug );
	return '' === $slug ? '' : 'odd-app-' . $slug;
}

function oddout_apps_surfaces_to_core_placement( $surfaces ) {
	$clean = oddout_apps_row_surfaces(
		array(
			'surfaces' => is_array( $surfaces ) ? $surfaces : array(),
		)
	);
	if ( $clean['desktop'] && $clean['taskbar'] ) {
		return 'both';
	}
	if ( $clean['taskbar'] ) {
		return 'dock';
	}
	if ( $clean['desktop'] ) {
		return 'desktop';
	}
	return 'hidden';
}

/**
 * Seed OpenStation's native launcher placement for an app.
 *
 * The installed-app index stores ODD's fallback `{ desktop, taskbar }`
 * shape, but current OpenStation decides visibility from
 * `osSettings.itemVisibility[odd-app-{slug}]`. Without this server-side
 * seed, installs that happen outside the live panel JS path register a
 * window/icon but have no visible desktop launcher until a manual toggle.
 *
 * Existing host placement wins unless `$force` is true; this keeps app
 * updates and reinstalls from silently undoing a user's hidden/taskbar choice.
 *
 * @param string $slug     App slug.
 * @param array  $surfaces { desktop: bool, taskbar: bool }
 * @param int    $user_id  Optional user id. Defaults to current user.
 * @param bool   $force    Whether to overwrite an existing placement.
 * @return bool Whether a host settings write occurred.
 */
function oddout_apps_seed_core_item_visibility( $slug, $surfaces, $user_id = 0, $force = false ) {
	$item_id = oddout_apps_core_item_id( $slug );
	$user_id = (int) ( $user_id ?: get_current_user_id() );
	if (
		'' === $item_id ||
		$user_id <= 0 ||
		! oddout_openstation_supports( 'os_settings' )
	) {
		return false;
	}

	try {
		$settings = openstation_get_os_settings( $user_id );
		if ( ! is_array( $settings ) ) {
			$settings = openstation_default_os_settings();
		}
		if ( ! is_array( $settings ) ) {
			return false;
		}

		if ( empty( $settings['itemVisibility'] ) || ! is_array( $settings['itemVisibility'] ) ) {
			$settings['itemVisibility'] = array();
		}
		if ( ! $force && array_key_exists( $item_id, $settings['itemVisibility'] ) ) {
			return false;
		}

		$settings['itemVisibility'][ $item_id ] = oddout_apps_surfaces_to_core_placement( $surfaces );
		return (bool) openstation_save_os_settings( $user_id, $settings );
	} catch ( Throwable $e ) {
		return false;
	}
}

function oddout_apps_remove_core_item_visibility( $slug, $user_id = 0 ) {
	$item_id = oddout_apps_core_item_id( $slug );
	$user_id = (int) ( $user_id ?: get_current_user_id() );
	if (
		'' === $item_id ||
		$user_id <= 0 ||
		! oddout_openstation_supports( 'os_settings' )
	) {
		return false;
	}

	try {
		$settings = openstation_get_os_settings( $user_id );
		if ( ! is_array( $settings ) || empty( $settings['itemVisibility'] ) || ! is_array( $settings['itemVisibility'] ) ) {
			return false;
		}
		if ( ! array_key_exists( $item_id, $settings['itemVisibility'] ) ) {
			return false;
		}

		unset( $settings['itemVisibility'][ $item_id ] );
		return (bool) openstation_save_os_settings( $user_id, $settings );
	} catch ( Throwable $e ) {
		return false;
	}
}

/**
 * Normalize the `surfaces` field on an app index row. App manifests may omit
 * the field; the current v1 default is `{ desktop: true, taskbar: false }`.
 *
 * @param array $row
 * @return array { desktop: bool, taskbar: bool }
 */
function oddout_apps_row_surfaces( $row ) {
	$s = isset( $row['surfaces'] ) && is_array( $row['surfaces'] ) ? $row['surfaces'] : array();
	return array(
		'desktop' => isset( $s['desktop'] ) ? (bool) $s['desktop'] : true,
		'taskbar' => isset( $s['taskbar'] ) ? (bool) $s['taskbar'] : false,
	);
}

/**
 * Flat list of installed apps, sorted alphabetically by name. Each
 * entry is the row from the index. The enqueue layer ships this same
 * list to the JS store as `registries.apps`.
 */
function oddout_apps_list() {
	$index = oddout_apps_index_load();
	// Installed apps have already passed archive/manifest validation. Publish
	// every installed row unless a host has explicitly narrowed slug policy.
	$rows = array();
	foreach ( $index as $slug => $row ) {
		$slug = sanitize_key( (string) $slug );
		if (
			'' === $slug ||
			! is_array( $row ) ||
			( function_exists( 'oddout_catalog_slug_allowed' ) && ! oddout_catalog_slug_allowed( $slug, $row ) )
		) {
			continue;
		}
		$rows[] = $row;
	}
	foreach ( $rows as &$row ) {
			// Keep the REST response and Shop store on a complete shape.
		$row['surfaces'] = oddout_apps_row_surfaces( $row );
	}
	unset( $row );
	usort(
		$rows,
		function ( $a, $b ) {
			$an = isset( $a['name'] ) ? (string) $a['name'] : '';
			$bn = isset( $b['name'] ) ? (string) $b['name'] : '';
			return strcmp( $an, $bn );
		}
	);
	return $rows;
}

function oddout_apps_get( $slug ) {
	return oddout_apps_manifest_load( $slug );
}

/**
 * Populate the oddout_app_registry filter with installed apps. Runs at
 * priority 5 so later filters can override or hide entries.
 */
add_filter(
	'oddout_app_registry',
	function ( $registry ) {
		if ( ! is_array( $registry ) ) {
			$registry = array();
		}
		$seen = array();
		foreach ( $registry as $e ) {
			if ( isset( $e['slug'] ) ) {
				$seen[ $e['slug'] ] = true;
			}
		}
		foreach ( oddout_apps_list() as $row ) {
			if ( isset( $seen[ $row['slug'] ] ) ) {
				continue;
			}
			$registry[] = $row;
		}
		return $registry;
	},
	5
);
