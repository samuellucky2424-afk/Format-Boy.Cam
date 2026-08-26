# Rapport d'analyse — Authentification

## Métadonnées

| Champ | Valeur |
|---|---|
| Date de l'analyse | 15 août 2026 |
| Branche git | `sandbox` |
| Derniers commits | `e264fbc Start billing when realtime credential is issued`, `f79665b Prevent billing failed realtime starts` |
| Version de l'app | `2.0.25` (`app/package.json:4`) |
| Stack | React 19 + Vite 7 (HashRouter), Electron 41, API Vercel-style (`app/api`), Supabase (Auth + Postgres + RLS + Storage), serveur Express local `app/scripts/local-api-server.mjs` |

---

## 1. Vue d'ensemble

L'authentification repose **entièrement sur Supabase Auth** (email/mot de passe + Google OAuth), en flux **PKCE** avec échange de code manuel. Il n'existe pas de système d'auth propriétaire : l'API Vercel ne crée pas de sessions elle-même ; elle **vérifie les JWT Supabase** via le client `service_role` (`supabaseAdmin.auth.getUser(token)`) pour les routes qui le font, et fait confiance aveuglément au paramètre `userId` pour les autres.

```
┌───────────────────────────────┐        ┌────────────────────────────────┐
│  Renderer (Vite / Electron)   │        │  API (Vercel / Express local)  │
│                               │        │                                │
│  supabase-js (client ANON,    │        │  supabaseAdmin (clé service    │
│  PKCE, localStorage)          │        │  role, autoRefresh=false)      │
│  AuthContext (état user)      │        │  app/api/*.ts (handlers)       │
│                               │        │  app/server/*.ts (handlers)    │
└───────┬───────────────┬───────┘        └───────┬─────────────────▲──────┘
        │               │                        │                 │
        │ (1) OAuth     │ (2) API avec Bearer    │ (3) Auth via    │ (4) RLS
        │ Google        │    access_token JWT    │    auth.getUser │    direct
        │ henshin://  │    (resolve-user,      │    (admin)      │    (anon)
        │ deep link     │    crypto-submit,      │                 │
        │               │    payment-methods)    │                 │
        ▼               ▼                        ▼                 │
┌──────────────────────────────────────────────────────────────────────┐
│  Supabase  —  auth.users (identités) · tables public (RLS) · Storage │
└──────────────────────────────────────────────────────────────────────┘
```

### Identité canonique vs identité de session (concept clé)

`app/src/context/AuthContext.tsx:17-25` distingue :
- **`user.id`** (canonical) — le **plus ancien compte Supabase** pour un email donné ; c'est l'ID utilisé pour **tous** les appels API (crédits, sessions, paiements) ;
- **`user.authId`** — l'ID `auth.users` de la session courante, qui peut différer si l'utilisateur s'est connecté via Google et a créé un doublon.

La résolution se fait au démarrage via `POST /api/auth/resolve-user` (Bearer token), qui **migre les données du doublon vers le compte canonique** (crédits, transactions, sessions) et garantit un wallet.

---

## 2. Flux détaillés

### 2.1 Inscription (email + mot de passe)

Fichier : `app/src/pages/Login.tsx:57-71` → `AuthContext.register` (`app/src/context/AuthContext.tsx:359-407`).

1. Validation minimale côté client : nom ≥ 2 caractères, email, mot de passe `minLength=6` (`Login.tsx:188`).
2. `supabase.auth.signUp({ email, password, options: { data: { name }, emailRedirectTo: buildHashRouteUrl(ROUTES.PUBLIC.LOGIN) } })` — `AuthContext.tsx:368-377`. L'URL de redirection d'email pointe vers `/login` en hash-routing (`app/src/lib/auth.ts:5-11`).
3. Si `data.user.confirmed_at` existe (confirmation d'email **désactivée** côté projet Supabase), un `signInWithPassword` implicite est exécuté et l'utilisateur est redirigé vers `/dashboard` (`AuthContext.tsx:384-394`). Sinon il est quand même redirigé vers `/dashboard` (l'écran affichera un état non confirmé) — `AuthContext.tsx:395-399`.
4. Le trigger `handle_new_user` crée la ligne `public.users` + `public.wallets` (`supabase/setup_schema.sql:121-137`, idempotent via `ON CONFLICT DO NOTHING` dans `supabase/migration.sql:205-224`).

**Absent** : pas de téléphone, pas d'OTP (`signInWithOtp` n'est utilisé nulle part — grep des 15 usages d'API auth ne montre que `getSession`, `onAuthStateChange`, `exchangeCodeForSession`, `signInWithPassword`, `signUp`, `signInWithOAuth`, `signOut`), pas de « forgot password » fonctionnel (bouton factice : « Password reset coming soon », `Login.tsx:170-177`).

### 2.2 Connexion (email + mot de passe)

`AuthContext.login` (`app/src/context/AuthContext.tsx:318-357`) :

1. `signInWithPassword` avec timeout de 20 s (`AUTH_REQUEST_TIMEOUT_MS`, `AuthContext.tsx:43`).
2. `buildUser(user, session)` (`AuthContext.tsx:170-202`) :
   - `resolveCanonicalUserId(session, authId)` — `POST /api/auth/resolve-user` avec `Authorization: Bearer <access_token>` (`AuthContext.tsx:125-156`) ; en cas d'échec, repli non bloquant sur `authId` ;
   - lecture de `users.is_admin` via le client **anon** (`supabase.from('users').select('is_admin').eq('id', canonicalId)`) avec timeout 12 s — rendu possible par la RLS « chaque utilisateur lit sa propre ligne » (`supabase/migration.sql:135-145`).
3. Redirection : admin → `/admin`, sinon `/dashboard` (`AuthContext.tsx:346-349`). La redirection est calculée aussi dans `PublicRoute` (`app/src/components/ProtectedRoute.tsx:53-56`).

### 2.3 Session : stockage, restauration, rafraîchissement

- **Stockage** : localStorage standard de `supabase-js` (clé `sb-<project-ref>-auth-token`). Aucune surcouche custom (pas de cookie, pas d'indexedDB).
- **Restauration** : `getSession()` au montage du `AuthProvider` (`AuthContext.tsx:206-224`), puis abonnement `onAuthStateChange` (`AuthContext.tsx:227-260`).
- **Déduplication** : `resolvingSessionRef` évite d'appeler `resolve-user` deux fois pour le même `access_token` (`AuthContext.tsx:236-258`). Le build de l'utilisateur est différé via `window.setTimeout(..., 0)` car Supabase interdit d'attendre d'autres appels dans le callback (verrou interne du client) — `AuthContext.tsx:240-258`.
- **Rafraîchissement** : délégué au client `supabase-js` (refresh token automatique du flux PKCE). `detectSessionInUrl: false` (`app/src/lib/supabase.ts:9`) impose un échange de code **manuel** (`exchangeCodeForSession`) — il n'y a pas de gestion custom du refresh côté serveur.
- **Timeout global de chargement** : 5 s (`AuthContext.tsx:262-264`).

### 2.4 Déconnexion

`AuthContext.logout` (`app/src/context/AuthContext.tsx:494-506`) : `signOut()` (révoque la session Supabase locale), reset de l'état, redirection `/login`. Appelé depuis `Sidebar` (`app/src/components/Sidebar.tsx:37-40`), `Settings` (`app/src/pages/Settings.tsx:55,323-329`), `Wallet` (`app/src/pages/Wallet.tsx:82-89`), `Subscription` (`app/src/pages/Subscription.tsx:79-86`). Aucune révocation serveur dédiée.

### 2.5 OAuth Google — Web (popup)

`AuthContext.signInWithGoogle` (`AuthContext.tsx:409-492`) :

1. Popup centrée nommée `henshin-google-auth` (`AuthContext.tsx:40-42,79-97`), état « Connecting to Google » injecté (`AuthContext.tsx:99-113`).
2. `signInWithOAuth({ provider: 'google', options: { redirectTo: buildHashRouteUrl('/auth/callback?next=...&auth=popup'), queryParams: { access_type: 'offline', prompt: 'consent' }, skipBrowserRedirect: true } })` — `AuthContext.tsx:460-470`. L'URL de callback est construite par `app/src/lib/auth.ts:21-31`.
3. Le popup navigue vers `data.url` (`AuthContext.tsx:482`).
4. `AuthCallback` (`app/src/pages/AuthCallback.tsx:15-82`) : lit `code` dans l'URL racine, appelle `exchangeCodeForSession(code)` (`AuthCallback.tsx:67`), puis **postMessage** `henshin-google-auth-complete` à l'opener (vérification `event.origin === window.location.origin` des deux côtés — `AuthCallback.tsx:38`, `Login.tsx:37-40`) et ferme la popup après 150 ms.
5. `Login` écoute le message et navigue vers `next` (`Login.tsx:36-55`).

### 2.6 OAuth Google — Electron (deep-link `henshin://`)

1. `signInWithOAuth` avec `redirectTo: henshin://auth/callback?next=...` (`app/src/lib/auth.ts:33-39`, `AuthContext.tsx:418-430`).
2. `ipcRenderer.send('open-auth-popup', url)` → main : `shell.openExternal(url)` (**navigateur système**, Google bloque les user-agents embarqués) — `app/electron/main.js:435-440`.
3. Retour : le navigateur système déclenche le protocole `henshin` (enregistré via `app.setAsDefaultProtocolClient('henshin')`, `main.js:198`, et déclaré dans `app/package.json:10-17`).
4. À la réception : `second-instance` (Windows, `main.js:306-313`) ou `open-url` (macOS, `main.js:464-467`), éventuellement `initialDeepLink` (`main.js:509-513`). `handleOAuthCallback` (`main.js:240-248`) accepte `henshin:` **et** `http(s)://localhost|127.0.0.1|::1` (mode dev) — `isOAuthCallbackUrl`, `main.js:203-220`.
5. Le callback est bufferisé (`pendingOAuthCallbackUrl`) jusqu'à ce que le renderer envoie `oauth-callback-ready` (`main.js:442-445`), puis transmis par `webContents.send('oauth-callback', url)` (`flushPendingOAuthCallback`, `main.js:229-238`).
6. `AuthContext` (Electron only, `AuthContext.tsx:272-312`) : parse l'URL (`henshin://` re-écrit en `https://localhost/` pour `new URL`, `AuthContext.tsx:67-77`), extrait `code` et `next`, normalise `next` (anti open-redirect : doit commencer par `/` et non par `//` — `app/src/lib/auth.ts:13-19`), puis `exchangeCodeForSession(code)` et navigation.
7. Fenêtre OAuth dédiée : `createAuthWindow` (`main.js:250-300`) — webPreferences **durcis** (`sandbox: true, contextIsolation: true, nodeIntegration: false`) — intercepte `will-navigate`/`will-redirect`/`setWindowOpenHandler` pour capturer le callback. En pratique, avec `shell.openExternal`, cette fenêtre n'est pas utilisée pour Google (le code existe pour d'autres providers éventuels).
8. Single-instance enforce (`main.js:201,302-314`) pour que le deep-link arrive bien dans l'instance existante.

### 2.7 Démarrage de session payante (lié à l'auth)

- `Dashboard.handleStart` (`app/src/pages/Dashboard.tsx:772-845`) : `POST /start-session` `{ userId }`, puis SDK Morphly avec `tokenEndpoint = /morphly-token?userId=...` (`Dashboard.tsx:574`) — le SDK Morphly fait lui-même un `POST` vers ce endpoint.
- Polling chaque seconde : `GET /session-status?userId=...` (`Dashboard.tsx:746-770`) ; arrêt auto si `shouldStop`/`forceEnd` ; à l'unmount, `POST /end-session { userId }` (`Dashboard.tsx:208-228`).

---

## 3. Fichiers clés

### Client (renderer)

| Fichier | Rôle | Lignes clés |
|---|---|---|
| `app/src/lib/supabase.ts` | Client anon PKCE, détection URL désactivée | `:6-10` |
| `app/src/context/AuthContext.tsx` | Cœur : types `User` (canonical/auth), `buildUser`, `resolveCanonicalUserId`, `login`, `register`, `signInWithGoogle`, `logout`, deep-link Electron | `:17-25`, `:125-156`, `:170-202`, `:206-270`, `:272-312`, `:318-357`, `:359-407`, `:409-492`, `:494-506` |
| `app/src/lib/auth.ts` | Helpers d'URL : `buildHashRouteUrl`, `normalizeRedirectPath`, `buildGoogleCallbackPath`, `buildElectronCallbackUrl` (`henshin://`) | `:5-39` |
| `app/src/lib/api-client.ts` | `getApiUrl`/`apiFetch` : base `/api` en dev, `VITE_API_BASE_URL` en prod avec repli Vercel, timeouts, retries | `:10-30`, `:36-38`, `:80-128` |
| `app/src/services/api.ts` | `apiRequest` — ajoute `Authorization: Bearer <token>` si fourni ; classes `ApiError`/`AuthError` | `:49-80` |
| `app/src/pages/Login.tsx` | Form login/signup, bouton Google, écoute postMessage popup | `:36-55`, `:57-81`, `:73-81` |
| `app/src/pages/AuthCallback.tsx` | Échange du code PKCE, popup → postMessage, fallback redirect | `:15-82` |
| `app/src/pages/Dashboard.tsx` | Appels session (start/end/status) et token Morphly avec `userId` en clair | `:208-228`, `:574`, `:746-845`, `:847-879` |
| `app/src/pages/AdminDashboard.tsx` | Lecture du token de session, appels API admin Bearer, RPC Supabase admin | `:66-106`, `:108-174`, `:184-239` |
| `app/src/components/CryptoPaymentModal.tsx` | `handlePaid` → `POST /payment/crypto-submit` avec Bearer + `userId` | `:89-137` |
| `app/src/components/ProtectedRoute.tsx` | `ProtectedRoute`/`PublicRoute`/`AuthGuard` basés sur `isAuthenticated` | `:11-37`, `:39-59`, `:66-78` |
| `app/src/context/AppContext.tsx` | Chargement des crédits via `/wallet?userId=` (sans Bearer) | `:51-105` |
| `app/src/lib/routes.ts` | Routes publiques/protégées | `:1-20` |
| `app/src/App.tsx` | Routage : `/login`, `/signup`, `/auth/callback`, `/admin`, etc. | `:33-89` |

### Electron (main)

| Fichier | Rôle | Lignes clés |
|---|---|---|
| `app/electron/main.js` | Protocole `henshin`, single-instance, capture des callbacks OAuth, fenêtre principale (`nodeIntegration: true, contextIsolation: false` pour la vcam), popup OAuth durcie, IPC `open-auth-popup`/`oauth-callback`/`oauth-callback-ready`, chargement `dist/index.html` (packagé) ou `localhost:5173` (dev), chargement `.env` (dotenv) | `:198-201`, `:203-248`, `:250-300`, `:302-314`, `:316-323`, `:325-403`, `:430-445`, `:464-467`, `:509-513` |
| `app/package.json` | Protocole `henshin` déclaré ; scripts `dev`, `dev:api`, `dev:all`, `electron:dev`, `electron:build` | `:10-17`, `:39-49` |

### API (serveur Vercel / Express local)

| Fichier | Rôle | Lignes clés |
|---|---|---|
| `app/api/supabase.ts` | Client `service_role` (`SUPABASE_SERVICE_ROLE_KEY` ou `SUPABASE_SERVICE_KEY`), `autoRefreshToken: false, persistSession: false` | `:4-17` |
| `app/api/auth/resolve-user.ts` | **Seul point de résolution d'identité** : vérifie le JWT Bearer via `supabaseAdmin.auth.getUser`, liste les comptes même email (`auth.admin.listUsers`, perPage 1000), choisit le plus ancien, migre wallets/transactions/sessions, crée le wallet canonique | `:29-40`, `:50-118`, `:127-192` |
| `app/api/start-session.ts` | Crée une session active (userId du body, **sans JWT**) ; délègue à morphly-token via `?action=morphly-token` | `:101-153`, `:102-104` |
| `app/api/end-session.ts` | Clôture la session et débite les crédits (userId du body, **sans JWT**) | `:98-123`, `:107-117` |
| `app/api/session-status.ts` | Poll 1 s : heartbeat `last_heartbeat`, secondes billables, `shouldStop`/`forceEnd` (userId en query, **sans JWT**) | `:13-89`, `:20-22` |
| `app/api/wallet.ts` | Transactions + solde (userId en query, **sans JWT**) ; route de dispatch pour `crypto-submit` et `payment-methods` via rewrites Vercel | `:7-65`, `:8-13` |
| `app/api/credit-utils.ts` | `getWalletByUserId` (upsert idempotent), `updateWalletCredits` | `:30-77`, `:89-114` |
| `app/server/morphly-token.ts` | Émet le credential Morphly : userId en query/body (**sans JWT**), vérifie crédits > 0 et session active, marque `realtime_credential_issued_at` (déclenche la facturation) | `:41-177`, `:69-75`, `:144-168` |
| `app/server/crypto-submit.ts` | **Avec JWT** : `auth.getUser(token)`, résolution du userId de facturation par correspondance d'email (`resolveBillingUserId`), insertion `crypto_payments` pending | `:51-77`, `:9-33` |
| `app/server/payment-methods.ts` | `requireAdmin` : JWT + check `users.is_admin` ; GET public des méthodes actives ; POST/PATCH réservés admin ; sauvegarde/restauration dans Storage privé `admin-config-backups` | `:16-51`, `:263-359` |
| `app/api/payment/paystack-init.ts` | Initialise Paystack (montant validé contre `credit_packages`), référence `FMT-<ts>-<userId>` | `:17-112`, `:59` |
| `app/api/payment/paystack-verify.ts` | Vérifie la transaction Paystack, **extrait `userId` du reference** (`FMT-…`), crédite le wallet, idempotent par `reference` | `:39-184`, `:91-99` |
| `app/api/payment/paystack-webhook.ts` | Webhook Paystack : vérifie la signature HMAC-SHA512 (`x-paystack-signature`), matching par montant sur paliers codés en dur, crédite le wallet | `:41-53`, `:94-116` |
| `app/api/version.ts` | Updater public (GitHub Releases puis Storage Supabase signed) — sans auth | `:66-170` |
| `app/api/rate.ts` | Taux de change public, fallback 1500 — sans auth | `:7-79` |
| `app/scripts/local-api-server.mjs` | Express local port 3001 : monte **toutes** les routes `/api/*` ci-dessus | `:18-41` |
| `app/vercel.json` | Rewrites : `/api/morphly-token` → `start-session?action=morphly-token`, `/api/payment/crypto-submit` → `wallet?action=crypto-submit`, `/api/payment-methods` → `wallet?action=payment-methods` | `:1-16` |

### Base de données (supabase/)

| Fichier | Rôle | Lignes clés |
|---|---|---|
| `supabase/setup_schema.sql` | Schéma initial : `users`, `wallets`, `transactions`, `sessions`, `plans`, `subscriptions` ; RLS par `auth.uid() = id` ; trigger `handle_new_user` (crée user+wallet à l'inscription) | `:5-69`, `:75-114`, `:121-137` |
| `supabase/migration.sql` | V2 : `is_premium`, index, policies SELECT/INSERT/UPDATE par user, fonctions `deduct_from_wallet`/`add_to_wallet`, seed plans | `:9-101`, `:127-249`, `:251-331` |
| `supabase/admin_crypto_schema_migration.sql` | **`users.is_admin BOOLEAN DEFAULT FALSE`** ; `credit_packages` (price_usd, sort_order) ; `crypto_payments` ; premières policies admin (avec sous-requête directe, avant le correctif) ; RPC `confirm_crypto_payment`/`admin_add_credits` | `:1-34`, `:46-92`, `:95-154` |
| `supabase/fix_admin_rls_recursion.sql` | **`public.is_admin()` SECURITY DEFINER** (corrige la récursion RLS 42P17) ; policies admin sur users/wallets/transactions/sessions/credit_packages/crypto_payments | `:4-18`, `:20-55` |
| `supabase/payment_approval_and_packages.sql` | Wallet partagé credits/balance (`sync_wallet_balance_and_credits`), subscriptions, `payment_methods`, bucket public `payment-qr-codes`, `crypto_payments` final + `create_pending_crypto_payment`, `admin_confirm_payment`, `admin_confirm_website_transaction`, vue `admin_users` (security_invoker) | `:54-86`, `:203-267`, `:269-355`, `:401-519`, `:187-199` |
| `supabase/protect_payment_methods.sql` | Supprime les policies INSERT/UPDATE/DELETE clientes sur `payment_methods` (écriture uniquement via l'API supervisor) | `:6-17` |
| `supabase/credit_system_migration.sql`, `paystack_reference_migration.sql`, `seed_plans.sql` | Migrations incrémentales (credits, reference, plans legacy) | — |

---

## 4. Rôles et permissions

Il n'existe **pas de table `roles`** : le rôle est un **booléen `users.is_admin`** (`supabase/admin_crypto_schema_migration.sql:1-3`), complété par `is_premium` (inutilisé par le frontend).

| Mécanisme | Détail |
|---|---|
| Flag | `public.users.is_admin BOOLEAN DEFAULT FALSE` |
| Détection frontend | `AuthContext.buildUser` lit `is_admin` via client anon (RLS propre ligne) — `AuthContext.tsx:174-192` ; `user.isAdmin` contrôle le lien Admin (`Sidebar.tsx:112-129`) et le guard de page (`AdminDashboard.tsx:180-182` → redirect `/dashboard`) |
| Détection serveur | `app/server/payment-methods.ts:16-51` : `auth.getUser(token)` + `users.is_admin` ; RPC Supabase : `public.is_admin()` (SECURITY DEFINER, `fix_admin_rls_recursion.sql:4-18`) |
| RLS admin | Policies « Admins can view/manage … » sur users, wallets, transactions, sessions, credit_packages, crypto_payments, subscriptions, payment_methods, storage `payment-qr-codes` (`fix_admin_rls_recursion.sql:20-55`, `payment_approval_and_packages.sql:96-99,179-182,228-267,304-307`) |
| RPC admin (SECURITY DEFINER, vérifient `is_admin`) | `admin_confirm_payment(uuid, text)` (`payment_approval_and_packages.sql:401-453`), `admin_confirm_website_transaction` (`:458-519`), `admin_add_credits`/`confirm_crypto_payment` legacy (`admin_crypto_schema_migration.sql:95-154`) — tous `GRANT … TO authenticated` |
| Vue | `public.admin_users` (security_invoker, lecture seule, `WHERE is_admin = true`) pour compat site web — `payment_approval_and_packages.sql:187-199` |
| API admin | Seule `payment-methods` (GET `includeInactive=true`, POST, PATCH) exige un JWT admin serveur. **`AdminDashboard` lit les autres données (users, transactions, crypto_payments, credit_packages) via le client anon + RLS admin** (`AdminDashboard.tsx:108-174`) |

---

## 5. Sécurité : vérification côté serveur et points faibles

### Ce qui est correct

- **`resolve-user` vérifie le JWT** avec `supabaseAdmin.auth.getUser(token)` (`resolve-user.ts:29-40`) — c'est la seule vraie porte d'entrée d'identité côté API, et elle est bien implémentée (Bearer obligatoire, 401 sur token invalide/expiré).
- **`crypto-submit` vérifie le JWT** et refuse une demande de facturation si le `userId` demandé n'a pas le même email que le compte authentifié (`crypto-submit.ts:51-77,9-33`) — protection IDOR partielle.
- **`payment-methods` vérifie JWT + `is_admin`** côté serveur (`payment-methods.ts:16-51`).
- **Webhook Paystack** : signature HMAC-SHA512 comparée (`paystack-webhook.ts:41-53`).
- **RLS** active sur toutes les tables métier ; `is_admin()` en SECURITY DEFINER évite la récursion.
- **Electron** : la fenêtre OAuth est durcie (`sandbox`, `contextIsolation`), le deep-link est filtré (`henshin:` ou localhost), `normalizeRedirectPath` bloque les open-redirects.
- **`envPrefix` Vite** (`vite.config.ts:22-33`) n'expose que les variables `VITE_*` ; `MORPHLY_API_KEY` et la clé service role restent côté serveur.
- Le retour de `resolve-user` est **non-fatal** côté frontend (l'app continue même si l'API est down).

### Points faibles remarqués

1. **IDOR massif sur les routes de session/crédits (sans JWT)** :
   - `POST /api/start-session`, `POST /api/end-session`, `GET /api/session-status?userId=`, `GET /api/wallet?userId=`, `POST /api/morphly-token` n'**authentifient jamais** le caller : l'UUID `userId` est pris tel quel du body/query (`start-session.ts:115`, `end-session.ts:108`, `session-status.ts:20`, `wallet.ts:21`, `morphly-token.ts:69-75`).
   - Conséquences : n'importe qui connaissant un `userId` (UUID `auth.users` peu devinable, mais exposé par les références Paystack `FMT-<ts>-<userId>`, les historiques, les journaux…) peut **lire les transactions et le solde d'autrui**, **ouvrir/fermer des sessions** à sa place et **consommer ses crédits** via Morphly. `end-session` débite le wallet de la victime ; `morphly-token` émet un credential de streaming facturé à la victime.
   - `Access-Control-Allow-Origin: *` sur ces routes (ex. `start-session.ts:106`) permet à **tout site web** de les appeler depuis un navigateur.
2. **`paystack-verify` attribue les crédits à un `userId` extrait de la référence** (`paystack-verify.ts:91-99`) sans vérifier l'identité du caller ni que le payeur est bien ce compte : un paiement Paystack réel (montant exact d'un palier) peut être crédité sur un compte arbitraire si l'attaquant contrôle la référence transmise à `/payment/paystack-verify` (l'API Paystack exige que la référence existe, mais la route n'est pas protégée et le format `FMT-<ts>-<userId>` est trivial à générer).
3. **Double système de pricing webhook vs verify** : `paystack-webhook.ts` utilise des paliers **codés en dur** (`CREDIT_PRICING_NGN`, `:6-11`) alors que `paystack-verify.ts` lit `credit_packages` (`:115-139`) — divergence possible entre webhook et verify (le verify matche le montant, pas le package).
4. **Electron renderer non durci** : `nodeIntegration: true, contextIsolation: false` (`main.js:334-345`) — nécessaire pour la vcam/le pipe, mais tout XSS dans le renderer = exécution arbitraire dans le processus avec accès Node. De plus `main.js:316-323` charge `.env` (qui contient `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, `MORPHLY_API_KEY` en dev) ; avec nodeIntegration activé, un renderer compromis en dev peut lire `process.env`. En packagé, `.env` n'est **pas** inclus dans `build.files` (`package.json:21-24`), donc la clé service role n'est pas embarquée dans l'installeur — vérifier que le processus de release ne copie jamais `.env` dans `dist/` ou `release/`.
5. **Migration de comptes non atomique** : `resolve-user` réassigne lignes par lignes, sans transaction (`resolve-user.ts:101-111`) ; un crash entre deux étapes laisse un état partiel (wallet dupliqué, transactions migrées mais pas les sessions, etc.). La suppression du wallet orphelin échoue silencieusement (log seulement).
6. **`admin.listUsers({ perPage: 1000 })` sans pagination** : au-delà de 1000 utilisateurs, les doublons d'email peuvent être manqués (`resolve-user.ts:52-57`, commentaire l'admettant).
7. **Mot de passe `minLength=6`** côté client (`Login.tsx:188`) — faible si la politique Supabase est laxiste ; pas de rate limiting applicatif sur `signInWithPassword` (dépend du projet Supabase).
8. **Pas de révocation serveur** de session à la déconnexion (signOut local uniquement ; le refresh token reste valide jusqu'à expiration côté Supabase).
9. **Fenêtre principale `setWindowOpenHandler` autorise tout** (`main.js:370-391`) : les liens arbitraires s'ouvrent dans de nouvelles fenêtres Electron avec les mêmes privilèges Node.
10. **`rate.ts` et `version.ts`** publics (OK par conception), mais `version.ts` renvoie des URLs Storage signées — l'endpoint étant public, quiconque peut lister les nouvelles versions (non bloquant).

---

## 6. Environnements

### Variables d'environnement (voir `app/.env.example`)

**Client (Vite, préfixe `VITE_` — `vite.config.ts:22-33`)**
| Variable | Usage |
|---|---|
| `VITE_SUPABASE_URL` | URL du projet Supabase (client anon PKCE) |
| `VITE_SUPABASE_ANON_KEY` | Clé publique anon |
| `VITE_API_BASE_URL` | Base de l'API en production ; si elle pointe sur localhost en prod, repli forcé vers `https://henshin.vercel.app/api` (`api-client.ts:18-29`) |
| `VITE_PAYSTACK_PUBLIC_KEY` | (déclarée, non utilisée dans le code actuel) |

**Serveur (Vercel / Express local, non exposées au client)**
| Variable | Usage |
|---|---|
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (ou `SUPABASE_SERVICE_KEY`) | Client service role (`app/api/supabase.ts:4-5`) |
| `MORPHLY_API_KEY` | Crédential Morphly (`morphly-token.ts:61`) |
| `PAYSTACK_SECRET_KEY` | Init/vérification/webhook Paystack |
| `EXCHANGE_RATE_API_KEY` | Taux NGN (`rate.ts:27`) |
| `DESKTOP_GITHUB_*`, `DESKTOP_SUPABASE_*`, `DESKTOP_DOWNLOAD_URL`, `DESKTOP_LATEST_VERSION`… | Updater (`version.ts:75-152`) |
| `HENSHIN_LOCAL_API_PORT` (défaut 3001), `HENSHIN_LOCAL_API_TARGET`, `HENSHIN_LOCAL_SUPABASE_URL`/`_ANON_KEY` | Mode local (Express + override Vite) |

### Tester localement

```bash
cd app
bun run dev:api          # Express local : http://127.0.0.1:3001 (toutes les routes /api)
bun run dev:all          # API locale + Vite ensemble
# ou : VITE_API_BASE_URL=http://127.0.0.1:3001 bun run dev:web (le proxy Vite route /api vers la cible)
bun run electron:dev     # Electron → localhost:5173 (protocole henshin enregistré au lancement)
```

- Le proxy Vite est configuré si `HENSHIN_LOCAL_API_TARGET` ou `VITE_API_BASE_URL` est défini (`vite.config.ts:9-13,41-49`).
- Pour tester le deep-link OAuth : dans l'app démarrée, simuler `henshin://auth/callback?code=...&next=/dashboard` (la fenêtre principale le réceptionnera via `second-instance`).

### Production (Vercel)

- Les fichiers `app/api/*.ts` et `app/server/*.ts` sont servis comme fonctions Vercel (monolythique) ; `app/vercel.json` réécrit les 3 routes composites.
- Env Vercel : toutes les variables serveur ci-dessus. Vérifier qu'`SUPABASE_SERVICE_ROLE_KEY` n'est définie **que** dans les env Vercel (jamais en `VITE_`).
- Config Supabase côté Dashboard : « Auth → URL Configuration » doit accepter les redirects `https://henshin.vercel.app/**` **et** `henshin://auth/callback` (sinon le flux Electron échoue avec l'erreur listée dans `AuthContext.tsx:476-479`) ; Google Cloud Console : clé OAuth avec l'URL de callback Supabase ; confirmation d'email : désactivée ou non, le code gère les deux (`AuthContext.tsx:384-399`).
- Build Windows : `npm run electron:build` (electron-builder NSIS, protocole `henshin`, exécutable `HENSHIN`).

---

## Annexe — Carte des appels API et leur mode d'authentification

| Endpoint | Méthode | Auth | Fichier |
|---|---|---|---|
| `/api/auth/resolve-user` | POST/GET | **Bearer JWT** (`auth.getUser`) | `resolve-user.ts:29-40` |
| `/api/payment/crypto-submit` | POST | **Bearer JWT** + email matching | `crypto-submit.ts:51-77` |
| `/api/payment-methods` | GET/POST/PATCH | GET public ; POST/PATCH **JWT + is_admin** | `payment-methods.ts:279-302` |
| `/api/start-session` | POST | **Aucune** (userId body) | `start-session.ts:114-116` |
| `/api/end-session` | POST | **Aucune** (userId body) | `end-session.ts:107-109` |
| `/api/session-status` | GET | **Aucune** (userId query) | `session-status.ts:20-22` |
| `/api/wallet` | GET | **Aucune** (userId query) | `wallet.ts:21-22` |
| `/api/morphly-token` | POST | **Aucune** (userId query/body) + crédits/session active | `morphly-token.ts:69-108` |
| `/api/payment/paystack-init` | POST | **Aucune** (userId/credits/email body, montant validé vs packages) | `paystack-init.ts:17-47` |
| `/api/payment/paystack-verify` | POST | **Aucune** (userId extrait de la référence) | `paystack-verify.ts:91-99` |
| `/api/payment/paystack-webhook` | POST | **Signature HMAC-SHA512** Paystack | `paystack-webhook.ts:41-53` |
| `/api/version`, `/api/rate`, `/api/local-health` | GET | Publique | `version.ts`, `rate.ts`, `local-api-server.mjs:43-63` |