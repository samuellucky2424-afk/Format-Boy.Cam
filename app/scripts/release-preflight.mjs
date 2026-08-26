import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = path.resolve(appDir, '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
const expectedArtifact = 'Henshin-Setup-${version}.${ext}';
const requiredBrowserEnv = ['VITE_API_BASE_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'];
const requiredBinaries = [
  'henshin_cam_registrar.exe',
  'henshin_cam_pipe_publisher.exe',
  'HenshinVirtualCameraMF.dll',
  'HenshinVirtualCamera.dll',
];

const errors = [];
if (!/^\d+\.\d+\.\d+$/.test(packageJson.version)) errors.push('package.json version is not major.minor.patch');
if (packageJson.build?.artifactName !== expectedArtifact) errors.push(`artifactName must be ${expectedArtifact}`);
if (packageJson.build?.nsis?.perMachine !== true) errors.push('NSIS must be configured perMachine');

for (const name of requiredBrowserEnv) {
  if (!String(process.env[name] || '').trim()) errors.push(`missing browser environment variable: ${name}`);
}

for (const [relativePath, pattern] of [
  ['api/version.ts', new RegExp(`FALLBACK_VERSION = '${packageJson.version.replaceAll('.', '\\.')}';`)],
  ['electron/updater.js', new RegExp(`CURRENT_VERSION = '${packageJson.version.replaceAll('.', '\\.')}';`)],
  ['src/lib/app-version.ts', new RegExp(`CURRENT_VERSION = '${packageJson.version.replaceAll('.', '\\.')}';`)],
]) {
  const source = fs.readFileSync(path.join(appDir, relativePath), 'utf8');
  if (!pattern.test(source)) errors.push(`${relativePath} is not synchronized to ${packageJson.version}`);
}

const configuredBinDir = String(process.env.HENSHIN_NATIVE_BIN_DIR || '').trim();
const nativeBinDir = configuredBinDir
  ? path.resolve(repoDir, configuredBinDir)
  : path.join(repoDir, 'native-camera', 'build', 'Release');
for (const binary of requiredBinaries) {
  const binaryPath = path.join(nativeBinDir, binary);
  if (!fs.existsSync(binaryPath) || !fs.statSync(binaryPath).isFile()) errors.push(`missing native binary: ${binaryPath}`);
}

if (errors.length > 0) {
  console.error(`Release preflight failed:\n${errors.map((error) => `- ${error}`).join('\n')}`);
  process.exit(1);
}

for (const script of ['lint', 'build']) {
  const result = spawnSync('bun', ['run', script], { cwd: appDir, env: process.env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log(`Release preflight passed for Henshin-Setup-${packageJson.version}.exe.`);
