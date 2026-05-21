# Mô hình vận hành Zilcode cho trợ lý AI

Tài liệu này mô tả cách một trợ lý AI nên hiểu và làm việc với Zilcode. Nội dung được viết như tài liệu chuẩn cho hệ thống, dùng được cho người phát triển, người thiết kế tool và model khi truy xuất qua RAG.

Tài liệu này không mô tả giao diện cho người dùng cuối. Tài liệu tập trung vào mô hình vận hành, quan hệ dữ liệu, quyền, tab, window, table, field, record và các quy trình thao tác.

## MODEL CONTROL INSTRUCTIONS

Khi trả lời hoặc điều khiển tool trong Zilcode, hãy áp dụng các luật sau:

- Luôn suy luận theo chuỗi `session -> role -> organization -> application -> window -> tab -> table -> field -> record`.
- Không coi window là dữ liệu thật. Window chỉ là màn hình. Tab mới xác định table và field đang thao tác.
- Không thực hiện thao tác ghi nếu chưa biết active tab, table, columnkey, record mục tiêu và quyền hiện tại.
- Không tự đoán quan hệ giữa các tab. Phải dùng metadata `parenttabid`, `linkchildfield`, `linkparentfield`, `relatetableid`, `relatechildfield`, `relateparentfield`.
- Nếu user yêu cầu sửa/xóa "dòng này", phải xác định selected record của active tab.
- Nếu active tab là tab con, phải kiểm tra parent record.
- Nếu tab là many-to-many, link/unlink chỉ thao tác relate table.
- Nếu user chỉ hỏi kiến thức chung, dùng RAG. Nếu user hỏi trạng thái hiện tại, gọi read tool. Nếu user yêu cầu ghi dữ liệu, dùng preview/apply flow.
- Khi thiếu thông tin, hỏi lại hoặc gọi read tool; không tự chọn thay người dùng.

## 1. Mô hình tổng quan

Zilcode là nền tảng nocode dựng ứng dụng từ metadata. Giao diện và hành vi không được viết cứng theo từng màn hình nghiệp vụ. Runtime đọc cấu hình application, menu, window, tab, table, field, domain, workflow và quyền để dựng UI.

Chuỗi vận hành tổng quát:

```text
Đăng nhập
  -> chọn role
  -> chọn organization
  -> mở application
  -> tải menu/window/table/domain/workflow metadata
  -> mở window
  -> render tab/field/grid/form
  -> đọc hoặc ghi record qua table service
```

## 2. Entity graph

```text
Site
  -> Organization
  -> User
  -> Role
  -> Application
       -> Menu
       -> Window
            -> Tab
                 -> Field
                 -> Table
                      -> Service
                 -> Domain / Lookup / Relation
       -> Workflow
            -> Workflow Step
```

Ý nghĩa:

- `Site` là phạm vi công ty hoặc khách hàng.
- `Organization` là chi nhánh, phòng ban hoặc đơn vị trong site.
- `User` là tài khoản đăng nhập.
- `Role` quyết định quyền và phạm vi chức năng.
- `Application` là app con trong Zilcode.
- `Menu` mở window, report hoặc component.
- `Window` là màn hình nghiệp vụ.
- `Tab` là vùng thao tác dữ liệu trong window.
- `Table` là nguồn dữ liệu thật.
- `Field` mô tả cách hiển thị và sửa từng column.
- `Domain` cung cấp danh sách giá trị.
- `Workflow` điều phối quy trình xử lý.

## 3. Site, user, role, organization

### 3.1. Site

Site là đơn vị dữ liệu cấp công ty. Nhiều bảng có field `siteid`.

Khi tạo record mới, nếu table có field `siteid`, hệ thống thường dùng `siteid` từ phiên hiện tại.

### 3.2. User

User có thể có nhiều role và nhiều organization.

Các thuộc tính quan trọng:

```text
userid
username
fullname
siteid
roleid
orgid
isviewer
```

Nếu `isviewer = true`, user chỉ được xem và không được thao tác ghi.

### 3.3. Role

Role quyết định:

- Application nào được mở.
- Menu/window nào được dùng.
- Table nào được đọc, thêm, sửa, xóa.
- Workflow step nào được xử lý.
- Action nào xuất hiện trên toolbar.

Mọi thao tác ghi phải được kiểm tra theo role hiện tại.

### 3.4. Organization

Organization ảnh hưởng đến phạm vi dữ liệu, giá trị mặc định và quyền nghiệp vụ.

Khi tạo record mới, nếu có field `orgid`, hệ thống có thể dùng organization hiện tại làm default.

## 4. Application và menu

Application là app con. Một application có thể chứa:

- Menu.
- Window.
- Table.
- Domain.
- Workflow.
- Service.
- Report.
- Component.

Menu có thể:

- Mở window.
- Mở report.
- Chạy component.
- Chứa menu con.
- Gắn filter hoặc tab cụ thể.

Khi user click menu, hệ thống xác định window hoặc action tương ứng, sau đó dựng UI từ metadata.

## 5. Window

Window là màn hình nghiệp vụ. Window không nhất thiết tương ứng với một table duy nhất.

Một window có thể có:

- Một root tab.
- Nhiều tab con.
- Tab quan hệ một-nhiều.
- Tab quan hệ nhiều-nhiều.
- Tab view-only.
- Tab workflow.
- Toolbar action.
- Custom menu tool.

Thông tin quan trọng:

```text
windowid
windowname
windowtype
appid
execname
isopenfind
translate
```

Không nên quyết định thao tác CRUD chỉ từ window. Cần xác định tab và table.

## 6. Tab

Tab là ngữ cảnh thao tác dữ liệu chính.

Thông tin quan trọng:

```text
tabid
parenttabid
tabname
tablevel
seqno
tableid
linktableid
linkparentfield
linkchildfield
relatetableid
relateparentfield
relatechildfield
whereclause
orderby
filterfield
filterclause
workflowid
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

### 6.1. Root tab

Root tab thường là dataset chính của window.

Nếu root tab đang active, selected record của root tab thường là mục tiêu cho các câu như:

```text
dòng này
bản ghi này
khách hàng này
```

### 6.2. Child tab

Child tab phụ thuộc parent tab.

Quan hệ một-nhiều dùng:

```text
parenttabid
linkparentfield
linkchildfield
```

Khi thêm record con:

```text
child[linkchildfield] = parent[linkparentfield]
```

Không tạo record con nếu chưa có parent record.

### 6.3. Relation tab

Quan hệ nhiều-nhiều dùng relate table.

Các field quan trọng:

```text
relatetableid
relateparentfield
relatechildfield
linkparentfield
linkchildfield
```

Link record nghĩa là thêm dòng vào relate table.

Unlink record nghĩa là xóa dòng khỏi relate table.

Unlink không đồng nghĩa với xóa record con.

### 6.4. View-only tab

Nếu tab `isviewonly = true` hoặc table readonly, tab chỉ dùng để xem.

Không thêm, sửa, xóa qua tab view-only.

## 7. Table

Table là nguồn dữ liệu thật. Table quyết định endpoint đọc/ghi, khóa chính, service và các cột hiển thị chính.

Thông tin quan trọng:

```text
tableid
tablename
serviceid
servicetype
urlview
urledit
columnkey
columncode
columndisplay
columntree
columnfind
columnlock
isreadonly
iscache
hasattach
archivetype
maplayer
```

Quy tắc:

- `urlview` dùng cho đọc.
- `urledit` dùng cho ghi.
- `columnkey` cần cho update/delete.
- `columndisplay` hoặc `columncode` nên dùng làm label khi hỏi xác nhận.
- `columnlock` cho biết record có thể bị khóa.
- `servicetype` quyết định cách gọi API.

Nếu table readonly hoặc thiếu `urledit`, không ghi dữ liệu.

Nếu table thiếu `columnkey`, không update/delete record cụ thể.

## 8. Field

Field mô tả cách UI hiển thị và sửa một column.

Thông tin quan trọng:

```text
fieldid
fieldname
columnname
fieldtype
tabid
tableid
domainid
linktableid
linkcolumn
bindfieldname
whereclause
wherefieldname
defaultvalue
isrequire
isreadonly
hideingrid
hideinform
hideinfind
fieldlength
vformat
calculation
displaylogic
options
```

Quy tắc:

- Field readonly không được sửa.
- Field có calculation nên được xem là field tính toán.
- Field primary key không được sửa.
- Field không có `columnname` không nên ghi dữ liệu.
- Field required cần có giá trị khi insert.
- Field domain phải dùng value hợp lệ.
- Field lookup/search phải map tới record liên kết.

## 9. Domain và lookup

Domain cung cấp danh sách giá trị cho select/list.

Khi người dùng nói bằng nhãn hiển thị, hệ thống cần map sang value thật trong domain.

Ví dụ:

```text
"Hoạt động" -> "A"
"Ngừng hoạt động" -> "I"
```

Không ghi text hiển thị nếu backend cần id/value.

Lookup/search field dùng bảng liên kết. Khi cập nhật lookup field, cần tìm record liên kết và ghi khóa của record đó, không ghi label.

## 10. Workflow

Workflow gồm workflow chính và các step.

Step có thể gắn:

```text
roleid
userid
windowid
status
reject
duration
ins
outs
```

Workflow có thể kiểm soát:

- Ai được xử lý bước hiện tại.
- Màn hình nào được mở để xử lý.
- Trạng thái nào được chuyển tiếp.
- Có được từ chối hay không.

Không thay đổi workflow nếu chưa kiểm tra role/user hiện tại và preview tác động.

## 11. Quyền thao tác

Quyền thao tác cần kiểm tra theo nhiều lớp:

```text
user.isviewer
role access
application/menu/window access
table access
tab flags
table flags
field flags
record state
workflow state
```

Một thao tác bị chặn nếu bất kỳ lớp nào không cho phép.

Các flag thường gặp:

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

## 12. Quy trình đọc dữ liệu

```text
1. Xác định application/window/tab.
2. Kiểm tra quyền đọc.
3. Xác định table và urlview.
4. Áp dụng filter của tab.
5. Nếu là child tab, áp dụng parent filter.
6. Áp dụng query/filter người dùng.
7. Giới hạn số dòng.
8. Trả dữ liệu cần thiết.
```

## 13. Quy trình thêm record

```text
1. Xác định active tab.
2. Kiểm tra quyền insert.
3. Kiểm tra table.urledit.
4. Lấy field metadata.
5. Điền default value.
6. Điền siteid/appid/orgid nếu field tồn tại.
7. Nếu là child tab, điền khóa cha.
8. Validate required/type/domain.
9. Preview.
10. Xác nhận.
11. Apply.
12. Verify.
```

## 14. Quy trình sửa record

```text
1. Xác định active tab.
2. Xác định target record.
3. Kiểm tra quyền update.
4. Kiểm tra table.urledit và columnkey.
5. Đọc record hiện tại.
6. Map yêu cầu sang field metadata.
7. Validate field.
8. Tạo diff tối thiểu.
9. Preview.
10. Xác nhận.
11. Apply.
12. Verify.
```

## 15. Quy trình xóa hoặc lưu trữ record

```text
1. Xác định active tab.
2. Xác định target record.
3. Kiểm tra quyền delete/archive.
4. Kiểm tra table.urledit và columnkey.
5. Kiểm tra record lock/workflow lock.
6. Kiểm tra dữ liệu con hoặc relation.
7. Preview kèm cảnh báo.
8. Xác nhận mạnh.
9. Apply.
10. Verify.
```

## 16. Quy trình link/unlink

Link:

```text
1. Xác định parent record.
2. Xác định child record.
3. Xác định relate table.
4. Preview insert relation row.
5. Xác nhận.
6. Apply.
7. Verify child xuất hiện dưới parent.
```

Unlink:

```text
1. Xác định parent record.
2. Xác định child record.
3. Xác định relation row.
4. Preview delete relation row.
5. Xác nhận.
6. Apply.
7. Verify child không còn liên kết với parent.
```

Unlink không xóa record con.

## 17. Khi nào cần hỏi lại

Cần hỏi lại khi:

- Không biết active tab.
- Không biết record nào là mục tiêu.
- Nhiều record cùng khớp.
- Nhiều field cùng khớp.
- Thiếu parent record cho child tab.
- Thiếu relation metadata.
- Thiếu quyền.
- Preview báo rủi ro cao hoặc không hợp lệ.

## 18. Nguyên tắc phản hồi

Trước khi apply:

```text
Dự kiến thay đổi trường A từ "old" sang "new". Bạn xác nhận thực hiện không?
```

Sau khi apply thành công:

```text
Đã cập nhật bản ghi X. Trường A đã đổi từ "old" sang "new".
```

Khi bị chặn:

```text
Không thể thực hiện vì tab hiện tại không cho phép sửa hoặc tài khoản hiện tại không có quyền cập nhật.
```

Không nói "đã sửa" nếu thao tác chưa được apply thành công.

## 19. Gợi ý truy xuất RAG

Khi câu hỏi liên quan đến:

- Quyền, role, không thấy nút, không sửa được: ưu tiên phần quyền thao tác.
- Tab con, bảng con, liên kết: ưu tiên phần tab cha-con và nhiều-nhiều.
- Thêm mới: ưu tiên quy trình thêm record.
- Sửa dữ liệu: ưu tiên quy trình sửa record.
- Xóa/lưu trữ: ưu tiên quy trình xóa hoặc lưu trữ.
- Workflow/phê duyệt: ưu tiên phần workflow.
- Field/domain/lookup/calculation: ưu tiên phần field, domain và lookup.

