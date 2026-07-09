var RptTongHop = {
    run: function () {

        var url = NUT.services[3].url;

        var domainNhomsp = NUT.domains[1098] || {};
        var itemsNhomsp = (domainNhomsp.items || [])
            .map(i => `<option value="${i.id}">${i.text || ""}</option>`)
            .join('');

        var domainNam = NUT.domains[1104] || {};
        var itemsNam = (domainNam.items || [])
            .map(i => `<option value="${i.id}">${i.text || ""}</option>`)
            .join('');

        var domainThang = NUT.domains[1099] || {};
        var itemsThang = (domainThang.items || [])
            .map(i => `<option value="${i.id}">${i.text || ""}</option>`)
            .join('');

        NUT.w2popup.open({
            title: '📃 <i>Báo cáo tổng hợp</i>',
            modal: true,
            width: 320,
            height: 240,
            body: `
                <table style='margin:auto'>                  
                    <tr>
                        <td>Năm*</td>
                        <td colspan='3'>
                            <select id="cboNam">${itemsNam}</select>
                        </td>
                    </tr>

                    <tr>
                        <td>Tháng*</td>
                        <td colspan='3'>
                            <select id="cboThang">${itemsThang}</select>
                        </td> 
                    </tr>

                    <tr>
                        <td>Nhóm sản phẩm *</td>
                        <td colspan='3'>
                            <select id="cboNhomsp">${itemsNhomsp}</select>
                        </td> 
                    </tr>
                </table>
            `,

            actions: {

                "_Close": function () {
                    NUT.w2popup.close();
                },

                "_Ok": function () {

                    var selNhom = document.getElementById("cboNhomsp");
                    var cboNhomsp = selNhom.value;
                    var nhomspText = (selNhom.options[selNhom.selectedIndex] && selNhom.options[selNhom.selectedIndex].text || "").trim();
                    var cboNam = document.getElementById("cboNam").value;
                    var cboThang = document.getElementById("cboThang").value;

                    if (!(cboNhomsp && cboNam && cboThang))
                        return NUT.notify("⚠️ Hãy chọn đầy đủ thông tin", "yellow");

                    const file = "RptTongHop.html";
                    NUT.ds.select({
                        url: url + "data/thsx_vv",
                        where: [
                            ["nam", "=", cboNam],
                            ["thang", "=", cboThang],
                            ["nhomsp", "=", cboNhomsp]
                        ]
                    }, function (res) {

                        if (!res.success || !res.result.length)
                            return NUT.notify("⚠️ Không có dữ liệu!", "yellow");

                        var reportParams = {
                            nhomspId: cboNhomsp,
                            nhomspText: nhomspText,
                            nam: cboNam,
                            thang: cboThang
                        };

                        var win = window.open(
                            `site/${n$.user.siteid}/${n$.app.appid}/${file}`
                        );

                        if (!win) {
                            return NUT.notify("⚠️ Popup bị chặn!", "red");
                        }

                        win.data = res.result;
                        win.reportParams = reportParams;

                        var timer = setInterval(function () {
                            if (win.renderReport) {
                                clearInterval(timer);
                                win.renderReport();
                            }
                        }, 200);
                    });

                }
            }

        });

    }
};
