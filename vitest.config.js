import { defineConfig } from 'vitest/config';

export default defineConfig( {
	test: {
		environment: 'jsdom',
		include: [ 'tests/app-only/js/**/*.test.js' ],
		globals: false,
		reporters: 'default',
	},
} );
