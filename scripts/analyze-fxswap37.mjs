#!/usr/bin/env node
/**
 * Spawn parallel opencode analysis agents on the fxswap37 reference project.
 * Usage:  node scripts/analyze-fxswap37.mjs
 */
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createWriteStream } from 'node:fs';

const REF_DIR = 'C:\\Users\\HP\\fxswap37';
const OUT_DIR = resolve('docs', 'analysis');
mkdirSync(OUT_DIR, { recursive: true });

const COMMON = `You are a READ-ONLY code analyst. Analyze the reference project at "${REF_DIR}".
RULES:
- DO NOT modify, create or delete any file inside the reference project.
- DO NOT run builds, installs or network calls.
- Read files, explore the tree, and produce a precise markdown report.
- Cite exact file paths and key line references for every claim.
- Be exhaustive but structured. Output ONLY the markdown report.`;

const MISSIONS = {
  'ui-design': `MISSION: Analyze the UI/UX of the reference project.
Cover:
1. Full component inventory in app/components/ (purpose, props, state of each).
2. The design system in app/components/ui/ (Button, Panel, Switch, SegmentedToggle, Icon...): variants, sizes, colors, dark theme tokens.
3. Layout structure: app/layout.tsx, page composition, TitleBar, AppSidebar navigation model (which views exist, routing).
4. Visual style: colors, spacing, typography, border radius, icons — describe the exact aesthetic so it can be RE-INSPIRED (not copied pixel-perfect) into another React+Tailwind app.
5. Views: PersonasView, CreditsView, SettingsView, DiagnosticsView, DelaySyncView, VcamPreviewView, CallRecorderView, BootScreen — what each view contains, sections, interactions.
6. The Stage/SessionBar/SessionCost live session UI: how the live swap experience is presented.`,

  'providers': `MISSION: Analyze the PROVIDER architecture (Morphly + Reactor) of the reference project.
Cover:
1. app/lib/liveProvider.ts — the provider abstraction: interface, events, lifecycle (start/stop/set), how providers are swapped at runtime.
2. app/lib/morphly/ — full client: token minting flow, session lifecycle, waitForRenderableStream, openSessions tracking.
3. Reactor integration: @reactor-team/js-sdk usage, @reactor-models/x2, /api/reactor/token and /api/reactor/status routes — how session JWTs are minted server-side.
4. app/api/morphly/token/route.ts and app/api/morphly/release/route.ts — exact request/response contracts.
5. How frames flow: WebcamSource -> provider -> Stage -> VcamPreview/useSourcePublisher.
6. applyPersona.ts, imagePrep.ts — how reference images are prepared and sent to providers.
7. List every env var both providers need.`,

  'features': `MISSION: Inventory ALL FEATURES of the reference project, grouped by category.
Cover:
1. Personas: AddPersonaDialog, PersonaPanel, PersonasView — what a persona is (image? prompt? both?), storage, selection.
2. Live session: SessionBar, SessionCost — session lifecycle, cost display (credits/sec?), start/stop controls.
3. Camera: CameraPickerDialog, cameraDevices.ts — device enumeration, virtual camera detection.
4. Delay/Sync: DelaySyncView, app/delay/ page — what the delay feature does.
5. Call recording: CallRecorderView, clips.ts — recording feature.
6. Diagnostics: DiagnosticsView — what is monitored.
7. Settings: SettingsView, appConfig.ts, config.ts — every setting available.
8. Boot flow: BootGate, BootScreen, boot.ts — startup sequence.
9. Pointer/overlay: PointerOverlay, PointerPanel — what this feature is.
10. Native: native/ folder, electron/ folder — virtual camera, native preview (NativePreview.tsx).`,

  'saas-model': `MISSION: Analyze the SaaS / CREDITS / MONETIZATION model of the reference project, and how it relates to the CALL ME project (docs/CARTOGRAPHIE_ANCIEN_PROJET.md mentions the CALL ME SaaS).
Cover:
1. CreditsView component — UI for credits/buying.
2. SessionCost — how cost is computed and displayed (credits per second? per session?).
3. Any references to payments, plans, subscriptions, wallets in the codebase.
4. docs/CARTOGRAPHIE_ANCIEN_PROJET.md — what was the old CALL ME SaaS architecture (Supabase, Paystack, crypto).
5. docs/ROADMAP.md and docs/TODO_FINALISATION.md — what is planned for SaaS/billing.
6. How API keys (REACTOR_API_KEY, MORPHLY_API_KEY) are kept server-side — the token-minting security model.
7. What the desktop app expects from a SaaS backend (endpoints, contracts).`,

  'architecture': `MISSION: Analyze the global ARCHITECTURE of the reference project.
Cover:
1. docs/ARCHITECTURE.md — full summary.
2. Electron: electron/main.js (or equivalent) — windows, IPC channels, native preview, virtual camera pipe.
3. Next.js structure: app/ router usage, API routes, layout/pages.
4. State management approach (React state? contexts? stores?).
5. The sprints model in docs/PARALLEL_SPRINTS.md — E0-E5: what each sprint delivered.
6. native/ folder — what native code exists (Rust? C++? Node addons?).
7. services/ folder — what services exist.
8. Build/packaging: electron-builder.yml, scripts/pack-release.mjs.
9. MERGE_LOG.md and state.md — current project state.`,
};

function runAgent(id, prompt) {
  return new Promise((resolvePromise) => {
    const outFile = resolve(OUT_DIR, `${id}.md`);
    const logFile = resolve(OUT_DIR, `${id}.stream.log`);
    const startedAt = Date.now();
    console.log(`[spawn] agent "${id}" started -> ${logFile}`);

    const child = spawn(
      'opencode',
      ['run', '--dir', REF_DIR, '--title', `analysis-${id}`, `${COMMON}\n\n${prompt}`],
      { shell: true, env: process.env }
    );

    // STREAM stdout/stderr directly to the log file as it arrives.
    const logStream = createWriteStream(logFile, 'utf8');
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });

    child.on('close', (code) => {
      const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
      logStream.end(`\n\n--- exit ${code} after ${secs}s ---\n`, () => {
        // Promote the streamed log to the final .md report.
        try { copyFileSync(logFile, outFile); } catch { /* ignore */ }
        console.log(`[done] agent "${id}" finished in ${secs}s (exit ${code})`);
        resolvePromise({ id, code });
      });
    });
  });
}

console.log(`Spawning ${Object.keys(MISSIONS).length} analysis agents on ${REF_DIR}...\n`);
const results = await Promise.all(
  Object.entries(MISSIONS).map(([id, prompt]) => runAgent(id, prompt))
);
console.log('\nAll agents finished:');
for (const r of results) console.log(`  - ${r.id}: exit ${r.code} -> ${r.outFile}`);
