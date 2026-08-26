// afterPack.cjs — electron-builder afterPack hook
// Copies the 4 required runtime camera binaries from the CMake Release output
// into resources/henshin-cam/ inside the packaged app.
// This runs AFTER electron-builder packages the app but BEFORE the installer
// is created, so the binaries are bundled into the final installer.

'use strict';

const fs   = require('fs');
const path = require('path');

const BINARIES = [
  'henshin_cam_registrar.exe',
  'henshin_cam_pipe_publisher.exe',
  'HenshinVirtualCameraMF.dll',
  'HenshinVirtualCamera.dll',
];

// henshin_cam_mf_smoke.exe is intentionally not shipped: it is a build/QA
// diagnostic, not an application runtime dependency.

exports.default = async function afterPack(context) {
  const { appOutDir } = context;

  // Source: native-camera/build/Release (cmake output)
  const repoRoot = path.resolve(__dirname, '..', '..');
  const configuredBinDir = String(process.env.HENSHIN_NATIVE_BIN_DIR || '').trim();
  const srcDir = configuredBinDir
    ? path.resolve(repoRoot, configuredBinDir)
    : path.join(repoRoot, 'native-camera', 'build', 'Release');

  // Destination: <packaged-app>/resources/henshin-cam/
  const dstDir = path.join(appOutDir, 'resources', 'henshin-cam');

  if (!fs.existsSync(srcDir)) {
    throw new Error(
      `[afterPack] Native binaries source dir not found: ${srcDir}\n` +
      `  Run: cmake -S native-camera -B native-camera/build -A x64\n` +
      `       cmake --build native-camera/build --config Release`
    );
  }

  fs.mkdirSync(dstDir, { recursive: true });

  const missing = [];
  for (const bin of BINARIES) {
    const src = path.join(srcDir, bin);
    const dst = path.join(dstDir, bin);
    if (!fs.existsSync(src)) {
      missing.push(src);
      continue;
    }
    fs.copyFileSync(src, dst);
    console.log(`[afterPack] Bundled: ${bin}`);
  }

  if (missing.length > 0) {
    throw new Error(
      '[afterPack] Missing native camera binaries:\n' +
      missing.map((file) => `  - ${file}`).join('\n')
    );
  }

  console.log('[afterPack] All native camera binaries bundled successfully');
};
