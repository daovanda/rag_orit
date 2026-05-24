# App Builder Agent Create Guide

Tài liệu này dành cho agent khi hỗ trợ tài khoản Role System tạo hoặc chỉnh sửa ứng dụng trong App Builder. Agent phải dùng tài liệu này như playbook vận hành, không dùng như nội dung trả lời người dùng cuối.

Mục tiêu của agent là hiểu cấu trúc App Builder, lập kế hoạch cấu hình an toàn, gọi đúng read/write tool, xác minh kết quả sau khi ghi và không tự ý tạo payload khi thiếu dữ liệu bắt buộc.

## 1. Nguyên tắc bắt buộc

- Luôn đọc `AppBuilderBlueprint` trước khi tạo, sửa hoặc xóa cấu hình.
- Nguồn sự thật về app hiện có là `app_builder_records.inventory.apps`, lấy từ bảng `NApplication` trong App Builder.
- Không dùng danh sách app trong session để suy luận app nghiệp vụ đang được cấu hình. Session apps chỉ cho biết user hiện có quyền mở app nào.
- Luôn lập plan trước khi gọi write tool.
- Không gọi write tool nếu user chưa xác nhận rõ ràng.
- Không tạo trùng `appcode`, `appname`, `tablename`, `windowname`, `menuname` trong cùng phạm vi app/site.
- Không tạo field nếu chưa biết field đó map tới `tabid`, `tableid`, `columnid` hoặc `columnname`.
- Không tạo tab nếu chưa biết tab đó dùng table nào.
- Không tạo menu nếu chưa biết menu sẽ mở window nào.
- Không update/delete bằng tên tự nhiên. Phải resolve ra ID thật từ blueprint trước.
- Sau khi ghi, luôn đọc lại `AppBuilderBlueprint` để kiểm tra cấu hình đã tồn tại và quan hệ đã đúng.
- Nếu thiếu thông tin nghiệp vụ, hỏi lại người dùng. Không tự bịa field, table, relation hoặc quyền.
- Nếu tool trả lỗi hoặc không chắc cache window đã refresh, báo rõ phần chưa xác minh được.

## 2. Mô hình tư duy của agent

App Builder là app hệ thống dùng để cấu hình các app nghiệp vụ khác.

Đọc theo cây:

```text
App Builder
-> NApplication: các app được tạo/cấu hình
-> NTable: các bảng/view metadata của từng app
-> NColumn: các cột của từng bảng
-> NWindow: các màn hình của từng app
-> NTab: các tab trong window, mỗi tab gắn với table
-> NField: các field trong tab, mỗi field thường gắn với column
-> NMenu: menu/sidebar trỏ tới window
-> NDomain: domain/list giá trị cho field select/list/status
-> NRelation/relates: quan hệ cha-con hoặc nhiều-nhiều giữa bảng/tab
```

Luồng runtime:

```text
User mở app
-> frontend gọi rest/token/app/{appid}
-> load domains, services, relates, tables, roles, menus
-> user click menu
-> frontend gọi rest/token/cache/{windowid}
-> parse configjson/layoutjson bằng Zipson
-> NUT.configWindow chuyển window/tabs/fields/menus từ array sang object
-> NWin render grid/form/tab/toolbar
```

Khi agent tạo cấu hình, mục tiêu không chỉ là insert record metadata. Cấu hình phải đủ để runtime trên có thể mở app, mở menu, load window, render tab, render field và thao tác dữ liệu.

## 3. API và dữ liệu nền

Runtime frontend dùng các URL chính:

```text
NUT.URL       = BASE + rest/daiviet_nut/dbo/data/
NUT.URL_DB    = BASE + rest/daiviet_nut/dbo/
NUT.URL_TOKEN = BASE + rest/token/
```

Các API đọc/ghi dữ liệu dạng SQLREST:

```text
GET    /rest/{database}/{schema}/data/{table}?where=...&select=...&orderby=...&limit=...
POST   /rest/{database}/{schema}/data/{table}?returnid=true
PUT    /rest/{database}/{schema}/data/{table}?where=...
PUT    /rest/{database}/{schema}/data/{table}?key={primaryKey}
DELETE /rest/{database}/{schema}/data/{table}?where=...
```

Body của `POST` và `PUT` luôn là JSON array:

```json
[
  {
    "field": "value"
  }
]
```

Các API tạo/sửa schema vật lý nếu cần:

```text
GET    /rest/{database}/{schema}/table
GET    /rest/{database}/{schema}/table/{name}?detail=true
POST   /rest/{database}/{schema}/table/{name}?alias=...&path=...
PUT    /rest/{database}/{schema}/table/{name}?newName=...&newAlias=...&newPath=...
DELETE /rest/{database}/{schema}/table/{name}

GET    /rest/{database}/{schema}/column/{table}
POST   /rest/{database}/{schema}/column/{table}
PUT    /rest/{database}/{schema}/column/{table}
POST   /rest/{database}/{schema}/column/{table}/alter
DELETE /rest/{database}/{schema}/column/{table}/{name}
```

Schema `ColumnJson` cho column vật lý:

```json
{
  "name": "customerid",
  "alias": "Mã khách hàng",
  "dataType": "int",
  "length": 0,
  "precision": 0,
  "nullable": false,
  "inPrimaryKey": true,
  "identity": true,
  "defaultValue": null
}
```

Agent không gọi raw API trực tiếp. Agent chỉ gọi write tool đã được backend đóng gói và validate. Tài liệu này dùng API để hiểu contract cho tool.

## 4. AppBuilderBlueprint phải được dùng như thế nào

Trước mọi thao tác tạo/sửa:

1. Gọi `AppBuilderBlueprint` ở `mode=graph` để lấy bản đồ tổng quan.
2. Dùng `app_builder_records.inventory.apps` để xác định app nghiệp vụ hiện có.
3. Nếu người dùng muốn chỉnh một app cụ thể, resolve app bằng `appid`, `appcode` hoặc `appname`.
4. Nếu cần chi tiết app/window/table cụ thể, gọi lại `mode=detail` hoặc `mode=subgraph` với `node_id`.
5. Kiểm tra trùng tên, trùng code và các quan hệ đang tồn tại.
6. Chỉ sau đó mới lập plan.

Không được lập plan chỉ từ câu người dùng nếu chưa đọc blueprint.

## 5. Plan chuẩn trước khi ghi

Agent phải tạo plan rõ ràng trước khi apply.

Plan tối thiểu:

```json
{
  "intent": "create_app",
  "target": {
    "appname": "CRM",
    "appcode": "crm"
  },
  "assumptions": [],
  "checks": [
    "Không trùng appcode crm",
    "Bảng customer chưa tồn tại",
    "Window CRM Main chưa tồn tại"
  ],
  "steps": [
    {
      "action": "create_application",
      "table": "NApplication",
      "record": {}
    },
    {
      "action": "create_table",
      "table": "NTable",
      "record": {}
    }
  ],
  "requires_confirmation": true
}
```

Agent phải trình bày plan bằng ngôn ngữ dễ hiểu cho user xác nhận. Không cần đưa toàn bộ JSON nếu user không yêu cầu, nhưng tool validate/apply nên nhận plan có cấu trúc.

## 6. Tạo một app mới

Thứ tự chuẩn:

1. Đọc `AppBuilderBlueprint`.
2. Xác nhận tên app, mã app, mục đích, nhóm người dùng, các màn hình chính.
3. Kiểm tra trùng `appcode` và `appname` trong `NApplication`.
4. Xác định app dùng bảng mới hay bảng/view đã có sẵn.
5. Nếu cần bảng vật lý mới, tạo schema vật lý trước bằng API table/column hoặc write tool tương ứng.
6. Tạo record `NApplication`.
7. Tạo record `NTable` cho từng bảng/view của app.
8. Tạo record `NColumn` cho từng cột cần hiển thị/sử dụng.
9. Tạo domain `NDomain` nếu field cần select/list/status.
10. Tạo `NWindow` cho màn hình chính.
11. Tạo `NTab` root gắn với table chính.
12. Tạo `NField` cho các column cần hiển thị trong tab.
13. Tạo `NMenu` trỏ tới window chính.
14. Nếu app cần cấp quyền cho role khác, tạo/cập nhật role/access/menu permission bằng tool riêng.
15. Refresh hoặc rebuild window cache nếu backend không tự làm.
16. Đọc lại `AppBuilderBlueprint` để verify.

### 6.1 Tạo NApplication

Record app tối thiểu cần có:

```text
appname
appcode
description
siteid
seqno
active
apptype
icon
theme
```

Quy tắc:

- `appcode` nên ngắn, không dấu, không khoảng trắng, ổn định.
- `appname` là tên hiển thị.
- `apptype` mặc định là app động thông thường nếu user không yêu cầu engine/gis.
- Nếu chưa có `siteid`, lấy từ session user.
- Không tự tạo `linkurl` trừ khi app là engine/external app.

### 6.2 Tạo bảng vật lý nếu cần

Nếu người dùng yêu cầu một app có bảng dữ liệu mới, agent cần phân biệt:

- Bảng vật lý trong database.
- Metadata bảng trong `NTable`.
- Metadata cột trong `NColumn`.
- Field UI trong `NField`.

Không được chỉ tạo `NTable` rồi cho rằng bảng vật lý đã tồn tại.

Tạo bảng vật lý qua contract:

```text
POST /rest/{database}/{schema}/table/{tablename}?alias={alias}
Body: ColumnJson[]
```

Mỗi bảng nghiệp vụ nên có:

- Một khóa chính ổn định, ví dụ `customerid`, `projectid`, `taskid`.
- Khóa chính dùng `identity=true` nếu backend hỗ trợ tự tăng.
- Các cột hiển thị như name/title/code.
- Cột trạng thái hoặc active nếu nghiệp vụ cần.
- Cột audit như created/updated nếu hệ thống đang dùng pattern này.

Sau khi tạo bảng vật lý, tạo metadata `NTable`.

### 6.3 Tạo NTable

Record `NTable` mô tả bảng/view cho app.

Các field quan trọng:

```text
appid
tableid
tablename
alias
tabletype
serviceid
servicetype
urlview
urledit
columnkey
columncode
columndisplay
columnfind
isreadonly
isview
seqno
description
```

Quy tắc:

- `tablename` phải trùng bảng/view vật lý hoặc nguồn dữ liệu thật.
- `tabletype` thường là `table` cho bảng dữ liệu chính, `relate` cho bảng quan hệ.
- `columnkey` phải là primary key thật.
- `columndisplay` nên là field người dùng dễ đọc.
- `columncode` dùng cho mã nghiệp vụ nếu có.
- `columnfind` dùng để tìm kiếm nhanh.
- `urlview` dùng đọc dữ liệu.
- `urledit` dùng insert/update/delete.
- Nếu bảng chỉ đọc, set `isreadonly=true`.
- Nếu là view, set `isview=true` và không tạo write tool nếu view không editable.

### 6.4 Tạo NColumn

Record `NColumn` mô tả cột của table.

Các field quan trọng:

```text
tableid
tablename
columnid
columnname
caption
label
datatype
columntype
isprimarykey
isrequired
defaultvalue
seqno
```

Quy tắc:

- Mỗi cột vật lý cần dùng trong UI nên có một record `NColumn`.
- `columnname` phải trùng tên cột thật.
- Primary key phải được đánh dấu rõ.
- Cột bắt buộc phải có `isrequired/isrequire`.
- Không tạo `NField` cho column chưa có `NColumn`, trừ khi field là virtual/display-only và tool hỗ trợ rõ.

### 6.5 Tạo domain nếu cần

Tạo `NDomain` khi field cần danh sách giá trị cố định.

`domainjson` thường là array:

```json
[
  ["NEW", "Mới", "#2563eb"],
  ["DONE", "Hoàn thành", "#16a34a"]
]
```

Quy tắc:

- ID nên ổn định, không phụ thuộc text hiển thị.
- Text hiển thị có thể theo tiếng Việt.
- Color là tùy chọn.
- Nếu domain cho phép sửa trong UI, dùng `iseditable` theo pattern hiện có.

## 7. Tạo window cho app

Window là màn hình nghiệp vụ. Window không phải bảng dữ liệu; window chứa tab và tab mới gắn với table.

Thứ tự:

1. Đọc app target từ `NApplication`.
2. Xác định window name, mục đích, appid.
3. Kiểm tra trùng `windowname` trong cùng app.
4. Tạo `NWindow`.
5. Tạo ít nhất một root tab `NTab` có `tablevel=0`.
6. Tạo fields cho root tab.
7. Tạo menu `NMenu` trỏ đến window.
8. Refresh/rebuild cache window nếu cần.
9. Đọc lại blueprint và verify `window -> tab -> field`.

Record `NWindow` quan trọng:

```text
windowid
windowname
windowtype
appid
execname
isopenfind
translate
seqno
```

Quy tắc:

- `appid` phải là app nghiệp vụ đích, không phải App Builder.
- `windowname` nên mô tả màn hình, ví dụ `Customer Management`.
- `translate` là text hiển thị nếu hệ thống dùng đa ngôn ngữ.
- Không dùng `execname` nếu window là dynamic CRUD thông thường.
- `windowtype` theo pattern window hiện có trong blueprint.

## 8. Tạo tab cho window

Tab là cầu nối giữa UI và table.

Root tab:

```text
windowid
tabname
tableid
tablevel = 0
parenttabid = null
seqno
```

Tab con 1-n:

```text
windowid
parenttabid
tablevel = parent.tablevel + 1
tableid = child tableid
linktableid = parent tableid
linkchildfield = child foreign key
linkparentfield = parent primary key
seqno
```

Tab nhiều-nhiều:

```text
windowid
parenttabid
tableid = child tableid
relatetableid = relation tableid
relatechildfield = relation field pointing to child
relateparentfield = relation field pointing to parent
linkchildfield = child primary/display key used for link
linkparentfield = parent primary key
```

Quy tắc:

- Tab root bắt buộc phải có table chính.
- Tab con phải có parent tab thật.
- Không tạo tab con nếu chưa xác định foreign key hoặc relate table.
- Không dùng `tableid` của App Builder cho app nghiệp vụ trừ khi đang sửa chính App Builder.
- Nếu tab chỉ xem, set `isviewonly` hoặc flag `noinsert/noupdate/nodelete` phù hợp.

## 9. Tạo field cho tab

Field quyết định grid column, form input và search input.

Field thường map:

```text
NField.tabid -> NTab.tabid
NField.tableid -> NTable.tableid
NField.columnid -> NColumn.columnid
NField.columnname -> NColumn.columnname
```

Các field quan trọng:

```text
fieldid
fieldname
translate
tabid
tableid
columnid
columnname
fieldtype
columntype
domainid
linktableid
linkcolumn
defaultvalue
isrequire
isreadonly
hideingrid
hideinform
hideinfind
displaylength
fieldlength
seqno
placeholder
calculation
displaylogic
parentfieldid
wherefieldname
whereclause
bindfieldname
options
colspan
rowspan
labelspan
```

Quy tắc:

- Không tạo field cho primary key identity nếu người dùng không cần thấy/sửa field đó.
- Field khóa chính thường `isreadonly=true` hoặc ẩn khỏi form khi tự sinh.
- Field bắt buộc phải map đúng column.
- `fieldtype` phải phù hợp datatype:
  - text/string: `string`, `textarea`
  - number: `int`, `float`, `currency`, `percent`
  - date/time: `date`, `datetime`, `time`
  - boolean/status: `toggle`, `checkbox`, `select`
  - lookup: `search` hoặc `select` có `linktableid/domainid`
  - file: `file`
  - json/array: `json`, `arrays`
- Nếu dùng `domainid`, domain phải tồn tại.
- Nếu dùng `linktableid`, bảng link phải tồn tại và có `columnkey/columndisplay`.
- Không cho user sửa field có `calculation`, field readonly, hoặc field không có column thật nếu write tool chưa hỗ trợ.

## 10. Tạo menu cho window

Menu giúp user mở window.

Record `NMenu` quan trọng:

```text
menuid
menuname
translate
parentid
seqno
appid
windowid
linkwindowid
menutype
execname
icon
reportid
```

Quy tắc:

- Menu của app nghiệp vụ phải có `appid` của app đó.
- Menu CRUD thông thường nên dùng `linkwindowid` hoặc `windowid` trỏ tới window.
- Nếu menu cha chỉ là group, không cần `linkwindowid`.
- Nếu menu mở component/report/custom command, dùng `execname` hoặc `reportid` theo pattern hiện có.
- Không tạo menu trỏ tới window chưa tồn tại.

## 11. Chỉnh sửa app hiện có

Luôn theo quy trình:

1. Đọc blueprint.
2. Resolve app target.
3. Resolve node cần sửa: table/window/tab/field/menu/domain.
4. Đọc detail nếu cần.
5. Lập patch tối thiểu.
6. Validate patch.
7. Hỏi user xác nhận.
8. Apply patch.
9. Đọc lại blueprint để verify.

Các thao tác chỉnh sửa thường gặp:

- Đổi tên app: update `NApplication.appname`, không đổi `appid`.
- Đổi mã app: chỉ làm nếu hiểu toàn bộ tham chiếu; `appcode` nên ổn định.
- Thêm bảng mới cho app: tạo table vật lý nếu cần, rồi `NTable`, `NColumn`, `NTab`, `NField`.
- Thêm cột vào bảng: tạo column vật lý, thêm `NColumn`, thêm `NField` nếu cần hiển thị.
- Thêm field vào màn hình: chỉ thêm `NField`, không cần tạo column nếu column đã có.
- Đổi label field: update `translate/fieldname/caption/label` tùy pattern.
- Ẩn field khỏi grid/form/find: update `hideingrid/hideinform/hideinfind`.
- Đổi thứ tự: update `seqno`.
- Thêm tab con: tạo `NTab` với parent/link fields, rồi tạo fields.
- Thêm menu: tạo `NMenu` trỏ tới window.

Không đổi ID chính (`appid`, `tableid`, `windowid`, `tabid`, `fieldid`, `columnid`) trừ khi tool được thiết kế riêng để migrate toàn bộ tham chiếu.

## 12. Xóa và vô hiệu hóa

Xóa là thao tác rủi ro cao. Mặc định agent nên đề xuất vô hiệu hóa/ẩn thay vì xóa cứng.

Quy tắc:

- Không xóa app nếu còn table/window/menu/role access liên quan.
- Không xóa table nếu còn tab/field/record dữ liệu thật.
- Không xóa column nếu còn field dùng column đó.
- Không xóa window nếu còn menu trỏ tới window.
- Không xóa tab nếu còn field hoặc tab con.
- Không xóa domain nếu còn field dùng domain.
- Không xóa relate table nếu còn quan hệ đang hoạt động.

Nếu user yêu cầu xóa, tool validate phải trả dependency list và yêu cầu xác nhận riêng.

## 13. Quyền và role

Role System có thể tạo cấu hình, nhưng app mới có thể chưa xuất hiện với user khác nếu chưa cấp quyền.

Khi mục tiêu là cho user/role khác dùng app mới, agent phải kiểm tra thêm:

- Role nào được dùng app.
- Menu nào role đó được thấy.
- Quyền CRUD trên từng table: `noselect`, `noinsert`, `noupdate`, `nodelete`, `noexport`.
- Bảng liên quan quyền như `NAccess`, `NRoleApp`, `NRoleMenu`, `NRoleUser`.

Nếu write tool hiện chưa hỗ trợ quyền, agent phải nói rõ: app/table/window đã có thể được cấu hình nhưng chưa cấp quyền cho role người dùng cuối.

## 14. Cache window

Frontend không chỉ đọc record `NWindow/NTab/NField`; khi mở window, nó gọi:

```text
GET rest/token/cache/{windowid}
```

Kết quả chứa `configjson` và có thể có `layoutjson`, thường được encode bằng Zipson. Runtime dùng:

```text
zipson.parse(cache.configjson)
NUT.configWindow(conf, layout)
```

Vì vậy sau khi tạo/sửa window/tab/field/menu trong window:

- Nếu backend tự rebuild cache, gọi endpoint/tool refresh cache nếu có.
- Nếu chưa có endpoint refresh cache, write tool phải biết cách cập nhật `NCache` đúng format.
- Không tự ghi `configjson` thủ công nếu tool chưa encode đúng ERD và Zipson.
- Sau khi refresh, gọi lại `AppBuilderBlueprint` để xác minh window parse được, có tab/field đúng.

Nếu cache chưa refresh, câu trả lời phải nói rõ: metadata đã ghi nhưng màn hình có thể chưa hiển thị cho tới khi cache được rebuild.

## 15. Validate plan

Validate tool phải kiểm tra tối thiểu:

- User đã đăng nhập Zilcode.
- Role hiện tại là Role System hoặc có quyền cấu hình App Builder.
- Target app tồn tại hoặc tên/code app mới chưa trùng.
- Target table/window/tab/field/menu/domain chưa trùng.
- Mọi ID tham chiếu đều tồn tại.
- Table có `columnkey`.
- Tab có `tableid`.
- Field có `tabid` và map được tới column/domain/link table nếu cần.
- Menu trỏ tới window hợp lệ.
- Quan hệ tab cha-con có `linkparentfield/linkchildfield`.
- Quan hệ nhiều-nhiều có relate table và relate fields.
- Nếu cần bảng vật lý, schema plan có primary key.
- Nếu thao tác ảnh hưởng quyền user khác, có plan cấp quyền hoặc cảnh báo rõ.

Validate tool không ghi dữ liệu.

## 16. Write tool nên được thiết kế theo nhóm nhỏ

Không nên bắt đầu bằng một tool ghi quá lớn. Nên có các tool nhỏ:

```text
app_builder_validate_plan
app_builder_create_app
app_builder_update_app
app_builder_create_table
app_builder_update_table
app_builder_create_column
app_builder_update_column
app_builder_create_window
app_builder_update_window
app_builder_create_tab
app_builder_update_tab
app_builder_create_field
app_builder_update_field
app_builder_create_menu
app_builder_update_menu
app_builder_create_domain
app_builder_refresh_window_cache
app_builder_verify_change
```

Sau khi các tool nhỏ ổn định mới thêm:

```text
app_builder_apply_plan
```

`apply_plan` chỉ được chạy khi:

- Plan đã validate.
- User đã xác nhận.
- Tool có rollback hoặc dừng an toàn khi một bước lỗi.
- Tool trả log từng bước và ID record vừa tạo.

## 17. Ví dụ tạo app đơn giản

Yêu cầu: tạo app CRM có màn hình Khách hàng.

Plan hợp lệ:

1. Kiểm tra `appcode=crm` chưa tồn tại trong `NApplication`.
2. Tạo app `CRM`.
3. Tạo bảng vật lý `crm_customer` nếu chưa có.
4. Tạo metadata `NTable` cho `crm_customer`.
5. Tạo `NColumn`:
   - `customerid` primary key identity
   - `customercode`
   - `customername`
   - `phone`
   - `email`
   - `status`
6. Tạo domain status nếu cần:
   - `ACTIVE`
   - `INACTIVE`
7. Tạo window `CRM - Khách hàng`.
8. Tạo root tab `Khách hàng` gắn `crm_customer`.
9. Tạo fields cho các column cần hiển thị.
10. Tạo menu `Khách hàng` trỏ tới window.
11. Refresh cache window.
12. Đọc lại blueprint và xác minh:
   - app CRM tồn tại
   - bảng `crm_customer` có columns
   - window có tab
   - tab có fields
   - menu trỏ đúng window

## 18. Ví dụ thêm tab con 1-n

Yêu cầu: trong app CRM, màn hình Khách hàng có tab Liên hệ.

Plan hợp lệ:

1. Resolve app CRM.
2. Resolve table cha `crm_customer`, key `customerid`.
3. Tạo bảng vật lý `crm_contact` nếu chưa có.
4. Tạo metadata `NTable` cho `crm_contact`.
5. Tạo `NColumn` cho `crm_contact`, bắt buộc có:
   - `contactid` primary key
   - `customerid` foreign key về customer
   - `contactname`
   - `phone`
6. Resolve window Khách hàng.
7. Resolve root tab Khách hàng.
8. Tạo child tab:
   - `parenttabid = customer tabid`
   - `tablevel = parent.tablevel + 1`
   - `tableid = crm_contact tableid`
   - `linktableid = crm_customer tableid`
   - `linkchildfield = customerid`
   - `linkparentfield = customerid`
9. Tạo fields cho contact tab.
10. Refresh cache.
11. Verify child tab xuất hiện dưới customer tab.

## 19. Ví dụ chỉnh field

Yêu cầu: đổi trường phone thành bắt buộc và đổi nhãn thành Số điện thoại.

Plan hợp lệ:

1. Resolve app.
2. Resolve table chứa `phone`.
3. Resolve tab đang hiển thị field `phone`.
4. Resolve `NField` theo `tabid + columnname`.
5. Update `NField`:
   - `translate` hoặc `fieldname` thành `Số điện thoại`
   - `isrequire = true`
6. Nếu cần bắt buộc ở schema vật lý, update column nullable bằng API column/table riêng.
7. Refresh cache nếu UI field metadata thay đổi.
8. Verify field label và required flag.

## 20. Cách trả lời người dùng

Khi user yêu cầu tạo/sửa:

- Tóm tắt hiểu biết của agent.
- Nêu các thông tin còn thiếu nếu có.
- Nếu đủ thông tin, đưa plan ngắn gọn.
- Hỏi xác nhận trước khi ghi.
- Sau khi ghi, báo kết quả theo từng bước và kết quả verify.

Không nói kiểu "tôi sẽ gọi API X" nếu user không cần. Nói theo nghiệp vụ:

```text
Mình sẽ tạo app CRM, thêm bảng Khách hàng, tạo màn hình Khách hàng và thêm menu để mở màn hình đó.
```

Khi có rủi ro:

```text
Phần bảng dữ liệu vật lý chưa được xác nhận. Mình cần biết bạn muốn tạo bảng mới hay dùng bảng đã có.
```

Khi chưa có write tool:

```text
Hiện mình đã đủ thông tin để lập kế hoạch cấu hình, nhưng chưa có tool ghi để thực hiện trực tiếp. Cần bổ sung write tool tương ứng trước khi apply.
```

