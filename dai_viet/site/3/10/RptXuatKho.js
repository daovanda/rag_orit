var RptXuatKho = {
    run: function () {
        var url = NUT.services[3].url;
        var now = (new Date()).toISOString().substring(0, 10);
        NUT.w2popup.open({
            title: '📃 <i>Xuất số liệu đóng gói đạt</i>',
            modal: true,
            width: 320,
            height: 240,
            body: `
                <table style='margin:auto'>                  
                    <tr>
                        <td>từ ngày*</td>
                        <td colspan='3'>
                            <input type="date" id="txtTuNgay" value="${now}" />
                        </td>
                    </tr>

                    <tr>
                        <td>đến ngày*</td>
                        <td colspan='3'>
                            <input type="date" id="txtDenNgay" value="${now}" />
                        </td> 
                    </tr>
                </table>
            `,

            actions: {

                "_Close": function () {
                    NUT.w2popup.close();
                },

                "_Ok": function () {
                    var txtTuNgay = document.getElementById("txtTuNgay");
                    var txtDenNgay = document.getElementById("txtDenNgay");

                    if (!(txtTuNgay.value && txtDenNgay.value))
                        return NUT.notify("⚠️ Hãy chọn đầy đủ thông tin", "yellow");

                    const file = "RptXuatKho.html";
                    NUT.ds.select({
                        url: url + "data/xuat_kho",
                        where: [
                            ["ngay_hach_toan", ">=", txtTuNgay.value],
                            ["ngay_hach_toan", "<=", txtDenNgay.value],
                            ["loai_nhap_kho", "!=", ""]
                            ["ngay_chung_tu", "!=", ""],
                            ["so_chung_tu", "!=", ""],
                            ["ma_doi_tuong", "!=", ""],
                            ["ten_doi_tuong", "!=", ""],
                            ["dia_chi", "!=", ""],
                            ["nguoi_giao", "!=", ""],
                            ["dien_giai", "!=", ""],
                            ["ma_nv_ban_hang", "!=", ""],
                            ["ma_hang", "!=", ""],
                            ["ten_hang", "!=", ""],
                            ["ma_kho", "!=", ""],
                            ["tk_no", "!=", ""],
                            ["tk_co", "!=", ""],
                            ["don_vi_tinh", "!=", ""],
                            ["so_luong", "!=", ""],
                            ["don_gia", "!=", ""],
                            ["thanh_tien", "!=", ""],
                            ["so_lsx", "!=", ""],
                            ["ma_dt_thcp", "!=", ""]
                        ]
                    }, function (res) {

                        if (!res.success || !res.result.length)
                            return NUT.notify("⚠️ Không có dữ liệu!", "yellow");

                        var win = window.open("site/" + n$.user.siteid + "/" + n$.app.appid + "/" + file);
                        win.onload = function () {

                            const tbody = win.document.getElementById("tbody");
                            tbody.innerHTML = "";

                            res.result.forEach((i, index) => {

                                const tr = win.document.createElement("tr");

                                tr.innerHTML = `
                                    <td><input type="text" value="${i.loai_nhap_kho || ''}"></td>
                                    <td><input type="date" value="${i.ngay_hach_toan ? i.ngay_hach_toan.split('T')[0] : ''}"></td>
                                    <td><input type="date" value="${i.ngay_chung_tu ? i.ngay_chung_tu.split('T')[0] : ''}"></td>
                                    <td><input type="text" value="${i.so_chung_tu || ''}"></td>
                                    <td><input type="text"></td>
                                    <td><input type="text"></td>
                                    <td><input type="text" value="${i.ma_nv_ban_hang || ''}"></td>
                                    <td><input type="text" value="${i.nguoi_giao || ''}"></td>
                                    <td><input type="text" value="${i.dien_giai || ''}"></td>
                                    <td><input type="text"></td>

                                    <td><input type="text" value="${i.ma_hang || ''}"></td>
                                    <td><input type="text" value="${i.ten_hang || ''}"></td>
                                    <td></td>
                                    <td></td>
                                    <td><input type="text" value="${i.ma_kho || ''}"></td>
                                    <td><input type="text" value="${i.tk_no || ''}"></td>
                                    <td><input type="text" value="${i.tk_co || ''}"></td>
                                    <td><input type="text" value="${i.don_vi_tinh || ''}"></td>

                                    <td><input type="number" value="${i.so_luong || 0}"></td>
                                    <td><input type="number" value="${i.don_gia || 0}"></td>
                                    <td><input type="number" value="${i.thanh_tien || 0}"></td>

                                    <td><input type="text"></td>
                                    <td><input type="text" value="${i.ma_dt_thcp || ''}"></td>
                                `;

                                tbody.appendChild(tr);
                            });
                        };
                    });

                }
            }

        });

    }
}