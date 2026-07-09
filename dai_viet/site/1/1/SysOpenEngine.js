var SysOpenEngine = {
	run: function (p) {
		if (p.records.length) {
			var app=p.records[0]
			window.open(app.linkurl, "_blank");
		} else NUT.notify("⚠️ No Application selected!", "yellow");
	}
}