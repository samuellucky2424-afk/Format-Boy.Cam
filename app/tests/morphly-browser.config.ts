import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// An isolated browser fixture: no real login, camera, API, or paid SDK connection.
const mocks: Record<string, string> = {
  '@/context/AuthContext': `export const useAuth = () => ({ user: { id: 'fixture-user', name: 'Morphly test' } });`,
  '@/context/AppContext': `export const useApp = () => ({ credits: 1000, setCredits() {}, setSessionStatus() {} });`,
  '@/lib/supabase': `export const supabase = { auth: { getSession: async () => ({ data: { session: { access_token: 'fixture-login' } } }) } };`,
  'fixture:morphly-sdk': `
    export const createMorphlyClient = (client) => ({ realtime: { connect: async (stream, settings) => {
      const debug = window.morphlyTest;
      debug.starts++;
      debug.authenticated = (await client.tokenEndpointHeaders()).Authorization === 'Bearer fixture-login';
      settings.output.srcObject = stream;
      await settings.output.play();
      settings.onStateChange('connected');
      const listeners = new Map();
      return {
        set: async (value) => { debug.prompt = value.prompt; },
        setPrompt: async (text) => { debug.prompt = text; },
        on: (event, callback) => {
          listeners.set(event, callback);
          if (event === 'balance') callback({ available_credits: 940, reserved_credits: 60, charged_credits: 0, billable_seconds: 0 });
        },
        off: (event) => listeners.delete(event),
        disconnect: async () => {
          debug.stops++;
          if (debug.stops === 1) throw { code: 'SESSION_STOP_PENDING' };
          settings.output.srcObject = null;
          listeners.get('balance')?.({ available_credits: 940, reserved_credits: 40, charged_credits: 20, billable_seconds: 10 });
        },
      };
    } } });`,
};

export default defineConfig({
  envPrefix: [],
  plugins: [{
    name: 'morphly-browser-fixtures', enforce: 'pre',
    resolveId(id) { if (id.startsWith('\0') || id in mocks) return id.startsWith('\0') ? id : `\0${id}`; },
    load(id) { return mocks[id.slice(1)]; },
    transform(code, id) {
      if (id.endsWith('/src/pages/Dashboard.tsx')) return code.replace("import(/* @vite-ignore */ MORPHLY_SDK_URL)", "import('fixture:morphly-sdk')");
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ allowed: true, credits: 1000, remainingCredits: 1000, shouldStop: false }));
      });
    },
  }, react()],
  resolve: { alias: { ...Object.fromEntries(Object.keys(mocks).filter((id) => id.startsWith('@/')).map((id) => [id, `\0${id}`])), '@': path.resolve('src') } },
  server: { host: '127.0.0.1', port: 5174, strictPort: true },
});
