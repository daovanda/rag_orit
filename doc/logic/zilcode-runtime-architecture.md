# Kiến trúc runtime Zilcode

MODEL CONTROL INSTRUCTIONS:

- Dùng file này để hiểu runtime flow của Zilcode từ login, chọn role/org, mở app, tải metadata, dựng window, load dữ liệu và thực hiện action.
- Phân biệt metadata tĩnh của app với state động của phiên người dùng.
- Nếu câu hỏi phụ thuộc màn hình hiện tại, lấy runtime context trước khi trả lời chắc chắn.
- Nếu câu hỏi chỉ là hướng dẫn chung, dùng RAG mà không cần gọi tool runtime.
- Nếu người dùng yêu cầu chỉnh sửa, chuyển sang flow: read context -> read metadata -> preview -> confirm -> apply -> verify.

Tài liệu này mô tả cách Zilcode hoạt động ở mức runtime: đăng nhập, chọn role/organization, mở application, tải metadata, dựng giao diện động và thao tác dữ liệu.

Mục tiêu của tài liệu là tạo nền tảng chung để hệ thống RAG, người phát triển và các tool AI hiểu cách Zilcode vận hành trước khi thực hiện thao tác đọc hoặc ghi dữ liệu.

## 1. Tổng quan runtime

Zilcode là một nền tảng web nocode/dynamic app runtime. Giao diện không được viết cứng cho từng bảng nghiệp vụ. Thay vào đó, frontend tải metadata từ backend rồi dựng ứng dụng động.

Luồng tổng quát:

1. Người dùng mở `index.html`.
2. `js/index.js` hiển thị form đăng nhập.
3. Sau khi đăng nhập, backend trả user, token, roles, orgs, apps và quyền truy cập.
4. Người dùng chọn role/organization nếu có nhiều lựa chọn.
5. Zilcode mở desktop và danh sách application.
6. Khi mở application, frontend gọi API lấy metadata của app.
7. Metadata được nạp vào các object runtime như `NUT.tables`, `NUT.domains`, `NUT.services`, `NUT.workflows`.
8. Khi người dùng click menu/window, frontend tải cache window nếu cần.
9. `NUT.configWindow()` chuyển config dạng mảng thành object có cấu trúc.
10. `NWin.buildWindow()` dựng UI gồm tab, grid, form, toolbar, field, menu tool.
11. CRUD dữ liệu được thực hiện qua REST API bằng `SqlREST`.

## 2. Các object runtime chính

### `n$`

`n$` là object global chứa trạng thái phiên hiện tại:

- `user`: thông tin người dùng đăng nhập.
- `winid`: window/tab đang active.
- `app`: application hiện tại.
- `locale`: ngôn ngữ hiện tại.
- `workflow`: workflow hiện tại nếu có.
- `BASE`: base URL backend.

Các hàm tiện ích trong `n$`:

- `now()`
- `nowTime()`
- `nowDate()`
- `nowMonth()`
- `nowYear()`
- `myLocate()`

### `NUT`

`NUT` là namespace runtime chính của Zilcode. Nó giữ cấu hình, cache metadata, service API, UI helper và các module đang chạy.

Các URL chính:

- `NUT.URL`: `BASE + "rest/daiviet_nut/dbo/data/"`
- `NUT.URL_DB`: `BASE + "rest/daiviet_nut/dbo/"`
- `NUT.URL_UPLOAD`: `BASE + "rest/upload/"`
- `NUT.URL_SOURCE`: `BASE + "rest/source/"`
- `NUT.URL_TOKEN`: `BASE + "rest/token/"`
- `NUT.URL_PROXY`: `BASE + "rest/proxy?"`

Các cache runtime quan trọng:

- `NUT.apps`: danh sách application user được phép dùng.
- `NUT.access`: quyền truy cập theo table.
- `NUT.domains`: các domain/list dùng cho field select/list.
- `NUT.dmlinks`: cache dữ liệu lookup từ bảng liên kết.
- `NUT.tables`: metadata bảng dữ liệu.
- `NUT.workflows`: workflow steps đã load.
- `NUT.relates`: quan hệ nhiều-nhiều giữa các bảng.
- `NUT.services`: danh sách service backend như sqlrest, arcgis, basemap.
- `NUT.windows`: cache window config đã parse.

## 3. Đăng nhập và chọn role/organization

Luồng đăng nhập:

1. Form login gồm `username`, `sitecode`, `password`, `savepass`.
2. Frontend gọi `NUT.URL_TOKEN` bằng method `POST`.
3. Nếu thành công, backend trả object user gồm token, site info, roles, orgs, apps, notifies.
4. Token được gán vào `SqlREST.token = "Bearer " + n$.user.token`.
5. Nếu user chỉ có một role và tối đa một org, hệ thống tự chọn role/org.
6. Nếu có nhiều role/org, frontend hiển thị form chọn role và chi nhánh.
7. Khi role/org được chọn, frontend gọi `NUT.URL_TOKEN + "roleorg"` bằng method `PUT`.
8. Backend trả:
   - `access`
   - `apps`
   - `notifies`
9. Sau đó gọi `openDesktop()`.

Ý nghĩa:

- Role và organization là một phần của security context.
- Cùng một user có thể có nhiều role/org.
- Quyền UI/CRUD phụ thuộc vào `NUT.access`.
- Tool AI muốn thao tác thay user phải có token và context role/org chính xác.

## 4. Desktop và application

Sau khi login, `openDesktop()` dựng layout chính:

- top panel: logo, site/org name, notification, user menu, apps button.
- left panel: menu application.
- main panel: desktop hoặc content app.
- right/bottom panel: dùng cho GIS hoặc phụ trợ.

Khi mở application, hàm `openApp(id)` thực hiện:

1. Gán `n$.app = NUT.apps[id]`.
2. Nếu app type là `engine`, mở external engine bằng `window.open()`.
3. Nếu app thường, gọi `NUT.URL_TOKEN + "app/" + id`.
4. Backend trả metadata app gồm:
   - domains
   - services
   - relates
   - tables
   - wfsteps
   - wfusers
   - roles
   - menus
5. Frontend build `NUT.domains`, `NUT.tables`, `NUT.services`, `NUT.workflows`.
6. Frontend build menu tree và shortcut toolbar.
7. Nếu menu có `isopen`, tự mở window tương ứng.

## 5. Menu và window

Menu có thể trỏ đến:

- một window theo ID (`linkwindowid`)
- một component JS (`execname`)
- một report (`reportid`)
- một URL/file
- một node cha chứa các menu con

Khi click menu, `menu_onClick(evt)` xử lý:

- Nếu `tag` là số nguyên: đây là window ID.
- Nếu window đã có trong `NUT.windows`, dùng cache đó.
- Nếu chưa có, gọi `NUT.URL_TOKEN + "cache/" + windowId`.
- Cache trả về `configjson` và có thể có `layoutjson`.
- `NUT.configWindow()` parse config.
- `NWin.buildWindow()` dựng UI.

Nếu menu có `whereclause`, điều kiện này được đưa vào tab chính như `menuWhere`.

Nếu menu có `newTab`, thay vì mở grid, hệ thống mở dialog thêm mới record cho tab đó.

## 6. Dynamic window rendering

`NWin.buildWindow()` dựng một window từ config đã parse. Một window gồm:

- một hoặc nhiều tab cấp 0
- tab con nhiều cấp
- grid
- form
- toolbar
- field
- menu tool

`NWin.buildContent()` tạo:

- w2grid để hiển thị records
- w2form để hiển thị/chỉnh sửa record
- toolbar CRUD
- search fields
- domain rendering
- relation/link controls
- workflow controls nếu tab gắn `workflowid`

UI không biết trước schema cụ thể của nghiệp vụ. Mọi thứ phụ thuộc vào metadata bảng, tab và field.

## 7. CRUD dữ liệu

CRUD dữ liệu chính dùng `SqlREST`:

- `select`: GET data.
- `insert`: POST data.
- `update`: PUT data.
- `delete`: DELETE data.
- `get`: gọi API tự do với method tùy chọn.
- `post`: upload form data hoặc binary.

CRUD record thông thường:

- Thêm mới: `NWin.showNewDialog()`, sau đó `NUT.ds.insert()`.
- Sửa: `NWin.saveEditData()`, sau đó `NUT.ds.update()`.
- Xóa: toolbar `DEL`, sau đó `NUT.ds.delete()`.
- Import: `NUT.importXls()` rồi insert/update hàng loạt.
- Export: `NUT.exportXls()` rồi select dữ liệu.

## 8. Quyền và trạng thái view-only

Một tab/window có thể bị khóa chỉnh sửa bởi nhiều lớp:

- `n$.user.isviewer`
- `conf.table.isreadonly`
- `conf.isviewonly`
- quyền trong `NUT.access[table.tablename]`
- field `isreadonly`
- tab flags như `noinsert`, `noupdate`, `nodelete`, `noselect`, `noexport`

Frontend chỉ hiện nút New/Save/Delete/Import/Export nếu quyền cho phép. Khi thiết kế tool AI, backend tool cũng phải kiểm tra quyền tương tự, không chỉ dựa vào model.

## 9. Workflow runtime

Workflow liên quan đến:

- `n_workflow`
- `n_wfstep`
- `n_wfflow`

Khi app được load, backend trả `wfsteps`. Frontend gom các step theo `workflowid` và mapping theo:

- `elementid`
- `stepid`
- `0` cho StartEvent

Nếu tab có `workflowid`, form mặc định có thể nhận:

- `status`
- `roleid`
- `userid`
- `stepid`

Workflow Manager ở `bpmnwf/index.js` cho phép tạo/sửa BPMN, lưu workflow và đồng bộ steps vào `n_wfstep`.

## 10. Engine apps

Một số application là engine app, mở ở cửa sổ riêng:

- SQL Cloud: quản lý database/table/view/procedure/query.
- Workflow Manager: thiết kế workflow BPMN.
- Source Editor: quản lý file source/site.
- Datarock/HTML Report: báo cáo, pivot, biểu đồ.

Các engine app vẫn dùng token hiện tại qua query string và dùng `SqlREST`.

## 11. Kết luận cho chatbot/tool

Để chatbot chỉnh sửa trực tiếp trong Zilcode, model cần hiểu:

- user đang ở app nào
- window nào đang mở
- tab nào đang active
- table nào được tab sử dụng
- record nào đang được chọn
- field nào cần sửa
- quyền của user với table/field
- service type của table là sqlrest hay arcgis
- có workflow/archive/beforechange/afterchange hay không

Không nên cho model gọi API thô khi thiếu các thông tin trên. Tool cần lấy context hiện tại, đọc metadata, tạo kế hoạch, xác nhận với user, rồi mới write.
