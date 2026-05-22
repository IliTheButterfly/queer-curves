import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// matrix-sdk-crypto-wasm ships a .wasm sidecar whose load path is
	// computed relative to the JS module location. Vite's dev-server
	// dep-pre-bundling copies the JS into node_modules/.vite/deps but
	// not the WASM, so the dynamic load 404s. Excluding it from
	// pre-bundling makes Vite serve the module from its original
	// location where the WASM sits next to it.
	optimizeDeps: {
		exclude: ['@matrix-org/matrix-sdk-crypto-wasm']
	},
	test: {
		include: ['src/**/*.test.{js,ts}'],
		environment: 'node'
	}
});
