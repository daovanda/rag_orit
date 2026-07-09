var RptIn = {
    run: function (p) {
        p = p || {};
        RptIn.url = NUT.services[3].url;
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
            var nkinid = selectedRecord.nkinid;
            if (!nkinid) {
                return NUT.notify("⚠️ Bản ghi chưa có nkinid!", "yellow");
            }

            NUT.ds.select({
                url: RptIn.url + "data/nkin",
                where: [["nkinid", "=", nkinid]],
                orderby: "ngay"
            }, function (resIn) {
                if (!resIn.success || !resIn.result.length) {
                    return NUT.notify("⚠️ Không có dữ liệu in cho bản ghi đã chọn!", "yellow");
                }
                var nk = resIn.result[0];

                NUT.ds.select({
                    url: RptIn.url + "data/ctnkin_v",
                    where: [["nkinid", "=", nk.nkinid]]
                }, function (resCT) {
                    if (!resCT.success) {
                        return NUT.notify("⚠️ Không lấy được dữ liệu chi tiết!", "yellow");
                    }

                    var detailsByNK = {};
                    resCT.result.forEach(function (ct) {
                        if (!detailsByNK[ct.nkinid]) {
                            detailsByNK[ct.nkinid] = [];
                        }
                        detailsByNK[ct.nkinid].push(ct);
                    });

                    var win = window.open("site/" + n$.user.siteid + "/" + n$.app.appid + "/RptIn.html");
                    win.onload = function () {
                        var table = win.document.getElementById("tblData");
                        if (!table) return;

                        var firstRow = table.rows[0];
                        firstRow.cells[0].textContent = `Ngày: ${nk.ngay ? new Date(nk.ngay).toLocaleDateString('vi-VN') : ""}`;
                        firstRow.cells[1].textContent = `Ca: ${nk.ca || ""}`;
                        firstRow.cells[2].textContent = `Tổ in: ${nk.toin || ""}`;
                        firstRow.cells[3].textContent = `Tổ trưởng: ${nk.totruong || ""}`;
                        firstRow.cells[4].textContent = "";

                        var stt = 1;
                        (detailsByNK[nk.nkinid] || []).forEach(function (ct) {
                            var row = win.document.createElement("tr");
                            row.innerHTML = `
                                <td>${stt++}</td>               
                                <td>${ct.mamau || ""}_${ct.quycach || ""}</td>       
                                <td>${ct.tt || ""}</td>             
                                <td>${ct.sotem || ""}</td>         
                                <td>${ct.soxe || ""}</td>          
                                <td>${ct.sltamdun || ""}</td>       
                                <td>${ct.slindat || ""}</td>       
                                <td>${ct.klindat || ""}</td>       
                                <td>${ct.soxethanhpham || ""}</td>  
                                <td>${ct.slloidun || ""}</td>       
                                <td>${ct.slloiin || ""}</td>         
                                <td>${ct.tomay || ""}</td>          
                                <td>${ct.dinhmucuv || ""}</td>      
                                <td>${ct.ghichuct || ""}</td>     
                            `;
                            table.appendChild(row);
                        });
                    };
                });
            });
        }
        else if (p.popup || (!p.records && typeof p.records === 'undefined')) {
            NUT.w2popup.open({
                title: '📃 <i>Báo cáo tổ in</i>',
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
                                url: RptIn.url + "data/nkin",
                                where: whereConditions,
                                orderby: "ngay"
                            }, function (resIn) {
                                if (!resIn.success || !resIn.result.length) {
                                    return NUT.notify("⚠️ Không có dữ liệu in!", "yellow");
                                }
                                var ids = resIn.result.map(function (r) { return r.nkinid; });

                                NUT.ds.select({
                                    url: RptIn.url + "data/ctnkin_v",
                                    where: [["nkinid", "in", ids]]
                                }, function (resCT) {
                                    if (!resCT.success) {
                                        return NUT.notify("⚠️ Không lấy được dữ liệu chi tiết!", "yellow");
                                    }

                                    var detailsByNK = {};
                                    resCT.result.forEach(function (ct) {
                                        if (!detailsByNK[ct.nkinid]) {
                                            detailsByNK[ct.nkinid] = [];
                                        }
                                        detailsByNK[ct.nkinid].push(ct);
                                    });

                                    var win = window.open("site/" + n$.user.siteid + "/" + n$.app.appid + "/RptIn.html");
                                    win.onload = function () {
                                        var templateTable = win.document.getElementById("tblData");
                                        if (!templateTable) return;

                                        var groups = [];
                                        var groupMap = {};
                                        resIn.result.forEach(function (nk) {
                                            var key = [
                                                nk.ngay ? new Date(nk.ngay).toDateString() : "",
                                                nk.ca || "",
                                                nk.toin || "",
                                                nk.totruong || ""
                                            ].join("||");
                                            if (!groupMap[key]) {
                                                groupMap[key] = {
                                                    ngay: nk.ngay,
                                                    ca: nk.ca,
                                                    toin: nk.toin,
                                                    totruong: nk.totruong,
                                                    ids: []
                                                };
                                                groups.push(groupMap[key]);
                                            }
                                            groupMap[key].ids.push(nk.nkinid);
                                        });

                                        groups.forEach(function (group, index) {
                                            var table = templateTable.cloneNode(true);
                                            table.removeAttribute("id");

                                            var firstRow = table.rows[0];
                                            firstRow.cells[0].textContent = `Ngày: ${group.ngay ? new Date(group.ngay).toLocaleDateString('vi-VN') : ""}`;
                                            firstRow.cells[1].textContent = `Ca: ${group.ca || ""}`;
                                            firstRow.cells[2].textContent = `Tổ in: ${group.toin || ""}`;
                                            firstRow.cells[3].textContent = `Tổ trưởng: ${group.totruong || ""}`;
                                            firstRow.cells[4].textContent = "";

                                            var stt = 1;
                                            group.ids.forEach(function (id) {
                                                var rows = detailsByNK[id] || [];
                                                rows.forEach(function (ct) {
                                                    var row = win.document.createElement("tr");
                                                    row.innerHTML = `
                                                        <td>${stt++}</td>                   
                                                         <td>${ct.mamau || ""}_${ct.quycach || ""}</td>        
                                                        <td>${ct.tt || ""}</td>             
                                                        <td>${ct.sotem || ""}</td>        
                                                        <td>${ct.soxe || ""}</td>           
                                                        <td>${ct.sltamdun || ""}</td>       
                                                        <td>${ct.slindat || ""}</td>        
                                                        <td>${ct.klindat || ""}</td>       
                                                        <td>${ct.soxethanhpham || ""}</td>  
                                                        <td>${ct.slloidun || ""}</td>       
                                                        <td>${ct.slloiin || ""}</td>       
                                                        <td>${ct.tomay || ""}</td>           
                                                        <td>${ct.dinhmucuv || ""}</td>      
                                                        <td>${ct.ghichuct || ""}</td>      
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
            NUT.notify("không có bản ghi nào được chọn", "yellow");
        }
    }
};