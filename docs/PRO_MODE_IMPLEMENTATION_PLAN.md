# Henshin PRO Mode Implementation Plan

## Confirmed Product Rules

- Fast: Reactor X2, 2 credits/second.
- PRO: fal.ai `decart/lucy-2-5/realtime` over WebRTC.
- PRO requires an active license and wallet credits.
- The client account already exists before the admin creates the license.
- The admin assigns and generates the license; the client redeems it once.
- Licenses are account-bound, revocable, and have no automatic expiration.
- Each license has a server-controlled credit rate.
- Initial negotiated client: 46 credits/second.
- Default future client: 80 credits/second.
- Unauthorized users contact administration through WhatsApp at `237620124019`.

## Phase 1: Data And Billing

1. Add `pro_licenses` with account assignment, code hash, status, rate, redemption and revocation metadata.
2. Add immutable `admin_audit_log` records for license, credit, and payment actions.
3. Allow `fal` as a new session provider while retaining old `morphly` history.
4. Resolve the session rate on the server from Reactor defaults or the active PRO license.
5. Keep activation/finalization atomic and add stale-session reconciliation.

## Phase 2: Secure Server APIs

1. Add authenticated license status and redemption endpoints.
2. Add admin endpoints for client search, license creation, rate changes, revoke/reactivate, and credit adjustment.
3. Add a fal realtime token endpoint that validates the account, active app session, license, and wallet.
4. Restrict every fal JWT to `decart/lucy-2-5/realtime` and keep `FAL_KEY` server-only.
5. Remove the Morphly credential route after all callers have migrated.

## Phase 3: Lucy WebRTC Provider

1. Add `@fal-ai/client` with Bun.
2. Replace `MorphlySessionProvider` with a Lucy fal.ai provider.
3. Implement signaling, ICE handling, camera track publishing, remote track reception, prompt updates, reference image input, timeout handling, and cleanup.
4. Reuse the existing first-visible-frame probe before declaring the session ready.
5. Feed the remote Lucy stream into Stage and Henshin Virtual Camera.

## Phase 4: Client Access UX

1. Fetch PRO entitlement with the authenticated account.
2. Intercept PRO selection when no active entitlement exists.
3. Show one dialog containing license redemption and the WhatsApp administration action.
4. Remove all `deprecated`, `Legacy`, and Morphly copy from active PRO controls.
5. Display provider-specific remaining time and current usage.

## Phase 5: Administration

1. Replace direct dashboard mutations with authenticated server APIs.
2. Add overview metrics grouped by currency and provider.
3. Add searchable client directory and a client detail view.
4. Add license creation, one-time code reveal, rate editing, revoke/reactivate, and usage visibility.
5. Add positive and negative credit adjustments with mandatory reasons.
6. Add payment filters, safe approval state transitions, and separated currency totals.
7. Add usage filters with fal cost (`seconds * $0.04`), billed credits, estimated revenue, and margin.

## Phase 6: Verification

1. Test authorization failures and account/license mismatches.
2. Test one-time redemption and revoked-license denial.
3. Test per-license rate selection and immutable session rates.
4. Test fal JWT endpoint restriction and secret non-disclosure.
5. Test idempotent session activation/finalization and stale reconciliation.
6. Run Bun lint, tests, Vite build, and an Electron camera smoke test.

## Rollout Notes

- Apply the Supabase migration before deploying the client that exposes PRO.
- Configure `FAL_KEY` only in server/Vercel environment variables.
- Create the first client license at 46 credits/second through the admin UI.
- Validate cost and usage against the fal.ai dashboard before assigning future 80-credit licenses.
