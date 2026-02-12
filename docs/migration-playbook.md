# Vault Migration Playbook (Old -> New)

This playbook is for migrating from the legacy vault deployment (transfer-only UX) to the upgraded vault (user `depositUsdc` + `withdrawToWallet`) with minimal downtime across Railway (bot) and Vercel (UI).

## Scope

- Preserve bot continuity while switching UI/backend to a new vault address.
- Snapshot old/new vault balances before and during cutover.
- Perform a blue/green swap with rollback points.

## Important constraints

- The legacy vault does not expose user share accounting or wallet withdraw methods.
- The upgraded flow starts from a fresh vault accounting state.
- Direct treasury migration from an already-deployed legacy vault is not provided by this repo; if required, it needs an audited migration adapter/sweep design.

## Required migration inputs

Set these in `.env` (or Railway variables) before running the migration report:

- `MIGRATION_OLD_VAULT_ADDRESS`
- `MIGRATION_NEW_VAULT_ADDRESS`
- optional `MIGRATION_OLD_BOT_STATE_URL` (old Railway `/state`)
- optional `MIGRATION_NEW_BOT_STATE_URL` (new Railway `/state`)
- optional `MIGRATION_BOT_STATE_AUTH_TOKEN`
- optional `MIGRATION_REPORT_PATH` (JSON output file path)

Run:

```bash
cd bot
npm run migration:report
```

The script fails (`exit 1`) if critical cutover checks are not met.

## Phase 1 - Baseline snapshot (no user impact)

1. Keep existing Railway bot + Vercel UI unchanged.
2. Run migration report and archive output (`JSON_REPORT_START/END` block).
3. Confirm old vault balances and LP exposure are understood before making changes.

## Phase 2 - Drain old LP exposure

Goal: old vault must be parked in USDC before switching UI/control to the new vault.

1. Send manual exit command to old bot service:

```bash
curl -X POST "https://<old-bot-domain>/controls/exit" \
  -H "x-bot-status-token: <BOT_STATUS_AUTH_TOKEN>"
```

2. Wait for a scan cycle to complete.
3. Re-run `npm run migration:report`.
4. Continue only when `old_vault.lp_drained` is `PASS`.

## Phase 3 - Warm new Railway service (blue/green)

Bring up a second Railway service for the new vault while old service stays live.

1. Deploy new vault (constructor includes `depositToken=USDC`).
2. Configure allowlists/roles for new vault.
3. Start **new** Railway service with:
   - `VAULT_ADDRESS=<new vault>`
   - `DRY_RUN=false`
   - `LIVE_MODE_ARMED=false` (guarded mode)
   - status server enabled (`BOT_STATUS_SERVER_ENABLED=true`, `BOT_STATUS_SERVER_REQUIRED=true`)
4. Verify:
   - `https://<new-bot-domain>/healthz` -> 200
   - `https://<new-bot-domain>/readyz` -> 200
   - `https://<new-bot-domain>/state` -> healthy/ready true
5. Re-run migration report with both old/new state URLs and ensure:
   - `new_vault.user_flow` is `PASS`
   - `railway.new_service_ready` is `PASS`

## Phase 4 - Zero-downtime Vercel cutover

Keep old bot service running during the switch.

1. In Vercel, update env vars:
   - `VAULT_ADDRESS=<new vault>`
   - `BOT_STATE_URL=https://<new-bot-domain>/state`
   - `BOT_CONTROL_URL=https://<new-bot-domain>`
   - `BOT_STATE_AUTH_TOKEN=<new bot token>`
2. Redeploy Vercel.
3. Smoke test immediately:
   - dashboard source is `bot state`
   - deposit card shows user flow (shares/withdrawable), not legacy message
   - controls (pause/exit/rotate) reach new service
4. After UI is stable, arm new Railway service (`LIVE_MODE_ARMED=true`) and redeploy/restart.
5. Keep old Railway service alive but disarmed for rollback window.

## Phase 5 - Rollback (fast path)

If any issue appears after cutover:

1. Revert Vercel env vars back to old bot/vault values:
   - `VAULT_ADDRESS`
   - `BOT_STATE_URL`
   - `BOT_CONTROL_URL`
   - `BOT_STATE_AUTH_TOKEN`
2. Redeploy Vercel.
3. Keep old Railway service ready (or re-arm if needed by policy).

## Old vault balances policy

- If old vault still holds treasury capital, treat it as legacy capital unless/until a dedicated migration contract path is built and audited.
- Do not attempt ad-hoc mainnet migration via unreviewed adapters.
- Block new deposits to old vault by completing the Vercel cutover and communicating the new vault address.
