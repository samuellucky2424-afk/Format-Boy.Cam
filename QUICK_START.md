# Release production: demarrage rapide

1. Configurez Vercel avec **Root Directory = `app`** et la matrice de `VERCEL_CONFIG.md`.
2. Configurez dans GitHub Actions `VITE_API_BASE_URL`, `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
3. Pour une release publique, configurez aussi `WINDOWS_PFX_BASE64` et `WINDOWS_PFX_PASSWORD`; le workflow signe les binaires natifs, l'application et l'installateur.
4. Synchronisez la version: `cd app; bun run release:sync 2.0.27`.
5. Installez strictement le lockfile: `bun install --frozen-lockfile`.
6. Compilez en x64 Release: `cmake -S native-camera -B native-camera/build -A x64`, puis `cmake --build native-camera/build --config Release --parallel`.
7. Avec les trois variables `VITE_*` chargees dans le processus, lancez `cd app; bun run release:preflight`.
8. Commitez la version, creez le tag `v2.0.27`, puis poussez le commit et le tag.
9. Verifiez la release: `Henshin-Setup-2.0.27.exe`, son fichier `.sha256`, puis `/api/version`.
10. Validez installation, camera et desinstallation sur des VM Windows 10 x64 et Windows 11 x64 propres, sans Visual Studio ni redistribuable VC++.

Le PC cible ne compile rien. L'installateur est machine-wide, sans fallback per-user, et les quatre binaires runtime camera sont hors ASAR. Le smoke tool est uniquement diagnostique.

Ne touchez pas `app/.env` pour la release. Ne committez aucun secret. Si un ancien secret a ete expose dans l'historique ou des logs, faites tourner tous les anciens secrets concernes avant publication.
