# App serving and archive security

Installed apps live under `wp-content/uploads/odd/apps/<slug>/`. ODD writes web
server deny rules for direct access and serves files through authenticated,
path-confined routes. The manifest-declared icon is public because OpenStation
renders it from normal image elements.

Before extraction, ODD rejects:

- non-`.wp` or invalid ZIP files;
- path traversal, absolute/backslash/control paths, hidden paths, duplicates,
  and symlinks;
- server-executable extensions;
- excessive file counts, uncompressed size, or compression ratios;
- missing, malformed, unknown-field, or non-app manifests;
- missing entry/icon/native assets and unsafe icon formats;
- service-worker code and unresolved browser module imports;
- base tags, external entry assets, unsafe relative references, and missing
  referenced files.

Install, update, and repair share one transaction. Extraction happens in a
staging directory; the working directory is renamed to a backup before the
staged copy is promoted. ODD restores that backup if promotion or registry
verification fails, and deletes it only after the filesystem and WordPress
records agree. Updates must be newer; repairs must exactly match the installed
version. Existing enabled state, surface preferences, installation timestamp,
and OpenStation placement are preserved.

Catalog installs, updates, and repairs additionally require an allowed
first-party URL, a valid registry signature, and the exact declared archive
size and SHA-256 digest. Missing assets never trigger repair from a GET request:
asset routes return 404. Repair is an explicit `manage_options` POST operation.

Executable and storage access normally require `manage_options`. The lower
`read` capability requires both an explicit manifest request and internal
install provenance from the verified first-party signed catalog or the
plugin-shipped frozen fallback. Direct uploads, unsigned test catalogs, and
private mirrors cannot grant `read`, and replacement installs do not inherit a
previous app's provenance.

## Browser app trust boundary

Installed browser apps are administrator-approved, trusted same-origin code.
Their iframe uses both `allow-scripts` and `allow-same-origin` because relative
assets need the WordPress login cookie; that combination is deliberately not
described as a security sandbox. Archive validation is the code-admission
boundary. Fixed CSP, same-origin framing/resource headers, path confinement,
and a narrow permissions policy provide defense in depth and prevent external
assets, workers, nested frames, top navigation, camera, microphone, and
geolocation. Catalog authors must not place untrusted tenant code in an app.
