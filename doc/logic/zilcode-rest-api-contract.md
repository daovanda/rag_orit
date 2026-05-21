# REST API contract Zilcode

MODEL CONTROL INSTRUCTIONS:

- Dùng file này để hiểu API shape, không dùng để tự tạo lệnh ghi dữ liệu tùy ý.
- Không gọi API raw nếu chưa qua tool có kiểm tra quyền.
- Mọi API ghi dữ liệu phải đi qua preview/apply tool.
- Khi đọc dữ liệu, phải dùng `urlview` hoặc tool đọc tương ứng. Khi ghi dữ liệu, phải dùng `urledit` hoặc tool ghi tương ứng.
- Nếu service type là `arcgis`, không áp dụng logic SQLREST.
- Không đưa token, password, API key hoặc secret vào prompt hoặc câu trả lời.

Tài liệu này mô tả contract REST API dùng trong Zilcode ở mức tích hợp. Nội dung tập trung vào cách phân loại endpoint, cách đọc/ghi dữ liệu và các ràng buộc an toàn khi thiết kế tool.

Khi thiết kế tool AI, cần dùng tài liệu này như nền tảng và xác minh lại với backend thực tế trước khi cho phép thao tác ghi.

## 1. Base URL và namespace API

Base URL backend được cấu hình theo môi trường triển khai:

```text
BASE = https://dvnb.zilcode.vn/
```

Các namespace:

```text
NUT.URL        = BASE + rest/daiviet_nut/dbo/data/
NUT.URL_DB     = BASE + rest/daiviet_nut/dbo/
NUT.URL_UPLOAD = BASE + rest/upload/
NUT.URL_SOURCE = BASE + rest/source/
NUT.URL_TOKEN  = BASE + rest/token/
NUT.URL_PROXY  = BASE + rest/proxy?
```

Ý nghĩa:

- `rest/token/`: login, role/org, app metadata, cache window, đổi mật khẩu.
- `rest/daiviet_nut/dbo/data/`: CRUD dữ liệu các bảng/views trong database `daiviet_nut`.
- `rest/upload/`: upload/download attachment/media.
- `rest/source/`: quản lý source file/site file.
- `rest/proxy`: proxy request ngoài nếu cần.

## 2. Authentication

Sau login, backend trả token. Frontend gán:

```text
Authorization: Bearer {token}
```

Mọi API đọc/ghi dữ liệu sau login đều cần header Authorization.

Tool AI không nên nhận token từ model. Token phải được truyền qua backend Worker hoặc context bảo mật, không lộ vào prompt nếu không cần thiết.

## 3. Wrapper `SqlREST`

`SqlREST` là lớp client REST gồm:

- `select(p, onok)`
- `insert(p, onok)`
- `update(p, onok)`
- `delete(p, onok)`
- `get(p, onok)`
- `post(p, onok)`
- `getText(p, onok)`

### `select`

Mục đích: đọc dữ liệu.

```js
SqlREST.select({
  url,
  id,
  where,
  select,
  orderby,
  groupby,
  having,
  offset,
  limit
})
```

HTTP:

- Nếu có `id`: `GET {url}/{id}`
- Nếu không có `id`: `GET {url}?where={decodeSql(p)}`

### `insert`

Mục đích: thêm record.

```js
SqlREST.insert({
  url,
  data,
  returnid
})
```

HTTP:

- `POST {url}`
- Nếu `returnid`: `POST {url}?returnid=true`
- Body luôn là JSON array. Nếu input là object đơn, wrapper tự bọc thành `[object]`.

### `update`

Mục đích: cập nhật record.

```js
SqlREST.update({
  url,
  data,
  where,
  key
})
```

HTTP:

- `PUT {url}?where={decodeSql(p)}` nếu có `where`
- `PUT {url}?key={key}` nếu có `key`
- Body là JSON array.

`key` thường là tên khóa chính, ví dụ `columnkey`.

### `delete`

Mục đích: xóa record.

```js
SqlREST.delete({
  url,
  where
})
```

HTTP:

- `DELETE {url}?where={decodeSql(p)}`

### `get`

Mục đích: gọi API tùy biến.

```js
SqlREST.get({
  url,
  method,
  data,
  token
})
```

HTTP:

- method mặc định là `GET`
- nếu có `data`, body là JSON
- luôn set `Content-Type: application/json;charset=UTF-8`

### `post`

Mục đích: upload form data hoặc binary.

```js
SqlREST.post({
  url,
  data
})
```

HTTP:

- `POST {url}`
- Không tự set JSON content type.

## 4. Where expression

Frontend dùng array để mô tả điều kiện query. `SqlREST.decodeSql()` chuyển array sang query string.

Ví dụ đơn:

```json
["userid", "=", 10]
```

Tương đương:

```sql
userid = 10
```

Ví dụ like:

```json
["username", "like", "%admin%"]
```

Ví dụ in:

```json
["roleid", "in", [1, 2, 3]]
```

Ví dụ nhiều điều kiện:

```json
[
  ["siteid", "=", 5],
  ["active", "=", true]
]
```

Ví dụ logic:

```json
[
  "or",
  ["username", "like", "%nam%"],
  ["fullname", "like", "%nam%"]
]
```

Operator hỗ trợ:

```text
is
!is
like
!like
in
!in
=
<>
>
>=
<
<=
between
```

Lưu ý bảo mật:

- Frontend tự encode string thành `N'...'`.
- Không nên để model tự viết raw SQL/where string.
- Tool AI nên nhận where dạng object/array có schema rõ rồi backend build query.

## 5. Token API

Các endpoint suy luận từ frontend:

### Login

```text
POST {NUT.URL_TOKEN}
Body: [username, sitecode, password]
```

Trả về user, token, roles, orgs, apps, notifies.

### Chọn role/org

```text
PUT {NUT.URL_TOKEN}roleorg
Body: [roleid, orgid]
```

Trả về access, apps, notifies.

### Lấy metadata application

```text
GET {NUT.URL_TOKEN}app/{appid}
```

Trả về:

- domains
- services
- relates
- tables
- wfsteps
- wfusers
- roles
- menus

### Lấy cache window

```text
GET {NUT.URL_TOKEN}cache/{windowid}
```

Trả về:

- `configjson`
- `layoutjson`

`configjson` thường được nén/serialize bằng `zipson`.

### Đổi mật khẩu

```text
PUT {NUT.URL_TOKEN}password
Body: [oldPassword, newPassword]
```

### Lấy user theo role

```text
GET {NUT.URL_TOKEN}roleusers/{roleid}
```

### Sửa domain editable

```text
PUT {NUT.URL_TOKEN}editdomain/{domainid}
Body: [domainJsonString]
```

## 6. Data API

Dữ liệu nghiệp vụ thường nằm dưới:

```text
{NUT.URL}{table_or_view_name}
```

Ví dụ:

```text
GET  /rest/daiviet_nut/dbo/data/n_app?where=...
POST /rest/daiviet_nut/dbo/data/n_app
PUT  /rest/daiviet_nut/dbo/data/n_app?key=appid
DELETE /rest/daiviet_nut/dbo/data/n_app?where=...
```

Trong runtime, table metadata cung cấp:

- `urlview`: URL đọc dữ liệu.
- `urledit`: URL ghi dữ liệu.

Tool AI nên dùng `urlview` cho read và `urledit` cho write. Không tự đoán URL nếu metadata chưa có.

## 7. Upload API

Upload file dùng:

```text
POST {NUT.URL_UPLOAD}{siteid}/{tableid}/{recordid}?f=file
```

File path lưu vào record dạng:

```text
media/{siteid}/{tableid}/{recordid}/{generatedFileName}
```

Quy tắc:

- Ảnh có thể được resize trước khi upload.
- File lớn hơn 1MB có thể bị bỏ qua theo logic frontend hiện tại.
- Record thường được insert trước, upload file sau, rồi update lại field chứa file path.

## 8. Source API

Source Editor dùng:

```text
NUT.URL_SOURCE
```

Nó quản lý file trong `/site/{siteid}/{appid}/...`.

Các thao tác source gồm:

- load folder
- tạo folder
- upload file
- preview file
- save content
- delete file/folder

Tool AI muốn sửa source file phải dùng tool chuyên biệt và cần xác nhận rõ file path.

## 9. SQL Cloud API

SQL Cloud dùng service có `servicetype = sqlrest`.

Các endpoint suy luận:

### Load schema

```text
GET {service.url}/schema/{...}?detail=true
```

### Query SELECT

```text
POST {service.url}/query
Body: { "body": "select ..." }
```

### Query modify

```text
PUT {service.url}/query
Body: { "body": "insert/update/delete ..." }
```

Frontend có confirm trước khi chạy query modify.

### Tạo table

```text
POST {schemaUrl}/{tableName}?alias={alias}
Body: [
  {
    "id": -1,
    "name": "...",
    "alias": "...",
    "dataType": "...",
    "nullable": true,
    "defaultValue": null,
    "length": -1,
    "precision": -1,
    "inPrimaryKey": false,
    "identity": false
  }
]
```

### Tạo view

```text
POST {schemaUrl}/{viewName}?alias={alias}
Body: { "body": "select ..." }
```

### Alter table columns

```text
POST {tableUrl}/alter
Body: column changes
```

### Delete table/view/procedure

```text
DELETE {schemaUrl}/{objectName}
```

### Rename table/view alias

```text
PUT {schemaUrl}/{oldName}?name={newName}&alias={alias}
```

Lưu ý: SQL Cloud rất nguy hiểm cho AI tool. Không cho model chạy raw SQL write nếu chưa có policy kiểm soát và xác nhận.

## 10. Workflow API

Workflow Manager dùng các bảng:

- `n_workflow`
- `n_wfstep`

Đọc workflow:

```text
GET {NUT.URL}n_workflow?where=...
```

Tạo workflow:

```text
POST {NUT.URL}n_workflow?returnid=true
```

Cập nhật workflow:

```text
PUT {NUT.URL}n_workflow?key=workflowid
```

Xóa workflow:

```text
DELETE {NUT.URL}n_wfstep?where=workflowid=...
DELETE {NUT.URL}n_workflow?where=workflowid=...
```

Cập nhật steps:

```text
DELETE {NUT.URL}n_wfstep?where=stepid in (...)
PUT {NUT.URL}n_wfstep?key=stepid
POST {NUT.URL}n_wfstep
```

## 11. Response pattern

Các API thường trả:

```json
{
  "success": true,
  "result": [],
  "total": 0
}
```

Khi lỗi:

```json
{
  "success": false,
  "result": "error message"
}
```

Frontend thường kiểm tra `res.success`. Nếu lỗi thì hiển thị `res.result`.

## 12. Quy tắc thiết kế AI API tools

Không nên tạo tool dạng:

```text
call_zilcode_api(method, url, body)
```

Nên tạo tool có mục đích cụ thể:

```text
get_current_context()
get_app_metadata(appid)
get_window_config(windowid)
list_table_records(tableid, filters)
get_record(tableid, recordid)
update_record(tableid, recordid, changes)
insert_record(tableid, data)
delete_record(tableid, recordids)
```

Tool write bắt buộc:

- kiểm tra access
- kiểm tra field/table metadata
- chạy dry-run/validate
- trả kế hoạch sửa
- yêu cầu user xác nhận
- ghi audit log
- verify lại sau khi write
