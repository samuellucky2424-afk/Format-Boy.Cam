import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requestedVersion = String(process.argv[2] || '').replace(/^v/, '').trim();

if (!/^\d+\.\d+\.\d+$/.test(requestedVersion)) {
  console.error('Usage: bun run release:sync <major.minor.patch>');
  process.exit(1);
}

const packagePath = path.join(appDir, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
packageJson.version = requestedVersion;
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 4)}\n`);

const replacements = [
  ['api/version.ts', /const FALLBACK_VERSION = '[^']+';/, `const FALLBACK_VERSION = '${requestedVersion}';`],
  ['electron/updater.js', /export const CURRENT_VERSION = '[^']+';/, `export const CURRENT_VERSION = '${requestedVersion}';`],
  ['src/lib/app-version.ts', /export const CURRENT_VERSION = '[^']+';/, `export const CURRENT_VERSION = '${requestedVersion}';`],
];

for (const [relativePath, pattern, replacement] of replacements) {
  const filePath = path.join(appDir, relativePath);
  const source = fs.readFileSync(filePath, 'utf8');
  if (!pattern.test(source)) {
    throw new Error(`Version constant not found in ${relativePath}`);
  }
  fs.writeFileSync(filePath, source.replace(pattern, replacement));
}

console.log(`Release version synchronized to ${requestedVersion}; bun.lock was not modified.`);
