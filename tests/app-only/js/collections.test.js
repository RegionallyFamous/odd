import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('_tools/catalog-sources/apps/collections/bundle-src/assets/app.js'), 'utf8');

describe('ODD Collections persistence and WordPress boundaries', () => {
	it('fails closed when a save rejects and retries from the recovered queue', () => {
		expect(source).toMatch(/queue\s*=\s*queue\.catch\(\(\)\s*=>\s*\{\}\)\.then\(\(\)\s*=>\s*rt\.storage\.set\(key,\s*snap\)\)/);
		expect(source).toMatch(/Could not save your changes/);
	});

	it('guards shelf creation when persistence rejects', () => {
		expect(source).toMatch(/state\.shelves\.push\(shelf\)/);
		expect(source).toMatch(/state\.shelves\s*=\s*previous\.shelves/);
		expect(source).toContain('rt.confirm(`Delete “${item.title}”?`)');
		expect(source).toContain('data-edit-shelf');
		expect(source).toContain('data-delete-shelf');
	});

	it('uses the public post/page search contract and handles actionable REST errors', () => {
		expect(source).toContain('wp/v2/search?search=');
		expect(source).toContain('type=post&subtype=post,page');
		expect(source).toMatch(/WordPress search failed/);
	});
});
