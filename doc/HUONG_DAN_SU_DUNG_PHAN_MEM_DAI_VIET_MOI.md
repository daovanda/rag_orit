# HƯỚNG DẪN SỬ DỤNG PHẦN MỀM QUẢN LÝ SẢN XUẤT NHỰA ĐẠI VIỆT

— biên soạn lại chi tiết từ tài liệu hướng dẫn, bao quát toàn bộ các phân hệ của phần mềm: Công thức, Kế hoạch trộn/đùn, Đơn hàng — Khách hàng, Trộn, Đùn (ECO & FOAM), In, Dán, Đóng gói (ECO & FOAM), Nhập/Xuất kho thành phẩm, Kế hoạch sản xuất tổng thể, Báo cáo, Dashboard và phân quyền sử dụng.

---

## MỤC LỤC

1. [Giới thiệu phần mềm](#1-giới-thiệu-phần-mềm)
2. [Đăng nhập hệ thống](#2-đăng-nhập-hệ-thống)
3. [Các chức năng dùng chung trên phần mềm](#3-các-chức-năng-dùng-chung-trên-phần-mềm)
   - [3.1. Lịch sử ca làm việc của tôi](#31-lịch-sử-ca-làm-việc-của-tôi)
   - [3.2. Nhập dữ liệu từ Excel](#32-nhập-dữ-liệu-từ-excel)
   - [3.3. Xuất dữ liệu ra Excel](#33-xuất-dữ-liệu-ra-excel)
   - [3.4. Chốt dữ liệu](#34-chốt-dữ-liệu)
   - [3.5. In báo cáo / nhật ký](#35-in-báo-cáo--nhật-ký)
   - [3.6. Sửa, xóa thông tin](#36-sửa-xóa-thông-tin)
4. [Bộ phận Công thức](#4-bộ-phận-công-thức)
5. [Bộ phận Kế hoạch trộn / đùn](#5-bộ-phận-kế-hoạch-trộn--đùn)
6. [Bộ phận Trộn](#6-bộ-phận-trộn)
7. [Đơn hàng — Khách hàng (Foam)](#7-đơn-hàng--khách-hàng-foam)
8. [Bộ phận Đùn (ECO)](#8-bộ-phận-đùn-eco)
9. [Bộ phận Đùn (FOAM)](#9-bộ-phận-đùn-foam)
10. [Bộ phận In](#10-bộ-phận-in)
11. [Bộ phận Dán](#11-bộ-phận-dán)
12. [Bộ phận Đóng gói (ECO)](#12-bộ-phận-đóng-gói-eco)
13. [Bộ phận Đóng gói (FOAM)](#13-bộ-phận-đóng-gói-foam)
14. [Bộ phận Nhập kho](#14-bộ-phận-nhập-kho)
15. [Bộ phận Xuất kho](#15-bộ-phận-xuất-kho)
16. [Bộ phận Kế hoạch sản xuất (Quản lý tổng thể)](#16-bộ-phận-kế-hoạch-sản-xuất-quản-lý-tổng-thể)
17. [Quyền hạn sử dụng chức năng của các bộ phận](#17-quyền-hạn-sử-dụng-chức-năng-của-các-bộ-phận)

---

## 1. GIỚI THIỆU PHẦN MỀM

**Định hướng và giá trị sử dụng của Phần mềm Đại Việt:**

- Hỗ trợ quản lý và theo dõi toàn bộ hoạt động sản xuất của nhà máy.
- Giúp người dùng thực hiện các nghiệp vụ sản xuất nhanh chóng, chính xác và thuận tiện hơn.
- Thông qua việc số hóa dữ liệu và quy trình làm việc, phần mềm giúp giảm thao tác thủ công, hạn chế sai sót, nâng cao hiệu quả quản lý và tối ưu năng suất sản xuất.

Phần mềm bao quát toàn bộ chuỗi sản xuất — từ khai báo công thức, lập kế hoạch, quản lý đơn hàng/khách hàng, đến từng công đoạn sản xuất thực tế (Trộn, Đùn, In, Dán, Đóng gói) trên **cả hai dòng sản phẩm ECO và FOAM**, và khép lại ở khâu nhập/xuất kho thành phẩm, báo cáo, dashboard tổng hợp.

![Trang bìa tài liệu](media2/page-01.jpg)

---

## 2. ĐĂNG NHẬP HỆ THỐNG

Người dùng truy cập vào trang web theo đường link:
**`https://dvnb.zilcode.vn/index.html`**

**Thông tin ô nhập dữ liệu trên màn hình đăng nhập:**

1. Ô nhập tên **"Người dùng"**.
2. Ô nhập **"Mật khẩu"**.
3. Site code của phần mềm là **"dvnb"**. *Ví dụ: `tpdun.dvnb` cho bộ phận đùn.*
4. Click **đăng nhập**.

**Đăng xuất tài khoản:**

5. Chọn biểu tượng hồ sơ (góc màn hình).
6. Click **đăng xuất**.

![Màn hình đăng nhập](media2/page-03.jpg)

---

## 3. CÁC CHỨC NĂNG DÙNG CHUNG TRÊN PHẦN MỀM

Các chức năng dưới đây được sử dụng lặp lại ở **hầu hết mọi phân hệ** của phần mềm (Công thức, Kế hoạch, Nhật ký sản xuất, Kho, Đơn hàng, Báo cáo...). Nắm vững 6 chức năng nền tảng này giúp người dùng thao tác thành thạo trên toàn bộ hệ thống.

### 3.1. Lịch sử ca làm việc của tôi

**Mục đích:** Theo dõi danh sách dữ liệu đã được tạo trong hệ thống, hỗ trợ xem thông tin chi tiết, kiểm tra và truy xuất dữ liệu khi cần.

**Chức năng:**
- Hiển thị danh sách các dữ liệu (công thức, nhật ký...) đã tạo.
- Xem thông tin chi tiết của từng mục.
- Kiểm tra thành phần nguyên vật liệu và định mức liên quan.

**Các bước thực hiện:**
`Chọn mục dữ liệu cần xem` → `Phần mềm hiển thị danh sách dữ liệu đã được tạo` → `Chọn dữ liệu cần xem` → `Nhấn "Chi tiết" để xem thông tin`

![Lịch sử ca làm việc của tôi](media2/page-47.jpg)

### 3.2. Nhập dữ liệu từ Excel

**Mục đích:** Nhập dữ liệu từ tệp Excel vào phần mềm nhằm bổ sung hoặc cập nhật dữ liệu, giúp giảm thời gian nhập liệu thủ công và đảm bảo tính chính xác của thông tin.

Khi mở cửa sổ **Nhập dữ liệu**, hệ thống sẽ hiển thị danh sách dữ liệu được đọc từ tệp Excel.

**Các bước thực hiện:**
`Nhấn vào biểu tượng "Nhập dữ liệu" trên thanh công cụ` → `Nhập/dán dữ liệu từ Excel vào ô cửa sổ` → `Nhấn "Thêm mới" để nhập dữ liệu vào hệ thống`

![Nhập dữ liệu từ Excel](media2/page-48.jpg)

### 3.3. Xuất dữ liệu ra Excel

**Mục đích:** Xuất dữ liệu ra tệp Excel nhằm phục vụ thống kê, báo cáo, lưu trữ và chia sẻ thông tin khi cần.

Cửa sổ **Xuất dữ liệu** cho phép thiết lập:
- **Đến dòng:** xác định số lượng dòng dữ liệu cần xuất.
- **Bỏ qua dòng:** xác định số dòng đầu tiên không xuất trong tệp Excel.

**Các bước thực hiện:**
`Chọn biểu tượng gửi` → `Click "Chấp nhận" để xuất dữ liệu` → `Chọn "Copy to Excel" để tải file Excel`

![Xuất dữ liệu ra Excel](media2/page-49.jpg)

### 3.4. Chốt dữ liệu

**Mục đích:** Xác nhận và chốt dữ liệu sản xuất sau khi hoàn tất, làm căn cứ để các bộ phận triển khai sản xuất theo đúng quy trình.

**Thông tin cần nhập trước khi gửi dữ liệu đi:**

| Trường | Mô tả |
|---|---|
| Kế tiếp | Chọn bộ phận nhận dữ liệu |
| Người dùng | Người gửi dữ liệu |

**Các bước thực hiện:**
`Click vào biểu tượng gửi` → `Nhập thông tin người gửi` → `Click vào nút "Gửi"`

**Lưu ý:**
- Các dấu **(\*)** xuất hiện đầu ô nhập dữ liệu là trường bắt buộc phải điền.
- Sau khi dữ liệu đã **chốt và gửi đi** thì **không thể chỉnh sửa** thông tin đã nhập trước đó.

![Chốt dữ liệu](media2/page-50.jpg)

### 3.5. In báo cáo / nhật ký

**Mục đích:** In nhật ký (ví dụ minh họa: nhật ký trộn) phục vụ lưu trữ, kiểm tra, đối chiếu và xác nhận kết quả thực hiện công đoạn sản xuất.

**Thông tin chi tiết trên bản in bao gồm:** Số mẻ, Khối lượng đổ, Phân loại nguyên liệu, Số bao, Khối lượng từng nguyên liệu, Ghi chú.

**Chức năng:**
- Hiển thị danh sách các công thức/dữ liệu đã sản xuất.
- Xem thông tin chi tiết của từng sản phẩm.
- Kiểm tra thành phần nguyên vật liệu và định mức của công thức.

**Báo cáo theo ngày — các bước thực hiện:**
`Trỏ vào 1 dòng dữ liệu → chọn "In nhật ký"` → `Chọn "Báo cáo tổ trộn"` → `Chọn ngày lấy dữ liệu` → `Nhấn "Chấp nhận"` → `Kiểm tra bản in` → `In nhật ký` hoặc `Xuất Excel`

![In báo cáo / nhật ký](media2/page-51.jpg)

### 3.6. Sửa, xóa thông tin

**Mục đích:** Cho phép người dùng cập nhật hoặc xóa dữ liệu đã tạo trên hệ thống nhằm đảm bảo thông tin luôn chính xác, đầy đủ và phù hợp với quá trình quản lý sản xuất.

**Chỉnh sửa thông tin:**
1. Chọn dòng dữ liệu cần chỉnh sửa.
2. Nhấn chuyển đổi cấu hình.
3. Cập nhật thông tin cần thay đổi.
4. Nhấn **Lưu** để hoàn tất.

**Xóa thông tin:**
1. Chọn dòng dữ liệu cần xóa.
2. Nhấn **Xóa**.
3. Thông báo xóa hiển thị.
4. Xác nhận thao tác xóa.

![Sửa, xóa thông tin](media2/page-52.jpg)

---

## 4. BỘ PHẬN CÔNG THỨC

**Mục đích:**
- Khai báo và quản lý công thức sản xuất.
- Thiết lập tỷ lệ nguyên vật liệu cho từng sản phẩm.
- Làm dữ liệu đầu vào cho kế hoạch sản xuất và các công đoạn sản xuất tiếp theo.
- Theo dõi, chỉnh sửa và lưu trữ các phiên bản công thức.

**Đơn vị phụ trách:** Tổ công thức.

**Quy trình tổng quan:**
`Lên danh sách tên nguyên liệu` → `Tạo công thức mới` → `Nhập thông tin công thức` → `Thêm nguyên liệu cần sử dụng` → `Mở chi tiết công thức` → `Hoàn thành công đoạn thêm nguyên liệu mới`

![Bộ phận Công thức — Tổng quan](media2/page-04.jpg)

### 4.1. Danh sách nguyên liệu

**Thông tin cần nhập khi thêm danh sách nguyên liệu:**

| Trường | Ghi chú |
|---|---|
| Tên nguyên liệu | |
| Chọn phân loại nguyên liệu | |
| Đơn vị tính | |
| Định mức bao/kg | |
| Nhà cung cấp | |

**Các bước thực hiện:**
`Chọn mục "Nguyên liệu"` → `Chọn "Thêm mới"` → `Nhập thông tin nguyên liệu` → `Click "Thêm mới" để hoàn thành`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải điền thông tin.

![Danh sách nguyên liệu](media2/page-05.jpg)

### 4.2. Thêm công thức

**Mục đích:** Tạo mới công thức phối trộn nguyên vật liệu phục vụ sản xuất, làm cơ sở để lập kế hoạch trộn và đảm bảo sản phẩm được sản xuất đúng thành phần, đúng định mức.

**Thông tin cần nhập khi thêm công thức:**

| Trường | Ghi chú |
|---|---|
| Ngày tạo | |
| Tên người tạo | |
| Mã công thức trộn | |
| Phiên bản | |
| Khối lượng | |
| Trạng thái | |

**Nhập chi tiết công thức:** Chọn phân loại nguyên liệu, Tên nguyên liệu, Khối lượng.

**Các bước thực hiện:**
`Chọn mục "Thêm công thức mới"` → `Nhấn "Thêm mới"` → `Nhập thông tin công thức` → `Lưu công thức` → `Chọn "Chi tiết công thức"` → `Nhập thông tin nguyên liệu` → `Lưu chi tiết công thức`

**Lưu ý:**
- Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải điền thông tin.
- **Khóa công thức** (các công thức khóa là trạng thái đã sử dụng).

![Thêm công thức](media2/page-06.jpg)

---

## 5. BỘ PHẬN KẾ HOẠCH TRỘN / ĐÙN

**Mục đích:**
- Lập kế hoạch trộn, máy đùn cho quy trình sản xuất.
- Phân bổ công thức, nguyên vật liệu, máy đùn, mã sản xuất cho từng sản lượng.
- Làm căn cứ để bộ phận Trộn thực hiện sản xuất.

**Đơn vị phụ trách:** Kế hoạch sản xuất.

**Quy trình tổng quan:**
`Nhập định mức máy trộn/đùn` → `Tạo kế hoạch sản xuất` → `Nhập thông tin chi tiết kế hoạch` → `Chốt kế hoạch` → `In phiếu xuất kho` → `Chuyển kế hoạch lên trên quản lý sản xuất`

![Kế hoạch sản xuất — Tổng quan](media2/page-07.jpg)

### 5.1. Định mức máy trộn

**Mục đích:** Thiết lập định mức vận hành tiêu chuẩn cho từng máy trộn và lập kế hoạch trộn phù hợp với hiệu suất của từng máy.

**Thông tin cần nhập khi thêm:** Tên máy trộn, Định mức máy trộn, Khối lượng trộn (Định mức trộn/mẻ), Khối lượng máy (Định mức máy trộn), Định mức phụ gia, Tên phụ gia, Tên màu.

**Các bước thực hiện:**
`Chọn mục "Máy trộn"` → `Chọn "Thêm mới"` → `Nhập thông tin máy trộn` → `Click "Thêm mới" để hoàn thành`

![Định mức máy trộn](media2/page-08.jpg)

### 5.2. Định mức máy đùn

**Mục đích:** Thiết lập định mức vận hành tiêu chuẩn cho từng máy đùn nhằm phục vụ việc lập kế hoạch sản xuất, tính toán năng suất và kiểm soát sản lượng thực tế.

**Thông tin cần nhập khi thêm:** Tên máy đùn, Khối lượng máy định mức, Khổ, Khối lượng khổ.

**Các bước thực hiện:**
`Chọn mục "Máy đùn"` → `Click biểu tượng thêm mới` → `Nhập thông tin máy đùn` → `Click "Thêm mới" để hoàn thành`

![Định mức máy đùn](media2/page-09.jpg)

### 5.3. Tạo kế hoạch

**Mục đích:** Lập kế hoạch trộn quy trình sản xuất, xác định công thức, số mẻ, máy trộn/đùn và thời gian thực hiện khi tiến hành sản xuất.

**Thông tin thêm mới kế hoạch:** Ngày thực hiện, Chọn công thức, Khối lượng kế hoạch tổng, Khối lượng theo ngày, Tổ trưởng/phó (người tạo kế hoạch), Ngày tạo.

**Các bước thực hiện:**
`Chọn mục "Nhật ký kế hoạch trộn"` → `Click biểu tượng thêm mới` → `Nhập thông tin ca trộn dự kiến` → `Click "Thêm mới" để hoàn thành`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải điền thông tin.

![Tạo kế hoạch](media2/page-10.jpg)

### 5.4. Chi tiết kế hoạch bồn trộn & máy đùn

**Mục đích:** Khai báo các thông tin chi tiết của kế hoạch trộn/đùn nhằm xác định cách thức thực hiện từng mẻ trộn, xác định phương án thực hiện cho từng máy đùn, và làm căn cứ cho bộ phận Trộn ghi nhận nhật ký sản xuất.

**Thông tin cần nhập chi tiết bồn trộn:** Ngày tạo, Chọn mã công thức trộn, Khối lượng tổng/ngày, Bồn trộn, Định mức mẻ trộn, Công suất mẻ/ngày, Số mẻ trộn, Tỷ lệ sử dụng.

**Thông tin cần nhập chi tiết máy đùn:** Ngày sản xuất, Mã công thức trộn, Bồn trộn, Máy đùn, Quy cách/mã màu/mã sản phẩm (foam), Số tấm dự kiến.

**Các bước thực hiện:**
`Click biểu tượng thêm mới` → `Nhập thông tin sản phẩm trộn` → `Click vào nút thêm mới` → `Chọn "Chi tiết công thức"` → `Nhập thông tin máy đùn` → `Click vào nút thêm mới`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Chi tiết kế hoạch bồn trộn & máy đùn](media2/page-11.jpg)

### 5.5. In phiếu yêu cầu xuất NVL

**Mục đích:** In phiếu yêu cầu xuất nguyên vật liệu theo kế hoạch sản xuất đã được chốt, làm căn cứ để bộ phận kho xuất đúng phân loại và số lượng nguyên vật liệu phục vụ quá trình sản xuất.

**Thông tin cần nhập trước khi gửi:** Người tạo phiếu, Bồn trộn, Mã số, Lần sửa đổi.

**Các bước thực hiện:**
`Nhập thông tin yêu cầu` → `Chọn "In phiếu yêu cầu xuất kho"` → `Chọn "Tạo phiếu" để in phiếu xuất NVL` → `Chọn "Kết xuất excel" để lưu file dữ liệu dưới dạng Excel`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![In phiếu yêu cầu xuất NVL](media2/page-12.jpg)

---

## 6. BỘ PHẬN TRỘN

**Mục đích:**
- Tiếp nhận kế hoạch trộn từ phần mềm.
- Nhập số liệu thực tế của từng sản lượng.
- Cập nhật nguyên liệu sử dụng, sản lượng và phế.
- Chuyển trạng thái hoàn thành sang công đoạn tiếp theo.

**Người phụ trách:** Người đứng ca.

**Quy trình tổng quan:**
`Nhận kế hoạch trộn` → `Chuẩn bị nguyên liệu` → `Thực hiện trộn` → `Ghi nhận nhật ký trộn` → `Hoàn thành mẻ trộn`

![Bộ phận Trộn — Tổng quan](media2/page-13.jpg)

### 6.1. Nhật ký trộn

**Mục đích:** In nhật ký trộn để lưu trữ, kiểm tra, đối chiếu và xác nhận kết quả thực hiện công đoạn trộn.

**Thông tin cần nhập khi thêm nhật ký:** Bồn trộn, Ngày trộn, Ca trộn, Người trộn, Ghi chú.

**Nhập chi tiết công thức:** Số mẻ, Khối lượng đổ (kg), Phân loại nguyên liệu, Số bao/túi.

**Các bước thực hiện:**
`Chọn "Nhật ký kế hoạch trộn"` → `Nhấn "Thêm mới"` → `Nhập thông tin nhật ký` → `Lưu nhật ký` → `Chọn "Chi tiết nhật ký"` → `Nhập thông tin sản xuất` → `Lưu chi tiết sản xuất`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Nhật ký trộn](media2/page-14.jpg)

---

## 7. ĐƠN HÀNG — KHÁCH HÀNG (FOAM)

**Mục đích:**
- Khai báo thông tin đơn hàng và khách hàng.
- Quản lý mã hàng, quy cách và số lượng đặt.
- Liên kết đơn hàng với kế hoạch sản xuất.
- Theo dõi trạng thái thực hiện đơn hàng.

**Đơn vị phụ trách:** Kế hoạch sản xuất.

**Quy trình tổng quan:**
`Khai báo khách hàng` → `Tạo đơn hàng` → `Khai báo sản phẩm của đơn hàng` → `Theo dõi tiến độ đơn hàng`

![Đơn hàng (Foam) — Tổng quan](media2/page-15.jpg)

### 7.1. Thông tin khách hàng

**Mục đích:** Quản lý và lưu trữ thông tin khách hàng, làm cơ sở để tạo đơn hàng, khai báo sản phẩm và theo dõi quá trình sản xuất đơn hàng của từng khách hàng.

**Thông tin cần nhập:** Tên khách hàng, Số điện thoại, Hình logo.

**Các bước thực hiện:**
`Chọn "Khách hàng"` → `Nhấn "Thêm mới"` → `Nhập thông tin khách hàng` → `Lưu thông tin`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Thông tin khách hàng](media2/page-16.jpg)

### 7.2. Thông tin sản phẩm (Foam)

**Mục đích:** Quản lý và cập nhật thông tin sản phẩm thuộc đơn hàng Foam, sử dụng để theo dõi quá trình sản xuất.

**Thông tin cần nhập:** Khách hàng, In logo, Công thức, Độ dày, Tỉ trọng, Màu, Chiều dài, Màng bảo vệ, Màng Film.

**Các bước thực hiện:**
`Chọn "Sản phẩm Foam"` → `Nhấn "Thêm mới"` → `Nhập thông tin sản phẩm` → `Lưu thông tin`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Thông tin sản phẩm Foam](media2/page-17.jpg)

### 7.3. Đơn hàng

**Mục đích:** Tạo và lưu trữ thông tin đơn hàng của khách hàng, làm cơ sở để triển khai kế hoạch và theo dõi quá trình sản xuất.

**Thông tin đơn hàng cần nhập:** Số chứng từ, Mã khách hàng, Ngày tạo, Nhóm sản phẩm, Logo cạnh tấm, Tổng tiền, Ngày nhận đơn, Ngày giao đơn, Trạng thái (giao/chưa giao).

**Nhập chi tiết đơn hàng:** Mã sản phẩm, Mã màu, Quy cách, Số lượng tấm.

**Các bước thực hiện:**
`Chọn "Đơn hàng"` → `Nhấn "Thêm mới"` → `Nhập thông tin đơn hàng` → `Lưu thông tin đơn hàng` → `Chọn "Chi tiết đơn hàng"` → `Nhập thông tin` → `Lưu chi tiết sản xuất`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Đơn hàng](media2/page-18.jpg)

### 7.4. Theo dõi đơn hàng

**Mục đích:** Theo dõi tiến độ thực hiện đơn hàng trong quá trình sản xuất, giúp người dùng cập nhật tình trạng hoàn thành và kiểm soát sản lượng theo từng đơn hàng.

**Thông tin hiển thị trạng thái đơn hàng:**

| Chỉ số | Ý nghĩa |
|---|---|
| SL tấm đặt | Tổng số lượng cần sản xuất theo đơn hàng |
| Đã đóng gói | Số lượng thành phẩm đã hoàn thành công đoạn đóng gói |
| % Hoàn thành | Tỷ lệ hoàn thành của đơn hàng |
| Còn thiếu | Số lượng còn lại cần hoàn thành |
| Tiến độ đóng gói theo thời gian | Biểu đồ thể hiện tiến độ đóng gói theo ngày hoặc tuần |

**Lưu ý:** Phải chọn đúng thông tin khách hàng để xem dữ liệu chuẩn.

**Các bước thực hiện:**
`Chọn "Theo dõi đơn hàng"` → `Nhấn chọn thông tin khách hàng` → `Xem thông tin tiến độ sản xuất đơn hàng` → `Nhấn "làm mới" để reload và cập nhật lại`

![Theo dõi đơn hàng](media2/page-19.jpg)

---

## 8. BỘ PHẬN ĐÙN (ECO)

**Mục đích:**
- Tiếp nhận kế hoạch đùn.
- Nhập sản lượng thực tế theo ca sản xuất.
- Cập nhật số lượng đạt, phế và thông tin vận hành.
- Ghi nhận kết quả sản xuất của từng loại.

**Đơn vị phụ trách:** Bộ phận đùn ECO.

**Quy trình tổng quan:**
`Nhận kế hoạch đùn` → `Thực hiện đùn` → `Ghi nhận nhật ký đùn` → `Hoàn thành công đoạn đùn`

![Bộ phận Đùn ECO — Tổng quan](media2/page-20.jpg)

### 8.1. Nhật ký đùn

**Mục đích:** Ghi nhận quá trình thực hiện công đoạn đùn theo kế hoạch sản xuất, phục vụ theo dõi tiến độ, quản lý dữ liệu sản xuất và truy xuất thông tin khi cần.

**Thông tin cần nhập khi thêm nhật ký:** Ngày, Chọn ca, Tổ trưởng/phó, Tổ máy.

**Các bước thực hiện:**
`Chọn "Nhật ký đùn"` → `Nhấn "Thêm mới"` → `Nhập thông tin nhật ký` → `Lưu nhật ký` → `Chọn "Chi tiết nhật ký"` → `Nhập thông tin sản xuất` → `Lưu chi tiết sản xuất` → `Kiểm tra phế`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Nhật ký đùn](media2/page-21.jpg)

### 8.2. Chi tiết thông tin nhật ký & phế

**Mục đích:** Cập nhật kết quả thực hiện của công đoạn đùn và thông tin phế đùn tại công đoạn Đùn/In/Dán cho từng nhật ký sản xuất, làm cơ sở theo dõi sản lượng, đối chiếu dữ liệu và kiểm soát hao hụt.

**Thông tin cần nhập khi thêm chi tiết nhật ký:** Quét số tem, Mã màu, Quy cách, Số máy, Tấm lót, Biển số xe, Số tấm đùn, Khối lượng tấm đùn thực tế, Số lượng phế đùn, Khối lượng phế đùn thực tế, Nguyên nhân phế.

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Chi tiết thông tin nhật ký & phế](media2/page-22.jpg)

---

## 9. BỘ PHẬN ĐÙN (FOAM)

**Mục đích:**
- Tiếp nhận kế hoạch đùn.
- Nhập sản lượng thực tế theo ca sản xuất.
- Cập nhật số lượng đạt, phế và thông tin vận hành.
- Ghi nhận kết quả sản xuất của từng loại.

**Đơn vị phụ trách:** Bộ phận đùn FOAM.

**Quy trình tổng quan:**
`Nhận kế hoạch đùn` → `Thực hiện đùn` → `Ghi nhận nhật ký đùn` → `Hoàn thành công đoạn đùn`

![Bộ phận Đùn FOAM — Tổng quan](media2/page-23.jpg)

### 9.1. Nhật ký máy đùn Foam

**Mục đích:** Ghi nhận quá trình thực hiện công đoạn đùn theo kế hoạch sản xuất, phục vụ theo dõi tiến độ, quản lý dữ liệu sản xuất và truy xuất thông tin khi cần.

**Thông tin cần nhập khi thêm nhật ký:** Ngày, Chọn ca, Tổ trưởng/phó, Tổ đùn.

**Các bước thực hiện:**
`Chọn "Nhật ký đùn Foam"` → `Nhấn "Thêm mới"` → `Nhập thông tin nhật ký` → `Lưu nhật ký` → `Chọn "Chi tiết nhật ký"` → `Nhập thông tin sản xuất` → `Lưu chi tiết sản xuất` → `Kiểm tra phế`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Nhật ký máy đùn Foam](media2/page-24.jpg)

### 9.2. Chi tiết nhật ký đùn & phế (Foam)

**Mục đích:** Cập nhật kết quả thực hiện của công đoạn đùn Foam và thông tin phế đùn tại công đoạn Đùn/Dán cho từng nhật ký sản xuất, làm cơ sở theo dõi sản lượng, đối chiếu dữ liệu và kiểm soát hao hụt.

**Chi tiết nhật ký bao gồm:** Quét QR số tem, Chọn mã sản phẩm foam (theo đơn), Chọn máy đùn, Số lượng tấm đùn, Khối lượng tấm đùn, Số tấm lót, Số xe, Số lượng phế đùn, Khối lượng phế đùn, Nguyên nhân phế đùn.

**Ghi chú:** Phần mềm tự động hiển thị số lượng phế đùn được cập nhật từ công đoạn Dán sang Đùn nhằm hỗ trợ theo dõi và đối chiếu dữ liệu sản xuất.

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Chi tiết nhật ký đùn & phế Foam](media2/page-25.jpg)

---

## 10. BỘ PHẬN IN

**Mục đích:**
- Nhập số liệu sản xuất và sản lượng thực tế.
- Cập nhật số lượng sản phẩm đạt, phế và trạng thái sản xuất.

**Đơn vị phụ trách:** Bộ phận In.

**Quy trình tổng quan:**
`Nhận sản phẩm từ công đoạn Đùn` → `Lập nhật ký sản xuất` → `Thực hiện công đoạn In` → `Ghi nhận kết quả sản xuất` → `Cập nhật thông tin phế đùn`

![Bộ phận In — Tổng quan](media2/page-26.jpg)

### 10.1. Nhật ký tổ in

**Mục đích:** Ghi nhận quá trình thực hiện công đoạn in theo kế hoạch sản xuất, phục vụ theo dõi tiến độ, quản lý dữ liệu sản xuất và truy xuất thông tin khi cần.

**Thông tin cần nhập khi thêm nhật ký:** Ngày, Chọn ca, Tổ trưởng/phó, Tổ in.

**Chi tiết nhật ký bao gồm:** Quét QR tem, Số lượng in đạt, Số lượng phế in, Số lượng phế đùn, Khối lượng phế đùn.

**Ghi chú:** Phần mềm tự động hiển thị số lượng phế đùn được cập nhật từ công đoạn In sang Đùn nhằm hỗ trợ theo dõi và đối chiếu dữ liệu sản xuất.

**Các bước thực hiện:**
`Chọn "Nhật ký tổ in"` → `Nhấn "Thêm mới"` → `Nhập thông tin nhật ký` → `Lưu nhật ký` → `Chọn "Chi tiết NK in"` → `Nhập thông tin sản xuất` → `Lưu chi tiết sản xuất`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Nhật ký tổ in](media2/page-27.jpg)

---

## 11. BỘ PHẬN DÁN

**Mục đích:**
- Nhập số lượng sản xuất thực tế.
- Cập nhật số lượng đạt, phế và tiến độ thực hiện.
- Tổng khối lượng UV sử dụng dựa trên định mức.

**Đơn vị phụ trách:** Bộ phận Dán.

**Quy trình tổng quan:**
`Nhận sản phẩm từ công đoạn Đùn` → `Lập nhật ký sản xuất` → `Thực hiện công đoạn Dán` → `Ghi nhận kết quả sản xuất` → `Cập nhật thông tin phế dán`

![Bộ phận Dán — Tổng quan](media2/page-28.jpg)

### 11.1. Nhật ký tổ dán

**Mục đích:** Ghi nhận quá trình thực hiện công đoạn dán theo kế hoạch sản xuất, phục vụ theo dõi tiến độ, quản lý dữ liệu sản xuất và truy xuất thông tin khi cần.

**Thông tin cần nhập khi thêm nhật ký:** Ngày, Chọn ca, Tổ trưởng/phó, Chọn tổ dán.

**Chi tiết nhật ký bao gồm:** Số tem, Mã phôi, Mã thành phẩm, Số tấm mang dán, Số lượng dán mặt 1, Số lượng dán mặt 2, Số lượng phế đùn, Số lượng phế dán mặt 1, Số lượng phế dán mặt 2.

**Ghi chú:** Phần mềm tự động hiển thị số lượng phế đùn được cập nhật từ công đoạn Đóng gói sang Dán nhằm hỗ trợ theo dõi và đối chiếu dữ liệu sản xuất.

**Các bước thực hiện:**
`Chọn "Nhật ký tổ dán"` → `Nhấn "Thêm mới"` → `Nhập thông tin nhật ký` → `Lưu nhật ký` → `Chọn "Chi tiết nhật ký dán"` → `Nhập thông tin sản xuất` → `Lưu chi tiết sản xuất`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Nhật ký tổ dán](media2/page-29.jpg)

---

## 12. BỘ PHẬN ĐÓNG GÓI (ECO)

**Mục đích:**
- Nhập số lượng đóng gói theo thực tế.
- Cập nhật số lượng đạt, phế và số kiện.

**Đơn vị phụ trách:** Bộ phận Đóng gói ECO.

**Quy trình tổng quan:**
`Nhận sản phẩm từ In/Dán` → `Thực hiện đóng gói` → `Ghi nhận kết quả sản xuất` → `Nhập kho thành phẩm`

![Bộ phận Đóng gói ECO — Tổng quan](media2/page-30.jpg)

### 12.1. Nhật ký đóng gói

**Mục đích:** Quản lý và theo dõi quá trình đóng gói thành phẩm, ghi nhận kết quả sản xuất và hoàn thiện thông tin thành phẩm trước khi nhập kho.

**Thông tin cần nhập khi thêm nhật ký:** Ngày, Chọn ca, Tổ trưởng/phó, Tổ đóng gói.

**Chi tiết nhật ký bao gồm:** Số tem, Số lượng đóng gói đạt, Số lượng phế đóng gói, Serial hộp.

**Các bước thực hiện:**
`Chọn "Nhật ký đóng gói"` → `Nhấn "Thêm mới"` → `Nhập thông tin nhật ký` → `Lưu nhật ký` → `Chọn "Chi tiết NK đóng gói"` → `Nhập thông tin sản xuất` → `Lưu chi tiết sản xuất`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Nhật ký đóng gói](media2/page-31.jpg)

---

## 13. BỘ PHẬN ĐÓNG GÓI (FOAM)

**Mục đích:**
- Nhập số lượng đóng gói theo thực tế.
- Cập nhật số lượng đạt, phế và số kiện.

**Đơn vị phụ trách:** Bộ phận Đóng gói FOAM.

**Quy trình tổng quan:**
`Nhận sản phẩm từ In/Dán` → `Thực hiện đóng gói` → `Ghi nhận kết quả sản xuất` → `Nhập kho thành phẩm`

![Bộ phận Đóng gói FOAM — Tổng quan](media2/page-32.jpg)

### 13.1. Nhật ký đóng gói Foam

**Mục đích:** Quản lý và theo dõi quá trình đóng gói thành phẩm, ghi nhận kết quả sản xuất và hoàn thiện thông tin thành phẩm trước khi nhập kho.

**Thông tin cần nhập khi thêm nhật ký:** Ngày tạo, Chọn ca, Tổ trưởng/phó, Tổ đóng gói.

**Chi tiết nhật ký bao gồm:** Số chứng từ, Quét QR số tem, Số lượng đóng gói đạt, Số lượng phế đóng gói, Nguyên nhân phế đóng gói, Số lượng phế dán, Khối lượng phế dán, Nguyên nhân phế dán.

**Các bước thực hiện:**
`Chọn "Nhật ký đóng gói Foam"` → `Nhấn "Thêm mới"` → `Nhập thông tin nhật ký` → `Lưu nhật ký` → `Chọn "Chi tiết nhật ký đóng gói Foam"` → `Nhập thông tin sản xuất` → `Lưu chi tiết sản xuất`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Nhật ký đóng gói Foam](media2/page-33.jpg)

---

## 14. BỘ PHẬN NHẬP KHO

**Mục đích:**
- Ghi nhận thông tin nhập kho như ca, kho, thủ kho, thời điểm nhập và ghi chú.
- Quản lý chi tiết thành phẩm nhập kho theo số tem, mã sản phẩm, quy cách, số kiện, khối lượng và serial.

**Đơn vị phụ trách:** Thủ kho.

**Quy trình tổng quan:**
`Đóng gói hoàn thành` → `Nhập nhật ký kho` → `Nhập chi tiết nhập kho` → `Nhập serial` → `Hoàn thành nhập kho`

![Bộ phận Nhập kho — Tổng quan](media2/page-34.jpg)

### 14.1. Nhập kho thành phẩm

**Mục đích:** Theo dõi danh sách dữ liệu đã được tạo trong phần mềm, hỗ trợ xem thông tin chi tiết, kiểm tra và truy xuất dữ liệu khi cần.

**Thông tin cần nhập khi thêm nhật ký:** Chọn nhập kho, Mã kho, Thời điểm nhập, Chọn ca, Thủ kho.

**Các bước thực hiện:**
`Chọn "Nhập kho thành phẩm"` → `Nhấn "Thêm mới"` → `Nhập thông tin nhập kho` → `Lưu thông tin nhập kho` → `Chọn "Chi tiết nhập kho TP"` → `Nhập thông tin sản phẩm` → `Lưu chi tiết` → `Nhập số serial`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Nhập kho thành phẩm](media2/page-35.jpg)

### 14.2. Nhập chi tiết kho thành phẩm

**Mục đích:** Ghi nhận thông tin chi tiết của các thành phẩm được nhập kho theo số tem và được gán serial, làm cơ sở cập nhật số lượng tồn kho và quản lý thông tin nhập kho.

**Thông tin cần nhập khi thêm nhật ký:** Chọn nhập kho, Mã kho, Thời điểm nhập, Chọn ca, Thủ kho.

**Ghi chú:** Quét mã serial cho từng sản phẩm, mỗi sản phẩm (kiện) tương ứng với 1 mã serial.

**Lưu ý:**
- Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.
- Mã serial **không được nhập trùng**.

![Nhập chi tiết kho thành phẩm](media2/page-36.jpg)

---

## 15. BỘ PHẬN XUẤT KHO

**Mục đích:**
- Ghi nhận thông tin xuất kho như số chứng từ, khách hàng, kho, ca, thủ kho và thời điểm xuất.
- Quản lý chi tiết thành phẩm xuất kho theo serial, số tem, mã sản phẩm, quy cách, số kiện và khối lượng.

**Đơn vị phụ trách:** Thủ kho.

**Quy trình tổng quan:**
`Tiếp nhận yêu cầu xuất kho` → `Nhập nhật ký kho` → `Nhập chi tiết xuất kho` → `Nhập serial` → `Hoàn thành xuất kho`

![Bộ phận Xuất kho — Tổng quan](media2/page-37.jpg)

### 15.1. Xuất kho thành phẩm

**Mục đích:** Theo dõi danh sách dữ liệu đã được tạo trong hệ thống, hỗ trợ xem thông tin chi tiết, kiểm tra và truy xuất dữ liệu khi cần.

**Thông tin cần nhập khi thêm nhật ký:** Chọn xuất kho, Số chứng từ, Khách hàng, Thời điểm xuất, Mã kho, Chọn ca, Thủ kho.

**Thông tin cần nhập khi thêm Serial:** Quét mã Serial, Số kiện.

**Các bước thực hiện:**
`Chọn "Xuất kho thành phẩm"` → `Nhấn "Thêm mới"` → `Nhập thông tin xuất kho` → `Lưu thông tin xuất kho` → `Chọn "Chi tiết xuất kho TP"` → `Nhập thông tin kiện hàng` → `Lưu chi tiết`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Xuất kho thành phẩm](media2/page-38.jpg)

---

## 16. BỘ PHẬN KẾ HOẠCH SẢN XUẤT (QUẢN LÝ TỔNG THỂ)

**Mục đích:** Lập kế hoạch sản xuất tổng thể theo tháng, triển khai kế hoạch xuống các bộ phận sản xuất, theo dõi tiến độ thực hiện và tổng hợp kết quả sản xuất toàn nhà máy.

**Đơn vị phụ trách:** Bộ phận Kế hoạch sản xuất.

**Quy trình tổng quan:**
`Lập kế hoạch` → `Triển khai sản xuất` → `Theo dõi tiến độ` → `Tổng hợp kết quả`

![Bộ phận Kế hoạch sản xuất — Tổng quan](media2/page-39.jpg)

### 16.1. Tạo kế hoạch sản xuất

**Mục đích:** Lập kế hoạch sản xuất theo tháng, làm căn cứ phân bổ sản lượng, nguyên vật liệu và kế hoạch thực hiện cho các công đoạn sản xuất.

**Thông tin cần nhập:** Chọn năm, Tháng (ví dụ: Tháng 7), Số máy, Mã màu, Quy cách, Mã sản phẩm foam, Tuần 1/2/3/4/5, Chiều dài, Nhóm sản phẩm.

**Các bước thực hiện:**
`Lập kế hoạch tháng` → `Phân bổ sản lượng` → `Lưu kế hoạch`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Tạo kế hoạch sản xuất](media2/page-40.jpg)

### 16.2. Nhật ký công đoạn

**Mục đích:** Quản lý danh sách các nhật ký sản xuất của từng công đoạn, hỗ trợ theo dõi trạng thái thực hiện, cập nhật thông tin, gửi duyệt và truy xuất dữ liệu trong quá trình sản xuất.

**Thông tin hiển thị trên màn hình:**
- Danh sách các loại nhật ký theo từng công đoạn.
- Danh sách nhật ký đã tạo.
- Thông tin trạng thái xử lý của nhật ký.
- Khu vực hiển thị chi tiết nhật ký.
- Thanh chức năng thực hiện các nghiệp vụ.

**Các bước thực hiện:**
`Chọn loại nhật ký công đoạn cần quản lý` → `Chọn hoặc tạo mới nhật ký` → `Duyệt dữ liệu nhật ký`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Nhật ký công đoạn](media2/page-41.jpg)

### 16.3. Tem sản lượng

**Mục đích:** Quản lý và in tem sản lượng cho từng xe thành phẩm, phục vụ nhận diện, theo dõi tiến độ sản xuất và truy xuất thông tin trong quá trình sản xuất.

**Thông tin cần nhập khi lựa chọn dữ liệu in tem:** Danh sách các tem sản lượng đã được tạo, Thời gian (Tháng - năm), Số tem (từ số... đến số...), Nhóm sản phẩm, Số serial tương ứng.

**Các bước thực hiện:**
`Chọn Tem sản lượng` → `Thêm mới tem sản lượng` → `Chọn kế hoạch hoặc xe thành phẩm cần in tem` → `Thực hiện In tem thành phẩm` → `Dán tem lên xe`

**Lưu ý:** Các dấu (\*) xuất hiện đầu các ô nhập dữ liệu là trường bắt buộc phải thêm thông tin.

![Tem sản lượng](media2/page-42.jpg)

### 16.4. Định mức hàng

**Mục đích:** Quản lý định mức sản xuất của từng loại sản phẩm (ECO/FOAM), làm cơ sở lập kế hoạch sản xuất, tính toán nhu cầu nguyên vật liệu và phân bổ trong quá trình sản xuất.

**Thông tin cần nhập khi thêm định mức:** Danh sách định mức đã được khai báo, Loại sản phẩm (ECO/FOAM), Quy cách, Mã màu, Khối lượng định mức (kg/tấm), Số lượng định mức (tấm/kiện).

**Các bước thực hiện:**
`Chọn định mức của ECO/FOAM` → `Nhấn "Thêm mới"` → `Nhập thông tin định mức` → `Lưu thông tin` → `Xem danh sách định mức của ECO/FOAM`

![Định mức hàng](media2/page-43.jpg)

### 16.5. Báo cáo

**Mục đích:** Theo dõi, thống kê và tổng hợp dữ liệu sản xuất của từng công đoạn theo khoảng thời gian, phục vụ công tác quản lý, đối chiếu và xuất báo cáo.

**Thông tin cần chọn khi lập báo cáo:** Từ ngày, Đến ngày, Chọn ca sản xuất.

**Kết quả hiển thị:** Ngày/ca/máy, Phân loại nguyên liệu, Số lượng bao, Khối lượng. Cho phép kết xuất báo cáo ra tệp Excel.

**Các bước thực hiện:**
`Chọn Báo cáo` → `Chọn thời gian lấy dữ liệu xuất` → `Chấp nhận yêu cầu` → `Kết xuất lưu file Excel`

![Báo cáo](media2/page-44.jpg)

### 16.6. Dashboard

**Mục đích:** Theo dõi tình hình sản xuất theo thời gian thực, so sánh kết quả thực tế với kế hoạch và hỗ trợ quản lý đánh giá hiệu quả sản xuất thông qua các chỉ số và biểu đồ tổng hợp.

**Thông tin hiển thị trên Dashboard:**

| Mục | Nội dung |
|---|---|
| Bộ lọc thời gian | Chọn khoảng thời gian cần theo dõi |
| Chỉ số tổng quan | Kế hoạch, Thực tế, Tỷ lệ đạt, Tỷ lệ phế |
| Biểu đồ kế hoạch và thực tế | So sánh sản lượng kế hoạch với sản lượng thực tế |
| Biểu đồ phế theo công đoạn | Theo dõi tỷ lệ phế của từng công đoạn |
| Biểu đồ sản lượng theo công đoạn | Thống kê sản lượng của từng công đoạn sản xuất |
| Biểu đồ hiệu suất theo máy | So sánh sản lượng đạt và sản lượng phế của từng máy |
| Top mã hàng lỗi | Thống kê các mã hàng có số lượng lỗi cao nhất |
| Xu hướng sản xuất | Theo dõi xu hướng sản lượng theo thời gian |

**Các bước thực hiện:**
1. Chọn khoảng thời gian cần theo dõi.
2. Phần mềm tự động tổng hợp và hiển thị các chỉ số, biểu đồ.
3. Theo dõi, so sánh kết quả thực tế với kế hoạch và phân tích dữ liệu sản xuất.

![Dashboard](media2/page-45.jpg)

---

## 17. QUYỀN HẠN SỬ DỤNG CHỨC NĂNG CỦA CÁC BỘ PHẬN

Phần mềm cho phép người dùng thực hiện các nghiệp vụ quản lý dữ liệu như **thêm mới, chỉnh sửa, xóa, nhập dữ liệu, xuất dữ liệu, chốt dữ liệu** và **xem lịch sử** của mỗi bộ phận sở hữu riêng biệt, đáp ứng nhu cầu quản lý, theo dõi và truy xuất thông tin trong quá trình sản xuất.

**Các bộ phận có thể sử dụng chức năng này bao gồm:**

- Bộ phận Kho
- Bộ phận Trộn
- Bộ phận Đùn
- Bộ phận In
- Bộ phận Dán
- Bộ phận Đóng gói
- Bộ phận Xuất/Nhập kho

![Quyền hạn sử dụng chức năng](media2/page-46.jpg)

---

*Tài liệu được biên soạn lại chi tiết từ bản hướng dẫn sử dụng mới và đầy đủ nhất của hệ thống phần mềm quản lý sản xuất Nhựa Đại Việt.*
