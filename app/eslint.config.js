import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    files: ['api/**/*.ts', 'server/**/*.ts'],
    rules: {
      // Legacy serverless handlers are loaded directly by both Vercel and Bun.
      '@typescript-eslint/ban-ts-comment': 'off',
    },
  },
  {
    files: ['src/components/ui/**/*.tsx', 'src/context/**/*.tsx'],
    rules: {
      // Generated UI modules and providers intentionally co-export helpers.
      'react-refresh/only-export-components': 'off',
    },
  },
])
