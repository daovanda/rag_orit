var SysAddMissColumn={
	run:function(p){
		if(p.records.length){
			var table=p.records[0];
			var service=p.parent;
			NUT.confirm("Add missing columns for table '"+table.tablename+"'?",function(evt){
				if (evt == "yes") {
					switch (service.servicetype) {
						case "sqlrest":
							NUT.ds.get({ url: service.url + table.tabletype+ "/" + table.tablename + "?detail=true" }, function (res) {
								if (res.success)SysAddMissColumn.addMissColumn(table.tableid, res.result.columns);
								else NUT.notify("⛔ ERROR: " + res.result, "red");
							});
							break;
						case "arcgis":
							NUT.AGMap.generateToken(service,function(error){
								if (error) NUT.notify("⛔ ERROR: " + error.message, "red");
								else {
									var isGeo = table.tabletype == "arcgis";
									if (service.url.endsWith("/MapServer")) NUT.AGMap.get({ url: NUT.URL_PROXY + table.url + "?f=json" }, function (res2) {
										if (res2.fields) SysAddMissColumn.addMissColumn(table.tableid, res2.fields,isGeo);
										else NUT.notify("⛔ ERROR: " + res2.result, "red");
									});
									else NUT.AGMap.get({ url: table.url + "?f=json",token:NUT.AGMap.token }, function (res2) {
										if (res2.fields)SysAddMissColumn.addMissColumn(table.tableid, res2.fields,isGeo);
										else NUT.notify("⛔ ERROR: " + res2.result, "red");
									});
								}
							})
							break;
						default: NUT.notify("⚠️ Service type is not support!", "yellow");
					}
					
				}
			});
		} else NUT.notify("⚠️ No table selected!","yellow");
	},
	
	addMissColumn: function (tableid, colInfo, isGeo) {
		NUT.ds.select({ url: NUT.URL + "n_column", select: "columnname", where: ["tableid", "=", tableid] }, function (res) {
			if (res.success) {
				var lookup = {};
				for (var i = 0; i < res.result.length; i++)lookup[res.result[i].columnname] = true;
				var cols = [];
				for (var i = 0; i < colInfo.length;i++) {
					var info = colInfo[i];
					if (!lookup[info.name]) {
						var col = {
							tableid: tableid,
							columnname: (isGeo ? info.fieldName || info.name : info.name),
							alias: (isGeo ? info.label || info.alias : info.alias),
							seqno: i,
							datatype: (isGeo ? (info.type ? info.type.substring(13) : "text") : info.dataType),
							length: (isGeo ? info.length || null : info.length),
							isnotnull: (isGeo ? null : !info.nullable),
							defaultvalue: (isGeo ? null : info.defaultValue),
							siteid: n$.user.siteid
						};
						if (info.inPrimaryKey || (isGeo && (info.fieldName || info.name == "OBJECTID"))) col.columntype = "key";
						cols.push(col);
					}
				}
				if (cols.length) {
					NUT.ds.insert({ url: NUT.URL + "n_column", data: cols }, function (res2) {
						if (res2.success) NUT.notify(cols.length + " columns added.", "lime");
						else NUT.notify("⛔ ERROR: " + res2.result, "red");
					});
				}else NUT.notify("⚠️ No missing columns", "yellow", document.activeElement);
			} else NUT.notify("⛔ ERROR: " + res.result, "red");
		});
	}
}