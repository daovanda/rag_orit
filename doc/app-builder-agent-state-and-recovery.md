# State Machine và Failure Recovery

## Hai lớp trạng thái

Job state điều khiển thực thi nền:

```text
queued -> running -> succeeded
                  -> waiting_confirmation
                  -> failed
                  -> cancelled/expired
```

Agent run state mô tả tiến triển nghiệp vụ:

```text
running -> waiting_confirmation
        -> repairing -> succeeded
                     -> verification_failed
                     -> blocked/failed
```

`AgentRunState` lưu original/clarified request, resolved targets, evidence, desired specification, attempted tool calls, prepared/completed operations, failed operation, verification result, repair counters, approved envelope và terminal status.

## Chống lặp

Mỗi tool attempt có:

```text
input fingerprint = tool name + normalized arguments
result fingerprint = input fingerprint + structured outcome status
progress revision = số lần state có evidence hoặc plan mới
```

Cùng input và cùng outcome được phép quan sát lại một lần; nếu lần sau vẫn không có progress thì bị chặn. Read, prepare repair và apply repair dùng ngân sách riêng. Control loop còn có giới hạn fail-safe toàn cục 16 lượt quyết định để không chạy vô hạn; giới hạn này không quyết định continuation theo tên tool.

## Prepare invalid

Prepare trả `blocking_errors` có cấu trúc:

```text
code, operation_id, entity, field,
expected, actual, evidence, repair_hint
```

Recovery có thể sửa tối đa ba lần. Model chỉ được thay representation của field được lỗi chỉ ra. Backend bắt buộc giữ nguyên operation IDs, action, dependency, target, tập field và giá trị nghiệp vụ. Secret được thay bằng placeholder khi gửi model rồi phục hồi từ operation gốc.

Nếu repair không an toàn hoặc không tạo delta, run dừng với blocker. Backend không bỏ field bắt buộc để ép plan thành valid.

## Confirm và apply

Prepare valid tạo pending action. User xác nhận qua:

```http
POST /pending-actions/{action_id}/confirm
```

Frontend chỉ gọi endpoint này khi người dùng bấm nút xác nhận. Nội dung chat tự do không được parse thành lệnh apply. Confirm tạo apply job mới. Trước write đầu tiên, executor ghi toàn bộ intended DAG vào `operation_journal` với precondition và expected effect. Mỗi operation sau đó có event `before` và `after`.

Executor fail-fast trong một attempt: operation sau lỗi được đánh dấu `previous_operation_failed`. Đây chỉ là an toàn cấp attempt; recovery tiếp tục bằng observed state, không apply lại plan cũ.

## Verify sau apply

Sau mỗi attempt:

1. graph search exact target;
2. node detail target;
3. so sánh expected field/value với actual record;
4. kiểm tra relation đã khai báo;
5. kiểm tra role/menu/access;
6. kiểm tra window cache khi UI metadata thay đổi.

Trạng thái chỉ là `verified` khi mọi expected operation đạt postcondition và cache liên quan không lỗi. API success nhưng entity thiếu hoặc value sai trở thành `verification_failed`.

## Partial apply và residual plan

```text
apply/verify fail
  -> giữ journal request/result/error đã redacted
  -> aggregate operation đã verify
  -> build residual từ expected - observed
  -> validate approved envelope
  -> prepare plan_id mới
  -> apply chỉ residual
  -> verify lại toàn bộ confirmed envelope
```

Operation đã verify được truyền vào executor dưới dạng `verified_operations`, nên được skip và reference vẫn dùng được cho operation sau.

Nếu residual cần đổi action, thêm field, thêm delete hoặc tác động entity ngoài approved envelope, recovery tạo một pending plan mới và chuyển về `waiting_confirmation`. Nó không tự apply scope mở rộng.

## Resume sau interruption

Job có lease và attempt counter. Khi lease cũ hết, consumer có thể claim lại job. Trước resume, hệ thống đọc `operation_journal`, verify metadata hiện tại và dựng `verified_operations`. Chỉ operation chưa chứng minh thành công mới đi vào residual attempt.

Lỗi mạng/timeout/HTTP 429 hoặc 5xx có thể retry job khi còn budget và Queue khả dụng. Lỗi validation/permission/business không được coi là transient chỉ vì message có chứa một số ID giống mã HTTP.

## Phase checkpoint

Kết quả verify được nhóm theo phase và upsert vào `agent_phase_checkpoints`. App lớn có thể resume từ trạng thái thật; checkpoint không thay thế postcondition verification.

## Dữ liệu nhạy cảm

- Operation journal redacts record preview, result và error.
- Agent run state, phase checkpoint, job event, debug step và action state đều redacted trước D1.
- Bearer token, NVIDIA/OpenAI/Cloudflare-style API key và credential trong chuỗi lỗi được che.
- User message được giữ nguyên trong lúc job cần xử lý; khi job kết thúc hoặc thất bại vĩnh viễn, pattern credential được redacted.
- `auth_context_json` chỉ tồn tại khi job cần chạy và được xóa ở terminal state.
