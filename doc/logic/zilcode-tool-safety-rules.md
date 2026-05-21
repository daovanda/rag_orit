# Chính sách tool an toàn cho Zilcode

Tài liệu này mô tả cách thiết kế và sử dụng tool khi tích hợp trợ lý AI với Zilcode. Mục tiêu là cho phép trợ lý đọc trạng thái hệ thống, hiểu màn hình, tìm dữ liệu và hỗ trợ chỉnh sửa mà vẫn kiểm soát được quyền, dữ liệu và rủi ro thao tác.

Tài liệu có hai lớp nội dung:

- Phần chính là hướng dẫn kiến trúc và quy tắc triển khai cho nhóm phát triển.
- Khối `MODEL CONTROL INSTRUCTIONS` là luật vận hành dành trực tiếp cho model khi được đưa vào prompt hoặc RAG context.

## MODEL CONTROL INSTRUCTIONS

Khi xử lý yêu cầu trong Zilcode, hãy tuân thủ các luật sau:

- Nếu câu hỏi là kiến thức chung hoặc hướng dẫn sử dụng, dùng RAG trước.
- Nếu câu hỏi phụ thuộc màn hình hiện tại, tab hiện tại, dòng đang chọn hoặc dữ liệu đang hiển thị, gọi tool đọc context trước khi trả lời chắc chắn.
- Nếu người dùng yêu cầu thêm, sửa, xóa, liên kết, lưu trữ, thay đổi workflow, thay đổi domain, sửa source hoặc chạy SQL ghi dữ liệu, không thực hiện ngay.
- Với mọi thao tác ghi dữ liệu, luôn đi theo flow: đọc context -> đọc metadata -> đọc dữ liệu hiện tại -> preview -> hỏi xác nhận -> apply -> verify.
- Không gọi tool apply nếu chưa có preview hợp lệ.
- Không gọi tool apply nếu người dùng chưa xác nhận rõ.
- Không tự đoán endpoint, table, primary key, field, relation hoặc quyền.
- Không sửa field chỉ đọc, field tính toán, khóa chính hoặc field không có trong metadata.
- Không update/delete nếu thiếu `recordid` hoặc thiếu `columnkey`.
- Không insert record con nếu thiếu record cha.
- Không xóa record con khi người dùng chỉ yêu cầu bỏ liên kết.
- Không vượt quyền role, organization, access, tab, table hoặc field.
- Không đưa token, password, API key hoặc secret vào câu trả lời.
- Nếu mục tiêu thao tác mơ hồ, hỏi lại hoặc gọi tool đọc context; không tự chọn thay người dùng.

## 1. Nguyên tắc thiết kế tool

Tool cho Zilcode cần được thiết kế theo nghiệp vụ, không thiết kế như một cổng gọi API tự do. Mỗi tool nên có phạm vi rõ ràng, input chặt chẽ, output có cấu trúc và cơ chế kiểm tra quyền ở backend.

Nguyên tắc chính:

- Tool đọc tách khỏi tool ghi.
- Tool preview tách khỏi tool apply.
- Tool apply chỉ nhận `preview_id` hoặc `operation_id` đã được backend tạo ra.
- Backend kiểm tra quyền và validate dữ liệu, không giao việc đó cho model.
- Tool chỉ trả dữ liệu cần thiết cho model, không trả token hoặc thông tin nhạy cảm.
- Tool ghi phải có audit log.

Không nên cấp tool dạng tổng quát:

```json
{
  "name": "call_zilcode_api",
  "parameters": {
    "method": "string",
    "url": "string",
    "body": "object"
  }
}
```

Tool dạng này khiến model có thể gọi sai endpoint, gửi sai payload, sửa nhầm bảng, xóa nhầm dữ liệu hoặc bỏ qua quyền nghiệp vụ.

## 2. Phân loại tool

Tool nên chia thành ba nhóm: read, preview và apply.

### 2.1. Read tools

Read tools chỉ đọc dữ liệu hoặc metadata, không thay đổi hệ thống.

Các tool nên có:

```text
get_zilcode_session_context
get_current_screen_context
get_app_metadata
get_window_config
get_tab_config
get_table_schema
get_field_metadata
get_record
search_records
get_domain_values
get_workflow_detail
get_user_permissions
```

Read tools dùng để xác định:

- Người dùng hiện tại.
- Role và organization hiện tại.
- Application đang mở.
- Window đang mở.
- Tab đang active.
- Table và field đang được dùng.
- Record đang chọn.
- Quyền thao tác.
- Domain/lookup values.
- Workflow hiện tại.

### 2.2. Preview tools

Preview tools kiểm tra thao tác dự kiến nhưng không ghi dữ liệu.

Các tool nên có:

```text
preview_record_insert
preview_record_update
preview_record_delete
preview_record_link
preview_record_unlink
preview_record_archive
preview_domain_update
preview_workflow_update
preview_source_patch
preview_sql_write
```

Preview tool cần trả về:

```text
can_apply
preview_id hoặc operation_id
target object
current values
new values
permission result
validation result
warnings
risk level
confirmation message
```

Nếu preview không hợp lệ, tool phải trả lý do cụ thể. Model không được gọi apply sau preview lỗi.

### 2.3. Apply tools

Apply tools ghi dữ liệu thật.

Các tool nên có:

```text
apply_record_insert
apply_record_update
apply_record_delete
apply_record_link
apply_record_unlink
apply_record_archive
apply_domain_update
apply_workflow_update
apply_source_patch
apply_sql_write
```

Apply tool phải tự kiểm tra lại:

- Phiên đăng nhập còn hợp lệ.
- Role và organization còn đúng.
- Quyền vẫn còn hợp lệ.
- Record chưa thay đổi gây xung đột.
- Preview chưa hết hạn.
- Payload apply trùng với preview.
- Dữ liệu vẫn pass validation.

## 3. Context bắt buộc cho tool

Một thao tác ghi dữ liệu trong Zilcode cần đủ context theo chuỗi:

```text
session -> site -> user -> role -> organization -> application -> window -> tab -> table -> field -> record
```

Các trường tối thiểu:

```text
siteid
userid
roleid
orgid
appid
windowid
tabid
tableid
service type
columnkey
access rights
field metadata
recordid, nếu là update/delete/link/archive
```

Nếu thiếu context, hệ thống cần dùng read tool để bổ sung. Nếu vẫn thiếu, hỏi lại người dùng.

## 4. Tool lấy context màn hình

`get_current_screen_context` là tool quan trọng cho các câu nói tự nhiên như:

- "Sửa dòng này."
- "Xóa bản ghi đang chọn."
- "Tab này dùng để làm gì?"
- "Tại sao tôi không thấy nút Lưu?"
- "Thêm dữ liệu vào bảng con này."

Output nên có cấu trúc:

```json
{
  "session": {
    "siteid": "...",
    "userid": "...",
    "roleid": "...",
    "orgid": "...",
    "isviewer": false
  },
  "application": {
    "appid": "...",
    "appname": "..."
  },
  "window": {
    "windowid": "...",
    "windowname": "...",
    "windowtype": "..."
  },
  "active_tab": {
    "tabid": "...",
    "tabname": "...",
    "tableid": "...",
    "parenttabid": "...",
    "relation_type": "root | one_to_many | many_to_many | view_only"
  },
  "selected_record": {
    "recordid": "...",
    "label": "...",
    "data": {}
  },
  "available_actions": {
    "can_select": true,
    "can_insert": true,
    "can_update": true,
    "can_delete": false,
    "can_export": true,
    "can_attach": false,
    "can_archive": false,
    "can_lock": false
  }
}
```

Không trả:

- Token.
- Password.
- API key.
- Connection string.
- Secret hệ thống.

## 5. Mô hình quyền

Quyền trong Zilcode là nhiều lớp. Một thao tác chỉ được phép khi tất cả lớp liên quan đều cho phép.

```text
user.isviewer
  -> role access
  -> application/menu/window access
  -> table access
  -> tab flags
  -> table flags
  -> field flags
  -> record state
```

Nếu có xung đột giữa các lớp quyền, áp dụng hướng an toàn hơn.

### 5.1. User level

Nếu `user.isviewer = true`, không cho phép thao tác ghi.

Các thao tác ghi gồm:

```text
insert
update
delete
archive
restore
link
unlink
attach
lock
unlock
workflow change
domain change
source change
SQL write
schema change
```

### 5.2. Role level

Role quyết định application, menu, window, table và workflow step mà user được dùng.

Nếu role không có quyền mở app hoặc window, không được thao tác dữ liệu thuộc app/window đó.

Nếu workflow step được gán cho role/user khác, không được tự xử lý step đó.

### 5.3. Access level

Các flag access thường gặp:

```text
noselect
noinsert
noupdate
nodelete
noexport
noattach
isarchive
islock
```

Nếu `noselect = true`, không đọc danh sách dữ liệu.

Nếu `noinsert = true`, không thêm record.

Nếu `noupdate = true`, không sửa record.

Nếu `nodelete = true`, không xóa record.

Nếu `noexport = true`, không export.

Nếu `noattach = true`, không attach file.

### 5.4. Tab level

Tab có thể chặn thao tác bằng:

```text
noselect
noinsert
noupdate
nodelete
noexport
isviewonly
isarchive
islock
isautosave
```

Nếu tab `isviewonly = true`, chỉ được đọc.

Nếu tab `noinsert = true`, không thêm record qua tab đó.

Nếu tab `noupdate = true`, không sửa record qua tab đó.

Nếu tab `nodelete = true`, không xóa record qua tab đó.

### 5.5. Table level

Table là mục tiêu đọc/ghi thật.

Cần kiểm tra:

```text
table.isreadonly
table.urlview
table.urledit
table.columnkey
table.service.servicetype
```

Nếu thiếu `urlview`, không đọc được dữ liệu theo table đó.

Nếu thiếu `urledit`, không ghi dữ liệu theo table đó.

Nếu thiếu `columnkey`, không update/delete record cụ thể.

Nếu `servicetype = arcgis`, không dùng quy trình SQLREST.

### 5.6. Field level

Field quyết định dữ liệu nào được hiển thị và sửa.

Không sửa field nếu:

```text
field.isreadonly = true
field.calculation tồn tại
field.columnname là primary key
field.columnname rỗng
field không thuộc active tab
field không có trong metadata
```

Field required phải có giá trị khi insert.

Field domain phải nhận giá trị hợp lệ trong domain.

Field lookup/search phải map sang khóa record liên kết, không ghi label hiển thị vào khóa ngoại.

### 5.7. Record level

Nếu record bị khóa theo `columnlock`, không update/delete record trừ khi có quyền unlock riêng.

Nếu record đang nằm trong workflow step không thuộc user/role hiện tại, không tự thay đổi trạng thái workflow.

## 6. Ràng buộc Window, Tab, Table

### 6.1. Window là container

Window chứa các tab và action. Window không phải lúc nào cũng là mục tiêu ghi dữ liệu.

Không được sửa dữ liệu nếu chỉ biết `windowid` nhưng chưa biết `tabid` và `tableid`.

### 6.2. Tab là ngữ cảnh thao tác

Tab xác định table, relation, filter, quyền và field.

Một window có thể có nhiều tab. Mỗi tab có thể trỏ tới table khác nhau.

Khi người dùng nói "dòng này", cần xác định active tab và selected record trong tab đó.

### 6.3. Table là nguồn dữ liệu thật

Table cung cấp:

```text
urlview
urledit
columnkey
columncode
columndisplay
columnlock
service type
```

Mọi thao tác CRUD phải cuối cùng map được tới table hợp lệ.

## 7. Ràng buộc tab cha-con

Tab con phụ thuộc tab cha.

Với quan hệ một-nhiều:

```text
child_tab.parenttabid = parent_tab.tabid
child_tab.linkchildfield = field ở bảng con
child_tab.linkparentfield = field ở bảng cha
```

Khi tạo record con:

```text
child_record[linkchildfield] = parent_record[linkparentfield]
```

Không tạo record con nếu chưa xác định parent record.

Không đổi khóa liên kết cha-con nếu người dùng chỉ muốn sửa thông tin nghiệp vụ của record con.

## 8. Ràng buộc nhiều-nhiều

Quan hệ nhiều-nhiều dùng relate table.

Khi link:

```text
insert row vào relate table
```

Khi unlink:

```text
delete row khỏi relate table
```

Không xóa record con thật khi người dùng chỉ yêu cầu bỏ liên kết.

Không thêm record con mới khi người dùng chỉ yêu cầu liên kết record đã có.

## 9. Quy trình select/search

Quy trình đọc dữ liệu:

```text
1. Xác định application/window/tab.
2. Kiểm tra quyền select.
3. Xác định table.urlview.
4. Áp dụng whereclause/filterclause/filterfield của tab.
5. Nếu là tab con, áp dụng filter theo parent record.
6. Áp dụng search query của người dùng.
7. Giới hạn số dòng.
8. Trả về field cần thiết và label dễ hiểu.
```

Không trả toàn bộ bảng lớn vào model context.

## 10. Quy trình insert

Quy trình thêm record:

```text
1. Xác định active tab.
2. Kiểm tra quyền insert.
3. Kiểm tra table.urledit.
4. Lấy field metadata.
5. Điền runtime defaults như siteid, appid, orgid nếu field tồn tại.
6. Nếu là child tab, điền linkchildfield từ parent record.
7. Validate required fields.
8. Validate field type và domain.
9. Tạo preview.
10. Hỏi xác nhận.
11. Apply bằng preview_id.
12. Đọc lại record đã tạo.
```

## 11. Quy trình update

Quy trình sửa record:

```text
1. Xác định active tab và target record.
2. Nếu target mơ hồ, search hoặc hỏi lại.
3. Kiểm tra quyền update.
4. Kiểm tra table.urledit và columnkey.
5. Kiểm tra record lock/workflow lock.
6. Đọc record hiện tại.
7. Map yêu cầu người dùng sang field metadata.
8. Validate field.
9. Tạo diff tối thiểu.
10. Tạo preview.
11. Hỏi xác nhận.
12. Apply bằng preview_id.
13. Đọc lại record và tóm tắt old/new values.
```

Chỉ sửa field được yêu cầu. Không ghi đè toàn bộ record nếu chỉ đổi một vài field.

## 12. Quy trình delete/archive

Quy trình xóa hoặc lưu trữ record:

```text
1. Xác định active tab và target record.
2. Nếu target mơ hồ, hỏi lại.
3. Kiểm tra quyền delete/archive.
4. Kiểm tra table.urledit và columnkey.
5. Kiểm tra record lock/workflow lock.
6. Kiểm tra dữ liệu con hoặc relation nếu có.
7. Chọn delete hoặc archive theo policy.
8. Tạo preview có cảnh báo.
9. Hỏi xác nhận mạnh.
10. Apply.
11. Verify record đã xóa hoặc chuyển archive.
```

Với thao tác nguy hiểm, câu xác nhận cần rõ hơn "ok".

## 13. Quy trình workflow

Workflow ảnh hưởng đến quy trình xử lý nên cần preview riêng.

Quy trình:

```text
1. Đọc workflow hiện tại.
2. Đọc danh sách step.
3. Xác định thay đổi yêu cầu.
4. Kiểm tra role/user được phép.
5. Validate cấu trúc workflow.
6. Preview thay đổi step.
7. Hỏi xác nhận mạnh.
8. Apply.
9. Đọc lại workflow và tóm tắt thay đổi.
```

Không sửa trực tiếp workflow XML hoặc step rows nếu chưa có preview.

## 14. Quy trình source và SQL

Source và SQL là nhóm rủi ro cao.

Với SQL:

- Tool SELECT có thể dùng nếu giới hạn dòng và chỉ đọc.
- SQL ghi dữ liệu cần preview riêng.
- Schema change cần quyền admin và xác nhận mạnh.
- Không chạy nhiều statement trong một request.

Với source:

```text
read file -> tạo diff -> preview patch -> xác nhận -> apply patch -> verify
```

Không ghi nguyên file mới nếu chưa có diff.

## 15. Output tool khuyến nghị

Tool result nên có cấu trúc để model xử lý ổn định.

Ví dụ preview update:

```json
{
  "ok": true,
  "action": "preview_record_update",
  "can_apply": true,
  "risk": "medium",
  "target": {
    "appid": "A1",
    "windowid": "W1",
    "tabid": "T1",
    "tableid": "customer",
    "recordid": "C001",
    "label": "Khách hàng ABC"
  },
  "changes": [
    {
      "fieldid": "phone",
      "label": "Số điện thoại",
      "old_value": "0901",
      "new_value": "0902"
    }
  ],
  "warnings": [],
  "confirmation_required": true,
  "preview_id": "op_123"
}
```

## 16. Quy tắc phản hồi

Trước khi apply thành công, không dùng các câu:

```text
Đã sửa.
Đã xóa.
Đã cập nhật.
```

Trước khi apply chỉ nói:

```text
Dự kiến thay đổi...
Tôi sẽ cập nhật...
Bạn xác nhận...
```

Sau khi apply thành công:

```text
Đã cập nhật thành công.
Trường A đã đổi từ "old" sang "new".
```

Nếu apply lỗi:

```text
Chưa có thay đổi nào được lưu.
Lỗi xảy ra ở bước...
```

## 17. Xử lý mơ hồ

Cần hỏi lại hoặc gọi tool đọc context khi:

- Có nhiều record khớp yêu cầu.
- Có nhiều field khớp tên người dùng nói.
- Người dùng nói "nó", "dòng đó", "cái này" nhưng không có selected record.
- Chưa biết active tab.
- Cần parent record nhưng chưa có.
- Tool result thiếu quyền hoặc thiếu metadata.
- Context có thể đã cũ.

## 18. Thứ tự triển khai tool

Thứ tự triển khai khuyến nghị:

1. `get_zilcode_session_context`
2. `get_current_screen_context`
3. `get_window_config`
4. `get_record`
5. `search_records`
6. `preview_record_update`
7. `apply_record_update`
8. `preview_record_insert`
9. `apply_record_insert`
10. `preview_record_delete`
11. `apply_record_delete`
12. `preview_record_link`
13. `apply_record_link`
14. Workflow tools
15. Domain/config tools
16. SQL/source tools

Không nên bắt đầu bằng tool ghi tổng quát hoặc SQL/source write.

