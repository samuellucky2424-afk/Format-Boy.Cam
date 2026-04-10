# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

## Desktop Updater With Supabase Storage

The Electron updater checks `GET /api/version` and expects a JSON response with:

```json
{
  "version": "1.0.1",
  "download_url": "https://...",
  "artifact_type": "portable"
}
```

This project now supports generating that `download_url` from Supabase Storage.

### Recommended setup

1. Create a bucket in Supabase Storage, for example `format-boy-updates`.
2. Upload your Windows release file, for example `desktop/Format-Boy-Desktop-1.0.1.exe`.
3. Set these environment variables on the backend that serves `/api/version`:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
DESKTOP_LATEST_VERSION=1.0.1
DESKTOP_ARTIFACT_TYPE=portable
DESKTOP_SUPABASE_BUCKET=format-boy-updates
DESKTOP_SUPABASE_PATH=desktop/Format-Boy-Desktop-{version}.exe
DESKTOP_SUPABASE_ACCESS=signed
DESKTOP_SIGNED_URL_EXPIRES=7200
DESKTOP_DOWNLOAD_SHA256=
DESKTOP_RELEASE_NOTES=Bug fixes and improvements
```

### Access modes

- `DESKTOP_SUPABASE_ACCESS=signed`
  Uses the Supabase service role key to create a temporary signed URL for a private bucket.
- `DESKTOP_SUPABASE_ACCESS=public`
  Builds a public Storage object URL. Use this only if the bucket is public.

### Notes

- `{version}` inside `DESKTOP_SUPABASE_PATH` is replaced automatically.
- If Supabase Storage settings are not provided, `/api/version` falls back to `DESKTOP_DOWNLOAD_URL`.
- The desktop updater needs a direct downloadable `.exe`, so Supabase Storage works well here. Plain MEGA share pages do not.
