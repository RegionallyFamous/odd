#!/usr/bin/env node
/**
 * create-odd-bundle — scaffold a new ODD .wp bundle.
 *
 * Usage:
 *   npm create odd-bundle           # interactive prompts
 *   npm create odd-bundle scene my-scene
 *   npx create-odd-bundle iconset my-iconset
 *   npx create-odd-bundle widget my-widget
 *   npx create-odd-bundle app my-app
 *
 * Every template produces:
 *   - manifest.json pre-filled with slug/version/type
 *   - type-specific entry files (scene.js, widget.js, index.html, icons)
 *   - README.md with next steps
 *   - .gitignore
 *
 * The slug is validated against the same ^[a-z0-9-]+$ pattern the
 * server-side installer enforces, so a successfully scaffolded bundle
 * is already a valid one — you can zip and upload immediately.
 */
import { promises as fs } from 'node:fs';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const __dirname = dirname( fileURLToPath( import.meta.url ) );
const TEMPLATES = resolve( __dirname, '..', 'templates' );
const TYPES = new Set( [ 'scene', 'iconset', 'icon-set', 'widget', 'app' ] );

function canonicalizeType( t ) {
	if ( t === 'iconset' ) return 'icon-set';
	return t;
}

function slugify( input ) {
	return String( input || '' )
		.toLowerCase()
		.replace( /[^a-z0-9-]+/g, '-' )
		.replace( /^-+|-+$/g, '' );
}

function usage() {
	console.log(
`create-odd-bundle — scaffold a new ODD .wp bundle

Usage:
  npm create odd-bundle [type] [slug]
  npx create-odd-bundle [type] [slug]

Types:
  scene     Animated wallpaper (.js entry + preview.webp + wallpaper.webp)
  iconset   Dock / desktop icons (14 PNG/WebP images)
  widget    Desktop widget (.js + .css)
  app       HTML/JS app that opens in a native window

Slug rules: lowercase letters, digits, hyphens. 1 to 64 chars.
`
	);
}

async function prompt( rl, question, validate ) {
	while ( true ) {
		const answer = ( await rl.question( question ) ).trim();
		const err = validate ? validate( answer ) : null;
		if ( ! err ) return answer;
		console.error( `  ↳ ${ err }` );
	}
}

async function main() {
	const [ , , typeArg, slugArg ] = process.argv;
	if ( typeArg === '--help' || typeArg === '-h' ) {
		usage();
		return 0;
	}

	const rl = readline.createInterface( { input: stdin, output: stdout } );
	try {
		let type = typeArg;
		if ( ! type ) {
			type = await prompt(
				rl,
				'Bundle type [scene | iconset | widget | app]: ',
				( v ) => TYPES.has( v ) ? null : 'pick one of: scene, iconset, widget, app',
			);
		} else if ( ! TYPES.has( type ) ) {
			console.error( `Unknown type '${ type }'. See --help.` );
			return 2;
		}
		type = canonicalizeType( type );

		let slug = slugArg || '';
		if ( ! slug ) {
			slug = await prompt(
				rl,
				'Bundle slug (lowercase-with-hyphens): ',
				( v ) => /^[a-z0-9-]+$/.test( v ) && v.length >= 1 && v.length <= 64
					? null
					: 'must match ^[a-z0-9-]+$ and be 1 to 64 chars',
			);
		} else {
			const normalised = slugify( slug );
			if ( normalised !== slug ) {
				console.log( `  ↳ normalised '${ slug }' → '${ normalised }'` );
			}
			slug = normalised;
		}

		// Fully non-interactive when both type + slug came from argv and
		// the stdin isn't a TTY. Lets CI / scripts drive the scaffolder
		// without wedging on an unclosed readline.
		var name, author, description;
		const nonInteractive = ( typeArg && slugArg && ! stdin.isTTY );
		if ( nonInteractive ) {
			name = slug;
			author = '';
			description = '';
		} else {
			name = ( await prompt( rl, `Bundle name (display) [${ slug }]: `, () => null ) ) || slug;
			author = await prompt( rl, 'Author (optional): ', () => null );
			description = await prompt( rl, 'Short description (optional): ', () => null );
		}

		const outDir = resolve( process.cwd(), slug );
		if ( existsSync( outDir ) ) {
			console.error( `Refusing to overwrite existing directory: ${ outDir }` );
			return 2;
		}

		await scaffold( { type, slug, name, author, description }, outDir );

		console.log( '' );
		console.log( `  ✓ scaffolded ${ type } bundle at ${ outDir }` );
		console.log( `  next steps:` );
		console.log( `    1. cd ${ slug } && read README.md` );
		console.log( `    2. (optional) npm install --save-dev @odd/test-harness vitest jsdom` );
		console.log( `    3. zip -r ../${ slug }.wp .` );
		console.log( `    4. upload the .wp in the ODD Shop → Install → Upload` );
		return 0;
	} finally {
		rl.close();
	}
}

async function scaffold( { type, slug, name, author, description }, outDir ) {
	await fs.mkdir( outDir, { recursive: true } );

	const templateDir = resolve( TEMPLATES, type );
	if ( ! existsSync( templateDir ) ) {
		throw new Error( `no template for type: ${ type }` );
	}

	const manifest = buildManifest( { type, slug, name, author, description } );
	await fs.writeFile( join( outDir, 'manifest.json' ), JSON.stringify( manifest, null, 2 ) + '\n' );

	await copyTemplateTree( templateDir, outDir, { slug, name } );

	// Common files.
	await fs.writeFile( join( outDir, '.gitignore' ), '*.wp\n*.DS_Store\nnode_modules/\n' );

	const readme = buildReadme( { type, slug, name } );
	await fs.writeFile( join( outDir, 'README.md' ), readme );
}

async function copyTemplateTree( src, dst, vars ) {
	const entries = await fs.readdir( src, { withFileTypes: true } );
	for ( const entry of entries ) {
		const from = join( src, entry.name );
		const to = join( dst, entry.name );
		if ( entry.isDirectory() ) {
			await fs.mkdir( to, { recursive: true } );
			await copyTemplateTree( from, to, vars );
		} else {
			const isText = /\.(js|css|html|md|json|svg|txt)$/i.test( entry.name );
			if ( isText ) {
				const raw = await fs.readFile( from, 'utf8' );
				const filled = raw
					.replace( /\{\{slug\}\}/g, vars.slug )
					.replace( /\{\{name\}\}/g, vars.name );
				await fs.writeFile( to, filled );
			} else {
				await fs.copyFile( from, to );
			}
		}
	}
}

function buildManifest( { type, slug, name, author, description } ) {
	const m = {
		'$schema': 'https://raw.githubusercontent.com/RegionallyFamous/odd/main/docs/schemas/manifest.schema.json',
		type,
		slug,
		name,
		label: name,
		version: '0.1.0',
	};
	if ( author ) m.author = author;
	if ( description ) m.description = description;
	if ( type === 'scene' ) {
		m.entry = 'scene.js';
		m.preview = 'preview.webp';
		m.wallpaper = 'wallpaper.webp';
		m.fallbackColor = '#0a0a1f';
	} else if ( type === 'icon-set' ) {
		m.accent = '#6a5cff';
		m.icons = {};
		for ( const k of [ 'dashboard','posts','pages','media','comments','appearance','plugins','users','tools','settings','profile','links','recycle-bin','fallback','os-settings','import','classic-admin' ] ) {
			m.icons[ k ] = `${ k }.webp`;
		}
	} else if ( type === 'widget' ) {
		m.entry = 'widget.js';
		m.css = [ 'widget.css' ];
		m.icon = 'dashicons-screenoptions';
		m.movable = true;
		m.resizable = true;
		m.minWidth = 220;
		m.minHeight = 140;
		m.defaultWidth = 280;
		m.defaultHeight = 180;
	} else if ( type === 'app' ) {
		m.window = { width: 640, height: 480, minWidth: 320, minHeight: 240 };
	}
	return m;
}

function buildReadme( { type, slug, name } ) {
	return `# ${ name }

${ type } bundle scaffolded by create-odd-bundle.

## Shipping

1. Make sure every file mentioned in \`manifest.json\` exists.
2. Run the validator: \`odd/bin/validate-manifest manifest.json\` from a cloned ODD repo, or install \`jsonschema\` locally and check against https://raw.githubusercontent.com/RegionallyFamous/odd/main/docs/schemas/manifest.schema.json.
3. Zip the contents: \`zip -r ../${ slug }.wp .\`.
4. Upload the \`.wp\` through the ODD Shop → Install → Upload.

## Testing

\`\`\`sh
npm install --save-dev @odd/test-harness vitest jsdom
\`\`\`

Then see https://github.com/RegionallyFamous/odd/tree/main/packages/test-harness for usage.

## References

- Manifest schema: https://raw.githubusercontent.com/RegionallyFamous/odd/main/docs/schemas/manifest.schema.json
- Building guide: https://github.com/RegionallyFamous/odd/tree/main/docs/building-a-${ type === 'icon-set' ? 'n-icon-set' : type }.md
`;
}

main().then(
	( code ) => process.exit( code || 0 ),
	( err ) => { console.error( err && err.stack || err ); process.exit( 1 ); },
);
