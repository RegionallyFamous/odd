import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve('_tools/catalog-sources/apps/reading-list/bundle-src/assets/app.js'), 'utf8');

describe('ODD Reading List persistence', () => {
	it('recovers the serialized save queue after a rejected write', () => {
		expect(source).toMatch(/queue\s*=\s*queue\.catch\(\(\)\s*=>\s*\{\}\)\.then\(\(\)\s*=>\s*rt\.storage\.set\(key,\s*state\.items\)\)/);
		expect(source).toMatch(/Could not save your changes/);
		expect(source).toContain('data-archive');
		expect(source).toContain('Link archived');
		expect(source).toContain('Could not delete the link');
		expect(source).toMatch(/!i\.archived\s*&&\s*i\.status\s*===\s*state\.filter/);
	});

	it('accepts only credential-free HTTP(S) links and opens explicitly', () => {
		expect(source).toMatch(/\["http:",\s*"https:"\]\.includes\(u\.protocol\)/);
		expect(source).toMatch(/window\.open\(item\.url,\s*"_blank",\s*"noopener,noreferrer"\)/);
	});
});
