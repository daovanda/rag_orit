# Kiến trúc Zilcode App Builder Agent

## Phạm vi

Agent chỉ quản lý metadata App Builder đã được chứng minh từ `api.json`, live metadata schema, ERD và runtime Zilcode. Phạm vi ghi gồm app, service binding, table/column metadata, domain/lookup/relation, window/tab/field, menu và roleapp/rolemenu/access.

Agent không tạo hoặc alter bảng vật lý, view, procedure, source file và không chạy SQL tùy ý. Các chức năng đó cần write contract riêng nếu được bổ sung sau này.

## Thành phần chính

- `src/agent.ts`: contextualize yêu cầu, chọn tool, chạy control loop và tạo câu trả lời.
- `src/agent-run-state.ts`: trạng thái bền vững, fingerprint, progress revision và ngân sách riêng.
- `src/app-builder-graph.ts`: overview/search/subgraph/detail và answer facts.
- `src/zilcode.ts`: đọc inventory metadata thật và gọi Zilcode API.
- `src/app-builder-contracts.ts`: registry contract động từ `/column/{table}`.
- `src/app-builder-specification.ts`: compile `ApplicationSpecification` thành operation DAG.
- `src/app-builder-write.ts`: prepare, validate, lưu pending plan và thực thi operation đã xác nhận.
- `src/app-builder-verification.ts`: đọc lại graph/detail/cache và kiểm tra postcondition.
- `src/app-builder-residual.ts`: xây phần việc còn thiếu từ expected và observed state.
- `src/app-builder-recovery.ts`: điều phối verify, residual plan, prepare repair và scope expansion.
- `src/conversations.ts`: conversation API, async jobs, D1 journal, pending action, resume và retry.
- `src/security-redaction.ts`: loại token/secret/credential khỏi journal, debug và state bền vững.

## Control loop đọc và chuẩn bị ghi

```text
user message + history
  -> contextualize + request goal contract
  -> update AgentRunState
  -> model decide next tool
  -> guard bằng fingerprint + budget
  -> execute tool
  -> inspect structured outcome
  -> persist evidence/progress
  -> luôn trả observation về model
  -> model tiếp tục hoặc phát tín hiệu kết thúc
```

Contextualizer tạo `request_kind` và `required_outcome` từ câu hiện tại cùng lịch sử. `answer` được phép kết thúc bằng câu trả lời; `pending_confirmation` chỉ hoàn thành khi prepare tạo được pending plan hợp lệ. Backend không dùng regex ngôn ngữ và không chọn continuation theo tên tool. Hai lần gọi cùng tool với cùng normalized arguments chỉ bị chặn sau khi cùng outcome không tạo thêm progress.

Các luồng được hỗ trợ:

```text
search -> subgraph -> một hoặc nhiều detail -> final answer
search/detail -> creation schema -> prepare
prepare invalid -> structured repair -> prepare lại (tối đa 3)
prepare valid -> waiting_confirmation
```

`app_builder_apply_change` không nằm trong tool registry của message agent. Prepare hợp lệ tạo `waiting_confirmation`; frontend tự hiển thị nút. Chỉ nút đó gọi confirm endpoint để tạo backend apply job. Tin nhắn như `OK` hoặc `đồng ý` không kích hoạt apply.

## ApplicationSpecification và operation DAG

Model có thể tạo specification gồm:

- app;
- services và service bindings;
- tables và columns;
- domains, lookups và relations;
- windows, tabs và fields;
- menus;
- roleapps, rolemenus và accesses.

Backend compiler resolve natural reference thành `$operation_id.result_id`, kiểm tra semantic và topological-sort operation. Các phase cố định theo dependency thật:

1. `app_service`
2. `table_column`
3. `domain_lookup_relation`
4. `window_tab_field`
5. `menu_permission`
6. `cache_verification`

Natural key (`key`, `*_ref`) chỉ dùng để compile và không được gửi như metadata field. Payload ghi chỉ chứa field tồn tại trong live schema.

## Dynamic metadata contract

Trước prepare, registry đọc schema thật từ endpoint `/column/{table}` tương ứng với từng collection. Registry lưu:

- tên column và datatype;
- nullable/not-null;
- primary key và identity;
- length;
- default value;
- nguồn contract và warning mâu thuẫn.

Live schema thắng semantic fallback. Nếu không lấy được live schema cho operation ghi, prepare fail closed với `live_metadata_schema_required`; agent không dùng fallback để ghi.

## Lưu trạng thái

D1 lưu:

- `conversations`, `messages`;
- `jobs`, `job_events`, `pending_actions`;
- `agent_runs`;
- `operation_journal`;
- `agent_phase_checkpoints`.

KV `CHUNKS` lưu pending plan có TTL. Job giữ auth context chỉ trong thời gian background runner cần gọi Zilcode và xóa sau khi job kết thúc. `AgentRunState`, journal, debug và event được redacted trước khi ghi D1.

## Invariant an toàn

- Luôn giữ `prepare -> user confirmation -> apply`.
- Không apply lại operation đã verify thành công.
- Không dùng lại plan cũ để sửa partial apply.
- Không tự mở rộng action, field hoặc delete scope đã xác nhận.
- Không báo thành công chỉ dựa trên HTTP/API success.
- Không dùng `/query` để giả lập transaction nhiều bảng.
- Không ghi khi thiếu token/user/site/role context hoặc live contract.

## Giới hạn đã biết

- `api.json` không chứng minh transaction nguyên tử nhiều metadata table; recovery là forward recovery.
- Physical database/runtime source nằm ngoài phạm vi.
- Map/layer, workflow, report và archive được đọc theo metadata/edge đã thấy. Chỉ entity có write contract trong registry mới được ghi.
- Khác biệt schema giữa site được giải quyết bằng live contract; một site thiếu field bắt buộc sẽ tạo blocker thay vì đoán.
