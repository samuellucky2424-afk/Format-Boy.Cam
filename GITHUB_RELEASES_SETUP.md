# Releases GitHub Henshin

## Prerequis

- Runner GitHub `windows-latest`, Bun `1.3.14`, Node.js 22 et `app/bun.lock` sont utilises par le workflow.
- Les cibles officielles sont **Windows 10 x64 et Windows 11 x64**.
- Les quatre binaires camera sont compiles en Release avec le runtime MSVC statique `/MT`; Visual Studio et le redistribuable VC++ ne sont pas requis sur le PC cible.
- `henshin_cam_mf_smoke.exe` reste un outil de diagnostic de build/QA et n'est pas livre.
- Une signature Authenticode valide est obligatoire avant une diffusion publique. Un build interne non signe reste possible.

## Secrets GitHub Actions

Variables navigateur requises par le preflight:

- `VITE_API_BASE_URL`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Signature Authenticode obligatoire pour le workflow de publication:

- `WINDOWS_PFX_BASE64`: contenu base64 du certificat PFX
- `WINDOWS_PFX_PASSWORD`: mot de passe du certificat

Le workflow signe d'abord les quatre binaires camera avec `signtool`, puis transmet le meme certificat a electron-builder via `CSC_LINK` et `CSC_KEY_PASSWORD`. Un build local interne peut rester non signe, mais le workflow refuse de publier sans certificat.

`GITHUB_TOKEN` est fourni automatiquement par Actions. Le workflow ne cree pas `app/.env`, n'utilise pas npm et ne modifie aucun lockfile.

## Preparer une version

Depuis `app`, synchronisez package, API et updater sans toucher `bun.lock`:

```powershell
bun run release:sync 2.0.27
bun install --frozen-lockfile
```

Compilez les binaires sur une machine de build Windows avec Visual Studio Build Tools et CMake:

```powershell
cmake -S native-camera -B native-camera/build -A x64
cmake --build native-camera/build --config Release --parallel
```

Chargez les trois variables `VITE_*` requises dans l'environnement du processus, puis lancez:

```powershell
cd app
bun run release:preflight
bun run electron-builder --win nsis --publish never
```

Le preflight verifie les quatre binaires, la version `2.0.27`, `Henshin-Setup-${version}.${ext}`, les variables navigateur, puis lint et build. Il ne compile rien sur le PC client.

## Publier

La version du tag est la source de verite du job; le workflow la resynchronise sans npm lock:

```powershell
git tag v2.0.27
git push origin v2.0.27
```

Le workflow recherche exactement `app/release/Henshin-Setup-2.0.27.exe`, calcule SHA256, produit le fichier `.sha256`, puis charge les deux assets dans la release. `/api/version` selectionne uniquement le motif `Henshin-Setup-<semver>.exe`; l'updater refuse un manifeste sans checksum SHA256 valide et verifie le fichier telecharge avant execution.

Une build de test non signee doit etre lancee manuellement avec `allow_unsigned=true`. Elle est publiee comme prerelease et ne change pas l'exigence de signature des tags normaux.

## Installation et desinstallation

L'installateur est per-machine et demande les droits administrateur. Sur Windows 11, le registrar active la camera Media Foundation; sur Windows 10, il charge uniquement le filtre DirectShow compatible. Il n'existe aucun fallback per-user; un registrar absent ou en erreur fait echouer explicitement l'installation.

La desinstallation doit d'abord desinscrire la camera et COM. Elle supprime ensuite uniquement les repertoires camera possedes `ProgramData\HenshinCam` et `Public\Documents\HenshinCam`; une erreur de desinscription arrete la desinstallation afin de permettre une nouvelle tentative.

## Securite

Ne committez ni `app/.env`, ni PFX, ni token. Si l'historique Git, une ancienne release ou des logs ont expose des secrets, faites tourner tous les anciens secrets concernes avant toute release publique. La validation finale doit etre faite sur des VM Windows 10 x64 et Windows 11 x64 propres, sans Visual Studio ni VC++ Redistributable installe.
