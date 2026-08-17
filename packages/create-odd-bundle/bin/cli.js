#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const slug = String( process.argv[ 2 ] || '' ).trim();
if ( ! /^[a-z0-9][a-z0-9-]*$/.test( slug ) ) {
	console.error( 'Usage: create-odd-bundle <lowercase-app-slug>' );
	process.exit( 1 );
}

const title = slug
	.split( '-' )
	.map( ( word ) => word.charAt( 0 ).toUpperCase() + word.slice( 1 ) )
	.join( ' ' );
const target = resolve( process.cwd(), slug );

await mkdir( target, { recursive: false } );
await writeFile(
	resolve( target, 'manifest.json' ),
	JSON.stringify( {
		'$schema': 'https://raw.githubusercontent.com/RegionallyFamous/odd/main/docs/schemas/manifest.schema.json',
		type: 'app',
		slug,
		name: title,
		version: '1.0.0',
		entry: 'index.html',
		icon: 'icon.svg',
		window: {
			width: 640,
			height: 480,
			minWidth: 320,
			minHeight: 240,
			resizable: true,
		},
		surfaces: { desktop: true, taskbar: false },
	}, null, 2 ) + '\n',
	{ flag: 'wx' }
);
await writeFile(
	resolve( target, 'index.html' ),
	`<!doctype html>
<html lang="en">
<head>
\t<meta charset="utf-8">
\t<meta name="viewport" content="width=device-width,initial-scale=1">
\t<title>${ title }</title>
</head>
<body>
\t<main><h1>${ title }</h1></main>
</body>
</html>
`,
	{ flag: 'wx' }
);
await writeFile(
	resolve( target, 'icon.svg' ),
	`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${ title }">
  <rect x="10" y="10" width="44" height="44" rx="10" fill="none" stroke="#111" stroke-width="4"/>
  <path d="M21 32h22M32 21v22" fill="none" stroke="#111" stroke-width="4" stroke-linecap="round"/>
</svg>
`,
	{ flag: 'wx' }
);

console.log( `Created ${ target }` );
