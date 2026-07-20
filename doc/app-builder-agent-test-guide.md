# Hướng dẫn kiểm thử App Builder Agent

## Kiểm tra bắt buộc trước deploy

Từ thư mục `ragorit`:

```powershell
npx tsc --noEmit
npm test
npm run smoke:offline
git diff --check
```

`smoke:offline` chỉ dùng mocked Zilcode, không gọi môi trường thật. Nó phủ read graph, full prepare/apply journal, partial recovery, postcondition verification và security redaction.

## Ma trận test

| Năng lực | File bằng chứng |
|---|---|
| Contextualizer goal contract, goal completion và model-driven continuation | `test/agent-contextualizer.test.ts` |
| Fingerprint và budget chống lặp | `test/agent-run-state.test.ts` |
| Live schema contract/default/type/length | `test/app-builder-contracts.test.ts` |
| ApplicationSpecification và phase DAG | `test/app-builder-specification.test.ts` |
| Full chain, nhiều table/window, journal và partial apply | `test/app-builder-prepare-integration.test.ts` |
| Parent-child, lookup/domain, relation, permission | `test/app-builder-specification.test.ts` |
| Safe delete/shared dependency | `test/app-builder-delete-safety.test.ts` |
| Prepare auto-repair | `test/app-builder-prepare-repair.test.ts` |
| Residual scope | `test/app-builder-residual.test.ts` |
| Apply recovery/resume/scope expansion | `test/app-builder-recovery.test.ts` |
| API success nhưng verify fail | `test/app-builder-verification.test.ts` |
| Retry transient và lease policy | `test/job-retry.test.ts` |
| Full read metadata graph | `test/app-builder-read-coverage.test.ts` |
| Field-to-tab inventory relation | `test/zilcode-inventory.test.ts` |
| Secret redaction | `test/security-redaction.test.ts` |

## D1 migration

Migration hiện tại:

```text
0001_async_jobs.sql
0002_unique_active_conversation_job.sql
0003_agent_run_state_and_operation_journal.sql
0004_job_retry_lease.sql
```

Local D1:

```powershell
npx wrangler d1 migrations apply ragorit-agent-db --local
```

Remote D1 chỉ chạy khi chuẩn bị deploy production:

```powershell
npx wrangler d1 migrations apply ragorit-agent-db --remote
```

Kiểm tra migration đã áp dụng:

```powershell
npx wrangler d1 migrations list ragorit-agent-db --local
npx wrangler d1 migrations list ragorit-agent-db --remote
```

## Dev async job

`wrangler.remote-dev.jsonc` cố ý bỏ Queue vì Wrangler remote dev cũ không hỗ trợ Queue. Nó dùng `ctx.waitUntil` nhưng vẫn dùng D1/KV/AI remote. Production `wrangler.jsonc` dùng Queue `AGENT_JOBS`.

```powershell
npm run dev:remote
```

Để kiểm thử Queue giống production, dùng một Worker/Queue staging riêng. Không bind dev vào Queue production khi đang thử recovery hoặc write.

## Smoke ghi Zilcode thật

Không chạy các script có khả năng ghi chỉ vì unit test đã xanh. Một real-write smoke hợp lệ phải có đủ:

- biến môi trường opt-in rõ ràng;
- site/role test riêng;
- tên fixture có prefix duy nhất;
- in trước exact operation scope;
- cleanup trong `finally`;
- verify cleanup;
- không dùng app/table/window production.

Nếu thiếu một điều kiện, chỉ chạy `npm run smoke:offline`.

## Tiêu chí pass

- Không có TypeScript error.
- Toàn bộ unit/integration test pass.
- Offline smoke pass.
- Prepare invalid không tạo pending plan valid giả.
- Apply success không được báo trước verify.
- Partial failure tạo plan ID mới cho residual.
- Scope expansion tạo pending action mới.
- Message agent không được nhận apply tool; chỉ pending-action confirm endpoint tạo apply job.
- Cùng tool/input/outcome không progress bị loop guard chặn.
- Không có token/secret thật trong debug, state hay journal assertion.
