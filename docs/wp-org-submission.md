# WordPress.org submission notes

The plugin slug is `odd-outlandish-desktop-decorator`; its required plugin slug
is `desktop-mode` (OpenStation). Keep the main plugin header, `readme.txt`, ZIP
directory name, and SVN paths consistent.

Before an SVN release, run the complete release runbook and WordPress Plugin
Check against the built ZIP. Upload only the explicit files produced by
`odd/bin/build-zip`; catalog archives and source tooling do not belong in the
WordPress.org plugin ZIP.

The `wporg-assets/` directory contains directory artwork and screenshots. Review
every caption and image against the current Apps-only product before uploading
assets separately to the WordPress.org SVN `assets/` directory.
