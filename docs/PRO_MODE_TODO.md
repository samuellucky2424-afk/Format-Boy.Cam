# Henshin PRO Mode TODO

## Planning

- [x] Confirm fal.ai Lucy 2.5 model and price.
- [x] Confirm license plus credits access rule.
- [x] Confirm account-bound, revocable, one-time redemption.
- [x] Confirm per-license rates: 46 negotiated, 80 default.
- [x] Confirm WhatsApp administration contact.

## Database

- [x] Add PRO license schema and policies.
- [x] Add admin audit log schema and policies.
- [x] Add `fal` session provider and migrate billing functions.
- [x] Add secure license/admin RPCs.
- [x] Add stale-session reconciliation and protected cron endpoint.

## API

- [x] Add license status endpoint.
- [x] Add one-time license redemption endpoint.
- [x] Add restricted fal realtime JWT endpoint.
- [x] Update session creation to resolve provider rates server-side.
- [x] Add admin client/license/credit/usage endpoints.
- [x] Remove Morphly routing after migration.

## Desktop UI

- [x] Install and integrate `@fal-ai/client`.
- [x] Replace Morphly provider with Lucy WebRTC provider.
- [x] Add locked PRO dialog and WhatsApp action.
- [x] Add one-time license redemption UI.
- [x] Show provider-specific rates and remaining time.
- [x] Update Stage, history, and labels from Morphly to fal.ai Lucy.

## Admin UI

- [x] Add overview metrics by provider and currency.
- [x] Add searchable client directory.
- [x] Add license generation and one-time code reveal.
- [x] Add rate edit, revoke, and reactivate actions.
- [x] Add audited credit additions and deductions.
- [x] Improve payment review and filtering.
- [x] Add usage, fal cost, and revenue reporting.

## Verification

- [x] Add API and billing contract tests.
- [x] Run `bun run test`.
- [x] Run `bun run lint`.
- [x] Run `bun run build`.
- [ ] Apply `supabase/20260826_pro_mode_fal.sql` to production.
- [ ] Configure server-only `FAL_KEY` and `CRON_SECRET`.
- [ ] Test license activation with a real account.
- [ ] Test Lucy video output in Electron.
- [ ] Test Henshin Virtual Camera in WhatsApp.
