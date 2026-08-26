# Configuration Vercel de production

## Projet

Dans Vercel, configurez **Root Directory** sur `app`. `app/vercel.json` impose ensuite `bun install --frozen-lockfile`, `bun run build` et la sortie `dist`.

Les rewrites conserves sont uniquement les alias API reellement geres par les fonctions:

| Route publique | Fonction Vercel |
|---|---|
| `/api/morphly-token` | `/api/start-session?action=morphly-token` |
| `/api/payment/fapshi-init` | `/api/wallet?action=fapshi-init` |
| `/api/payment/fapshi-return` | `/api/wallet?action=fapshi-return` |
| `/api/payment/fapshi-status` | `/api/wallet?action=fapshi-status` |
| `/api/payment/fapshi-webhook` | `/api/wallet?action=fapshi-webhook` |

## Variables

Ajoutez les valeurs dans Vercel Settings > Environment Variables. Ne placez jamais une cle serveur dans une variable `VITE_*`.

L'origine de production unique est `https://henshin.numzer0.store`: utilisez `VITE_API_BASE_URL=https://henshin.numzer0.store/api` et cette meme origine pour `APP_PUBLIC_URL` et `PAYMENT_RETURN_URL`.

| Groupe | Variable | Portee | Requise |
|---|---|---|---|
| Navigateur | `VITE_API_BASE_URL` | Build + navigateur | Oui |
| Supabase | `VITE_SUPABASE_URL` | Build + navigateur | Oui |
| Supabase | `VITE_SUPABASE_ANON_KEY` | Build + navigateur, cle publique | Oui |
| Supabase | `SUPABASE_URL` | Serveur | Oui |
| Supabase | `SUPABASE_SERVICE_ROLE_KEY` | Serveur secret | Oui |
| Fapshi | `FAPSHI_BASE_URL` | Serveur | Oui |
| Fapshi | `FAPSHI_APIUSER` | Serveur secret | Oui |
| Fapshi | `FAPSHI_APIKEY` | Serveur secret | Oui |
| Fapshi | `FAPSHI_WEBHOOK_SECRET` | Serveur secret | Oui |
| Fapshi | `APP_PUBLIC_URL` | Serveur, URL de retour | Oui |
| Fapshi | `PAYMENT_RETURN_URL` | Serveur, destination apres checkout | Oui |
| Fapshi | `FAPSHI_APP_RETURN_URL` | Serveur, pont HTTPS vers `henshin://` | Oui |
| Fapshi | `FAPSHI_WEBHOOK_URL` | Documentation ops | Non |
| Reactor | `REACTOR_API_KEY` | Serveur secret | Oui |
| Reactor | `REACTOR_API_URL` | Serveur | Non, defaut Reactor |
| Reactor | `VITE_REACTOR_API_URL` | Navigateur, URL publique | Non |
| Reactor | `VITE_REACTOR_DASHBOARD_URL` | Navigateur, URL publique | Non |
| GitHub | `DESKTOP_GITHUB_OWNER` | Serveur | Oui, `pius-coder` |
| GitHub | `DESKTOP_GITHUB_REPO` | Serveur | Oui, `ghostSwap237` |
| GitHub | `DESKTOP_GITHUB_EXE_PATTERN` | Serveur | Oui, `^Henshin-Setup-\d+\.\d+\.\d+\.exe$` |
| GitHub | `GITHUB_TOKEN` | Serveur secret | Non, utile pour depot prive/quota |

`MORPHLY_API_KEY` est requis cote serveur si Morphly est actif. `EXCHANGE_RATE_API_KEY` est optionnel selon le fournisseur de taux. Les fallbacks updater `DESKTOP_*` et Supabase Storage sont decrits dans `app/.env.example`; GitHub Releases reste la source primaire.

En production, utilisez `FAPSHI_BASE_URL=https://live.fapshi.com` et `FAPSHI_APP_RETURN_URL=https://henshin.numzer0.store/api/payment/fapshi-return`. Dans le dashboard Fapshi, configurez `https://henshin.numzer0.store/api/payment/fapshi-webhook` et le meme secret que `FAPSHI_WEBHOOK_SECRET`. Le webhook recoit les POST serveur; le pont HTTPS ouvre ensuite `henshin://payment-success` pour revenir dans l'application.

Dans Supabase Authentication > URL Configuration, utilisez `https://henshin.numzer0.store` comme Site URL et ajoutez `https://henshin.numzer0.store/auth-callback` ainsi que `henshin://auth-callback` dans Redirect URLs. Une inscription web revient au callback HTTPS; une inscription depuis Electron ouvre directement l'application. Les deux parcours terminent ensuite l'echange PKCE. Ne laissez aucune URL localhost comme destination de production.

## Preflight et deploiement

Depuis la racine du depot, sans afficher de valeur d'environnement:

```powershell
bunx vercel pull --yes --environment=production --cwd app
bun app/scripts/vercel-preflight.mjs
bunx vercel build --prod --cwd app
bunx vercel deploy --prebuilt --prod --cwd app
```

Puis verifiez `https://<domaine>/api/version`: le nom doit etre `Henshin-Setup-<version>.exe` et `sha256` doit contenir 64 caracteres hexadecimaux.

Ne commitez jamais `app/.env`. Si un secret a deja ete expose dans Git ou dans des journaux publics, revoquez-le et faites tourner **tous** les anciens secrets concernes avant le deploiement.
