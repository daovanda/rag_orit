# Window, Tab, Field config trong Zilcode

MODEL CONTROL INSTRUCTIONS:

- Khi cần hiểu một màn hình Zilcode, coi `window` là container, `tab` là ngữ cảnh thao tác, `table` là nguồn dữ liệu thật, `field` là luật hiển thị/sửa từng column.
- Không thực hiện insert/update/delete nếu mới biết `windowid` nhưng chưa biết `tabid`, `tableid`, `columnkey` và quyền tương ứng.
- Với tab con, phải xác định quan hệ cha-con trước khi thêm/sửa/xóa. Không insert record con nếu thiếu parent record.
- Với tab nhiều-nhiều, thao tác link/unlink phải tác động lên relate table, không xóa record con thật.
- Field có `isreadonly`, `calculation`, primary key hoặc không có `columnname` không được sửa trực tiếp.

Tài liệu này mô tả cách Zilcode dùng metadata để dựng giao diện động. Đây là phần quan trọng nhất để chatbot hiểu vì sao Zilcode có thể tạo app không cần viết code.

## 1. Ý tưởng chính

Trong Zilcode, giao diện nghiệp vụ không được viết cứng theo từng table. Backend trả metadata window/tab/field/menu. Frontend đọc metadata đó và dựng UI gồm:

- sidebar menu
- window
- tab
- grid
- form
- toolbar
- search dialog
- relation/link dialog
- import/export
- workflow action

Hai hàm chính:

- `NUT.configWindow(conf, layout)`
- `NWin.buildWindow(div, conf, tabLevel, callback)`

## 2. ERD mapping

Trong `NUT.ERD`, config được định nghĩa bằng các mảng field name. Backend cache có thể trả dữ liệu dạng array để giảm dung lượng. Frontend dùng ERD mapping để chuyển array thành object.

### Window ERD

```text
windowid
windowname
windowtype
appid
execname
isopenfind
translate
```

### Tab ERD

```text
tabid
parenttabid
tabname
tablevel
seqno
layoutcols
linkchildfield
linkparentfield
linktableid
whereclause
orderby
tableid
windowid
relatechildfield
relateparentfield
relatetableid
filterfield
filterclause
noinsert
noupdate
nodelete
isarchive
islock
isautosave
translate
noselect
noexport
workflowid
isviewonly
labelspan
```

### Field ERD

```text
fieldid
fieldname
translate
hideingrid
hideinform
hideinfind
displaylength
seqno
isreadonly
fieldlength
vformat
defaultvalue
isrequire
isfrozen
fieldgroup
tabid
columnid
fieldtype
linktableid
domainid
issearchtonghop
parentfieldid
wherefieldname
placeholder
calculation
colspan
rowspan
mapcolumn
displaylogic
columnname
tableid
whereclause
bindfieldname
options
columntype
linkcolumn
```

### Menu ERD

```text
menuid
menuname
parentid
seqno
translate
issummary
appid
windowid
siteid
tabid
menutype
execname
icon
reportid
```

## 3. `NUT.configWindow()`

Input:

- `conf.window`: array window.
- `conf.tabs`: array tab.
- `conf.fields`: array field.
- `conf.menus`: array menu.
- `layout`: optional layout HTML.

Output:

```js
winconf = {
  tabs: [],
  needCache: {},
  lookupFieldName: {},
  lookupField: {},
  lookupTab: {}
}
```

Quá trình:

1. Convert `conf.window` thành object window theo `NUT.ERD.window`.
2. Convert từng tab theo `NUT.ERD.tab`.
3. Gắn table metadata vào tab qua `tableid`.
4. Gắn link table, relate table nếu có.
5. Tạo cây tab cha-con theo `parenttabid` và `tablevel`.
6. Convert fields theo `NUT.ERD.field`.
7. Gắn field vào tab tương ứng.
8. Gắn link table/domain/calculation/displaylogic.
9. Convert menus theo `NUT.ERD.menu`.
10. Gắn menu tool vào tab.

## 4. Tab hierarchy

Tab có thể lồng nhiều cấp.

- `tablevel = 0`: tab cấp gốc.
- `parenttabid`: ID tab cha.
- `children`: tab con trực tiếp.
- `tabs`: tab con được render dưới dạng tabs trong UI.
- `maxLevel`: cấp sâu nhất dưới tab đó.

Khi tab con được chọn, frontend có thể reload dữ liệu theo record cha.

## 5. Relation 1-n và n-n

### Quan hệ 1-n

Nếu tab con có field link đến table cha, runtime có thể xác định:

- `linktable`
- `linktableid`
- `linkchildfield`
- `linkparentfield`

Khi thêm record con, frontend tự gán `linkchildfield = parentKey`.

### Quan hệ n-n

Nếu có `relatetableid`, hoặc runtime suy luận được từ `NUT.relates`, tab dùng relate table để link/unlink record.

Các field:

- `relatetable`
- `relatetableid`
- `relateparentfield`
- `relatechildfield`
- `linkparentfield`
- `linkchildfield`

Lệnh `LINK` trên toolbar mở dialog chọn record và insert/delete vào relate table.

## 6. Layout

Nếu `layoutjson` tồn tại, `NUT.configWindow()` parse layout HTML. Layout gắn field vào các vị trí cụ thể trong form.

Nếu không có layout, w2form tự layout theo:

- `layoutcols`
- `colspan`
- `fieldgroup`
- `labelspan`

AI tool chỉnh field/layout cần phân biệt:

- chỉnh metadata field
- chỉnh layout HTML
- chỉnh dữ liệu record

Đây là ba loại thao tác khác nhau.

## 7. Field rendering

Field quyết định cả grid column và form input.

Nếu `hideingrid` false, field được đưa vào grid.

Nếu `hideinform` false, field được đưa vào form.

Nếu `hideinfind` false, field được đưa vào search form.

`fieldtype` được dùng làm editor/render:

```text
password
int
float
currency
date
datetime
percent
toggle
textarea
radio
select
list
search
file
arrays
json
QR
point
polyline
polygon
```

## 8. Domain và lookup field

Nếu field là `select` hoặc `list`, runtime lấy domain từ:

- `domainid`
- hoặc `linktableid + whereclause`

Nếu field là `search`, UI có helper để chọn record từ bảng liên kết.

Field search cần:

- `linktableid`
- `linkcolumn`
- `bindfieldname`
- `whereclause`
- `wherefieldname`

## 9. Default value

Field có `defaultvalue`. Nếu default bắt đầu bằng `n$.`, frontend eval giá trị runtime.

Ví dụ:

- `n$.now()`
- `n$.nowDate()`
- `n$.nowMonth()`
- `n$.nowYear()`
- `n$.user.userid`
- `n$.user.siteid`
- `n$.app.appid`

Khi tạo record mới, runtime cũng tự gán:

- `siteid = n$.user.siteid` nếu field có columnname `siteid`.
- `appid = n$.app.appid` nếu field có columnname `appid`.
- `orgid = n$.orgid` nếu field có columnname `orgid`.

## 10. Calculation

Field có thể có `calculation`, dùng cú pháp tham chiếu field trong dấu `[]`.

Ví dụ:

```text
[quantity] * [price]
sum[detail.amount]
```

Runtime parse các field trong `[]`, tạo `calculationInfos`, và thay biểu thức thành dạng `_v[index]`.

Calculation có thể tham chiếu:

- field cùng table
- field table cha
- aggregate từ child tab: `sum`, `count`, `avg`, `min`, `max`

AI tool không nên sửa calculation nếu không hiểu quan hệ tab/table.

## 11. Display logic

Field có thể có `displaylogic`, cũng tham chiếu field bằng `[]`.

Runtime thay:

```text
[status] == "A"
```

thành:

```js
form.record["status"] == "A"
```

Display logic ảnh hưởng hiển thị field. Tool sửa field cần tránh phá logic này.

## 12. Toolbar mặc định

Toolbar tab có thể có các command:

```text
SWIT  - chuyển form/grid
RELO  - reload
TREE  - chế độ cây
FIND  - tìm kiếm
NEW   - thêm mới
SAVE  - lưu
SAVE_A - lưu và archive
DEL   - xóa
DEL_A - xóa và archive
ATTA  - attachment
LINK  - liên kết n-n
LOCK  - lock/unlock
ARCH  - xem archive
ARCH_D - xem archive xóa
IMP   - import
EXP   - export
PREV  - record trước
NEXT  - record sau
EXPD  - expand/collapse
```

Toolbar phụ thuộc quyền. Nếu user không có quyền, command không xuất hiện.

## 13. Menu tool tùy biến

Mỗi tab có thể có `menus`. Menu tool có thể:

- chạy component JS qua `execname`
- chạy report qua `reportid`
- là button
- là check button
- là menu con

Khi click menu tool, runtime gọi:

```js
NUT.runComponent(execname, {
  records,
  parent,
  config,
  checked
})
```

Nếu tool AI muốn mô phỏng menu tool, cần biết `execname` và input context.

## 14. Build grid request

`grid_onRequest()` build query read data.

Nguồn where có thể gồm:

- `gisWhere`
- `menuWhere`
- `whereclause`
- workflow filter
- searchData từ grid/form
- filterfield
- filterclause

Nó cũng xử lý:

- limit
- offset
- orderby
- search operators

AI tool muốn list records giống UI cần dùng cùng các điều kiện này.

## 15. Khi nào dùng metadata này trong chatbot

Chatbot cần metadata window/tab/field khi user hỏi:

- “Màn hình này có những field nào?”
- “Field này lấy dữ liệu từ đâu?”
- “Tại sao tôi không sửa được cột này?”
- “Tạo thêm một field trong tab này được không?”
- “Nút Lưu/Xóa bị ẩn vì sao?”
- “Tab con này liên kết với tab cha thế nào?”

Với câu hỏi hướng dẫn chung, RAG tài liệu user/admin có thể đủ. Với câu hỏi chỉnh sửa runtime hoặc API tool, phải đọc metadata.
