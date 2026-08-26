// Dev launcher: start the local API and Vite before launching Electron.
// All child processes are stopped when Electron exits.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electronPath from 'electron';

const apiPort = Number(process.env.HENSHIN_LOCAL_API_PORT || 3001);
const apiOrigin = `http://127.0.0.1:${apiPort}`;

let apiProc = null;
let electronProc = null;
let server = null;
let shuttingDown = false;

async function apiIsReady() {
  try {
    // A 503 still means the API process is listening; it may only be
    // reporting missing local Supabase configuration.
    await fetch(`${apiOrigin}/api/local-health`);
    return true;
  } catch {
    return false;
  }
}

async function waitForApi(timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await apiIsReady()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Local API did not start at ${apiOrigin} within ${timeoutMs}ms`);
}

async function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;

  electronProc?.kill();
  apiProc?.kill();
  try {
    await server?.close();
  } catch {
    // server may already be closed
  }
  process.exit(code);
}

try {
  if (!(await apiIsReady())) {
    console.log(`[dev-electron] starting local API at ${apiOrigin}`);
    apiProc = spawn('bun', ['run', 'scripts/local-api-server.mjs'], {
      stdio: 'inherit',
      windowsHide: false,
      env: { ...process.env, HENSHIN_LOCAL_API_PORT: String(apiPort) },
    });
    apiProc.on('exit', (code) => {
      if (!shuttingDown) {
        console.error(`[dev-electron] local API exited unexpectedly (${code ?? 1})`);
        void shutdown(code || 1);
      }
    });
    await waitForApi();
  } else {
    console.log(`[dev-electron] reusing local API at ${apiOrigin}`);
  }

  process.env.HENSHIN_LOCAL_API_TARGET ||= apiOrigin;
  server = await createServer({
    // Fail loudly if 5173 is taken instead of silently hopping ports.
    server: { strictPort: true },
  });

  await server.listen();

  const url = server.resolvedUrls?.local?.[0] || 'http://localhost:5173';
  console.log(`[dev-electron] vite ready at ${url}`);
  console.log('[dev-electron] launching electron...');

  electronProc = spawn(electronPath, ['.'], {
    stdio: 'inherit',
    windowsHide: false,
    env: { ...process.env, HENSHIN_DEV_SERVER_URL: url },
  });

  electronProc.on('exit', (code) => {
    console.log(`[dev-electron] electron exited (${code ?? 0})`);
    void shutdown(code ?? 0);
  });
} catch (error) {
  console.error('[dev-electron] failed to start:', error);
  await shutdown(1);
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    void shutdown(0);
  });
}
