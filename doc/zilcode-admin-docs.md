# Hướng dẫn quản trị Zilcode

## 1. Truy nhập phần mềm

### 1.1 Đăng nhập

- Mở trình duyệt và truy cập: `https://demo.zilcode.com/index.html`
- Điền **Username.SiteCode** và **Password**, bấm **Login**
- SiteCode (mã công ty) được cấp khi mua hoặc đăng ký ZilcodeCloud
- Tích **Remember** để lưu thông tin đăng nhập cho lần sau

### 1.2 Lựa chọn vai trò (Role)

- Nếu người dùng có nhiều hơn một vai trò, phần mềm yêu cầu chọn vai trò trước khi vào
- Chọn **Role System** để sử dụng quyền quản trị

### 1.3 Các ứng dụng hệ thống

Bấm nút công cụ ngoài cùng bên phải trên thanh công cụ để truy cập các ứng dụng hệ thống:

| Ứng dụng | Chức năng |
|---|---|
| **App Builder** | Công cụ chính để tạo và quản lý ứng dụng |
| **SQL Cloud** | Tạo và quản lý bảng/view/mã thực thi trên cloud |
| **Workflow Designer** | Thiết kế và quản lý luồng công việc |
| **HTML Report** | Tạo và quản lý báo cáo HTML |
| **Data Analyst** | Thiết kế và phân tích dữ liệu |
| **Source Editor** | Biên tập chỉnh sửa mã nguồn |

---

## 2. SQL Cloud – Quản lý cơ sở dữ liệu

SQL Cloud giúp quản trị viên tạo và quản lý **bảng dữ liệu**, **view** và **mã thực thi (procedure)** trên dịch vụ đám mây của Zilcode.

- Panel bên trái chia thành 3 nhóm: **TABLES**, **VIEWS**, **PROCEDURES**
- Tìm kiếm đối tượng: nhập ít nhất 2 ký tự vào ô tìm kiếm và bấm **Enter**

---

### 2.1 Bảng dữ liệu (Tables)

#### 2.1.1 Xem và sửa thông tin bảng

Bấm vào tên bảng trong nhóm **TABLES** để xem thông tin:
- Tên bảng, bí danh (alias), dung lượng sử dụng, ngày tạo

**Đổi tên bảng:** Bấm nút chỉnh sửa bên cạnh tên bảng → sửa **Name** và **Alias** → bấm **Ok**

**Thông tin cột (tab Column):**

| Trường | Ý nghĩa |
|---|---|
| ID | Số thứ tự cột |
| Name | Tên cột |
| Alias | Bí danh |
| Data Type | Kiểu dữ liệu |
| Default Value | Giá trị mặc định |
| Length | Độ dài trường |
| Precision | Độ chính xác (chỉ với kiểu số) |
| Nullable | Cho phép rỗng |
| Primary Key | Là khóa chính |
| Identity | Tự tăng (chỉ với khóa chính) |

- **Sửa cột:** Chọn cột → bấm **Edit** (hoặc nhấp đúp) → nhập trực tiếp → bấm **Save**
- **Thêm cột:** Bấm **Add New** → nhập thông tin → bấm **Save**
- **Xóa cột:** Chọn cột → bấm **Delete** → xác nhận **Yes**
- **Xem dữ liệu:** Bấm tab **Data**
- **Sửa dữ liệu:** Chọn dòng → bấm **Edit** → nhập trực tiếp → bấm **Save**
- **Thêm dòng dữ liệu:** Bấm **Add New** → nhập thông tin → bấm **Save**
- **Xóa dòng dữ liệu:** Chọn dòng → bấm **Delete** → xác nhận **Yes**

#### 2.1.2 Tạo bảng mới

Bấm nút **+** bên phải mục TABLES → nhập **Name** và **Alias** → thêm cột bằng **Add New** → bấm **Save**.

> **Lưu ý:** Bảng bắt buộc phải có ít nhất một cột và phải có khóa chính (Primary Key).

#### 2.1.3 Xóa bảng

Bấm nút xóa bên cạnh tên bảng trong panel trái → xác nhận **Yes**.

> **Lưu ý:** Khi xóa bảng, toàn bộ dữ liệu trong bảng cũng bị xóa.

---

### 2.2 View dữ liệu

#### 2.2.1 Xem và sửa thông tin view

Bấm vào tên view trong nhóm **VIEWS** để xem: tên view, bí danh, ngày tạo.

- **Đổi tên view:** Bấm nút chỉnh sửa → sửa **Name** và **Alias** → bấm **Ok**
- **Cột của view:** Liệt kê ở tab **Column** — không thể thay đổi trực tiếp, muốn thay đổi phải sửa script
- **Xem dữ liệu:** Bấm tab **Data** — dữ liệu view là chỉ đọc, không thay đổi được
- **Sửa script view:** Bấm tab **Script** → sửa trực tiếp → bấm nút lưu → xác nhận **Yes**

#### 2.2.2 Tạo view mới

Bấm nút **+** bên phải mục VIEWS → nhập **Name**, **Alias** → viết **Script** → bấm **Save**.

#### 2.2.3 Xóa view

Bấm nút xóa bên cạnh tên view → xác nhận **Yes**.

---

### 2.3 Mã thực thi (Procedure)

#### 2.3.1 Xem và sửa mã thực thi

Bấm vào tên procedure trong nhóm **PROCEDURES** để xem: tên, bí danh, ngày tạo.

- **Đổi tên:** Bấm nút chỉnh sửa → sửa **Name** và **Alias** → bấm **Ok**
- **Xem tham số:** Tab **Parameters**
- **Sửa script:** Bấm tab **Script** → sửa trực tiếp → bấm nút lưu → xác nhận **Yes**

#### 2.3.2 Tạo mã thực thi mới

Bấm nút **+** bên phải mục PROCEDURES → nhập **Name**, **Alias** → viết **Script** → bấm **Save**.

#### 2.3.3 Xóa mã thực thi

Bấm nút xóa bên cạnh tên procedure → xác nhận **Yes**.

---

### 2.4 Truy vấn dữ liệu (Query)

Bấm nút **Query** ở panel bên trái → nhập câu lệnh → bấm **Execute**.

Các câu lệnh được hỗ trợ:

| Lệnh | Chức năng |
|---|---|
| `SELECT` | Truy vấn dữ liệu |
| `INSERT` | Thêm mới dữ liệu |
| `UPDATE` | Cập nhật dữ liệu |
| `DELETE` | Xóa dữ liệu |
| `EXEC` | Chạy mã thực thi (procedure) |

---

## 3. App Builder – Xây dựng ứng dụng

App Builder cho phép quản trị viên tạo ứng dụng nocode và quản lý tất cả thành phần liên quan.

**Các chức năng chính của App Builder:**
- **Site** – Thông tin công ty
- **Data Service** – Khai báo dịch vụ dữ liệu
- **Organization** – Phân cấp tổ chức
- **User** – Người dùng
- **Role** – Vai trò
- **Applications** – Các ứng dụng đã tạo

---

### 3.1 Site – Thông tin công ty

Khi đăng ký ZilcodeCloud, hệ thống cấp một **SiteCode** duy nhất để định danh khách hàng.

**Các thông tin có thể cập nhật trong tab Site:**

| Trường | Ý nghĩa |
|---|---|
| Site Name* | Tên công ty |
| Site Code* | Mã khách hàng |
| Description | Mô tả công ty (hỗ trợ song ngữ) |
| Icon | Ảnh thương hiệu |
| Background | Ảnh nền sau khi đăng nhập |
| Contact | Số điện thoại liên hệ |
| Address | Địa chỉ công ty |
| License | Thông tin bản quyền |

**Cấu hình Organization trong tab Organization:**

| Trường | Ý nghĩa |
|---|---|
| OrgName* | Tên chi nhánh |
| Description | Mô tả chi nhánh |
| Active | Còn hoạt động? |
| ParentID | Chi nhánh cha trong cây phân cấp |
| SeqNo* | Số thứ tự (số thứ tự con phải nhỏ hơn cha) |

> **Lưu ý:** User thuộc Organization nào chỉ được truy cập dữ liệu của Organization đó.

---

### 3.2 Service – Dịch vụ dữ liệu

Service là dịch vụ dữ liệu được cung cấp qua giao thức web. ZilcodeCloud đã cấu hình sẵn dịch vụ **SQLCloud**.

**Các loại ServiceType được hỗ trợ:**

| Loại | Mô tả |
|---|---|
| SQLRest | Dịch vụ Zilcode, dựa trên SQL Server |
| PostgRest | Dịch vụ PostgREST, dựa trên PostgreSQL (đang phát triển) |
| ArcGIS | Dịch vụ bản đồ của Esri |
| Mapbox | Dịch vụ bản đồ Mapbox (đang phát triển) |

**Thông tin khai báo service:**

| Trường | Ý nghĩa |
|---|---|
| ServiceName* | Tên dịch vụ |
| ServiceType* | Loại dịch vụ |
| Description | Mô tả |
| URL* | Đường dẫn URL |
| AccessUser | Tài khoản truy cập |
| AccessPass | Mật khẩu tài khoản |
| SeqNo | Số thứ tự (áp dụng với dịch vụ bản đồ) |
| Credential | Tên cơ sở dữ liệu và không gian dữ liệu (`database.schema`) |

**Import cấu hình bảng:** Chọn service → bấm **ImportTables** → tích chọn bảng cần import → bấm **Ok**.

> **Lưu ý:** Mỗi bảng chỉ cần import cấu hình một lần.

**Cấp quyền SQL Cloud:** Chọn service → bấm **Allow SQLCloud** → xác nhận **Yes**.

---

#### 3.2.1 Table – Bảng dữ liệu

**Cấu hình bảng:**

| Trường | Ý nghĩa |
|---|---|
| TableName* | Tên bảng, dùng cho INSERT/UPDATE/DELETE |
| ViewName | Tên view dùng cho SELECT (nếu khai báo) |
| Alias | Bí danh bảng |
| TableType* | `Table` / `View` / `Relate` (bảng trung gian n-n) |
| URL | Địa chỉ riêng cho bảng (thường dùng với dịch vụ bản đồ) |
| HasAttachment | Cho phép đính kèm file |
| IsReadonly | Chỉ cho phép đọc |
| IsCache | Cache dữ liệu danh mục để tăng tốc tra cứu |
| ArchiveType | `Auto` – tự động lưu trữ khi sửa/xóa; `Manual` – người dùng xác nhận |
| BeforeChange | Plugin thực thi trước khi dữ liệu thay đổi |
| AfterChange | Plugin thực thi sau khi dữ liệu thay đổi |
| MapLayer | Định danh lớp bản đồ (chỉ với dịch vụ bản đồ) |

**Thêm cột còn thiếu:** Chọn bảng → bấm **Add Mis-Columns**.

---

#### 3.2.2 Column – Cột trong bảng

**Cấu hình cột:**

| Trường | Ý nghĩa |
|---|---|
| ColumnName* | Tên cột |
| Alias | Bí danh cột |
| DataType* | Kiểu dữ liệu |
| DefaultValue | Giá trị mặc định khi thêm mới |
| Length | Độ dài tối đa |
| IsNotnull | Không cho phép null |
| ColumnType | Loại cột (xem bảng bên dưới) |
| SeqNo* | Số thứ tự cột |
| DomainID | Giá trị tra cứu từ Domain |
| LinkTableID | Bảng liên kết (khóa ngoại – Foreign Key) |

**Các loại ColumnType:**

| Loại | Ý nghĩa |
|---|---|
| Key | Khóa chính (primary key) |
| Code | Mã tìm kiếm trong form nhập liệu |
| Display | Giá trị hiển thị của danh mục (domain) |
| Find | Cột dùng tìm kiếm trong bản đồ |
| Lock | Quy định bản ghi có cho phép sửa/xóa |
| Tree | Cột liên kết với bản ghi cha (dữ liệu phân cấp) |
| Organization | Mã tổ chức dùng phân quyền dữ liệu |

---

### 3.3 User – Người dùng

**Thông tin người dùng:**

| Trường | Ý nghĩa |
|---|---|
| UserName* | Tài khoản đăng nhập |
| UserCode | Mã người dùng (thường là mã nhân viên) |
| FullName | Tên đầy đủ |
| Password* | Mật khẩu |
| PIN | Số bí mật thay cho mật khẩu (thiết bị bàn phím số) |
| Tag | Thông tin mở rộng |
| Active | Còn hoạt động? (không active = không đăng nhập được) |
| IsViewer | Chỉ được đọc, không được sửa dữ liệu |
| IsSystem | Được dùng ứng dụng hệ thống (AppBuilder, SQL Cloud...) |
| ParentID | Người quản lý trực tiếp |
| Email | Địa chỉ email |
| Phone | Điện thoại |
| Description | Mô tả |

---

### 3.4 Role – Vai trò

Role là nhóm quyền. Một người dùng có thể có nhiều Role.

**Thông tin Role:**

| Trường | Ý nghĩa |
|---|---|
| RoleName* | Tên vai trò |
| Description | Mô tả |
| SeqNo | Thứ tự hiển thị khi chọn vai trò sau đăng nhập |

**Gán người dùng vào Role:** Chọn Role → tab **User** → tích/bỏ tích user.

**Phân quyền trong Role:**

| Quyền | Cách cấu hình |
|---|---|
| Application | Gán ứng dụng được phép dùng |
| Menu | Gán menu được phép truy cập |
| Tool | Gán công cụ trong cửa sổ được phép dùng |
| Access | Giới hạn quyền trên từng bảng dữ liệu |

**Các quyền truy cập bảng (Access):**
- `NoSelect` – không được xem
- `NoInsert` – không được thêm mới
- `NoUpdate` – không được sửa
- `NoDelete` – không được xóa
- `NoExport` – không được export
- `AllowLock` – được phép khóa từng bản ghi
- `AllowArchive` – được phép lưu trữ trước khi sửa

---

### 3.5 Organization – Chi nhánh

Organization dùng để phân cấp chi nhánh trong công ty. Dữ liệu được phân quyền theo Organization — user của chi nhánh nào chỉ truy cập được dữ liệu của chi nhánh đó.

**Gán user vào chi nhánh:** Chọn Organization → bấm nút gán → tích/bỏ tích user.

> **Yêu cầu:** Bảng dữ liệu cần có một cột với `ColumnType = Organization`.

---

### 3.6 Application – Ứng dụng

**Thông tin ứng dụng:**

| Trường | Ý nghĩa |
|---|---|
| AppName* | Tên ứng dụng |
| Translate | Tên dịch sang ngôn ngữ khác |
| Description | Mô tả |
| AppType* | `Application` / `GIS Application` / `Engine` |
| SeqNo | Thứ tự hiển thị trên trang chủ |
| IsSystem | Ứng dụng hệ thống |
| Icon | Ảnh biểu tượng |
| Color | Màu nền |
| Theme | Chủ đề giao diện |
| LinkUrl | Địa chỉ URL (chỉ với Engine) |
| StartExec | Plugin thực thi sau khi ứng dụng khởi chạy |

**Gán Service cho ứng dụng:** Trong tab **Service** → bấm nút gán → tích/bỏ tích service.

**Các thành phần của một ứng dụng nocode:**
- **Window** – Cửa sổ hiển thị và nhập liệu
- **Menu** – Trình đơn chức năng
- **Workflow** – Quy trình
- **Report** – Báo cáo
- **Domain** – Dữ liệu tra cứu

---

#### 3.6.1 Window – Cửa sổ

Window là giao diện chính để người dùng tương tác với dữ liệu (xem, thêm, sửa, xóa, tìm kiếm).

**Thông tin Window:**

| Trường | Ý nghĩa |
|---|---|
| WindowName* | Tên cửa sổ |
| WindowType* | Luôn là `Window` |
| Translate | Tên dịch sang ngôn ngữ khác |
| ExecName | Plugin thực thi sau khi cửa sổ được khởi tạo |
| IsOpenFind | Tự động mở hộp thoại tìm kiếm khi mở cửa sổ |

**Xây dựng tab cho Window:**
1. Chọn Window → bấm **Build Tabs**
2. Chọn bảng chính (**MainTab**) → tích chọn các bảng tab con
3. Bấm **BuildTab**

> **Lưu ý:** Cần cấu hình `LinkTableID` cho các bảng có quan hệ trước khi BuildTab.

**Sau khi cấu hình xong:**
- Bấm **DeployWindow** để đưa vào sử dụng
- Bấm **PreviewWindow** để xem trước
- Bấm **DesignLayout** để thiết kế bố cục

---

##### 3.6.1.1 Tab – Biểu nhập liệu

Tab trình bày dữ liệu của một bảng, gồm nhiều field tương ứng với các cột.

**Thông tin Tab:**

| Trường | Ý nghĩa |
|---|---|
| TabName* | Tên tab |
| Translate | Tên dịch |
| LayoutCols | Số cột bố trí ô nhập liệu (mặc định = 3) |
| LabelSpan | Độ rộng nhãn (mặc định = 6; đặt -1 để nhãn nằm trên ô nhập) |
| TabLevel* | Vị trí hàng của tab trong Window (0 = hàng đầu tiên) |
| SeqNo* | Số thứ tự (tab con phải nhỏ hơn tab cha) |
| ParentTabID | Tab cha trong phân cấp |
| TableID* | Bảng dữ liệu của tab |
| WhereClause | Giới hạn dữ liệu hiển thị |
| OrderBy | Thứ tự sắp xếp dữ liệu |
| FilterFields | Bộ lọc theo cột (domain hoặc bảng cache) |
| FilterClauses | Bộ lọc theo điều kiện WHERE được chuẩn bị sẵn |
| IsViewOnly | Chỉ xem, không sửa |
| WorkflowID | Tab tham gia vào Workflow |
| WindowID* | Cửa sổ chứa tab |

**Liên kết tùy chỉnh giữa các tab:**

| Trường | Ý nghĩa |
|---|---|
| LinkChildField | Trường liên kết bảng con |
| LinkTableID | Bảng liên kết |
| LinkParentField | Trường liên kết bảng cha |
| RelateTableID | Bảng trung gian |
| RelateChildField | Trường liên kết với bảng trung gian con |
| RelateParentField | Trường liên kết với bảng trung gian cha |

**Thêm field còn thiếu:** Bấm **Add Mis-Fields**.

---

##### 3.6.1.2 Field – Trường thông tin

Field là ô nhập liệu tương ứng với một cột trong bảng dữ liệu.

**Thông tin Field:**

| Trường | Ý nghĩa |
|---|---|
| FieldName* | Tên trường (tự động lấy từ alias hoặc tên cột) |
| Translate | Tên dịch |
| ColumnID | Cột bảng dữ liệu tương ứng |
| FieldType* | Loại ô nhập liệu (xem bảng bên dưới) |
| FieldGroup | Nhóm các field (cùng nhóm hiển thị chung) |
| SeqNo* | Thứ tự hiển thị trong tab |
| DefaultValue | Giá trị mặc định khi thêm mới |
| PlaceHolder | Chỉ dẫn nhập liệu |
| Format | Định dạng/pattern kiểm tra dữ liệu nhập |
| IsRequire | Bắt buộc nhập |
| IsReadOnly | Chỉ đọc |
| IsFrozen | Đóng băng cột khi hiển thị dạng lưới |
| HideInGrid | Ẩn khi hiển thị dạng lưới |
| HideInForm | Ẩn khi hiển thị dạng form |
| HideInSearch | Ẩn trong form tìm kiếm |
| FieldLength | Độ dài tối đa cho phép nhập |
| DisplayField | Độ rộng hiển thị (pixel) |
| Calculation | Biểu thức tính giá trị tự động. VD: `[QtyInvoice]*[Price]` |
| DisplayLogic | Biểu thức quy định có hiển thị field hay không. VD: `[tabletype]=="table"` |
| WhereClause | Giới hạn giá trị lựa chọn (dành cho Select và Search) |
| ParentFieldID | Field cha – thay đổi giá trị cha sẽ lọc danh sách field con |
| WhereFieldName | Thay thế columnkey trong câu điều kiện lọc từ field cha |
| BindFieldName | Field con tự nhận giá trị từ field cha dạng Search/Select |

**Các loại FieldType:**

| FieldType | Mô tả |
|---|---|
| Alphanumeric | Chỉ cho phép chữ và số |
| Array | Mảng nhiều giá trị theo thứ tự |
| Checks | Danh sách ô tích |
| Checkbox | Ô tích đơn |
| Color | Ô chọn màu |
| Combo | Ô nhập tự động hoàn thành |
| Currency | Số định dạng tiền tệ |
| Date | Chọn ngày |
| Datetime | Chọn ngày và giờ |
| Email | Định dạng email |
| Enum | Chọn một hoặc nhiều phần tử |
| File | Tải tệp tin (upload) |
| Float | Số thực |
| Hex | Số thập lục phân |
| Html | Văn bản định dạng HTML |
| Int | Số nguyên |
| Map | Giá trị dạng khóa/giá trị (JSON) |
| Password | Mật khẩu |
| Percent | Số dạng phần trăm |
| Radio | Danh sách radio |
| Text | Văn bản ngắn |
| Textarea | Văn bản dài |
| Time | Chọn thời gian |
| Toggle | Bật/tắt (switch) |
| Select | Chọn một giá trị từ domain hoặc bảng liên kết (dữ liệu ít) |
| Search | Tìm kiếm và chọn từ bảng liên kết (dữ liệu nhiều) |
| Point | Tọa độ điểm trên bản đồ |
| Polyline | Tọa độ đường trên bản đồ |
| Polygon | Tọa độ vùng trên bản đồ |

---

##### 3.6.1.3 MenuTool – Công cụ trong Tab

Tool là nút trên thanh công cụ của tab, dùng để mở báo cáo hoặc thực thi plugin.

**Thông tin Tool:**

| Trường | Ý nghĩa |
|---|---|
| MenuName* | Tên tool |
| MenuType* | Luôn là `tool` |
| Translate | Tên dịch |
| ParentID | Tool cha trong cấu trúc menu |
| ExecName | File plugin thực thi khi bấm tool |
| ReportID | Báo cáo hoặc phân tích được gọi |
| SeqNo* | Số thứ tự (tool con lớn hơn tool cha) |
| Icon | Ảnh biểu tượng |
| WindowID* | Cửa sổ chứa tool |

---

#### 3.6.2 Window Layout – Thiết kế bố cục

Theo mặc định, field được bố trí theo số cột `LayoutCols` của tab, từ trái qua phải, trên xuống dưới. Bấm **DesignLayout** để thiết kế tùy chỉnh.

**Tạo lại lưới layout:** Chọn tab → bấm **RecreateLayout** → nhập số cột và số hàng → bấm **Ok**.

**Các thao tác với ô lưới (nhấp chuột phải):**

| Thao tác | Ý nghĩa |
|---|---|
| Merge | Gộp các ô liền kề |
| Unmerge | Bỏ gộp |
| InsertRow | Thêm hàng tại vị trí hiện tại |
| DeleteRow | Xóa hàng tại vị trí hiện tại |
| InsertColumn | Thêm cột tại vị trí hiện tại |
| DeleteColumn | Xóa cột tại vị trí hiện tại |
| InsertGroup | Thêm group (nhập tên, số hàng, số cột) |
| DeleteGroup | Xóa group |

**Kéo thả field:** Kéo field từ panel phải vào ô lưới để sắp xếp vị trí.

**Hiệu chỉnh nội dung layout:** Bấm nút chỉnh sửa trên thanh công cụ để thêm chữ, thay đổi kiểu dáng.

**Lưu:** Bấm **Save** | **Xóa toàn bộ layout:** Bấm **Delete**

---

#### 3.6.3 Menu – Trình đơn

Menu là trình đơn chức năng chính của ứng dụng, có cấu trúc cây cha con.

**Thông tin Menu:**

| Trường | Ý nghĩa |
|---|---|
| MenuName* | Tên menu |
| MenuType* | `Menu` (thông thường) hoặc `ShortCut` (hiển thị ở header) |
| Translate | Tên dịch |
| LinkWindowID | Cửa sổ mở khi bấm menu |
| ReportID | Báo cáo/phân tích mở khi bấm menu |
| ExecName | Plugin thực thi khi bấm menu |
| Icon | Ảnh biểu tượng |
| SeqNo* | Số thứ tự (menu con lớn hơn menu cha) |
| ParentID | Menu cha trong cây phân cấp |
| WhereClause | Giới hạn dữ liệu trong tab đầu tiên của window được mở |
| ShowSummary | Hiển thị số đếm dữ liệu trong tab đầu tiên |
| IsOpen | Cha: expand/collapse; Lá: kích hoạt ngay khi mở ứng dụng |
| MapLayer | Định danh lớp bản đồ |
| Subtype | Lớp con của lớp bản đồ |

---

#### 3.6.4 Domain – Danh mục

Domain là danh sách các giá trị hợp lệ, thường dùng với ô nhập liệu **Select**.

**Thông tin Domain:**

| Trường | Ý nghĩa |
|---|---|
| DomainName* | Tên domain |
| DomainType* | `Text` hoặc `Number` |
| Description | Mô tả |
| Domain* | Nội dung: danh sách `[Value, Display, Color, Lock]` |

**Cấu trúc giá trị domain:** `[Value, Display, Color, Lock]`
- **Value** – Giá trị lưu vào cơ sở dữ liệu
- **Display** – Tên hiển thị
- **Color** – Màu sắc hiển thị
- **Lock** – `0` = cho phép sửa; `1` = không cho phép sửa

---

### 3.7 Application Wizard

Wizard hỗ trợ tạo mới ứng dụng theo trình tự từng bước. Trong cửa sổ Application bấm **AppWizard**.

---

#### Bước 1 – User & Organization

Cấu hình người dùng và tổ chức:
- Chọn user → tích ô kiểm Organization tương ứng để gán
- Bấm **AddUser** để thêm mới người dùng
- Bấm **AddOrganization** để thêm mới chi nhánh

---

#### Bước 2 – Data Service

Cấu hình dịch vụ dữ liệu và bảng dữ liệu:
- Tích/bỏ tích service để gán/bỏ quyền truy xuất cho ứng dụng
- Bấm **AddDataService** để thêm mới dịch vụ dữ liệu
- Chọn service → bấm **ImportTables** để import cấu hình bảng
- Bấm nút chỉnh sửa bên cạnh bảng để sửa đổi cấu hình

---

#### Bước 3 – Domain

Cấu hình danh mục:
- Bấm **AddDomain** để thêm mới danh mục
- Chọn domain → bấm **EditValues** để sửa đổi giá trị

---

#### Bước 4 – Window & Menu

**Cấu hình Window:**
- Bấm tên window trên thanh công cụ để xem layout
- Bấm **AddWindow** để thêm mới cửa sổ
- Bấm nút chỉnh sửa bên cạnh tab để sửa cấu hình tab
- Bấm nút chỉnh sửa bên cạnh nhãn field để sửa cấu hình field

**Công cụ cấu hình Window:**
- **BuildTabs** – Xây dựng tab cho window
- **DesignLayout** – Thiết kế bố cục
- **DeployWindow** – Đưa window vào sử dụng
- **PreviewWindow** – Xem trước

**Cấu hình Menu:**
- Danh sách menu hiển thị ở panel phải
- Bấm **AddMenu** để thêm mới menu

---

#### Bước 5 – Role & Permission

Cấu hình vai trò và phân quyền:
- Tích/bỏ tích Role để dùng/không dùng trong ứng dụng
- Bấm **AddRole** để thêm mới vai trò
- Chọn Role và cấu hình:
  - **User** – Gán/bỏ user khỏi vai trò
  - **Menu** – Gán/bỏ menu khỏi vai trò
  - **Tool** – Gán/bỏ tool khỏi vai trò
  - **Access** – Phân quyền truy nhập bảng dữ liệu (Select, Insert, Update, Delete, Export, Archive, Lock)
