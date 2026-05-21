# Domain model Zilcode

MODEL CONTROL INSTRUCTIONS:

- Khi cần hiểu cấu trúc Zilcode, map yêu cầu về chuỗi entity thật: `role -> application -> window -> tab -> table -> field -> record`.
- Khi người dùng yêu cầu xem hoặc sửa dữ liệu, không suy luận trực tiếp từ tên gọi tự nhiên. Phải xác định entity tương ứng.
- Nếu thiếu `roleid`, `orgid`, `appid`, `windowid`, `tabid`, `tableid`, `columnkey` hoặc `recordid` cho thao tác ghi, hãy gọi tool đọc context hoặc hỏi lại.
- Role và access là ràng buộc bắt buộc. Không vượt quyền bằng cách gọi endpoint khác hoặc tự tạo payload.
- Table là mục tiêu ghi dữ liệu thật. Window chỉ là container UI. Tab là cầu nối giữa UI và table.

Tài liệu này mô tả các khái niệm domain chính của Zilcode. Đây là lớp kiến thức nền để hiểu hệ thống trước khi dùng tool gọi API hoặc hỗ trợ chỉnh sửa trực tiếp.

## 1. Site

Site là đơn vị công ty/khách hàng trong Zilcode.

Thông tin thường gặp:

- `siteid`: ID công ty.
- `sitecode`: mã công ty, dùng khi đăng nhập dạng `Username.SiteCode`.
- `sitename`: tên công ty.
- `sitedesc`: mô tả công ty.
- `icon`: logo.
- `backdrop`: ảnh nền.

Site là phạm vi dữ liệu quan trọng. Nhiều record có field `siteid`. Khi tạo record mới, nếu field `siteid` tồn tại thì runtime thường tự gán `n$.user.siteid`.

## 2. Organization

Organization là chi nhánh/phòng ban/cây tổ chức trong một site.

Thông tin thường gặp:

- `orgid`
- mã/tên org
- parent org
- trạng thái active

Khi user có nhiều org, hệ thống yêu cầu chọn org sau login. Context `orgid` có thể ảnh hưởng đến dữ liệu mặc định, quyền và phạm vi truy cập.

## 3. User

User là tài khoản đăng nhập.

Thông tin runtime thường có:

- `userid`
- `username`
- `fullname`
- `siteid`
- `sitecode`
- `token`
- `roleid`
- `orgid`
- `isviewer`
- `roles`
- `orgs`

`isviewer` làm user chỉ được xem, không được sửa dữ liệu. AI tool write phải kiểm tra flag này.

## 4. Role

Role là vai trò/quyền của user.

Sau login, user có thể có nhiều role. Khi chọn role, backend trả:

- `access`
- `apps`
- `notifies`

Role ảnh hưởng đến:

- app nào được mở
- window/menu nào được dùng
- quyền CRUD trên từng table
- workflow step được giao
- danh sách user có thể nhận workflow/message

## 5. Access

`NUT.access` là object quyền theo table name. Runtime dùng:

```text
- noselect
- noinsert
- noupdate
- nodelete
- noexport
- noattach
- isarchive
- islock
```

Tool AI không được chỉ dựa vào prompt để quyết định write. Tool phải kiểm tra quyền thực tế trong access context.

## 6. Application

Application là ứng dụng con trong Zilcode.

Thông tin thường gặp:

- `appid`
- `appname`
- `apptype`
- `description`
- `icon`
- `theme`
- `linkurl`
- `siteid`

Các loại app:

- app thường: được render động từ menu/window/tab/field.
- app `engine`: mở cửa sổ riêng qua `linkurl`, ví dụ SQL Cloud, Workflow Manager, Source Editor.
- app `gis`: có map service và ArcGIS layer.

Khi mở app, frontend gọi `token/app/{appid}` để lấy metadata app.

## 7. Service

Service mô tả nguồn dữ liệu hoặc backend service.

Loại service thường gặp:

- `sqlrest`: REST data service cho bảng/view/procedure.
- `arcgis`: ArcGIS feature service.
- `basemap`: bản đồ nền.

Table trỏ đến service qua `serviceid`. Cách read/write phụ thuộc service type:

- `sqlrest`: dùng `SqlREST`.
- `arcgis`: dùng queryFeatures, add/update/delete features.

## 8. Table

Table là metadata bảng dữ liệu mà tab sử dụng.

Thông tin thường gặp:

- `tableid`
- `tablename`
- `serviceid`
- `servicetype`
- `urlview`
- `urledit`
- `columnkey`
- `columncode`
- `columndisplay`
- `columntree`
- `columnfind`
- `columnlock`
- `isreadonly`
- `iscache`
- `hasattach`
- `archivetype`
- `maplayer`

`urlview` dùng để đọc dữ liệu. `urledit` dùng để thêm/sửa/xóa. `columnkey` là khóa chính của record.

## 9. Domain

Domain là danh sách giá trị dùng cho field select/list hoặc trạng thái.

Domain được load khi mở app. Mỗi domain có:

- `domainid`
- `domainjson`
- `iseditable`

`domainjson` thường là array dạng:

```json
[
  ["id", "text", "color"]
]
```

Runtime chuyển domain thành:

- `items`: danh sách cho w2ui select.
- `lookup`: tra từ id sang text.
- `lookdown`: tra từ text sang id.

Nếu domain `iseditable`, UI có helper để sửa domain.

## 10. Relate

Relate mô tả quan hệ nhiều-nhiều giữa hai bảng.

Khi tab con không có `relatetableid`, runtime có thể tự suy luận relate từ `NUT.relates` theo cặp table parent/child.

Các field quan trọng:

- `relatetableid`
- `relateparentfield`
- `relatechildfield`
- `linkparentfield`
- `linkchildfield`

Khi link/unlink record, runtime insert/delete record trong relate table.

## 11. Window

Window là màn hình nghiệp vụ động.

Metadata window gồm:

- `windowid`
- `windowname`
- `windowtype`
- `appid`
- `execname`
- `isopenfind`
- `translate`

Window chứa nhiều tab. Khi user click menu trỏ tới window, frontend load window cache và render bằng `NWin`.

## 12. Tab

Tab là vùng dữ liệu trong window. Một tab thường tương ứng một bảng.

Tab có thể là:

- tab cha cấp 0
- tab con cấp sâu hơn
- tab liên kết 1-n
- tab liên kết n-n
- tab view-only
- tab workflow

Metadata quan trọng:

- `tabid`
- `parenttabid`
- `tabname`
- `tablevel`
- `seqno`
- `layoutcols`
- `tableid`
- `linktableid`
- `linkchildfield`
- `linkparentfield`
- `relatetableid`
- `relatechildfield`
- `relateparentfield`
- `whereclause`
- `orderby`
- `filterfield`
- `filterclause`
- `workflowid`
- flags: `noinsert`, `noupdate`, `nodelete`, `noselect`, `noexport`, `isviewonly`, `islock`, `isautosave`, `isarchive`

## 13. Field

Field mô tả cột hiển thị/edit trong tab.

Metadata quan trọng:

- `fieldid`
- `fieldname`
- `columnname`
- `fieldtype`
- `tabid`
- `columnid`
- `tableid`
- `domainid`
- `linktableid`
- `linkcolumn`
- `bindfieldname`
- `whereclause`
- `parentfieldid`
- `wherefieldname`
- `defaultvalue`
- `isrequire`
- `isreadonly`
- `hideingrid`
- `hideinform`
- `hideinfind`
- `displaylength`
- `fieldlength`
- `vformat`
- `placeholder`
- `calculation`
- `displaylogic`
- `options`
- `colspan`
- `rowspan`
- `fieldgroup`

Field quyết định UI editor, validation, lookup, calculation và display logic.

## 14. Menu

Menu là node trong sidebar hoặc shortcut toolbar.

Menu có thể:

- mở window
- chạy component
- chạy report
- mở file/URL
- chứa menu con

Metadata quan trọng:

- `menuid`
- `menuname`
- `parentid`
- `seqno`
- `appid`
- `windowid`
- `tabid`
- `menutype`
- `execname`
- `icon`
- `reportid`
- `whereclause`
- `isopen`
- `issummary`

## 15. Workflow

Workflow gồm:

- `n_workflow`: workflow chính.
- `n_wfstep`: các step trong BPMN.
- `n_wfflow`: luồng xử lý/thông báo/công việc.

Workflow step có:

- `workflowid`
- `elementid`
- `steptype`
- `stepname`
- `status`
- `reject`
- `duration`
- `roleid`
- `userid`
- `windowid`
- `ins`
- `outs`

Workflow dùng role/user/window để giao việc và mở đúng màn hình xử lý.

## 16. Report

Report có thể dùng:

- HTML report.
- Datarock pivot/report.
- Highcharts/Chart.js.

Report thường gắn với `tableid` và `contentjson`. Khi chạy report, runtime lấy dữ liệu từ table rồi đưa vào report viewer.

## 17. Source/media/file

Source Editor và File Manager dùng:

- `NUT.URL_SOURCE`
- `NUT.URL_UPLOAD`
- thư mục `/site/`
- thư mục `/media/`

File attach theo cấu trúc:

```text
media/{siteid}/{tableid}/{recordid}/{filename}
```

Upload file record dùng `NUT.uploadFile()`.

## 18. Quan hệ tổng quát

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
                 -> Domain / Link table
       -> Workflow
            -> Workflow Step
```

## 19. Ý nghĩa cho AI tool

Muốn chỉnh sửa an toàn, tool AI cần biết tối thiểu:

- current `siteid`, `userid`, `roleid`, `orgid`
- current `appid`
- current `windowid`
- current `tabid`
- current `tableid`
- selected `recordid`
- table `columnkey`
- field metadata
- access rights
- service type
- write mode: insert/update/delete/link/archive/workflow

Nếu thiếu các thông tin này, model chỉ nên hỏi lại hoặc gọi read/context tool, không được tự gọi write tool.
