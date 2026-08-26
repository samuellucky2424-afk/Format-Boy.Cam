import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '');
  const apiProxyTarget = (
    process.env.HENSHIN_LOCAL_API_TARGET ||
    env.VITE_API_BASE_URL ||
    ''
  ).replace(/\/api\/?$/i, '');
  const localSupabaseUrl = process.env.HENSHIN_LOCAL_SUPABASE_URL?.trim();
  const localSupabaseAnonKey = process.env.HENSHIN_LOCAL_SUPABASE_ANON_KEY?.trim();

  return {
    base: './',
    // Only expose the browser-safe VITE_ namespaces used by the app. In
    // particular, this prevents a legacy VITE_MORPHLY_API_KEY from being
    // serialized into the browser environment.
    envPrefix: [
      'VITE_API_BASE_URL',
      'VITE_SUPABASE_',
      'VITE_REACTOR_',
    ],
    define: {
      ...(localSupabaseUrl
        ? { 'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(localSupabaseUrl) }
        : {}),
      ...(localSupabaseAnonKey
        ? { 'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(localSupabaseAnonKey) }
        : {}),
    },
    plugins: [inspectAttr(), react()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: apiProxyTarget ? {
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    } : undefined,
  };
});
