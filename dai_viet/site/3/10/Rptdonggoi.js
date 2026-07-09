var Rptdonggoi = {
    run: function (p) {
        p = p || {};
        Rptdonggoi.url = NUT.services[3].url;
        var domainObj = NUT.domains[1092] || {};
        var items = domainObj.items || [];

        var cboCa = document.createElement("select");
        cboCa.id = "cboCa";
        cboCa.className = 'w2ui-input';
        cboCa.style.width = "230px";
        var optAll = document.createElement("option");
        optAll.value = "";
        optAll.innerHTML = "Chọn ca";
        cboCa.add(optAll);
        items.filter(item => item.text && item.text.trim() !== "").sort((a, b) => a.id - b.id).forEach(function (item) {
            var opt = document.createElement("option");
            opt.value = item.text || "";
            opt.innerHTML = item.text || "";
            cboCa.add(opt);
        });

        var now = (new Date()).toISOString().substring(0, 10);

        if (p.records && p.records.length) {
            var selectedRecord = p.records[0];
            var nkdongid = selectedRecord.nkdongid;
            if (!nkdongid) {
                return NUT.notify("⚠️ Bản ghi chưa có nkdongid!", "yellow");
            }

            NUT.ds.select({
                url: Rptdonggoi.url + "data/nkdong",
                where: [["nkdongid", "=", nkdongid]],
                orderby: "ngay, ca"
            }, function (resNK) {
                if (!resNK.success || !resNK.result.length) {
                    return NUT.notify("⚠️ Không có dữ liệu nhật ký đóng gói cho bản ghi đã chọn!", "yellow");
                }

                var nk = resNK.result[0];
                NUT.ds.select({
                    url: Rptdonggoi.url + "data/ctnkdong_v",
                    where: [["nkdongid", "=", nk.nkdongid]]
                }, function (resCT) {
                    if (!resCT.success) {
                        return NUT.notify("⚠️ Không lấy được dữ liệu chi tiết!", "yellow");
                    }

                    var detailsByNK = {};
                    resCT.result.forEach(function (ct) {
                        if (!detailsByNK[ct.nkdongid]) {
                            detailsByNK[ct.nkdongid] = [];
                        }
                        detailsByNK[ct.nkdongid].push(ct);
                    });

                    var win = window.open("site/" + n$.user.siteid + "/" + n$.app.appid + "/Rptdonggoi.html");
                    win.onload = function () {
                        var table = win.document.getElementById("tblData");
                        if (!table) return;
                        var firstRow = table.rows[0];
                        firstRow.cells[0].innerHTML = `Ngày: ${nk.ngay ? new Date(nk.ngay).toLocaleDateString('vi-VN') : ""}`;
                        firstRow.cells[1].innerHTML = `Ca: ${nk.ca || ""}`;
                        firstRow.cells[2].innerHTML = `Tổ trưởng: ${nk.totruong || ""}`;

                        var rows = detailsByNK[nk.nkdongid] || [];
                        rows.forEach(function (ct, i) {
                            var row = win.document.createElement("tr");

                            // let KienTam = ct.slkien > 0
                            //     ? ((ct.sltam || 0) / ct.slkien).toFixed(2)
                            //     : "";

                            row.innerHTML = `
                                <td>${i + 1}</td>
                                 <td>${ct.mamau || ""}_${ct.quycach || ""}</td>
                                <td>${ct.sotem || ""}</td>
                                <td>${ct.sldinhmuc || ""}</td>
                                <td>${ct.slthem || ""}</td>
                                <td>${ct.slthieu || ""}</td>
                                <td>${ct.slloi || ""}</td>
                                <td>${ct.ghichu || ""}</td>
                            `;
                            table.appendChild(row);
                        });
                    };
                });
            });
        }
        else if (p.popup || (!p.records && typeof p.records === 'undefined')) {
            NUT.w2popup.open({
                title: '📦 <i>Báo cáo đóng gói</i>',
                modal: true,
                width: 300,
                height: 250,
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
                            <td>Ca *</td>
                            <td colspan='3'>` + cboCa.outerHTML + `</td>
                        </tr>
                    </table>
                `,
                actions: {
                    "_Close": function () {
                        NUT.w2popup.close();
                    },
                    "_Ok": function () {
                        var cboCa = document.getElementById("cboCa");
                        var datTuNgay = document.getElementById("datTuNgay");
                        var datDenNgay = document.getElementById("datDenNgay");

                        if (datTuNgay.value && datDenNgay.value) {
                            var whereConditions = [
                                ["ngay", ">=", datTuNgay.value],
                                ["ngay", "<=", datDenNgay.value]
                            ];
                            if (cboCa.value !== "") {
                                whereConditions.push(["ca", "=", cboCa.value]);
                            }

                            NUT.ds.select({
                                url: Rptdonggoi.url + "data/nkdong",
                                where: whereConditions,
                                orderby: "ngay, ca"
                            }, function (resNK) {
                                if (!resNK.success || !resNK.result.length) {
                                    return NUT.notify("⚠️ Không có dữ liệu nhật ký đóng gói!", "yellow");
                                }
                                var ids = resNK.result.map(function (r) { return r.nkdongid; });

                                NUT.ds.select({
                                    url: Rptdonggoi.url + "data/ctnkdong_v",
                                    where: [["nkdongid", "in", ids]]
                                }, function (resCT) {
                                    if (!resCT.success) {
                                        return NUT.notify("⚠️ Không lấy được dữ liệu chi tiết!", "yellow");
                                    }

                                    var detailsByNK = {};
                                    resCT.result.forEach(function (ct) {
                                        if (!detailsByNK[ct.nkdongid]) {
                                            detailsByNK[ct.nkdongid] = [];
                                        }
                                        detailsByNK[ct.nkdongid].push(ct);
                                    });

                                    var win = window.open("site/" + n$.user.siteid + "/" + n$.app.appid + "/Rptdonggoi.html");
                                    win.onload = function () {
                                        var templateTable = win.document.getElementById("tblData");
                                        if (!templateTable) return;

                                        var groups = [];
                                        var groupMap = {};
                                        resNK.result.forEach(function (nk) {
                                            var key = [
                                                nk.ngay ? new Date(nk.ngay).toDateString() : "",
                                                nk.ca || "",
                                                nk.totruong || ""
                                            ].join("||");
                                            if (!groupMap[key]) {
                                                groupMap[key] = {
                                                    ngay: nk.ngay,
                                                    ca: nk.ca,
                                                    totruong: nk.totruong,
                                                    ids: []
                                                };
                                                groups.push(groupMap[key]);
                                            }
                                            groupMap[key].ids.push(nk.nkdongid);
                                        });

                                        groups.forEach(function (group, index) {
                                            var table = templateTable.cloneNode(true);
                                            table.removeAttribute("id");

                                            var firstRow = table.rows[0];
                                            firstRow.cells[0].innerHTML = `Ngày: ${group.ngay ? new Date(group.ngay).toLocaleDateString('vi-VN') : ""}`;
                                            firstRow.cells[1].innerHTML = `Ca: ${group.ca || ""}`;
                                            firstRow.cells[2].innerHTML = `Tổ trưởng: ${group.totruong || ""}`;

                                            var stt = 1;
                                            group.ids.forEach(function (id) {
                                                var rows = detailsByNK[id] || [];
                                                rows.forEach(function (ct) {
                                                    var row = win.document.createElement("tr");

                                                    // let KienTam = ct.slkien > 0
                                                    //     ? ((ct.sltam || 0) / ct.slkien).toFixed(2)
                                                    //     : "";

                                                    row.innerHTML = `
                                                        <td>${stt++}</td>
                                                        <td>${ct.mamau || ""}_${ct.quycach || ""}</td>
                                                        <td>${ct.sotem || ""}</td>
                                                        <td>${ct.sldinhmuc || ""}</td>
                                                        <td>${ct.slthem || ""}</td>
                                                        <td>${ct.slthieu || ""}</td>
                                                        <td>${ct.slloi || ""}</td>
                                                        <td>${ct.ghichu || ""}</td>
                                                    `;

                                                    table.appendChild(row);
                                                });
                                            });

                                            win.document.body.appendChild(table);
                                            if (index < groups.length - 1) {
                                                let pageBreak = win.document.createElement("div");
                                                pageBreak.style.pageBreakAfter = "always";
                                                win.document.body.appendChild(pageBreak);
                                            }
                                        });

                                        templateTable.remove();
                                    };

                                });
                            });
                        } else {
                            NUT.notify("⚠️ Chọn từ ngày và đến ngày!", "yellow");
                        }
                    }
                }
            });
        }
        else {
            NUT.notify("không có bản ghi nào được chọn!", "yellow");
        }
    }
};