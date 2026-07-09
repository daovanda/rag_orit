var GenerateRecord = {
    run: function (p) {
        var parent = p.parent;
        let url = NUT.services[3].url;
        let tu = parent.sotem_min || 1;
        let den = parent.soluongtem || 1;

        NUT.w2popup.open({
            title: '📃 <i>Xác nhận?</i>',
            modal: true,
            width: 270,
            height: 200,
            body: `
                    <table style='margin:auto'>
                        <tr>
                            <td>In từ*</td>
                            <td><input id='datTu' type='input' value='${tu}' disabled/></td>
                        </tr>
                        <tr>
                            <td>In đến*</td>
                            <td><input id='datDen' type='input' value='${den}' disabled/></td>
                        </tr>
                    </table>
            `,
            actions: {
                "No": function () {
                    NUT.w2popup.close();
                },
                "Yes": function () {
                    let tu = parseInt(document.getElementById("datTu").value, 10);
                    let den = parseInt(document.getElementById("datDen").value, 10);

                    if (!Number.isInteger(tu) || !Number.isInteger(den) || tu <= 0 || den <= 0 || tu > den) {
                        NUT.notify("Khoảng số không hợp lệ!", "red");
                        return;
                    }

                    let total = den - tu + 1;
                    let done = 0;

                    for (let i = tu; i <= den; i++) {
                        const data = {
                            id: `${i}${parent.seri}`,
                            temsl_id: parent.temsl_id,
                            nhomsp: parent.nhomsp
                        };

                        NUT.ds.insert({
                            url: url + "data/ctTemSL",
                            data: data
                        }, function (res) {
                            done++;

                            if (!res.success) {
                                console.warn("Insert lỗi:", data.id);
                            }

                            if (done === total) {
                                let grid = NUT.w2ui["grid_" + p.config.tabid];
                                grid.reload();
								NUT.w2popup.close();
                                NUT.notify("Generate xong!", "green");
                            }
                        });
                    }
                }

            }
        })

    }
};
