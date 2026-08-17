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

Extraction happens in a staging directory and is promoted atomically. Catalog
installs additionally require an allowed first-party URL, a valid registry
signature, and the exact declared archive size and SHA-256 digest.
