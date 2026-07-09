var RptThongKe = {
    chartJS: null,
    url: NUT.services[3].url,
    run: function (p) {
        var a = NUT.createWindowTitle("RptThongKe", divTitle);
        if (!a) return;

        a.innerHTML = "📊Thống kê sản xuất";

        a.div.innerHTML = `
            <div id="divRptTabs"></div>
            <div id="divTongHop" class="nut-full"></div>       
        `;

        (NUT.w2ui['tabRpt'] || new NUT.w2tabs({
            name: 'tabRpt',
            active: 'tonghop',
            tabs: [
                { id: 'tonghop', text: 'Tổng hợp' },
                //{ id: 'chitiet', text: 'Chi tiết theo tháng' }
            ],
            onClick(evt) {
                divTongHop.style.display = evt.target === 'tonghop' ? '' : 'none';
                // divChiTiet.style.display = evt.target === 'chitiet' ? '' : 'none';
            }
        })).render(divRptTabs);

        this.initTongHop();
        this.pullData_phe();
        this.pullData_khsx_thsx();
        this.pullData_ton();
        this.pullData_may();
        this.pullData_mahang();
        this.pullData_trend();
    },

    initTongHop: function () {
        divTongHop.innerHTML = `
            <style>
                .dash-wrap{
                    display:flex;
                    flex-direction:column;
                    height:100%;
                    gap:16px;
                    padding:14px;
                    background:linear-gradient(135deg,#eef2f7,#f8fafc);
                }
                .dash-row{
                    display:flex;
                    gap:16px;
                    flex-wrap:wrap;
                }
                .dash-card{
                    flex:1;
                    min-width:280px;
                    background:rgba(255,255,255,0.95);
                    border-radius:14px;
                    box-shadow:0 6px 18px rgba(0,0,0,0.08);
                    padding:14px;
                    border:1px solid rgba(47,128,237,0.08);
                    transition:transform .2s ease, box-shadow .2s ease;
                }
                .dash-card:hover{
                    transform:translateY(-2px);
                    box-shadow:0 10px 24px rgba(0,0,0,0.1);
                }
                .dash-row:first-child .dash-card{
                    background:linear-gradient(180deg,#ffffff,#f8fbff);
                }
                .dash-kpi-title{
                    font-size:13px;
                    color:#6b7280;
                    margin-bottom:6px;
                }
                .dash-kpi-value{
                    font-size:26px;
                    font-weight:700;
                    letter-spacing:.3px;
                }
                .kpi-blue{ color:#2f80ed }
                .kpi-green{ color:#27ae60 }
                .kpi-orange{ color:#f2994a }
                .kpi-red{ color:#eb5757 }

                .dash-chart-title{
                    font-weight:600;
                    margin-bottom:10px;
                    font-size:14px;
                    color:#1f2937;
                }

                canvas{
                    height:300px !important;
                }

                @media (max-width: 1024px){
                    .dash-card{
                        min-width:calc(50% - 8px);
                    }
                }

                @media (max-width: 680px){
                    .dash-card{
                        min-width:100%;
                    }
                }
            </style>

            <div class="dash-wrap">

                <!-- KPI -->
                <div class="dash-row">
                    <div id="kpiKeHoach" class="dash-card">
                        <div class="dash-kpi-title">📦 Kế hoạch</div>
                        <div class="dash-kpi-value kpi-blue">0</div>
                    </div>

                    <div id="kpiThucTe" class="dash-card">
                        <div class="dash-kpi-title">🏭 Thực tế</div>
                        <div class="dash-kpi-value kpi-green">0</div>
                    </div>

                    <div id="kpiTyLe" class="dash-card">
                        <div class="dash-kpi-title">📈 Tỷ lệ đạt</div>
                        <div class="dash-kpi-value kpi-orange">0%</div>
                    </div>

                    <div id="kpiPhe" class="dash-card">
                        <div class="dash-kpi-title">🔥 Tỷ lệ phế</div>
                        <div class="dash-kpi-value kpi-red">0%</div>
                    </div>
                </div>

                <!-- Row 1 -->
                <div class="dash-row">
                    <div class="dash-card" style="flex:2">
                        <div class="dash-chart-title">Kế hoạch vs Thực tế</div>
                        <canvas id="chartRadar"></canvas>
                    </div>

                    <div class="dash-card">
                        <div class="dash-chart-title">Phế theo công đoạn</div>
                        <canvas id="chartPhe"></canvas>
                    </div>
                </div>

                <!-- Row 2 -->
                <div class="dash-row">
                    <div class="dash-card">
                        <div class="dash-chart-title">Tồn theo công đoạn</div>
                        <canvas id="chartTon"></canvas>
                    </div>

                    <div class="dash-card">
                        <div class="dash-chart-title">Hiệu suất theo máy</div>
                        <canvas id="chartMay"></canvas>
                    </div>
                </div>

                <!-- Row 3 -->
                <div class="dash-row">
                    <div class="dash-card">
                        <div class="dash-chart-title">Top mã hàng lỗi</div>
                        <canvas id="chartMaHang"></canvas>
                    </div>

                    <div class="dash-card">
                        <div class="dash-chart-title">Xu hướng sản xuất</div>
                        <canvas id="chartTrend"></canvas>
                    </div>
                </div>

            </div>
        `;
    },

    pullData_ton: function () {
        NUT.ds.select({
            url: this.url + "data/view_ton_congdoan"
        }, (res) => {
            if (!res.success || !res.result.length) {
                return NUT.notify("⚠️ Không có dữ liệu tồn theo công đoạn!", "yellow");
            }
            this.showChartTon(res.result);
        });
    },

    pullData_may: function () {
        NUT.ds.select({
            url: this.url + "data/view_sanxuat_theomay"
        }, (res) => {
            if (!res.success || !res.result.length) {
                return NUT.notify("⚠️ Không có dữ liệu hiệu suất theo máy!", "yellow");
            }
            this.showChartMay(res.result);
        });
    },

    pullData_mahang: function () {
        NUT.ds.select({
            url: this.url + "data/view_sanxuat_mahang"
        }, (res) => {
            if (!res.success || !res.result.length) {
                return NUT.notify("⚠️ Không có dữ liệu mã hàng lỗi!", "yellow");
            }
            this.showChartMaHang(res.result);
        });
    },

    pullData_trend: function () {
        NUT.ds.select({
            url: this.url + "data/view_sanxuat_theongay"
        }, (res) => {
            if (!res.success || !res.result.length) {
                return NUT.notify("⚠️ Không có dữ liệu xu hướng sản xuất!", "yellow");
            }
            this.showChartTrend(res.result);
        });
    },

    // Lấy dữ liệu kế hoạch và thực tế sản xuất từ server và hiển thị trên dashboard
    pullData_khsx_thsx: function () {
        NUT.ds.select({
            url: this.url + "data/dashboard_sx_v"
        }, (res) => {
            if (!res.success || !res.result.length) {
                return NUT.notify("⚠️ Không có dữ liệu!", "yellow");
            }
            this.showDashboard_khsx_thsx(res.result);
        });
    },

    // Lấy dữ liệu phế theo công đoạn và hiển thị trên dashboard
    pullData_phe: function () {
        NUT.ds.select({
            url: this.url + "data/view_phe_tonghop"
        }, (res) => {
            if (!res.success || !res.result.length) {
                return NUT.notify("⚠️ Không có dữ liệu!", "yellow");
            }
            this.showDashboard_phe(res.result);
        });
    },



    // Hàm animate số từ 0 đến end trong thời gian 800ms
    animateNumber: function (el, end, suffix = "", decimals = 0) {
        if (!el) return;
        let start = 0;
        let duration = 800;
        let startTime = null;

        function animate(time) {
            if (!startTime) startTime = time;
            let progress = time - startTime;
            let value = Math.min(progress / duration * end, end);
            let shown = Number(value).toLocaleString('vi-VN', {
                minimumFractionDigits: decimals,
                maximumFractionDigits: decimals
            });
            el.innerText = shown + suffix;

            if (progress < duration) {
                requestAnimationFrame(animate);
            }
        }

        requestAnimationFrame(animate);
    },

    KpiPhe: function () {
        var tongPhe = Number(this.tongPhe || 0);
        var tongSanLuong = Number(this.tongThucTe || 0);
        var tyLePhe = tongSanLuong > 0 ? (tongPhe * 100 / tongSanLuong) : 0;
        this.animateNumber(
            document.querySelector("#kpiPhe .dash-kpi-value"),
            tyLePhe,
            "%",
            1
        );
    },

    showChartTrend: function (data) {
        var labels = [];
        var dat = [];
        var phe = [];
        var formatTrendDate = function (value) {
            if (value == null || value === "") return "";
            var d = new Date(value);
            if (!isNaN(d.getTime())) {
                return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
            }
            var raw = String(value);
            var datePart = raw.split('T')[0].split(' ')[0];
            var m = datePart.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
            if (m) return m[3].padStart(2, '0') + '/' + m[2].padStart(2, '0');
            return raw;
        };

        data.forEach(r => {
            labels.push(formatTrendDate(r.ngay));
            dat.push(Number(r.kl_dat || 0));
            phe.push(Number(r.kl_phe || 0));
        });

        var canvas = document.querySelector('#chartTrend');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        if (this.chartTrend) this.chartTrend.destroy();

        this.chartTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Đạt',
                        data: dat,
                        borderColor: '#27ae60',
                        backgroundColor: 'rgba(39,174,96,0.15)',
                        fill: false,
                        tension: 0.25,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    },
                    {
                        label: 'Phế',
                        data: phe,
                        borderColor: '#eb5757',
                        backgroundColor: 'rgba(235,87,87,0.15)',
                        fill: false,
                        tension: 0.25,
                        pointRadius: 3,
                        pointHoverRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                var v = ctx.raw == null ? 0 : Number(ctx.raw);
                                return ctx.dataset.label + ': ' + v.toLocaleString('vi-VN') + ' kg';
                            }
                        }
                    }
                }
            }
        });
    },

    showChartMaHang: function (data) {
        data.sort((a, b) => b.kl_phe - a.kl_phe);

        var top = data.slice(0, 10);

        var labels = [];
        var values = [];

        top.forEach(r => {
            labels.push(r.mahang);
            values.push(Number(r.kl_phe || 0));
        });

        var canvas = document.querySelector('#chartMaHang');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        if (this.chartMaHang) this.chartMaHang.destroy();

        this.chartMaHang = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Phế',
                    data: values,
                    backgroundColor: '#eb5757',
                    borderRadius: 6
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                var v = ctx.raw == null ? 0 : Number(ctx.raw);
                                return v.toLocaleString('vi-VN') + ' kg';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        grid: { color: "rgba(0,0,0,0.05)" },
                        ticks: {
                            callback: function (v) {
                                return v.toLocaleString('vi-VN');
                            }
                        }
                    },
                    y: {
                        grid: { display: false }
                    }
                }
            }
        });
    },

    showChartMay: function (data) {
        var labels = [];
        var dat = [];
        var phe = [];

        data.forEach(r => {
            labels.push(r.somay);
            dat.push(Number(r.kl_dat || 0));
            phe.push(Number(r.kl_phe || 0));
        });

        var canvas = document.querySelector('#chartMay');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        if (this.chartMay) this.chartMay.destroy();

        this.chartMay = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Đạt',
                        data: dat,
                        backgroundColor: 'rgba(39,174,96,0.85)',
                        borderRadius: 6
                    },
                    {
                        label: 'Phế',
                        data: phe,
                        backgroundColor: 'rgba(235,87,87,0.85)',
                        borderRadius: 6
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                var v = ctx.raw == null ? 0 : Number(ctx.raw);
                                return ctx.dataset.label + ': ' + v.toLocaleString('vi-VN') + ' kg';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: "rgba(0,0,0,0.05)" },
                        ticks: {
                            callback: function (v) {
                                return v.toLocaleString('vi-VN');
                            }
                        }
                    }
                }
            }
        });
    },

    showChartTon: function (data) {
        var labels = [];
        var values = [];

        data.forEach(r => {
            labels.push((r.congdoan || '').toUpperCase());
            values.push(Number(r.klton || 0));
        });

        var canvas = document.querySelector('#chartTon');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');

        if (this.chartTon) this.chartTon.destroy();

        this.chartTon = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Tồn (kg)',
                    data: values,
                    backgroundColor: '#f2994a',
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: function (ctx) {
                                var v = ctx.raw == null ? 0 : Number(ctx.raw);
                                return v.toLocaleString('vi-VN') + ' kg';
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: "rgba(0,0,0,0.05)" },
                        ticks: {
                            callback: function (v) {
                                return v.toLocaleString('vi-VN');
                            }
                        }
                    }
                }
            }
        });
    },

    // Hiển thị dashboard phế theo công đoạn
    showDashboard_phe: function (data) {
        var map = {};

        data.forEach(r => {
            var cd = r.congdoan || "khac";
            if (!map[cd]) map[cd] = 0;

            var raw = (r.klphe == null ? 0 : r.klphe).toString().replace(/,/g, '');
            var val = Number(raw);
            if (!isNaN(val)) {
                map[cd] += val;
            }
        });

        var labels = [];
        var values = [];

        Object.keys(map).forEach(k => {
            labels.push(k.toUpperCase());
            var v = map[k];
            values.push(isNaN(v) ? 0 : v);
        });

        var canvas = document.querySelector('#chartPhe');
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        if (this.chartPhe) {
            this.chartPhe.destroy();
        }

        this.tongPhe = values.reduce((a, b) => a + b, 0);
        this.KpiPhe();

        this.chartPhe = new Chart(ctx, {
            type: 'bar',

            data: {
                labels: labels,
                datasets: [{
                    label: 'Khối lượng phế (kg)',
                    data: values,
                    backgroundColor: [
                        '#2f80ed', // đùn
                        '#27ae60', // in
                        '#f2994a', // dán
                        '#eb5757'  // đóng gói
                    ],
                    borderRadius: 6
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            title: function (items) {
                                return items[0] && items[0].label ? items[0].label : '';
                            },
                            label: function (ctx) {
                                var v = ctx.raw;
                                if (v == null || (typeof v === 'number' && isNaN(v))) v = 0;
                                return (Number(v)).toLocaleString('vi-VN') + ' kg';
                            }
                        }
                    }
                },
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                scales: {
                    x: {
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        grid: {
                            color: "rgba(0,0,0,0.05)"
                        },
                        ticks: {
                            callback: function (v) {
                                return v.toLocaleString('vi-VN');
                            }
                        }
                    }
                }
            }

        });
    },

    // Hiển thị dashboard kế hoạch và thực tế sản xuất
    showDashboard_khsx_thsx: function (data) {
        var tongKH = 0;
        var tongTT = 0;

        data.forEach(r => {
            tongKH += Number(r.sl_kehoach || 0);
            tongTT += Number(r.sl_thucte || 0);
        });

        var tyle = tongKH === 0 ? 0 : (tongTT * 100 / tongKH);
        this.tongThucTe = tongTT;
        this.KpiPhe();
        if (tyle < 80) {
            document.querySelector("#kpiTyLe").style.background = "#fff3f3";
        } else {
            document.querySelector("#kpiTyLe").style.background = "";
        }

        this.animateNumber(
            document.querySelector("#kpiKeHoach .dash-kpi-value"),
            tongKH
        );

        this.animateNumber(
            document.querySelector("#kpiThucTe .dash-kpi-value"),
            tongTT
        );

        this.animateNumber(
            document.querySelector("#kpiTyLe .dash-kpi-value"),
            tyle,
            "%",
            1
        );

        var labels = [];
        var kehoach = [];
        var thucte = [];

        function nhomspFull(nhomspid) {
            let domains = NUT.domains[1098].items;
            let nhomspFull = domains.find(i => i.id == nhomspid);
            if (!nhomspFull)
                return "";
            return nhomspFull.text || "";
        }

        data.forEach(r => {
            labels.push(nhomspFull(r.nhomsp));
            kehoach.push(Number(r.sl_kehoach || 0));
            thucte.push(Number(r.sl_thucte || 0));
        });


        var canvas = document.querySelector('#chartRadar');
        if (!canvas) return;

        var ctx = canvas.getContext('2d');

        if (this.chartJS) {
            this.chartJS.destroy();
        }

        this.chartJS = new Chart(ctx, {
            type: 'radar',

            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Kế hoạch',
                        data: kehoach,
                        backgroundColor: 'rgba(47,128,237,0.15)',
                        borderColor: '#2f80ed',
                        borderWidth: 2,
                        pointBackgroundColor: '#2f80ed',
                        pointRadius: 4
                    },
                    {
                        label: 'Thực tế',
                        data: thucte,
                        backgroundColor: 'rgba(39,174,96,0.15)',
                        borderColor: '#27ae60',
                        borderWidth: 2,
                        pointBackgroundColor: '#27ae60',
                        pointRadius: 4
                    }
                ]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,

                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        enabled: true,
                        callbacks: {
                            title: function (items) {
                                return items[0] && items[0].label ? items[0].label : '';
                            },
                            label: function (ctx) {
                                var v = ctx.raw;
                                if (v == null || (typeof v === 'number' && isNaN(v))) v = 0;
                                return ctx.dataset.label + ': ' + (Number(v)).toLocaleString('vi-VN');
                            }
                        }
                    }
                },

                interaction: {
                    mode: 'index',
                    intersect: false
                },

                scales: {
                    r: {
                        beginAtZero: true,

                        ticks: {
                            callback: function (v) {
                                return v.toLocaleString('vi-VN');
                            }
                        },

                        grid: {
                            color: "rgba(0,0,0,0.08)"
                        },

                        angleLines: {
                            color: "rgba(0,0,0,0.1)"
                        },

                        pointLabels: {
                            font: {
                                size: 12
                            }
                        }
                    }
                }
            }
        });
    }
};


// var RptThongKe = {
//     chartJS: null,
//     url: NUT.services[3].url,

//     dataStore: {
//         phe: [],
//         khsx_thsx: [],
//         ton: [],
//         may: [],
//         mahang: [],
//         trend: []
//     },

//     /** Giới hạn hiển thị để biểu đồ không chồng chéo khi dữ liệu rất lớn (KPI vẫn tính đủ) */
//     chartLimits: {
//         radarMaxCategories: 12,
//         mayMaxBars: 24,
//         tonMaxBars: 20,
//         trendMaxPoints: 96,
//         maHangTop: 10
//     },

//     run: function (p) {
//         var a = NUT.createWindowTitle("RptThongKe", divTitle);
//         if (!a) return;

//         a.innerHTML = "📊Thống kê sản xuất";
//         a.div.innerHTML = `
//             <div id="divRptTabs"></div>
//             <div id="toolbar"></div>
//             <div id="divTongHop" class="nut-full"></div>
//         `;

//         new NUT.w2toolbar({
//             name: 'toolbar',
//             items: [
//                 { type: 'break' },

//                 { type: 'html', id: 'from', html: '<input id="f_from" type="date">' },
//                 { type: 'html', id: 'to', html: '<input id="f_to" type="date">' },

//                 { type: 'button', id: 'apply', text: '🔍 Lọc' }
//             ],

//             onClick: (event) => {
//                 if (event.target === 'apply') {
//                     RptThongKe.applyFilter();
//                 }
//             }
//         }).render('#toolbar');


//         (NUT.w2ui['tabRpt'] || new NUT.w2tabs({
//             name: 'tabRpt',
//             active: 'tonghop',
//             tabs: [
//                 { id: 'tonghop', text: 'Tổng hợp' },
//                 // { id: 'chitiet', text: 'Chi tiết theo tháng' }
//             ],
//             onClick(evt) {
//                 divTongHop.style.display = evt.target === 'tonghop' ? '' : 'none';
//                 // divChiTiet.style.display = evt.target === 'chitiet' ? '' : 'none';
//             }
//         })).render(divRptTabs);

//         this.initTongHop();
//         this.loadAllData()
//             .then(() => this.renderAll())
//             .catch((e) => {
//                 console.error(e);
//                 if (typeof NUT.notify === 'function') {
//                     NUT.notify('Không tải được dữ liệu dashboard.', 'red');
//                 }
//             });
//     },

//     initTongHop: function () {
//         divTongHop.innerHTML = `
//             <style>
//                 .dash-wrap{
//                     display:flex;
//                     flex-direction:column;
//                     height:100%;
//                     gap:16px;
//                     padding:14px;
//                     background:linear-gradient(135deg,#eef2f7,#f8fafc);
//                 }
//                 .dash-row{
//                     display:flex;
//                     gap:16px;
//                     flex-wrap:wrap;
//                 }
//                 .dash-card{
//                     flex:1;
//                     min-width:280px;
//                     background:rgba(255,255,255,0.95);
//                     border-radius:14px;
//                     box-shadow:0 6px 18px rgba(0,0,0,0.08);
//                     padding:14px;
//                     border:1px solid rgba(47,128,237,0.08);
//                     transition:transform .2s ease, box-shadow .2s ease;
//                 }
//                 .dash-card:hover{
//                     transform:translateY(-2px);
//                     box-shadow:0 10px 24px rgba(0,0,0,0.1);
//                 }
//                 .dash-row:first-child .dash-card{
//                     background:linear-gradient(180deg,#ffffff,#f8fbff);
//                 }
//                 .dash-kpi-title{
//                     font-size:13px;
//                     color:#6b7280;
//                     margin-bottom:6px;
//                 }
//                 .dash-kpi-value{
//                     font-size:26px;
//                     font-weight:700;
//                     letter-spacing:.3px;
//                 }
//                 .kpi-blue{ color:#2f80ed }
//                 .kpi-green{ color:#27ae60 }
//                 .kpi-orange{ color:#f2994a }
//                 .kpi-red{ color:#eb5757 }

//                 .dash-chart-title{
//                     font-weight:600;
//                     margin-bottom:10px;
//                     font-size:14px;
//                     color:#1f2937;
//                 }

//                 canvas{
//                     height:300px !important;
//                 }

//                 @media (max-width: 1024px){
//                     .dash-card{
//                         min-width:calc(50% - 8px);
//                     }
//                 }

//                 @media (max-width: 680px){
//                     .dash-card{
//                         min-width:100%;
//                     }
//                 }
//             </style>

//             <div class="dash-wrap">

//                 <!-- KPI -->
//                 <div class="dash-row">
//                     <div id="kpiKeHoach" class="dash-card">
//                         <div class="dash-kpi-title">📦 Kế hoạch</div>
//                         <div class="dash-kpi-value kpi-blue">0</div>
//                     </div>

//                     <div id="kpiThucTe" class="dash-card">
//                         <div class="dash-kpi-title">🏭 Thực tế</div>
//                         <div class="dash-kpi-value kpi-green">0</div>
//                     </div>

//                     <div id="kpiTyLe" class="dash-card">
//                         <div class="dash-kpi-title">📈 Tỷ lệ đạt</div>
//                         <div class="dash-kpi-value kpi-orange">0%</div>
//                     </div>

//                     <div id="kpiPhe" class="dash-card">
//                         <div class="dash-kpi-title">🔥 Tỷ lệ phế</div>
//                         <div class="dash-kpi-value kpi-red">0%</div>
//                     </div>
//                 </div>

//                 <!-- Row 1 -->
//                 <div class="dash-row">
//                     <div class="dash-card" style="flex:2">
//                         <div class="dash-chart-title">Kế hoạch vs Thực tế</div>
//                         <canvas id="chartRadar"></canvas>
//                     </div>

//                     <div class="dash-card">
//                         <div class="dash-chart-title">Phế theo công đoạn</div>
//                         <canvas id="chartPhe"></canvas>
//                     </div>
//                 </div>

//                 <!-- Row 2 -->
//                 <div class="dash-row">
//                     <div class="dash-card">
//                         <div class="dash-chart-title">Tồn theo công đoạn</div>
//                         <canvas id="chartTon"></canvas>
//                     </div>

//                     <div class="dash-card">
//                         <div class="dash-chart-title">Hiệu suất theo máy</div>
//                         <canvas id="chartMay"></canvas>
//                     </div>
//                 </div>

//                 <!-- Row 3 -->
//                 <div class="dash-row">
//                     <div class="dash-card">
//                         <div class="dash-chart-title">Top mã hàng lỗi</div>
//                         <canvas id="chartMaHang"></canvas>
//                     </div>

//                     <div class="dash-card">
//                         <div class="dash-chart-title">Xu hướng sản xuất</div>
//                         <canvas id="chartTrend"></canvas>
//                     </div>
//                 </div>

//             </div>
//         `;
//     },

//     applyFilter: function () {
//         var from = document.getElementById('f_from').value;
//         var to = document.getElementById('f_to').value;

//         if (from && to && new Date(from) > new Date(to)) {
//             return NUT.notify("Từ ngày phải nhỏ hơn đến ngày", "yellow");
//         }

//         this.renderAll();
//     },

//     /** Gọi tất cả API một lần, song song */
//     loadAllData: function () {
//         return Promise.all([
//             this.pullData_phe(),
//             this.pullData_khsx_thsx(),
//             this.pullData_ton(),
//             this.pullData_may(),
//             this.pullData_mahang(),
//             this.pullData_trend()
//         ]);
//     },

//     /**
//      * Render KPI + charts từ dữ liệu đã lọc (theo ô from/to).
//      * @param {object} [view] — cùng cấu trúc dataStore; mặc định lọc từ dataStore hiện tại
//      */
//     renderAll: function (view) {
//         const data = view || this.getFilteredView();
//         this.showDashboard_khsx_thsx(data.khsx_thsx);
//         this.showDashboard_phe(data.phe);
//         this.showChartTon(data.ton);
//         this.showChartMay(data.may);
//         this.showChartMaHang(data.mahang);
//         this.showChartTrend(data.trend);
//     },

//     _parseRowDateMs: function (value) {
//         if (value == null || value === '') return null;
//         var d = new Date(value);
//         if (!isNaN(d.getTime())) return d.getTime();
//         var raw = String(value);
//         var datePart = raw.split('T')[0].split(' ')[0];
//         var m = datePart.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
//         if (m) {
//             var t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
//             return isNaN(t) ? null : t;
//         }
//         return null;
//     },

//     _rowDateMs: function (row) {
//         var keys = ['ngay', 'ngay_sx', 'ngaynl', 'ngay_lsx', 'ngay_ls'];
//         for (var i = 0; i < keys.length; i++) {
//             var t = this._parseRowDateMs(row[keys[i]]);
//             if (t != null) return t;
//         }
//         return null;
//     },

//     /**
//      * Lọc mảng theo from/to (chuỗi yyyy-mm-dd).
//      * Dòng không có ngày (hoặc không parse được) vẫn giữ — snapshot tổng hợp.
//      */
//     filterRows: function (rows, from, to) {
//         if (!Array.isArray(rows)) return [];
//         var fromMs = from ? new Date(from + 'T00:00:00').getTime() : null;
//         var toMs = to ? new Date(to + 'T23:59:59.999').getTime() : null;
//         var hasRange = (fromMs != null && !isNaN(fromMs)) || (toMs != null && !isNaN(toMs));

//         return rows.filter((row) => {
//             if (!hasRange) return true;
//             var t = this._rowDateMs(row);
//             if (t == null) return true;
//             if (fromMs != null && !isNaN(fromMs) && t < fromMs) return false;
//             if (toMs != null && !isNaN(toMs) && t > toMs) return false;
//             return true;
//         });
//     },

//     getFilteredView: function () {
//         var fromEl = document.getElementById('f_from');
//         var toEl = document.getElementById('f_to');
//         var from = fromEl && fromEl.value ? fromEl.value : '';
//         var to = toEl && toEl.value ? toEl.value : '';
//         var ds = this.dataStore;
//         return {
//             phe: this.filterRows(ds.phe || [], from, to),
//             khsx_thsx: this.filterRows(ds.khsx_thsx || [], from, to),
//             ton: this.filterRows(ds.ton || [], from, to),
//             may: this.filterRows(ds.may || [], from, to),
//             mahang: this.filterRows(ds.mahang || [], from, to),
//             trend: this.filterRows(ds.trend || [], from, to)
//         };
//     },

//     _sortTrendRowsByNgay: function (data) {
//         var self = this;
//         return data.slice().sort(function (a, b) {
//             var ta = self._parseRowDateMs(a.ngay) || 0;
//             var tb = self._parseRowDateMs(b.ngay) || 0;
//             return ta - tb;
//         });
//     },

//     /** Lấy mẫu đều theo thời gian khi quá nhiều điểm (giữ đầu/cuối gần đúng) */
//     _sampleRowsEvenly: function (rows, max) {
//         if (!rows.length || rows.length <= max) return rows;
//         var out = [];
//         var step = (rows.length - 1) / (max - 1);
//         for (var i = 0; i < max; i++) {
//             var idx = Math.min(rows.length - 1, Math.round(i * step));
//             out.push(rows[idx]);
//         }
//         return out;
//     },

//     /**
//      * Gom theo nhóm SP, sort theo tổng SL; nếu quá nhiều nhóm thì top (max-1) + "Khác".
//      */
//     _prepareRadarFromKhsx: function (data, nhomspFullFn) {
//         var maxCat = this.chartLimits.radarMaxCategories;
//         var map = {};
//         data.forEach(function (r) {
//             var label = nhomspFullFn(r.nhomsp) || 'Không xác định';
//             if (!map[label]) map[label] = { kehoach: 0, thucte: 0 };
//             map[label].kehoach += Number(r.sl_kehoach || 0);
//             map[label].thucte += Number(r.sl_thucte || 0);
//         });
//         var arr = Object.keys(map).map(function (k) {
//             var o = map[k];
//             return { label: k, kehoach: o.kehoach, thucte: o.thucte, sum: o.kehoach + o.thucte };
//         });
//         arr.sort(function (a, b) { return b.sum - a.sum; });
//         if (arr.length <= maxCat) {
//             return {
//                 labels: arr.map(function (x) { return x.label; }),
//                 kehoach: arr.map(function (x) { return x.kehoach; }),
//                 thucte: arr.map(function (x) { return x.thucte; }),
//                 truncated: false,
//                 totalGroups: arr.length
//             };
//         }
//         var head = arr.slice(0, maxCat - 1);
//         var tail = arr.slice(maxCat - 1);
//         var khacKh = 0;
//         var khacTt = 0;
//         tail.forEach(function (x) {
//             khacKh += x.kehoach;
//             khacTt += x.thucte;
//         });
//         head.push({
//             label: 'Khác (' + tail.length + ' nhóm)',
//             kehoach: khacKh,
//             thucte: khacTt,
//             sum: khacKh + khacTt
//         });
//         return {
//             labels: head.map(function (x) { return x.label; }),
//             kehoach: head.map(function (x) { return x.kehoach; }),
//             thucte: head.map(function (x) { return x.thucte; }),
//             truncated: true,
//             totalGroups: arr.length
//         };
//     },

//     _selectToRows: function (resolve, storeKey, url, emptyMessage) {
//         var finish = (rows) => {
//             var safe = Array.isArray(rows) ? rows : [];
//             this.dataStore[storeKey] = safe;
//             resolve(safe);
//         };
//         try {
//             NUT.ds.select({ url: url }, (res) => {
//                 try {
//                     var rows = (res && res.success && Array.isArray(res.result)) ? res.result : [];
//                     if (!rows.length && emptyMessage && typeof NUT.notify === 'function') {
//                         NUT.notify(emptyMessage, 'yellow');
//                     }
//                     finish(rows);
//                 } catch (err) {
//                     console.error(err);
//                     finish([]);
//                 }
//             });
//         } catch (err) {
//             console.error(err);
//             finish([]);
//         }
//     },

//     pullData_ton: function () {
//         return new Promise((resolve) => {
//             this._selectToRows(
//                 resolve,
//                 'ton',
//                 this.url + 'data/view_ton_congdoan',
//                 '⚠️ Không có dữ liệu tồn theo công đoạn!'
//             );
//         });
//     },

//     pullData_may: function () {
//         return new Promise((resolve) => {
//             this._selectToRows(
//                 resolve,
//                 'may',
//                 this.url + 'data/view_sanxuat_theomay',
//                 '⚠️ Không có dữ liệu hiệu suất theo máy!'
//             );
//         });
//     },

//     pullData_mahang: function () {
//         return new Promise((resolve) => {
//             this._selectToRows(
//                 resolve,
//                 'mahang',
//                 this.url + 'data/view_sanxuat_mahang',
//                 '⚠️ Không có dữ liệu mã hàng lỗi!'
//             );
//         });
//     },

//     pullData_trend: function () {
//         return new Promise((resolve) => {
//             this._selectToRows(
//                 resolve,
//                 'trend',
//                 this.url + 'data/view_sanxuat_theongay',
//                 '⚠️ Không có dữ liệu xu hướng sản xuất!'
//             );
//         });
//     },

//     pullData_khsx_thsx: function () {
//         return new Promise((resolve) => {
//             this._selectToRows(
//                 resolve,
//                 'khsx_thsx',
//                 this.url + 'data/dashboard_sx_v',
//                 '⚠️ Không có dữ liệu!'
//             );
//         });
//     },

//     pullData_phe: function () {
//         return new Promise((resolve) => {
//             this._selectToRows(
//                 resolve,
//                 'phe',
//                 this.url + 'data/view_phe_tonghop',
//                 '⚠️ Không có dữ liệu!'
//             );
//         });
//     },

//     // Hàm animate số từ 0 đến end trong thời gian 800ms
//     animateNumber: function (el, end, suffix = "", decimals = 0) {
//         if (!el) return;
//         let start = 0;
//         let duration = 800;
//         let startTime = null;

//         function animate(time) {
//             if (!startTime) startTime = time;
//             let progress = time - startTime;
//             let value = Math.min(progress / duration * end, end);
//             let shown = Number(value).toLocaleString('vi-VN', {
//                 minimumFractionDigits: decimals,
//                 maximumFractionDigits: decimals
//             });
//             el.innerText = shown + suffix;

//             if (progress < duration) {
//                 requestAnimationFrame(animate);
//             }
//         }

//         requestAnimationFrame(animate);
//     },

//     KpiPhe: function () {
//         var tongPhe = Number(this.tongPhe || 0);
//         var tongSanLuong = Number(this.tongThucTe || 0);
//         var tyLePhe = tongSanLuong > 0 ? (tongPhe * 100 / tongSanLuong) : 0;
//         this.animateNumber(
//             document.querySelector("#kpiPhe .dash-kpi-value"),
//             tyLePhe,
//             "%",
//             1
//         );
//     },

//     showChartTrend: function (data) {
//         var maxPts = this.chartLimits.trendMaxPoints;
//         var sorted = this._sortTrendRowsByNgay(data);
//         var rows = this._sampleRowsEvenly(sorted, maxPts);
//         var truncated = sorted.length > rows.length;

//         var labels = [];
//         var dat = [];
//         var phe = [];
//         var formatTrendDate = function (value) {
//             if (value == null || value === "") return "";
//             var d = new Date(value);
//             if (!isNaN(d.getTime())) {
//                 return d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
//             }
//             var raw = String(value);
//             var datePart = raw.split('T')[0].split(' ')[0];
//             var m = datePart.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
//             if (m) return m[3].padStart(2, '0') + '/' + m[2].padStart(2, '0');
//             return raw;
//         };

//         rows.forEach(function (r) {
//             labels.push(formatTrendDate(r.ngay));
//             dat.push(Number(r.kl_dat || 0));
//             phe.push(Number(r.kl_phe || 0));
//         });

//         var pr = rows.length > 48 ? 0 : (rows.length > 24 ? 2 : 3);

//         var canvas = document.querySelector('#chartTrend');
//         if (!canvas) return;
//         var ctx = canvas.getContext('2d');
//         if (this.chartTrend) this.chartTrend.destroy();

//         this.chartTrend = new Chart(ctx, {
//             type: 'line',
//             data: {
//                 labels: labels,
//                 datasets: [
//                     {
//                         label: 'Đạt',
//                         data: dat,
//                         borderColor: '#27ae60',
//                         backgroundColor: 'rgba(39,174,96,0.15)',
//                         fill: false,
//                         tension: 0.25,
//                         pointRadius: pr,
//                         pointHoverRadius: 6
//                     },
//                     {
//                         label: 'Phế',
//                         data: phe,
//                         borderColor: '#eb5757',
//                         backgroundColor: 'rgba(235,87,87,0.15)',
//                         fill: false,
//                         tension: 0.25,
//                         pointRadius: pr,
//                         pointHoverRadius: 6
//                     }
//                 ]
//             },
//             options: {
//                 responsive: true,
//                 maintainAspectRatio: false,
//                 interaction: {
//                     mode: 'index',
//                     intersect: false
//                 },
//                 plugins: {
//                     subtitle: truncated ? {
//                         display: true,
//                         text: 'Hiển thị ' + rows.length + ' điểm / ' + sorted.length + ' ngày (rút gọn để dễ xem)',
//                         color: '#6b7280',
//                         font: { size: 11 },
//                         padding: { bottom: 4 }
//                     } : { display: false },
//                     tooltip: {
//                         callbacks: {
//                             label: function (ctx) {
//                                 var v = ctx.raw == null ? 0 : Number(ctx.raw);
//                                 return ctx.dataset.label + ': ' + v.toLocaleString('vi-VN') + ' kg';
//                             }
//                         }
//                     }
//                 },
//                 scales: {
//                     x: {
//                         ticks: {
//                             maxRotation: 45,
//                             autoSkip: true,
//                             maxTicksLimit: 18
//                         }
//                     }
//                 }
//             }
//         });
//     },

//     showChartMaHang: function (data) {
//         data.sort((a, b) => b.kl_phe - a.kl_phe);

//         var topN = this.chartLimits.maHangTop;
//         var top = data.slice(0, topN);

//         var labels = [];
//         var values = [];

//         top.forEach(r => {
//             labels.push(r.mahang);
//             values.push(Number(r.kl_phe || 0));
//         });

//         var canvas = document.querySelector('#chartMaHang');
//         if (!canvas) return;
//         var ctx = canvas.getContext('2d');
//         if (this.chartMaHang) this.chartMaHang.destroy();

//         var mhTrunc = data.length > topN;

//         this.chartMaHang = new Chart(ctx, {
//             type: 'bar',
//             data: {
//                 labels: labels,
//                 datasets: [{
//                     label: 'Phế',
//                     data: values,
//                     backgroundColor: '#eb5757',
//                     borderRadius: 6
//                 }]
//             },
//             options: {
//                 indexAxis: 'y',
//                 responsive: true,
//                 maintainAspectRatio: false,
//                 plugins: {
//                     subtitle: mhTrunc ? {
//                         display: true,
//                         text: 'Top ' + topN + ' mã / ' + data.length + ' mã (theo phế)',
//                         color: '#6b7280',
//                         font: { size: 11 },
//                         padding: { bottom: 4 }
//                     } : { display: false },
//                     legend: { display: false },
//                     tooltip: {
//                         callbacks: {
//                             label: function (ctx) {
//                                 var v = ctx.raw == null ? 0 : Number(ctx.raw);
//                                 return v.toLocaleString('vi-VN') + ' kg';
//                             }
//                         }
//                     }
//                 },
//                 scales: {
//                     x: {
//                         beginAtZero: true,
//                         grid: { color: "rgba(0,0,0,0.05)" },
//                         ticks: {
//                             callback: function (v) {
//                                 return v.toLocaleString('vi-VN');
//                             }
//                         }
//                     },
//                     y: {
//                         grid: { display: false }
//                     }
//                 }
//             }
//         });
//     },

//     showChartMay: function (data) {
//         var cap = this.chartLimits.mayMaxBars;
//         var sorted = data.slice().sort(function (a, b) {
//             var sa = Number(a.kl_dat || 0) + Number(a.kl_phe || 0);
//             var sb = Number(b.kl_dat || 0) + Number(b.kl_phe || 0);
//             return sb - sa;
//         });
//         var slice = sorted.slice(0, cap);
//         var truncated = sorted.length > slice.length;

//         var labels = [];
//         var dat = [];
//         var phe = [];

//         slice.forEach(function (r) {
//             labels.push(r.somay);
//             dat.push(Number(r.kl_dat || 0));
//             phe.push(Number(r.kl_phe || 0));
//         });

//         var canvas = document.querySelector('#chartMay');
//         if (!canvas) return;
//         var ctx = canvas.getContext('2d');
//         if (this.chartMay) this.chartMay.destroy();

//         this.chartMay = new Chart(ctx, {
//             type: 'bar',
//             data: {
//                 labels: labels,
//                 datasets: [
//                     {
//                         label: 'Đạt',
//                         data: dat,
//                         backgroundColor: 'rgba(39,174,96,0.85)',
//                         borderRadius: 6
//                     },
//                     {
//                         label: 'Phế',
//                         data: phe,
//                         backgroundColor: 'rgba(235,87,87,0.85)',
//                         borderRadius: 6
//                     }
//                 ]
//             },
//             options: {
//                 indexAxis: 'y',
//                 responsive: true,
//                 maintainAspectRatio: false,
//                 plugins: {
//                     subtitle: truncated ? {
//                         display: true,
//                         text: 'Top ' + slice.length + ' máy / ' + sorted.length + ' máy (theo tổng Đạt+Phế)',
//                         color: '#6b7280',
//                         font: { size: 11 },
//                         padding: { bottom: 4 }
//                     } : { display: false },
//                     legend: { position: 'top' },
//                     tooltip: {
//                         callbacks: {
//                             label: function (ctx) {
//                                 var v = ctx.raw == null ? 0 : Number(ctx.raw);
//                                 return ctx.dataset.label + ': ' + v.toLocaleString('vi-VN') + ' kg';
//                             }
//                         }
//                     }
//                 },
//                 scales: {
//                     x: {
//                         beginAtZero: true,
//                         grid: { color: "rgba(0,0,0,0.05)" },
//                         ticks: {
//                             callback: function (v) {
//                                 return v.toLocaleString('vi-VN');
//                             }
//                         }
//                     },
//                     y: {
//                         grid: { display: false },
//                         ticks: {
//                             autoSkip: true,
//                             maxTicksLimit: 24
//                         }
//                     }
//                 }
//             }
//         });
//     },

//     showChartTon: function (data) {
//         var cap = this.chartLimits.tonMaxBars;
//         var sorted = data.slice().sort(function (a, b) {
//             return Number(b.klton || 0) - Number(a.klton || 0);
//         });
//         var slice = sorted.slice(0, cap);
//         var truncated = sorted.length > slice.length;

//         var labels = [];
//         var values = [];

//         slice.forEach(function (r) {
//             labels.push((r.congdoan || '').toUpperCase());
//             values.push(Number(r.klton || 0));
//         });

//         var canvas = document.querySelector('#chartTon');
//         if (!canvas) return;
//         var ctx = canvas.getContext('2d');

//         if (this.chartTon) this.chartTon.destroy();

//         this.chartTon = new Chart(ctx, {
//             type: 'bar',
//             data: {
//                 labels: labels,
//                 datasets: [{
//                     label: 'Tồn (kg)',
//                     data: values,
//                     backgroundColor: '#f2994a',
//                     borderRadius: 6
//                 }]
//             },
//             options: {
//                 indexAxis: 'y',
//                 responsive: true,
//                 maintainAspectRatio: false,
//                 plugins: {
//                     subtitle: truncated ? {
//                         display: true,
//                         text: 'Top ' + slice.length + ' công đoạn / ' + sorted.length + ' (theo tồn)',
//                         color: '#6b7280',
//                         font: { size: 11 },
//                         padding: { bottom: 4 }
//                     } : { display: false },
//                     legend: { display: false },
//                     tooltip: {
//                         callbacks: {
//                             label: function (ctx) {
//                                 var v = ctx.raw == null ? 0 : Number(ctx.raw);
//                                 return v.toLocaleString('vi-VN') + ' kg';
//                             }
//                         }
//                     }
//                 },
//                 scales: {
//                     x: {
//                         beginAtZero: true,
//                         grid: { color: "rgba(0,0,0,0.05)" },
//                         ticks: {
//                             callback: function (v) {
//                                 return v.toLocaleString('vi-VN');
//                             }
//                         }
//                     },
//                     y: {
//                         grid: { display: false },
//                         ticks: {
//                             autoSkip: true,
//                             maxTicksLimit: 20
//                         }
//                     }
//                 }
//             }
//         });
//     },

//     // Hiển thị dashboard phế theo công đoạn
//     showDashboard_phe: function (data) {
//         var map = {};

//         data.forEach(r => {
//             var cd = r.congdoan || "khac";
//             if (!map[cd]) map[cd] = 0;

//             var raw = (r.klphe == null ? 0 : r.klphe).toString().replace(/,/g, '');
//             var val = Number(raw);
//             if (!isNaN(val)) {
//                 map[cd] += val;
//             }
//         });

//         var labels = [];
//         var values = [];

//         Object.keys(map).forEach(k => {
//             labels.push(k.toUpperCase());
//             var v = map[k];
//             values.push(isNaN(v) ? 0 : v);
//         });

//         var canvas = document.querySelector('#chartPhe');
//         if (!canvas) return;
//         var ctx = canvas.getContext('2d');
//         if (this.chartPhe) {
//             this.chartPhe.destroy();
//         }

//         this.tongPhe = values.reduce((a, b) => a + b, 0);
//         this.KpiPhe();

//         this.chartPhe = new Chart(ctx, {
//             type: 'bar',

//             data: {
//                 labels: labels,
//                 datasets: [{
//                     label: 'Khối lượng phế (kg)',
//                     data: values,
//                     backgroundColor: [
//                         '#2f80ed', // đùn
//                         '#27ae60', // in
//                         '#f2994a', // dán
//                         '#eb5757'  // đóng gói
//                     ],
//                     borderRadius: 6
//                 }]
//             },
//             options: {
//                 responsive: true,
//                 maintainAspectRatio: false,
//                 plugins: {
//                     legend: { display: false },
//                     tooltip: {
//                         enabled: true,
//                         callbacks: {
//                             title: function (items) {
//                                 return items[0] && items[0].label ? items[0].label : '';
//                             },
//                             label: function (ctx) {
//                                 var v = ctx.raw;
//                                 if (v == null || (typeof v === 'number' && isNaN(v))) v = 0;
//                                 return (Number(v)).toLocaleString('vi-VN') + ' kg';
//                             }
//                         }
//                     }
//                 },
//                 interaction: {
//                     mode: 'index',
//                     intersect: false
//                 },
//                 scales: {
//                     x: {
//                         grid: { display: false }
//                     },
//                     y: {
//                         beginAtZero: true,
//                         grid: {
//                             color: "rgba(0,0,0,0.05)"
//                         },
//                         ticks: {
//                             callback: function (v) {
//                                 return v.toLocaleString('vi-VN');
//                             }
//                         }
//                     }
//                 }
//             }

//         });
//     },

//     // Hiển thị dashboard kế hoạch và thực tế sản xuất
//     showDashboard_khsx_thsx: function (data) {
//         var tongKH = 0;
//         var tongTT = 0;

//         data.forEach(r => {
//             tongKH += Number(r.sl_kehoach || 0);
//             tongTT += Number(r.sl_thucte || 0);
//         });

//         var tyle = tongKH === 0 ? 0 : (tongTT * 100 / tongKH);
//         this.tongThucTe = tongTT;
//         this.KpiPhe();
//         if (tyle < 80) {
//             document.querySelector("#kpiTyLe").style.background = "#fff3f3";
//         } else {
//             document.querySelector("#kpiTyLe").style.background = "";
//         }

//         this.animateNumber(
//             document.querySelector("#kpiKeHoach .dash-kpi-value"),
//             tongKH
//         );

//         this.animateNumber(
//             document.querySelector("#kpiThucTe .dash-kpi-value"),
//             tongTT
//         );

//         this.animateNumber(
//             document.querySelector("#kpiTyLe .dash-kpi-value"),
//             tyle,
//             "%",
//             1
//         );

//         function nhomspFull(nhomspid) {
//             let domains = NUT.domains[1098].items;
//             let nhomspFull = domains.find(i => i.id == nhomspid);
//             if (!nhomspFull)
//                 return "";
//             return nhomspFull.text || "";

//         }

//         var radar = this._prepareRadarFromKhsx(data, nhomspFull);
//         var labels = radar.labels;
//         var kehoach = radar.kehoach;
//         var thucte = radar.thucte;
//         var plSize = labels.length > 10 ? 9 : (labels.length > 7 ? 10 : 12);

//         var canvas = document.querySelector('#chartRadar');
//         if (!canvas) return;

//         var ctx = canvas.getContext('2d');

//         if (this.chartJS) {
//             this.chartJS.destroy();
//         }

//         this.chartJS = new Chart(ctx, {
//             type: 'radar',

//             data: {
//                 labels: labels,
//                 datasets: [
//                     {
//                         label: 'Kế hoạch',
//                         data: kehoach,
//                         backgroundColor: 'rgba(47,128,237,0.15)',
//                         borderColor: '#2f80ed',
//                         borderWidth: 2,
//                         pointBackgroundColor: '#2f80ed',
//                         pointRadius: 4
//                     },
//                     {
//                         label: 'Thực tế',
//                         data: thucte,
//                         backgroundColor: 'rgba(39,174,96,0.15)',
//                         borderColor: '#27ae60',
//                         borderWidth: 2,
//                         pointBackgroundColor: '#27ae60',
//                         pointRadius: 4
//                     }
//                 ]
//             },

//             options: {
//                 responsive: true,
//                 maintainAspectRatio: false,

//                 plugins: {
//                     subtitle: radar.truncated ? {
//                         display: true,
//                         text: 'Gom ' + radar.totalGroups + ' nhóm SP → tối đa ' + this.chartLimits.radarMaxCategories + ' trục (phần còn lại gộp "Khác")',
//                         color: '#6b7280',
//                         font: { size: 11 },
//                         padding: { bottom: 4 }
//                     } : { display: false },
//                     legend: { position: 'top' },
//                     tooltip: {
//                         enabled: true,
//                         callbacks: {
//                             title: function (items) {
//                                 return items[0] && items[0].label ? items[0].label : '';
//                             },
//                             label: function (ctx) {
//                                 var v = ctx.raw;
//                                 if (v == null || (typeof v === 'number' && isNaN(v))) v = 0;
//                                 return ctx.dataset.label + ': ' + (Number(v)).toLocaleString('vi-VN');
//                             }
//                         }
//                     }
//                 },

//                 interaction: {
//                     mode: 'index',
//                     intersect: false
//                 },

//                 scales: {
//                     r: {
//                         beginAtZero: true,

//                         ticks: {
//                             callback: function (v) {
//                                 return v.toLocaleString('vi-VN');
//                             }
//                         },

//                         grid: {
//                             color: "rgba(0,0,0,0.08)"
//                         },

//                         angleLines: {
//                             color: "rgba(0,0,0,0.1)"
//                         },

//                         pointLabels: {
//                             font: {
//                                 size: plSize
//                             }
//                         }
//                     }
//                 }
//             }
//         });
//     }
// };
