var RptKhsxEco = {
    run: function () {
        RptKhsxEco.url = NUT.services[3].url;
        var now = (new Date()).toISOString().substring(0, 10);
        var domain = NUT.domains[1098].items;

        var cboLoaiSp = `
            <select id="cboLoaiSp">
                <option value="">-- Chọn loại sản phẩm --</option>
                ${domain.map(item =>
            `<option value="${item.id}">${item.text}</option>`
        ).join('')}
            </select>`;


        NUT.w2popup.open({
            title: '📃 <i>Báo cáo KHSX ECO</i>',
            modal: true,
            width: 300,
            height: 220,
            body: `
                <table style='margin:auto'>                  
                    <tr>
                        <td>Từ ngày*</td>
                        <td><input id='datTuNgay' type='date' value='${now}'/></td>
                    </tr>
                    <tr>
                        <td>Đến ngày*</td>
                        <td><input id='datDenNgay' type='date' value='${now}'/></td>
                    </tr>  
                    <tr>
                        <td>Chọn loại sản phẩm</td>
                        <td>${cboLoaiSp}</td>
                    </tr>  
                </table>
                `,

            actions: {
                "_Close": function () {
                    NUT.w2popup.close();
                },
                "_Ok": function () {
                    var datTuNgay = document.getElementById("datTuNgay");
                    var datDenNgay = document.getElementById("datDenNgay");

                    if (datTuNgay.value && datDenNgay.value) {
                        var whereConditions = [
                            ["ngay", ">=", datTuNgay.value],
                            ["ngay", "<=", datDenNgay.value]
                        ];

                        NUT.ds.select({
                            url: RptKhsxEco.url + "data/KHSX_v",
                            where: whereConditions,
                            orderby: "ngay"
                        }, function (res) {

                            if (!res.success || !res.result.length) {
                                return NUT.notify("⚠️ Không có dữ liệu!", "yellow");
                            }

                            var result = res.result;
                            var win = window.open("site/" + n$.user.siteid + "/" + n$.app.appid + "/RptKhsxEco.html");

                            win.onload = function () {
                                win.document.getElementById("title").innerText =
                                    `BÁO CÁO KẾ HOẠCH SẢN XUẤT ECO TỪ NGÀY ${datTuNgay.value} ĐẾN NGÀY ${datDenNgay.value}`;

                                var table = win.document.getElementById("tblData");
                                var stt = 1;

                                result.forEach(function (ct) {
                                    var row = win.document.createElement("tr");
                                    row.innerHTML = `
                                        <td>${stt++}</td>
                                        <td>${ct.ngay || ""}</td>
                                        <td>${ct.may || ""}</td>
                                        <td>${ct.masp || ""}</td>
                                        <td>${ct.quycach || ""}</td>
                                        <td>${ct.mamau || ""}</td>

                                        <td>${ct.tongsltam || 0}</td>
                                        <td>${ct.tongkhsxtong || 0}</td>

                                        <td>${ct.slduntrongky || 0}</td>
                                        <td>${ct.klduntrongky || 0}</td>

                                        <td>${ct.sotamconlai || 0}</td>
                                        <td>${ct.tongklconlai || 0}</td>

                                        <td>${ct.sotammangin || 0}</td>
                                        <td>${ct.slindat || 0}</td>
                                        <td>${ct.slchuain || 0}</td>

                                        <td>${ct.donggoidattam || 0}</td>
                                        <td>${ct.chuadonggoi || 0}</td>

                                        <td>${ct.slkientonkho || 0}</td>
                                        <td>${ct.sltonphoi || 0}</td>

                                        <td>${ct.songayconlai || 0}</td>
                                    `;
                                    table.appendChild(row);
                                });
                            };
                        });


                    } else {
                        NUT.notify("⚠️ Chọn từ ngày và đến ngày!", "yellow");
                    }
                }
            }
        });
    }
}