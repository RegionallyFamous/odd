import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('_tools/catalog-sources/apps/collections/bundle-src/assets/app.js'), 'utf8');

describe('ODD Collections persistence and WordPress boundaries', () => {
	it('fails closed when a save rejects and retries from the recovered queue', () => {
		expect(source).toContain("queue=queue.catch(()=>{}).then(()=>rt.storage.set(key,snap))");
		expect(source).toContain("try{await save()}catch(e){toast(msg(e,'Could not save your changes.'),true);return}");
	});

	it('guards shelf creation when persistence rejects', () => {
		expect(source).toContain("state.shelves.push({id:id(),name,created:now()});try{await save()}catch(e){toast(msg(e,'Could not save your changes.'),true);return}");
		expect(source).toContain('rt.confirm(`Delete “${item.title}”?`)');
	});

	it('uses the public post/page search contract and handles actionable REST errors', () => {
		expect(source).toContain('wp/v2/search?search=');
		expect(source).toContain('type=post&subtype=post,page');
		expect(source).toContain("toast(msg(e,'WordPress search failed.'),true)");
	});
});
