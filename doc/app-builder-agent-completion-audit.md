# Báo cáo audit hoàn thành App Builder Agent

Ngày audit: 2026-07-20.

## Kết quả theo yêu cầu

| Yêu cầu | Trạng thái | Bằng chứng chính |
|---|---|---|
| Read app/window/tab/table/column/field/menu/domain | Đạt | `src/app-builder-graph.ts`, `src/zilcode.ts`, `test/app-builder-read-coverage.test.ts` |
| Read service/appservice | Đạt | Node/edge coverage trong `test/app-builder-read-coverage.test.ts` |
| Read roleapp/rolemenu/access đúng lớp | Đạt | `permissions_summary` và role/app/menu/table edges |
| Read lookup/domain/parent-child/many-to-many | Đạt trong metadata đã chứng minh | Column/table/domain và tab relation edges; compiler/validator tests |
| Read workflow/report/map/layer/archive | Đạt | Runtime summaries và edge coverage trong read coverage test |
| Dynamic live schema contract | Đạt | `src/app-builder-contracts.ts`, fail-closed integration test |
| ApplicationSpecification -> deterministic DAG | Đạt | `src/app-builder-specification.ts`, phase/topological/reference tests |
| App đơn giản | Đạt | Prepare và apply mocked Zilcode integration |
| Full metadata chain, nhiều table/window | Đạt | Full-chain prepare/apply integration; references phải resolve trước API |
| Parent-child, lookup/domain, relation | Đạt | Semantic validation và explicit relation compiler tests |
| roleapp/rolemenu/access | Đạt | Compiler, duplicate/conflict validator và full-chain apply test |
| Update/delete an toàn | Đạt | Live contract, immutable metadata ID, shared dependency/delete tests |
| Stateful control loop | Đạt | Model request goal contract, mọi observation quay lại model, D1 persistence và goal-completion tests |
| Loop guard và budget riêng | Đạt | Fingerprint/progress/read/prepare/apply budget tests |
| Prepare structured auto-repair <= 3 | Đạt | Repair validator, recovery budget và production callback |
| Operation journal trước/sau write | Đạt | Journal migration và executor integration |
| Verify sau apply | Đạt | Search/detail/cache verifier; API success but verify fail test |
| Partial apply -> residual plan mới | Đạt | Recovery/residual integration tests |
| Scope expansion -> confirm mới | Đạt | Approved envelope và waiting-confirmation recovery test |
| Resume, skip operation đã verify | Đạt | Journal observation, verified operation references và recovery tests |
| Phase checkpoint | Đạt | `agent_phase_checkpoints` persistence theo verification result |
| Retry transient/lease | Đạt | `src/job-retry.ts`, migration 0004 và retry tests |
| Không apply từ message agent | Đạt | Apply không nằm trong model tool registry; chỉ UI confirm endpoint tạo pending-action apply job |
| Không `/query`/physical DB write | Đạt | Không có call `/query` trong agent/write/conversation path |
| Không lưu secret trong journal/state/debug | Đạt | Shared redactor và security tests |
| Tài liệu kiến trúc/state/failure/test | Đạt | Ba tài liệu App Builder Agent và async setup đã cập nhật |

## Migration

- `0003_agent_run_state_and_operation_journal.sql`
- `0004_job_retry_lease.sql`

D1 local đã báo `No migrations to apply`, nghĩa là 0001-0004 đã được áp dụng ở local state hiện tại. Remote migration không được tự chạy trong audit này để tránh thay đổi production ngoài yêu cầu deploy.

## Gate cuối

```text
npx tsc --noEmit
npm test
npm run smoke:offline
git diff --check
```

Kết quả cuối phải được lấy từ command output của lần chạy sau cùng; không dùng bảng này thay cho output CI.

## Giới hạn còn lại từ nguồn sự thật

- `api.json` có data CRUD và `/query`, nhưng không chứng minh transaction nguyên tử nhiều metadata table. Agent cố ý không dùng `/query`; recovery là forward recovery.
- Physical table/view/procedure/source/GIS runtime file nằm ngoài phạm vi write.
- Workflow/report/GIS/archive chỉ được ghi khi sau này có live write contract riêng; hiện tại năng lực đã chứng minh là read/interpret.
- Real-write smoke chưa chạy vì audit không có opt-in fixture/site test/cleanup scope rõ ràng. Offline mocked integration là bằng chứng an toàn hiện tại.
- Production cần apply migration remote trước deploy phiên bản code này.
