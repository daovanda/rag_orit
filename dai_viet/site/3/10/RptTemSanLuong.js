var RptTemSanLuong = {
    run: function (p) {

        if (!p.records.length)
            return NUT.notify("⚠️ Bạn chưa chọn bản ghi để in!", "yellow");

        let url = NUT.services[3].url;
        let record = p.records[0];

        NUT.ds.select({
            url: url + "data/TemSL",
            where: [["temsl_id", "=", record.temsl_id]]
        }, function (resTemSL) {

            if (!resTemSL.success || !resTemSL.result.length)
                return NUT.notify("⚠️ Không có dữ liệu nhật ký đùn!", "yellow");

            let tem = resTemSL.result[0];
            let domains = NUT.domains[1098].items;
            let nhomsp = domains.find(i => i.id == tem.nhomsp);

            if (!nhomsp)
                return NUT.notify("⚠️ Không xác định được nhóm sản phẩm!", "yellow");

            const TEMPLATE_MAP = {
                ECO: "RptTemSanLuong.html",
                PEN: "RptTemSanLuong.html",
                ICA: "RptTemslIcasa.html",
                LUX: "RptTemslLux.html",
                "LUX_E+": "RptTemslLux.html",
                OP_DN: "RptTemslTamOpDaNang.html",
                LAM: "RptaTemslLamSong.html",
                FILM: "RptTemSLmangFilm.html",
                OP_T: "TemSLoptuong.html",
                ECO_K: "RptTemslEcokin.html",
                FOAM_K: "TemslFoamKhongdan.html",
                "ECO+_K": "RptTemslEcokin.html",
            };

            const file = TEMPLATE_MAP[nhomsp.id];
            if (!file)
                return NUT.notify("⚠️ Không phù hợp!", "yellow");

            let win = window.open(
                `site/${n$.user.siteid}/${n$.app.appid}/${file}`
            );

            win.onload = function () {
                const doc = win.document;
                const template = doc.getElementById("template").outerHTML;

                let html = "";
                let pageContent = "";

                const itemsPerPage = nhomsp.id === "FOAM_K" ? 2 : 3;
                let printedCount = 0;

                for (let i = (tem.sotem_min ?? 1); i <= tem.soluongtem; i++) {

                    const qrValue = `${i}${tem.seri || ""}_${nhomsp.id || ""}`;

                    const wrap = doc.createElement("div");
                    wrap.innerHTML = template;
                    const tempRoot = wrap.firstElementChild;
                    if (!tempRoot) continue;

                    const tieudeEl = tempRoot.querySelector("#tieude");
                    if (tieudeEl) tieudeEl.textContent = nhomsp.text || "";

                    const maydunEl = tempRoot.querySelector("#maydun");
                    if (maydunEl) maydunEl.textContent = `MÁY ĐÙN: ${tem.maydun || ""}`;

                    const tomayEl = tempRoot.querySelector("#tomay");
                    if (tomayEl) tomayEl.textContent = `TỔ MÁY: ${tem.tomay || ""}`;

                    const toinEl = tempRoot.querySelector("#toin");
                    if (toinEl) toinEl.textContent = `TỔ IN: ${tem.toin || ""}`;

                    const seriEl = tempRoot.querySelector("#seri");
                    if (seriEl) seriEl.textContent = `SERI: ${qrValue}`;

                    const caEl = tempRoot.querySelector("#ca");
                    if (caEl) {
                        const oldText = (caEl.firstChild && caEl.firstChild.nodeType === Node.TEXT_NODE)
                            ? caEl.firstChild.nodeValue
                            : "";
                        const baseText = oldText ? oldText.trim() : "";
                        caEl.insertBefore(doc.createTextNode(baseText ? `${baseText} ${tem.ca || ""}` : (tem.ca || "")), caEl.firstChild);
                    }

                    const qrEl = tempRoot.querySelector(".qrcode");
                    if (qrEl) qrEl.dataset.qr = qrValue;

                    const temp = tempRoot.outerHTML;

                    pageContent += temp;
                    printedCount++;

                    // chia trang
                    if (printedCount % itemsPerPage === 0) {
                        html += `<div class="page">${pageContent}</div>`;
                        pageContent = "";
                    }
                }

                if (pageContent) {
                    html += `<div class="page">${pageContent}</div>`;
                }

                doc.body.innerHTML = html;
                doc.close();

                // render QR
                doc.querySelectorAll(".qrcode").forEach(el => {
                    const qrSize = Number(el.dataset.qrSize) || 80;

                    new QRCode(el, {
                        text: el.dataset.qr,
                        width: qrSize,
                        height: qrSize,
                        colorDark: "#000",
                        colorLight: "#fff",
                        correctLevel: QRCode.CorrectLevel.H
                    });
                });
            };
        });
    }
};