# Hướng dẫn người dùng Zilcode

## 1. Truy nhập phần mềm

### 1.1 Đăng nhập

- Mở trình duyệt và truy cập: `https://demo.zilcode.com/index.html`
- Điền **Username.SiteCode** và **Password**, bấm **Login** để đăng nhập
- SiteCode (mã công ty) được cấp khi mua hoặc đăng ký ZilcodeCloud
- Tích **Remember** để lưu thông tin đăng nhập cho lần sau
- Chọn **Language** để thay đổi ngôn ngữ — hiện hỗ trợ **English** và **Tiếng Việt**
- Chọn **Theme** để thay đổi chủ đề giao diện. Ngoài mặc định, có 4 chủ đề:

| Theme | Mô tả |
|---|---|
| Spect | Sáng, phong cách mặc định |
| Spect-dark | Tối, phong cách Spect |
| Mirage | Sáng, phong cách Mirage |
| Mirage-dark | Tối, phong cách Mirage |

---

### 1.2 Lựa chọn vai trò (Role)

- Nếu người dùng có nhiều hơn một vai trò, phần mềm yêu cầu chọn vai trò trước khi vào
- Chọn **Role** trong danh sách → bấm **Ok**

---

### 1.3 Trang chủ ứng dụng (Desktop)

- Màn hình desktop hiển thị các ô tile tương ứng với các ứng dụng người dùng có quyền truy cập
- Nhấn chuột vào ô tile để mở ứng dụng tương ứng

---

### 1.4 Giao diện ứng dụng

Giao diện một ứng dụng bao gồm các phần:

| Ký hiệu | Thành phần |
|---|---|
| (A) | Tiêu đề ứng dụng (header) |
| (B) | Trình đơn chính (menu) |
| (C) | Cửa sổ thông tin (window) |
| (D) | Bản đồ (nếu là ứng dụng GIS) |

Nhấn chuột vào mục trên menu chính để mở cửa sổ (window) tương ứng.

---

## 2. Tiêu đề ứng dụng (Header)

Tiêu đề ứng dụng hiển thị tên và mô tả ứng dụng đang mở ở bên trái. Bên phải là các chức năng:

- **Home** — Vào trang chủ (desktop) của ứng dụng
- **Notification** — Các thông báo gửi đến người dùng (chỉ dùng với Workflow)
- **Information** — Thông tin người dùng, bao gồm:
  - **Profile** — Thông tin cá nhân cơ bản (Username, Fullname, Organization, Email)
  - **Change Password** — Đổi mật khẩu: nhập mật khẩu cũ → mật khẩu mới → xác nhận → bấm **Ok**
  - **Logout** — Đăng xuất khỏi phần mềm
- **Mở ứng dụng** — Mở nhanh các ứng dụng khác

---

## 3. Làm việc với cửa sổ (Window)

### 3.1 Cửa sổ thông tin

Cửa sổ thông tin là nơi người dùng làm việc với dữ liệu. Một cửa sổ có thể có một hoặc nhiều tab, mỗi tab tương ứng với một bảng dữ liệu.

| Ký hiệu | Thành phần |
|---|---|
| (1) | Tiêu đề cửa sổ (title) |
| (2) | Các tab (có thể trên nhiều hàng) |
| (3) | Thanh công cụ (trên từng tab) |
| (A) | Hiển thị dạng lưới (grid) |
| (B) | Hiển thị dạng biểu (form) |

**Quan hệ cha – con giữa các tab:** Khi chọn dữ liệu trên tab cha, các tab con chỉ hiển thị dữ liệu liên quan đến bản ghi cha đang chọn.

Trong mỗi tab, dữ liệu có hai kiểu hiển thị: **dạng lưới (grid)** và **dạng biểu (form)**.

---

### 3.2 Thanh công cụ

Thanh công cụ là nơi thực hiện các thao tác chính với dữ liệu:

| Nút | Phím tắt | Chức năng |
|---|---|---|
| Switch | F10 | Chuyển đổi hiển thị grid/form |
| Refresh | F5 | Làm tươi dữ liệu |
| Tree | — | Hiển thị lưới theo cây phân cấp (chỉ với bảng có cấu hình cột Tree) |
| Find | F3 | Tìm kiếm dữ liệu |
| AddNew | F2 | Thêm mới dữ liệu |
| Save | F6 | Lưu sửa đổi |
| Delete | F8 | Xóa dữ liệu |
| Attach | F7 | Đính kèm file (chỉ với bảng HasAttachment) |
| Link | F9 | Liên kết dữ liệu nhiều-nhiều |
| Lock | F4 | Khóa/bỏ khóa dữ liệu (chỉ với người dùng có quyền Lock) |
| Archive | — | Xem lịch sử chỉnh sửa (chỉ với bảng cấu hình lưu lịch sử) |
| Previous | F11 | Về bản ghi trước |
| Next | F12 | Lên bản ghi sau |
| Import | — | Nhập dữ liệu từ Excel |
| Export | — | Xuất dữ liệu ra Excel |
| Expand | — | Mở rộng/thu hẹp tab |

---

### 3.3 Tìm kiếm dữ liệu

Bấm nút **Find** (F3) trên thanh công cụ để tìm kiếm:

1. Nhập giá trị cần tìm vào ô nhập liệu → bấm **Find**
2. Với dữ liệu dạng text: dùng ký tự `%` để tìm gần đúng (ví dụ: `Nguy%` tìm tất cả bắt đầu bằng "Nguy")

**Tìm kiếm nâng cao (Advanced Search):**
- Bấm **Advance** để mở hộp thoại tìm kiếm kết hợp nhiều điều kiện
- Chọn **All (AND)** — tất cả điều kiện phải thỏa mãn
- Chọn **Any (OR)** — chỉ cần một điều kiện thỏa mãn
- Bấm **Search** để thực hiện tìm kiếm kết hợp
- Bấm **Reset** để bỏ điều kiện tìm kiếm, hiển thị tất cả dữ liệu

Kết quả hiển thị trong cửa sổ dưới dạng lưới (grid).

---

### 3.4 Thêm mới dữ liệu

1. Bấm nút **AddNew** (F2) trên thanh công cụ
2. Cửa sổ thêm mới mở ra — nhập thông tin vào các ô
3. Các ô có dấu `*` là trường **bắt buộc** phải nhập
4. Bấm **AddNew** trong cửa sổ để lưu dữ liệu mới

---

### 3.5 Liên kết dữ liệu (quan hệ nhiều-nhiều)

Dùng khi muốn liên kết một dữ liệu đã có với dữ liệu ở tab cha (quan hệ nhiều-nhiều):

1. Bấm nút **Link** (F9) trên thanh công cụ
2. Tích chọn dữ liệu cần liên kết / bỏ tích để bỏ liên kết

---

### 3.6 Sửa đổi dữ liệu

Dữ liệu có thể sửa trực tiếp trên **lưới (grid)** hoặc **biểu (form)**:

- Bấm nút **Switch** (F10) để chuyển đổi giữa hai chế độ hiển thị
- Trên **grid**: nhấp đúp vào ô cần sửa → nhập giá trị mới
- Trên **form**: sửa trực tiếp vào ô nhập liệu
- Sau khi sửa xong bấm **Save** (F6) để lưu

---

### 3.7 Xóa dữ liệu

1. Chọn một hoặc nhiều dòng dữ liệu cần xóa
2. Bấm nút **Delete** (F8) trên thanh công cụ
3. Bấm **Yes** để xác nhận xóa

---

### 3.8 Đính kèm file

Chỉ áp dụng với bảng dữ liệu được cấu hình `HasAttachment = true`.

1. Chọn bản ghi → bấm nút **Attach** (F7)
2. Trong cửa sổ Attach:
   - Bấm nút **thư mục** để tạo thư mục mới
   - Bấm nút **upload** để tải file lên
   - Bấm **Preview** để xem file trong tab mới của trình duyệt
   - Với file text: nội dung hiển thị ở panel phải, có thể chỉnh sửa trực tiếp → bấm **Save**
   - Với file không phải text: bấm **Download** để tải về
   - Bấm nút **–** bên cạnh file → xác nhận **Yes** để xóa file đính kèm

---

### 3.9 Khóa dữ liệu (Lock)

Chức năng khóa/bỏ khóa dữ liệu phụ thuộc vào cột khóa (`ColumnLock`).

- Khi cột khóa = `true` → dữ liệu **không thể sửa hoặc xóa** (ví dụ: đơn hàng đã phê duyệt, số liệu kế toán đã chốt)
- Chỉ người dùng được phân quyền **Lock** trên bảng dữ liệu mới thực hiện được

**Cách khóa/bỏ khóa:**
1. Chọn bản ghi → bấm nút **Lock** (F4)
2. Bấm **Yes** để xác nhận

---

### 3.10 Lịch sử chỉnh sửa (Archive)

Chỉ áp dụng với bảng dữ liệu được cấu hình cho phép lưu lịch sử.

**Hai cơ chế lưu lịch sử:**

| Cơ chế | Mô tả |
|---|---|
| Auto | Tự động lưu lịch sử mỗi khi người dùng sửa đổi dữ liệu |
| Manual | Người dùng tự chọn: **Save** (không lưu) hoặc **Save & Archive** (có lưu); tương tự với **Delete** / **Delete & Archive** |

**Xem lịch sử:**
1. Chọn bản ghi → bấm nút **Archive** trên thanh công cụ
2. Chọn loại lịch sử:
   - **Archive** — Xem lịch sử sửa đổi của bản ghi đang chọn (liệt kê theo thời gian giảm dần)
   - **Archive of Deletes** — Xem lịch sử bản ghi đã bị xóa (liệt kê theo thời gian giảm dần)

---

### 3.11 Import dữ liệu

1. Bấm nút **Import** trên thanh công cụ
2. Copy dữ liệu từ file Excel → dán vào ô nhập trong cửa sổ Import (các cột phải tương ứng với các cột được gợi ý)
3. Chọn hành động:
   - **Update** — Sửa đổi dữ liệu dựa theo cột khóa chính (Primary Key)
   - **AddNew** — Thêm mới dữ liệu

---

### 3.12 Export dữ liệu

1. Bấm nút **Export** trên thanh công cụ
2. Nhập **Offset** (số bản ghi bỏ qua) và **Limit** (số lượng bản ghi muốn export)
3. Bấm **Ok** để xuất dữ liệu
4. Bấm **CopyToExcel** để copy toàn bộ nội dung bảng vào clipboard → có thể dán thẳng vào Excel
