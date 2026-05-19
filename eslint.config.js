import js from '@eslint/js';
import svelte from 'eslint-plugin-svelte';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import svelteParser from 'svelte-eslint-parser';

export default tseslint.config(
	js.configs.recommended,
	...tseslint.configs.recommended,
	...svelte.configs.recommended,
	prettier,
	...svelte.configs.prettier,
	{
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node
			}
		}
	},
	{
		files: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.js'],
		languageOptions: {
			parser: svelteParser,
			parserOptions: {
				parser: tseslint.parser,
				svelteFeatures: {
					experimentalGenerics: true
				}
			}
		}
	},
	{
		rules: {
			'@typescript-eslint/no-unused-vars': [
				'error',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_' }
			],
			// Static internal paths are fine in v0; we'll revisit when we wire
			// up dynamic / typed route resolution (e.g. resolveRoute from
			// $app/paths) once the route surface is more than a handful of paths.
			'svelte/no-navigation-without-resolve': 'off',
			// We use plain Set/Map as compute-once data structures inside
			// $derived blocks (filtering, deduping, graph traversal). We don't
			// rely on reactivity through them — the surrounding $derived re-runs
			// from its tracked inputs. Use SvelteSet/SvelteMap explicitly when
			// genuine reactive collections are needed.
			'svelte/prefer-svelte-reactivity': 'off'
		}
	},
	{
		ignores: ['build/', '.svelte-kit/', 'dist/', 'node_modules/']
	}
);
