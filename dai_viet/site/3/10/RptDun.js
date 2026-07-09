var RptDun = {
    run: function (p) {
        p = p || {};
        RptDun.url = NUT.services[3].url;
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
        var makePheKey = function (nkdunid, somay) {
            return String(nkdunid || "") + "::" + String(somay || "").trim();
        };
        var buildPheMap = (rows) => {
            var map = {};
            (rows || []).forEach(function (p) {
                var key = makePheKey(p.nkdunid, p.somay);
                if (!map[key]) {
                    map[key] = { total: 0, causes: {} };
                }
                var val = Number(p.klphe || 0);
                if (isNaN(val)) val = 0;
                var cause = String(p.nguyennhan || "").trim() || "khac";
                map[key].total += val;
                map[key].causes[cause] = (map[key].causes[cause] || 0) + val;
            });
            return map;
        };
        var formatCauses = function (causes) {
            if (!causes) return "";
            return Object.keys(causes)
                .sort(function (a, b) { return causes[b] - causes[a]; })
                .map(function (k) { return k + ": " + Number(causes[k]).toLocaleString('vi-VN'); })
                .join(", ");
        };
        if (p.records && p.records.length) {
            var selectedRecord = p.records[0];

            NUT.ds.select({
                url: RptDun.url + "data/nkdun",
                where: [["nkdunid", "=", selectedRecord.nkdunid]]
            }, function (resNK) {
                if (!resNK.success || !resNK.result.length) {
                    return NUT.notify("⚠️ Không có dữ liệu nhật ký đùn cho bản ghi đã chọn!", "yellow");
                }
                var nk = resNK.result[0];

                NUT.ds.select({
                    url: RptDun.url + "data/ctphedun",
                    where: [["nkdunid", "=", nk.nkdunid]]
                }, function (resPhe) {
                    if (!resPhe.success) {
                        return NUT.notify("⚠️ Không lấy được dữ liệu phế đùn!", "yellow");
                    }

                    var pheByMay = buildPheMap(resPhe.result);

                    NUT.ds.select({
                        url: RptDun.url + "data/ctnkdun_v",
                        where: [["nkdunid", "=", nk.nkdunid]]
                    }, function (resCT) {
                        if (!resCT.success) {
                            return NUT.notify("⚠️ Không lấy được dữ liệu chi tiết!", "yellow");
                        }

                        var win = window.open("site/" + n$.user.siteid + "/" + n$.app.appid + "/RptDun.html");
                        win.onload = function () {
                            var table = win.document.getElementById("tblData");
                            if (!table) return;

                            var firstRow = table.rows[0];
                            firstRow.cells[0].innerHTML = `Ngày: ${nk.ngay ? new Date(nk.ngay).toLocaleDateString('vi-VN') : ""}`;
                            firstRow.cells[1].innerHTML = `Ca: ${nk.ca || ""}`;
                            firstRow.cells[2].innerHTML = `Tên tổ trưởng: ${nk.totruong || ""}`;

                            let stt = 1;
                            resCT.result.forEach(function (ct) {
                                var key = makePheKey(nk.nkdunid, ct.somay);
                                var pheInfo = pheByMay[key] || { total: 0, causes: {} };
                                var row = win.document.createElement("tr");
                                row.innerHTML = `
                                <td>${stt++}</td>
                                <td>${ct.somay || ""}</td>
                                 <td>${ct.mamau || ""}_${ct.quycach || ""}</td>
                                <td>${ct.sotamlot || ""}</td>
                                <td>${ct.soxe || ""}</td>                               
                                <td>${ct.sotem || ""}</td>                               
                                <td>${ct.sltamdun || ""}</td> 
                                <td>${ct.klthucte || ""}</td>
                                <td>${ct.kldinhmuc || ""}</td>
                                <td>${Number(pheInfo.total || 0).toLocaleString('vi-VN')}</td>
                                <td>${formatCauses(pheInfo.causes)}</td>
                                <td class="sign-col">
                                    <div class="sign-body">
                                        <div class="sign-name"></div>
                                        <div class="sign-ksc"></div>
                                    </div>
                                </td>

                            `;
                                table.appendChild(row);
                            });
                        };
                    });

                });

            });
        }

        else if (p.popup || (!p.records && typeof p.records === 'undefined')) {
            NUT.w2popup.open({
                title: '📃 <i>Báo cáo đùn</i>',
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
                                url: RptDun.url + "data/nkdun",
                                where: whereConditions,
                                orderby: "ngay, ca"
                            }, function (resNK) {
                                if (!resNK.success || !resNK.result.length) {
                                    return NUT.notify("⚠️ Không có dữ liệu nhật ký đùn!", "yellow");
                                }
                                var ids = resNK.result.map(r => r.nkdunid);

                                NUT.ds.select({
                                    url: RptDun.url + "data/ctphedun",
                                    where: [["nkdunid", "in", ids]]
                                }, function (resPhe) {
                                    if (!resPhe.success) {
                                        return NUT.notify("⚠️ Không lấy được dữ liệu phế đùn!", "yellow");
                                    }
                                    var pheByMay = buildPheMap(resPhe.result);
                                    NUT.ds.select({
                                        url: RptDun.url + "data/ctnkdun_v",
                                        where: [["nkdunid", "in", ids]]
                                    }, function (resCT) {
                                        if (!resCT.success) {
                                            return NUT.notify("⚠️ Không lấy được dữ liệu chi tiết!", "yellow");
                                        }

                                        var detailsByNK = {};
                                        resCT.result.forEach(function (ct) {
                                            if (!detailsByNK[ct.nkdunid]) {
                                                detailsByNK[ct.nkdunid] = [];
                                            }
                                            detailsByNK[ct.nkdunid].push(ct);
                                        });

                                        var win = window.open("site/" + n$.user.siteid + "/" + n$.app.appid + "/RptDun.html");
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
                                                groupMap[key].ids.push(nk.nkdunid);
                                            });

                                            groups.forEach(function (group, index) {
                                                var table = templateTable.cloneNode(true);
                                                table.removeAttribute("id");

                                                var firstRow = table.rows[0];
                                                firstRow.cells[0].innerHTML = `Ngày: ${group.ngay ? new Date(group.ngay).toLocaleDateString('vi-VN') : ""}`;
                                                firstRow.cells[1].innerHTML = `Ca: ${group.ca || ""}`;
                                                firstRow.cells[2].innerHTML = `Tên tổ trưởng: ${group.totruong || ""}`;

                                                let stt = 1;
                                                group.ids.forEach(function (id) {
                                                    var rows = detailsByNK[id] || [];
                                                    rows.forEach(function (ct) {
                                                        var key = makePheKey(id, ct.somay);
                                                        var pheInfo = pheByMay[key] || { total: 0, causes: {} };
                                                        var row = win.document.createElement("tr");
                                                        row.innerHTML = `
                                                        <td>${stt++}</td>
                                                        <td>${ct.somay || ""}</td>
                                                         <td>${ct.mamau || ""}_${ct.quycach || ""}</td>
                                                        <td>${ct.sotamlot || ""}</td>
                                                        <td>${ct.soxe || ""}</td>                               
                                                        <td>${ct.sotem || ""}</td>                               
                                                        <td>${ct.sltamdun || ""}</td> 
                                                        <td>${ct.klthucte || ""}</td>
                                                        <td>${ct.kldinhmuc || ""}</td>
                                                        <td>${Number(pheInfo.total || 0).toLocaleString('vi-VN')}</td>
                                                        <td>${formatCauses(pheInfo.causes)}</td>
                                                        <td class="sign-col">
                                                            <div class="sign-body">
                                                                <div class="sign-name"></div>
                                                                <div class="sign-ksc"></div>
                                                            </div>
                                                        </td>

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
