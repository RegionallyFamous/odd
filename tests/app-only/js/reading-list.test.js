import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('_tools/catalog-sources/apps/reading-list/bundle-src/assets/app.js'), 'utf8');

describe('ODD Reading List persistence', () => {
	it('recovers the serialized save queue after a rejected write', () => {
		expect(source).toContain("queue=queue.catch(()=>{}).then(()=>rt.storage.set(key,state.items))");
		expect(source).toContain("try{await save()}catch(e){toast(msg(e,'Could not save your changes.'),true);return}");
	});

	it('accepts only credential-free HTTP(S) links and opens explicitly', () => {
		expect(source).toContain("['http:','https:'].includes(u.protocol)&&!u.username&&!u.password");
		expect(source).toContain("window.open(item.url,'_blank','noopener,noreferrer')");
	});
});
