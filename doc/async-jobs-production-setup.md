# Async Jobs Production Setup

Tai lieu nay mo ta cach chay kien truc chat async job cho Worker `ragorit`.
Muc tieu la tranh request chat bi giu den gioi han 60 giay cua Worker.
Giai doan nay chua dung R2; state va debug compact duoc luu trong D1.

## Luong runtime

1. Frontend goi `POST /conversations/{conversation_id}/messages`.
2. Worker xac thuc Zilcode context tu header.
3. Worker luu user message, tao assistant placeholder, tao job `queued`.
4. Worker dispatch job vao Queue qua binding `AGENT_JOBS`.
5. Neu binding Queue bi go bo trong moi truong dev rieng, Worker moi fallback `ctx.waitUntil(...)`.
6. Endpoint tra nhanh HTTP `202` voi `job_id`.
7. Frontend poll `GET /jobs/{job_id}`.
8. Background job chay agent loop hien co va ghi ket qua vao D1.
9. Neu agent tao pending App Builder plan, job chuyen sang `waiting_confirmation`.
10. Frontend hien nut xac nhan/huy.
11. Confirm goi `POST /pending-actions/{action_id}/confirm` va tao apply job moi.

## D1

Tao database:

```powershell
npx wrangler d1 create ragorit-agent-db
```

Sau khi co `database_id`, mo `wrangler.jsonc`, uncomment block:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "ragorit-agent-db",
    "database_id": "<D1_DATABASE_ID>"
  }
]
```

Khong hard-code id gia. Chi thay `<D1_DATABASE_ID>` bang id that Cloudflare tra ve.

Apply migration local:

```powershell
npx wrangler d1 migrations apply ragorit-agent-db --local
```

Apply migration remote/production:

```powershell
npx wrangler d1 migrations apply ragorit-agent-db --remote
```

Migration hien tai nam o:

```text
migrations/0001_async_jobs.sql
migrations/0002_unique_active_conversation_job.sql
migrations/0003_agent_run_state_and_operation_journal.sql
migrations/0004_job_retry_lease.sql
```

Bang duoc tao:

- `conversations`
- `messages`
- `jobs`
- `job_events`
- `pending_actions`
- `agent_runs`
- `operation_journal`
- `agent_phase_checkpoints`

## Queue

Queue la duong production dang dung cho background agent jobs.

Queue hien tai:

```text
name: ragorit-agent-jobs
binding: AGENT_JOBS
```

Lenh tao queue cho moi truong moi:

```powershell
npx wrangler queues create ragorit-agent-jobs
```

`wrangler.jsonc` dang bind producer va consumer:

```jsonc
"queues": {
  "producers": [
    { "binding": "AGENT_JOBS", "queue": "ragorit-agent-jobs" }
  ],
  "consumers": [
    { "queue": "ragorit-agent-jobs", "max_batch_size": 1, "max_batch_timeout": 1 }
  ]
}
```

Neu go bo Queue binding, `/messages` van co the fallback sang `ctx.waitUntil`.
Fallback nay chi nen dung de dev/transition, khong phai duong production tot nhat cho job dai.

## Dev voi remote resources

Wrangler 4.88 chua support Queues trong `wrangler dev --remote`.
Neu chay remote dev bang `wrangler.jsonc` production, Worker co the tra 503 vi config co Queue binding.

De test dev voi D1/KV/Vectorize/AI remote that, dung config rieng khong bind Queue:

```powershell
npm run dev:remote
```

Lenh nay dung `wrangler.remote-dev.jsonc`.
Trong mode nay, `/messages` se fallback sang `ctx.waitUntil`, nen response `dispatch` la `waitUntil`.
Production/staging deploy bang `wrangler.jsonc` van dung Queue that va response `dispatch` la `queue`.

Neu Wrangler bao can OAuth, go bo cac bien `CLOUDFLARE_API_TOKEN` dang set trong shell hoac `.env`,
sau do chay:

```powershell
npx wrangler login
```

## API async

Gui message:

```http
POST /conversations/{conversation_id}/messages
Idempotency-Key: <uuid>
Authorization: Bearer <zilcode-token>
X-Zilcode-Base: <base-url>
X-Zilcode-UserId: <userid>
X-Zilcode-SiteCode: <sitecode>
X-Zilcode-RoleId: <roleid>
X-Zilcode-OrgId: <orgid>
```

Response thanh cong:

```json
{
  "success": true,
  "status": "queued",
  "conversation_id": "...",
  "user_message_id": "...",
  "assistant_message_id": "...",
  "job_id": "...",
  "dispatch": "queue"
}
```

Poll job:

```http
GET /jobs/{job_id}
```

Job status co the la:

- `queued`
- `running`
- `waiting_confirmation`
- `succeeded`
- `failed`
- `cancelled`
- `expired`

Lay event compact:

```http
GET /jobs/{job_id}/events
```

Confirm pending action:

```http
POST /pending-actions/{action_id}/confirm
```

Cancel pending action:

```http
POST /pending-actions/{action_id}/cancel
```

## Ownership va bao mat

Moi conversation, message, job, event va pending action deu gan `user_key`.
`user_key` duoc tao tu:

```text
sitecode:userid:roleid:orgid
```

API chi tra ve object khop voi `user_key` cua Zilcode context hien tai.
Auth context duoc luu ngan han trong job de background runner co the goi Zilcode,
sau khi job ket thuc se xoa `auth_context_json`.

Khong log token ra debug step/job event.
`job_events.payload_json` duoc gioi han kich thuoc de tranh ghi log qua lon vao D1.

## Frontend

Frontend khong doi answer truc tiep tu `POST /messages`.
Sau khi nhan `job_id`, frontend:

1. hien user message va typing/placeholder;
2. poll `GET /jobs/{job_id}`;
3. reload conversation khi job ket thuc;
4. neu `waiting_confirmation`, hien panel nut `Xac nhan thuc hien` va `Huy`;
5. confirm/cancel bang API pending action.

## Kiem thu

Chay TypeScript:

```powershell
npx tsc --noEmit
```

Chay test hien co:

```powershell
npm run test
```

Chay smoke App Builder offline, khong ghi Zilcode that:

```powershell
npm run smoke:offline
```

Chay smoke async job:

```powershell
npx tsx scripts/smoke-conversations-async-jobs.ts
```

Kiem tra whitespace diff:

```powershell
git diff --check
```

## Ghi chu chua dung R2

Giai doan nay khong co binding R2.
Neu sau nay debug artifact, file export, hoac tool output qua lon, co the chuyen phan blob sang R2
va chi luu pointer trong D1.
