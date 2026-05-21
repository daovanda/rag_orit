# Quy tắc chỉnh sửa dữ liệu và cấu hình Zilcode

MODEL CONTROL INSTRUCTIONS:

- Dùng file này như luật trước khi đề xuất hoặc thực hiện thay đổi.
- Không nói "đã sửa" nếu apply tool chưa trả thành công.
- Không ghi dữ liệu nếu chưa có preview và xác nhận của người dùng.
- Luôn xác định đúng loại thao tác: insert, update, delete, archive, link, unlink, workflow update, domain update, source patch hoặc SQL/schema change.
- Với mọi thao tác ghi, backend tool phải kiểm tra lại quyền. Không tự kết luận có quyền chỉ từ hội thoại.

Tài liệu này mô tả các quy tắc cần tuân thủ khi trợ lý AI hoặc API tự động hỗ trợ người dùng chỉnh sửa dữ liệu trong Zilcode.

Mục tiêu của tài liệu là giúp hệ thống RAG và các tool của chatbot hiểu rõ khi nào được đọc, khi nào được sửa, cần xác nhận gì trước khi sửa và cần kiểm tra gì sau khi sửa.

## 1. Nguyên tắc tổng quát

Zilcode là hệ thống nocode có cấu trúc động. Một cửa sổ làm việc không được viết cứng theo từng màn hình, mà được dựng từ metadata gồm Application, Window, Tab, Field, Menu, Domain, Workflow và quyền truy cập.

Vì vậy, mọi thao tác chỉnh sửa phải dựa trên metadata hiện tại của hệ thống, không được tự suy đoán tên bảng, tên khóa, tên trường hoặc quyền sửa.

Một thao tác chỉnh sửa hợp lệ cần đi qua các bước:

1. Xác định người dùng đang đăng nhập, vai trò và tổ chức đang chọn.
2. Xác định ứng dụng, window, tab, bảng dữ liệu và record đang thao tác.
3. Đọc cấu hình tab và field để biết trường nào được sửa, trường nào bắt buộc, trường nào chỉ đọc.
4. Đọc dữ liệu hiện tại trước khi sửa.
5. Tạo bản xem trước thay đổi.
6. Yêu cầu người dùng xác nhận rõ ràng.
7. Gọi API ghi dữ liệu.
8. Đọc lại dữ liệu sau khi ghi để kiểm tra kết quả.

Nếu thiếu một trong các thông tin quan trọng như `tableid`, `columnkey`, `recordid`, `fieldid`, quyền sửa hoặc dữ liệu hiện tại thì không nên ghi dữ liệu.

## 2. Nhóm thao tác chỉnh sửa

Các thao tác chỉnh sửa trong Zilcode có thể chia thành nhiều nhóm khác nhau.

### 2.1. Chỉnh sửa dữ liệu nghiệp vụ

Đây là nhóm thao tác thường gặp nhất:

- Thêm bản ghi mới.
- Cập nhật bản ghi hiện có.
- Xóa bản ghi.
- Tìm kiếm và lọc dữ liệu.
- Import dữ liệu từ Excel.
- Export dữ liệu ra Excel.
- Đính kèm file.
- Khóa hoặc mở khóa bản ghi.
- Lưu trữ hoặc phục hồi bản ghi.

Nhóm này thường đi qua class `NWin` trong `window.js` và API trong `SqlREST`.

### 2.2. Chỉnh sửa cấu hình window, tab, field

Nhóm này ảnh hưởng đến cách hệ thống hiển thị và vận hành:

- Cấu hình window.
- Cấu hình tab.
- Cấu hình field.
- Cấu hình menu.
- Cấu hình domain.
- Cấu hình rule hiển thị hoặc tính toán.

Đây là nhóm rủi ro cao vì có thể làm thay đổi cách toàn bộ ứng dụng hoạt động.

### 2.3. Chỉnh sửa workflow

Workflow được quản lý trong `bpmnwf/index.js`. Các thao tác chính gồm:

- Tạo workflow mới.
- Sửa tên workflow.
- Thiết kế sơ đồ BPMN.
- Gán bước xử lý cho role, user hoặc window.
- Lưu các bước workflow vào bảng `n_wfstep`.
- Xóa workflow.

Workflow cần kiểm tra kỹ vì ảnh hưởng đến luồng phê duyệt hoặc xử lý nghiệp vụ.

### 2.4. Chỉnh sửa cấu trúc dữ liệu trong SQL Cloud

SQL Cloud cho phép thao tác với schema, table, view và query. Đây là nhóm nguy hiểm nhất vì có thể thay đổi cấu trúc dữ liệu.

Các thao tác gồm:

- Tạo bảng.
- Tạo view.
- Sửa alias.
- Xóa bảng hoặc view.
- Chạy câu SQL.
- Thay đổi cấu trúc bảng bằng lệnh alter.

AI không nên được phép chạy trực tiếp SQL ghi dữ liệu nếu không có lớp kiểm soát riêng.

### 2.5. Chỉnh sửa source hoặc file

Source Editor dùng `NUT.URL_SOURCE` để quản lý file nguồn. Nhóm này có thể ảnh hưởng đến giao diện, script hoặc tài nguyên hệ thống.

Các thao tác sửa source cần được xem như thao tác cấu hình cấp cao, không phải thao tác chat thông thường.

## 3. Điều kiện bắt buộc trước khi ghi dữ liệu

Trước khi gọi bất kỳ API ghi dữ liệu nào, hệ thống cần có đủ các thông tin sau:

- Người dùng đã đăng nhập và có token hợp lệ.
- Người dùng đã chọn role và organization.
- Đã mở đúng application.
- Đã tải metadata của window.
- Đã xác định tab đang thao tác.
- Đã xác định bảng dữ liệu của tab.
- Đã xác định khóa chính của bảng, thường là `columnkey`.
- Đã xác định record cần sửa nếu là thao tác update hoặc delete.
- Đã kiểm tra quyền theo window, tab và field.
- Đã có bản xem trước thay đổi.
- Người dùng đã xác nhận thao tác.

Nếu người dùng nói chung chung như "sửa giúp tôi thông tin này", "xóa cái đó", "đổi trạng thái thành hoạt động" nhưng hệ thống không biết record nào đang được chọn thì phải hỏi lại hoặc gọi tool lấy context màn hình trước.

## 4. Quy tắc đọc trước khi ghi

Mọi thao tác ghi nên bắt đầu bằng thao tác đọc.

Lý do:

- Dữ liệu trên màn hình có thể đã cũ.
- Người dùng khác có thể đã sửa record.
- Field có thể có giá trị mặc định, giá trị tính toán hoặc rule phụ thuộc.
- Một số trường có thể chỉ đọc hoặc bị ẩn theo cấu hình.

Quy trình đề xuất:

1. Đọc metadata của window/tab/field.
2. Đọc record hiện tại bằng khóa chính.
3. So sánh giá trị hiện tại với giá trị người dùng muốn sửa.
4. Nếu không có thay đổi thật sự, trả lời người dùng rằng dữ liệu đã đúng.
5. Nếu có thay đổi, tạo bản preview.
6. Chỉ ghi sau khi người dùng xác nhận.

## 5. Quy tắc thêm bản ghi

Khi thêm bản ghi mới, hệ thống cần dựa trên cấu hình field của tab.

Các điểm cần chú ý:

- Field có giá trị mặc định phải được tự động điền nếu cấu hình yêu cầu.
- Field bắt buộc phải có dữ liệu trước khi insert.
- Field thuộc hệ thống như `siteid`, `appid`, `orgid` có thể được điền theo context hiện tại.
- Nếu tab là tab con, cần gắn khóa liên kết với bản ghi cha.
- Nếu dữ liệu liên quan đến file, cần upload file trước hoặc sau insert tùy cấu hình.
- Nếu quan hệ là nhiều-nhiều, không nên sửa trực tiếp bảng chính mà cần thêm dòng vào bảng quan hệ.

Không nên cho model tự tạo payload insert chỉ từ ngôn ngữ tự nhiên. Backend tool nên tự map tên field an toàn từ metadata.

## 6. Quy tắc cập nhật bản ghi

Khi cập nhật bản ghi, chỉ nên gửi các trường thật sự thay đổi.

Quy tắc:

- Không ghi đè toàn bộ record nếu chỉ sửa một vài field.
- Không gửi field không có trong metadata.
- Không sửa field chỉ đọc.
- Không sửa field bị ẩn nếu không có lý do nghiệp vụ rõ ràng.
- Không sửa khóa chính.
- Không sửa field hệ thống nếu tool không được thiết kế riêng cho việc đó.
- Chuỗi rỗng nên được xử lý theo quy tắc của hệ thống, thường cần chuyển thành `null` nếu field cho phép rỗng.
- Nếu field là kiểu file hoặc ảnh, phải dùng luồng upload phù hợp thay vì ghi chuỗi tùy ý.

Với người dùng, chatbot nên trình bày dạng:

- Bản ghi sẽ sửa.
- Trường sẽ sửa.
- Giá trị cũ.
- Giá trị mới.
- Lý do hoặc yêu cầu của người dùng.

Sau khi người dùng xác nhận, tool mới thực hiện update.

## 7. Quy tắc xóa bản ghi

Xóa bản ghi là thao tác rủi ro cao.

Trước khi xóa cần:

- Xác định chính xác record.
- Hiển thị tên hoặc mô tả record cho người dùng.
- Kiểm tra quyền xóa.
- Kiểm tra tab có cho phép xóa không.
- Kiểm tra record có đang bị khóa không.
- Kiểm tra record có liên kết dữ liệu con quan trọng không, nếu backend có hỗ trợ.
- Yêu cầu người dùng xác nhận rõ ràng.

Không được xóa khi người dùng dùng đại từ mơ hồ như "cái này", "nó", "dòng đó" mà hệ thống không có selected record rõ ràng.

Nếu hệ thống có chức năng archive, nên ưu tiên lưu trữ thay vì xóa vĩnh viễn khi nghiệp vụ cho phép.

## 8. Quy tắc khóa và mở khóa bản ghi

Một số tab hoặc record có thể hỗ trợ khóa dữ liệu.

Khi khóa:

- Cần biết field nào đại diện cho trạng thái khóa, ví dụ `columnlock`.
- Chỉ người có quyền khóa mới được thao tác.
- Sau khi khóa, các thao tác update/delete cần bị chặn nếu policy yêu cầu.

Khi mở khóa:

- Cần kiểm tra người dùng có quyền mở khóa không.
- Cần hiển thị rõ record nào sẽ được mở khóa.

AI không nên tự mở khóa chỉ để hoàn thành thao tác sửa dữ liệu nếu người dùng không yêu cầu rõ.

## 9. Quy tắc lưu trữ và phục hồi

Zilcode có logic archive cho một số thao tác dữ liệu.

Archive thường dùng khi:

- Người dùng muốn đưa bản ghi ra khỏi danh sách đang hoạt động.
- Người dùng muốn lưu lại dữ liệu cũ.
- Hệ thống cần giữ lịch sử thay vì xóa thật.

Khi archive cần lưu ý:

- Phải biết bảng nguồn.
- Phải biết khóa chính.
- Phải biết danh sách record cần archive.
- Phải kiểm tra quyền.
- Phải xác nhận với người dùng.

Nếu người dùng nói "xóa" nhưng hệ thống có chính sách lưu trữ, chatbot nên nói rõ sẽ "lưu trữ" hay "xóa vĩnh viễn".

## 10. Quy tắc liên kết dữ liệu

Một số tab có quan hệ cha-con hoặc nhiều-nhiều.

Khi liên kết dữ liệu:

- Cần biết record cha.
- Cần biết record con.
- Cần biết bảng quan hệ nếu là nhiều-nhiều.
- Cần biết field khóa cha và field khóa con.
- Không được tự đoán quan hệ nếu metadata chưa đủ.

Khi hủy liên kết:

- Chỉ xóa dòng quan hệ nếu đây là quan hệ nhiều-nhiều.
- Không nên xóa record con nếu người dùng chỉ yêu cầu bỏ liên kết.

## 11. Quy tắc import và export

Import dữ liệu từ Excel cần kiểm tra:

- File có đúng định dạng không.
- Header có khớp field không.
- Field bắt buộc có dữ liệu không.
- Dữ liệu có trùng khóa không.
- Người dùng muốn thêm mới, cập nhật hay cả hai.

Export dữ liệu là thao tác ít rủi ro hơn, nhưng vẫn cần kiểm tra quyền đọc và phạm vi dữ liệu.

Khi AI hỗ trợ import, nên có bước preview số dòng sẽ thêm, số dòng sẽ cập nhật và số dòng lỗi.

## 12. Quy tắc chỉnh sửa workflow

Workflow ảnh hưởng đến luồng xử lý của ứng dụng.

Khi sửa workflow cần kiểm tra:

- Workflow thuộc application nào.
- Tên workflow.
- Bảng hoặc window liên quan.
- Danh sách step.
- Step nào gán role.
- Step nào gán user.
- Step nào mở window.
- Có start event và end event hợp lệ không.

Không nên để model tự thay đổi sơ đồ workflow nếu người dùng chưa xác nhận thiết kế mới.

Quy trình an toàn:

1. Đọc workflow hiện tại.
2. Mô tả workflow hiện tại cho người dùng.
3. Tạo đề xuất thay đổi.
4. Kiểm tra step bị thêm, sửa, xóa.
5. Yêu cầu xác nhận.
6. Lưu workflow.
7. Đọc lại workflow để kiểm tra.

## 13. Quy tắc với SQL Cloud

SQL Cloud có quyền thao tác trực tiếp lên schema và dữ liệu, vì vậy cần hạn chế mạnh.

Không nên mở tool cho model chạy SQL tự do trong production.

Nếu cần hỗ trợ SQL, nên tách thành các tool an toàn:

- Tool đọc schema.
- Tool đọc danh sách table/view.
- Tool chạy câu SELECT có giới hạn.
- Tool preview thay đổi schema.
- Tool tạo table từ schema đã xác nhận.
- Tool tạo view từ câu SELECT đã xác nhận.

Các câu SQL ghi dữ liệu như `INSERT`, `UPDATE`, `DELETE`, `ALTER`, `DROP`, `TRUNCATE` phải yêu cầu xác nhận nhiều bước hoặc chỉ cho phép admin.

## 14. Quy tắc với Source Editor

Source Editor có thể thay đổi file nguồn hoặc tài nguyên hệ thống.

Các thao tác này cần xem như chỉnh sửa code:

- Đọc file.
- Tạo file.
- Sửa file.
- Xóa file.
- Upload file.
- Di chuyển file.

AI chỉ nên hỗ trợ source khi:

- Người dùng là admin hoặc developer.
- Đã xác định đúng file.
- Đã tạo diff thay đổi.
- Người dùng xác nhận diff.
- Có cơ chế backup hoặc versioning.

Không nên cho model ghi trực tiếp file nguồn chỉ từ một câu chat ngắn.

## 15. Quy tắc phản hồi cho người dùng

Khi thao tác thành công, chatbot nên trả lời:

- Đã sửa gì.
- Sửa ở đâu.
- Giá trị cũ là gì.
- Giá trị mới là gì.
- Có cần người dùng reload hoặc mở lại màn hình không.

Khi thao tác thất bại, chatbot nên trả lời:

- Lỗi xảy ra ở bước nào.
- Dữ liệu đã được ghi hay chưa.
- Nếu chưa ghi, nói rõ là chưa có thay đổi nào được lưu.
- Nếu có thể, đưa cách xử lý tiếp theo.

Không nên trả lỗi kỹ thuật thô cho người dùng cuối nếu lỗi có thể diễn giải bằng ngôn ngữ nghiệp vụ.

## 16. Quy tắc dành cho chatbot

Chatbot có thể hỗ trợ chỉnh sửa Zilcode, nhưng không nên tự quyết định ghi dữ liệu nếu thiếu xác nhận.

Quy tắc nên áp dụng:

- Nếu người dùng hỏi hướng dẫn, dùng RAG.
- Nếu người dùng hỏi dữ liệu hiện tại, dùng tool đọc dữ liệu.
- Nếu người dùng yêu cầu sửa, dùng tool preview trước.
- Nếu người dùng xác nhận, dùng tool ghi dữ liệu.
- Nếu câu yêu cầu mơ hồ, hỏi lại hoặc lấy context màn hình.
- Nếu thao tác rủi ro cao, giải thích tác động trước khi làm.
- Nếu tool trả về lỗi quyền, không tìm cách vượt quyền.

AI chỉ nên là lớp điều phối và giải thích. Luật quyền, validate dữ liệu và giới hạn thao tác phải được thực thi ở backend tool.
