var ImportDuLieuSet = {
	run: function (p) {
		ImportDuLieuSet.url = NUT.services[5].url;
		var now=new Date();
		NUT.w2popup.open({
			title: '📥 <i>Import dữ liệu sét</i>',
			modal: true,
			width: 360,
			height: 180,
			body: "<table style='margin:auto'><tr><td align='right'>Thời điểm</td><td><input type='datetime' id='txtThoiDiem' class='w2ui-input' value='"+now.getFullYear()+"-"+(now.getMonth+1)+"-"+now.getDate()+" "+now.getHours()+":"+now.getMinutes()+":"+now.getSeconds()+"'/></td></tr><tr><td align='right'>Loại sét</td><td><select id='cboLoaiSet'><option></option><option value='CG'>Sét xuống đất</option><option value='CP'>Sét trong mây</option></select></td></tr></table>",
			actions: {
				"_Cancel": function () {
					NUT.w2popup.close();
				}, "_Ok": function () {
					var date=datNgay.valueAsDate;
					var nam=date.getFullYear();
					var thang=date.getMonth()+1;
					var ngay=date.getDate();
					NUT.ds.select({url:ImportDuLieuSet.url+"data/sethistory",select:"max(thoigian)"},function (res2) {
						if (res2.success&&res2.result.length) {
							NUT.ds.get({url:URL_PROXY+"https://set.evnhanoi.vn/rest/proxy?http://10.2.60.1:8080/cp4/dbserver/LdQuery.php?format=default&s=2025-07-20+00:00:00&e=2025-07-22+00:00:00&ll=20.510958&ul=21.459775&lg=105.163522&ug=106.078134&nocloud=checked"},function(res){
								if(res.success){
									var data=[];
									for(var i=0;i<res.result.length;i++){
										var rec=res.result[i].split('\t');
										var tg=new Date(rec[0]);
										data.push({loaiset:'CG',thoigian:tg,lat:rec[1],lng:rec[2],giatri:rec[3],nam:tg.getFullYear(),thang:tg.getMonth()+1,ngay:tg.getDate(),gio:tg.getHours()});
									}
									NUT.ds.insert({url:ImportDuLieuSet.url+"data/sethistory",data:data},function(res3){
										if(res3.success)NUT.notify("Import dữ liệu sét thành công", "lime");
										else NUT.notify("🛑 ERROR: " + res3.result, "red");
									});
								}else NUT.notify("🛑 ERROR: " + res.result, "red");
							});
						}
					});
					
				}
			}
		});
	}
}