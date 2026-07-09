import { w2ui, w2grid, w2toolbar, w2form, w2tabs, w2utils } from "../lib/w2ui.es6.min.js";

export class NWin {
	constructor(id) {
		this.id = id;
	}
	buildWindow(div, conf, tabLevel, callback) {
		var divTabs = div.z(["div", { id: "tabs_" + conf.tabid + "_" + tabLevel }]);
		var tabs = [];
		for (var i = 0; i < conf.tabs.length; i++) {
			var tabconf = conf.tabs[i];
			if (tabconf.tablevel == tabLevel) {
				var divTab = div.z(["div", { id: "tab_" + tabconf.tabid, style: "height:" + (tabconf.maxLevel ? "40vh" : "90vh"), tag: tabconf }]);
				var tab = { id: tabconf.tabid, text: NUT.translate(tabconf.translate) || tabconf.tabname, div: divTab };
				this.buildContent(divTab, tabconf, callback);
				if (tabconf.tabs.length) {
					for (var l = tabLevel + 1; l <= tabconf.maxLevel; l++)
						this.buildWindow(divTab, tabconf, l, callback);
				}
				if (tabs.length) divTab.style.display = "none";
				tabs.push(tab);
			}
		}

		(w2ui[divTabs.id] || new w2tabs({
			name: divTabs.id,
			active: tabs[0].id,
			tabs: tabs,
			onClick: function (evt) {
				var id = evt.object.id;
				for (var i = 0; i < this.tabs.length; i++) {
					var tab = this.tabs[i];
					var divTab = tab.div;
					divTab.style.display = (tab.id == id) ? "" : "none";
					if (tab.id == id) NWin.updateChildGrid(divTab.tag);
				}
			}
		})).render(divTabs);
		div.parentNode.parentNode.scrollTop = 0;
	}
	cacheDmAndOpenWin(div, conf, needCaches, index) {
		var fldconf = needCaches[index];
		if (fldconf && fldconf.linktable && !fldconf.parentfieldid) {
			var that = this;
			var columnkey = fldconf.bindfieldname || fldconf.linkcolumn || fldconf.linktable.columnkey;
			var columndisplay = fldconf.linktable.columndisplay || columnkey;
			NUT.ds.select({ url: fldconf.linktable.urlview, select: [columnkey, columndisplay], where: (fldconf.whereclause ? JSON.parse(fldconf.whereclause) : null) }, function (res) {
				if (res.success) {
					var dm = { items: [NUT.DM_NIL], lookup: {}, lookdown: {} };
					for (var i = 0; i < res.result.length; i++) {
						var data = res.result[i];
						var item = [data[columnkey], data[columndisplay]];
						dm.items.push({ id: item[0], text: item[1] });
						dm.lookup[item[0]] = item;
						dm.lookdown[item[1]] = item;
					}
					NUT.dmlinks[fldconf.linktableid + (fldconf.whereclause || "")] = dm;
					if (++index < needCaches.length) that.cacheDmAndOpenWin(div, conf, needCaches, index);
					else that.buildWindow(div, conf, 0);
				} else NUT.notify("🛑 ERROR: " + res.result, "red");
			});
		} else this.buildWindow(div, conf, 0);
	}

	buildContent(div, conf, callback) {
		var lookupField = {}, columns = [], searches = [];
		for (var i = 0; i < conf.fields.length; i++) {
			var fldconf = conf.fields[i];
			lookupField[fldconf.columnname] = fldconf;
			var alias = NUT.translate(fldconf.translate) || fldconf.fieldname;
			if (fldconf.isreadonly) alias = "<i>" + alias + "</i>";
			if (!fldconf.hideingrid) {
				var column = { field: fldconf.columnname, text: alias, size: (fldconf.displaylength || 100) + "px", sortable: true, frozen: fldconf.isfrozen, resizable: true, searchable: !fldconf.hideinfind, tag: fldconf };
				if (NUT.RENDER_TYPE.includes(fldconf.fieldtype)) column.render = fldconf.fieldtype;
				else if (fldconf.fieldtype == "file") column.render = function (record, extra) {
					if (extra.value) {
						var files = JSON.parse(extra.value);
						for (var j = 0; j < files.length; j++) {
							files[j] = "<a class='nut-link' target='_blank' href='" + files[j] + "'>[ " + (j + 1) + " ]</a>";
						}
						return files.toString();
					} else return extra.value;
				}
				var domain = NWin.domainFromConfig(fldconf);
				if (domain) {
					column.domain = domain;
					column.render = function (record, obj) {
						var col = this.columns[obj.colIndex];
						var item = col.domain.lookup[obj.value];
						var val = (item ? item[1] : obj.value);
						if (item && item[2]) {
							val = "<span style='color:" + item[2] + "'>" + val + "</span>";
						}
						return val;
					}
				}
				if (!(conf.isviewonly || fldconf.isreadonly)) {
					var type = fldconf.fieldtype;
					if (fldconf.fieldtype == "textarea") type = "text";
					if (fldconf.fieldtype == "radio") type = "select";
					column.editable = { type: type };
					if (domain) column.editable.items = domain.items;
				}
				columns.push(column);
			}
		}
		if (window.DaiVietUI && DaiVietUI.fitGridColumns) DaiVietUI.fitGridColumns(columns);
		var fields = NWin.fieldsFromConfig(conf);
		var index = 0;
		for (var i = 0; i < fields.length; i++) {
			if (!fields[i].tag.hideinfind) {
				var fld = w2utils.clone(fields[i]);
				fld.required = false;
				fld.html.column = (NUT.isMobile ? 0 : (fld.colspan ? fld.colspan - 1 : index++ % conf.layoutcols));
				searches.push(fld);
			}
		}

		var divTool = div.z(["div", { id: "tool_" + conf.tabid }]);
		var divCont = div.z(["div", { id: "cont_" + conf.tabid, className: "nut-full" }]);
		var divGrid = divCont.z(["div", { id: "grid_" + conf.tabid, className: "nut-full" }]);
		var recid = conf.table.columnkey;

		opt = {
			name: divGrid.id,
			dataType: "RESTFULL",
			httpHeaders: { Authorization: "Bearer " + n$.user.token },
			limit: NUT.GRID_LIMIT,
			reorderColumns: true,
			recid: recid,

			multiSelect: true,
			markSearch: false,
			columns: columns,
			onSelect: this.grid_onSelect,
			onLoad: this.grid_onLoad,
			onRequest: this.grid_onRequest,
			onError: this.grid_onError,
			onChange: NWin.field_onChange,
			onDblClick: this.grid_onDblClick,
		}

		if (conf.table.maplayer) {
			opt.columns[0].info = { icon: 'w2ui-icon-search', style: "float:left" };
			opt.showBubble = function (row, col, summary) {
				NUT.AGMap.selectByOID(conf.table.maplayer, this.getSelection(),true);
			}
			divCont.z(["button", {className:"w2ui-btn", style:"float:right", onclick: function () {NUT.AGMap.selectByOID(conf.table.maplayer, NUT.w2ui[divForm.id].record.OBJECTID, true)}, innerHTML: "🔍 Zoom"}]);
		}
		
		if (conf.check) opt.show = { selectColumn: true };
		var grid = (w2ui[divGrid.id] || new w2grid(opt));
		if (window.DaiVietUI && DaiVietUI.fitGridColumns) DaiVietUI.fitGridColumns(grid);
		grid.searches = searches;
		grid.render(divGrid);
		if (window.DaiVietUI && DaiVietUI.scheduleResizeW2UI) DaiVietUI.scheduleResizeW2UI(20);
		if (recid) {
			if (conf.table.servicetype == "arcgis") {
				grid.url = conf.table.url + "/query";
				if (NUT.AGMap.token) grid.url += "?token=" + NUT.AGMap.token;
				//grid.proxy = NUT.URL_PROXY;
			} else grid.url = conf.table.urlview;
			if (conf.table.maplayer) NUT.AGMap.grids[conf.table.maplayer] = grid;
		}

		var divForm = divCont.z(["div", { id: "form_" + conf.tabid, className: "nut-full" }]);
		var opt = {
			name: divForm.id,
			autosize: false,
			fields: fields,
			recid: recid,
			onChange: NWin.field_onChange
		}
		var form = (w2ui[divForm.id] || new w2form(opt));
		if (conf.layout) form.formHTML = conf.layout.outerHTML;
		form.render(divForm);
		if (window.DaiVietUI && DaiVietUI.scheduleResizeW2UI) DaiVietUI.scheduleResizeW2UI(20);
		var viewonly = n$.user.isviewer || conf.table.isreadonly || conf.isviewonly;
		var access = NUT.access[conf.table.tablename] || {};
		var isArchive = access.isarchive && (conf.table.archivetype != "auto");
		var items = [{ type: 'check', id: "SWIT", text: '↔️', tooltip: "_Switch" }, { type: 'button', id: "RELO", text: '🔄', tooltip: "_Reload" }];
		if (conf.table.columntree) items.push({ type: 'check', id: "TREE", text: '🌳', tooltip: "_Tree" });
		items.push({ type: 'break' });
		if (!access.noselect) items.push({ type: 'button', id: "FIND", text: '🔎', tooltip: "_Find" });
		if (callback) items.push({ type: 'button', id: "OK", text: '_Choose', tooltip: "_Choose", callback: callback });
		if (!viewonly && !access.noinsert) items.push({ type: "button", id: "NEW", text: '📝', tooltip: "_New" });
		if (!viewonly && !access.noupdate) items.push({ type: (isArchive ? "menu" : "button"), id: (isArchive ? "save" : "SAVE"), text: '💾', tooltip: "_Save", items: [{ id: "SAVE", text: "_Save", tag: -1 }, { id: "SAVE_A", text: "_SaveA", tag: -1 }] });
		if (!viewonly && !access.nodelete) items.push({ type: (isArchive ? "menu" : "button"), id: (isArchive ? "del" : "DEL"), text: '❌', tooltip: "_Delete", items: [{ id: "DEL", text: "_Delete", tag: -1 }, { id: "DEL_A", text: "_DeleteA", tag: -1 }] });
		if (conf.table.hasattach && !viewonly && !access.noattach) items.push({ type: 'button', id: "ATTA", text: '🗂️', tooltip: "_Attach" });
		items.push({ type: 'break' });
		if (!viewonly && !access.noupdate && conf.relatetableid) items.push({ type: 'button', id: "LINK", text: '🔗', tooltip: "_Link" });
		if (!viewonly && access.islock && conf.table.columnlock) items.push({ type: 'button', id: "LOCK", text: '🔐', tooltip: "_Lock/Unlock" });
		if (access.isarchive) items.push({ type: 'menu', id: "arch", text: '🗄️', tooltip: "_Archive", items: [{ id: "ARCH", text: "_Archive", tag: -1 }, { id: "ARCH_D", text: "_ArchiveD", tag: -1 }] });
		if (conf.filterfield) {
			var filterfields = JSON.parse(conf.filterfield);
			for (var i = 0; i < filterfields.length; i++) {
				var key = filterfields[i][0];
				var val = filterfields[i][1];
				if (typeof val == "string" && val.startsWith("n$.")) val = eval(val);

				var fld = lookupField[key]
				var values = [{ id: "", text: "-/-" }];
				var dm = fld.domainid ? NUT.domains[fld.domainid] : NUT.dmlinks[fld.linktableid + (fld.whereclause || "")];
				for (var j = 0; j < dm.items.length; j++) {
					var itm = dm.items[j];
					values.push({ id: itm.id, text: itm.text });
				}
				var item = { type: 'menu-radio', id: key, items: values, tooltip: fld.fieldname, text(itm) { return itm.selected || itm.id } }
				if (val) {
					item.selected = val;
					var search = grid.getSearchData(key);
					if (search) search.value = val;
					else grid.searchData.push({ field: key, operator: "=", value: val });
				}
				items.push(item);
			}
		}
		if (conf.filterclause) {//where clause filter
			var filterclauses = JSON.parse(conf.filterclause);
			var values = [{ id: "", text: "-/-" }, { id: "", text: "" }];
			for (var i = 0; i < filterclauses.length; i++) {
				var where = NUT.ds.decodeSql({ where: filterclauses[i] });
				values.push(where);
			}
			items.push({ type: 'menu-radio', id: "FLT_" + conf.tabid, items: values, tooltip: "_Filter", text: "🌪️" });
		}

		items.push({ type: 'spacer', id: "SPACE" });
		var lookup = {};
		for (var i = 0; i < conf.menus.length; i++) {
			var menu = conf.menus[i];
			var item = { type: (menu.issummary ? 'check' : 'button'), id: menu.menuid, text: menu.menuname, tooltip: menu.description, tag: menu.execname, rpt: menu.reportid };
			if (menu.parentid) {
				var parent = lookup[menu.parentid];
				if (parent) {
					parent.type = 'menu';
					if (!parent.items) parent.items = [];
					parent.items.push(item);
				} else NUT.notify("⚠️ No menu's parent found!", "yellow");
			} else {
				items.push(item);
			}
			lookup[menu.menuid] = item;
		}
		items.push({ type: 'break' });
		if (!viewonly && !(access.noselect || access.noupdate)) items.push({ type: 'button', id: "IMP", text: '📥', tooltip: "_Import" });
		if (!access.noexport) items.push({ type: 'button', id: "EXP", text: '📤', tooltip: "_Export" });
		items.push({ type: 'break' });
		items.push({ type: 'button', id: "PREV", text: '⬅️', tooltip: "_Previous", step: -1 });
		items.push({ type: 'button', id: "NEXT", text: '➡️', tooltip: "_Next", step: +1 });
		items.push({ type: 'html', id: "STUT", html: "<div style='padding:6px'><span id='rec_" + conf.tabid + "'></span>/<span id='total_" + conf.tabid + "'></span></div>" });
		items.push({ type: 'break' });
		items.push({ type: 'check', id: "EXPD", text: "»", tooltip: "_Expand" });

		//toolbar
		(w2ui[divTool.id] || new w2toolbar({
			name: divTool.id,
			items: items,
			onClick: this.tool_onClick
		})).render(divTool);

		if (!conf.parenttabid && recid) grid.reload();
	}
	static domainFromConfig(fldconf) {
		var domain = null;
		if (fldconf.columntype != "key" && fldconf.columnname == "siteid") domain = NUT.domains[0];
		if (!domain && (fldconf.fieldtype == "select" || fldconf.fieldtype == "list")) {
			domain = fldconf.domainid ? NUT.domains[fldconf.domainid] : NUT.dmlinks[fldconf.linktableid + (fldconf.whereclause || "")];
		}
		return domain;
	}
	static fieldsFromConfig(conf) {
		var fields = [], index = 0, group = null, colGroup = null;
		conf.default = {};
		if (conf.workflowid) {
			var wf = NUT.workflows[conf.workflowid][0];
			if (wf.status) conf.default.status = wf.status;
			conf.default.roleid = n$.user.roleid;
			conf.default.userid = n$.user.userid;
			conf.default.stepid = wf.stepid;
		}
		if (!conf.layoutcols) conf.layoutcols = 3;
		for (var i = 0; i < conf.fields.length; i++) {
			var fldconf = conf.fields[i];
			if (fldconf.columntype != "key") {
				if (fldconf.columnname == "siteid") conf.default.siteid = n$.user.siteid;
				if (fldconf.columnname == "appid") conf.default.appid = n$.app.appid;
				if (fldconf.columnname == "orgid") conf.default.orgid = n$.orgid;
			}
			if (fldconf.defaultvalue) {
				if (fldconf.defaultvalue == "n$.myLocate()") {
					var colname = fldconf.columnname;
					navigator.geolocation.getCurrentPosition(function (evt) {
						conf.default[colname] = evt.coords.longitude + "," + evt.coords.latitude;
					});
				} else conf.default[fldconf.columnname] = (typeof fldconf.defaultvalue == "string" && fldconf.defaultvalue.startsWith("n$.") ? eval(fldconf.defaultvalue) : fldconf.defaultvalue);
			}
			if (!fldconf.hideinform) {
				var alias = NUT.translate(fldconf.translate) || fldconf.fieldname;
				if (fldconf.isreadonly) alias = "<i>" + alias + "</i>";

				var field = { field: fldconf.columnname, type: fldconf.fieldtype, required: fldconf.isrequire, disabled: conf.isviewonly || fldconf.isreadonly, label: alias, html: { label: alias }, options: JSON.parse(fldconf.options) || {}, tag: fldconf };
				if (fldconf.fieldname == "-") {
					field.html.label = "";
					fields[fields.length - 1].html.text = field.html.anchor = fldconf.columnname;
				} else field.html.column = NUT.isMobile ? 0 : (fldconf.colspan ? fldconf.colspan - 1 : index++ % conf.layoutcols);
				var labspan = conf.labelspan || (NUT.isGIS && !NUT.isMobile ? -1 : null);
				if (labspan) {
					field.html.span = labspan;
					field.html.style = "margin-left:16px";
				}
				if (!fldconf.parentfieldid) {
					var domain = NWin.domainFromConfig(fldconf);
					if (domain) {
						field.options.items = domain.items;
					}
				}
				if (fldconf.displaylength) field.html.attr += " style='width:" + fldconf.displaylength + "px'";
				var isGeom = fldconf.fieldtype == "point" || fldconf.fieldtype == "polyline" || fldconf.fieldtype == "polygon";
				if (fldconf.fieldtype == "search") {
					field.html.text = "<span class='nut-fld-helper'><button class='nut-but-helper' onclick='NUT.NWin.helper_onClick(this.parentNode.previousSibling,{fieldid:" + fldconf.fieldid + ",fieldtype:\"" + fldconf.fieldtype + "\",tabid:" + fldconf.tabid + ",linktableid:" + fldconf.linktableid + ",linkcolumn:\"" + (fldconf.linkcolumn || "") + "\",whereclause:\"" + (fldconf.whereclause || "") + "\"})'>&nbsp;✏️&nbsp;</button><label>-/-</label></span>";
					if (!fldconf.displaylength) field.html.attr += " style='width:40%'";
				} else if (fldconf.fieldtype == "file") {
					if (!fldconf.displaylength) field.html.attr += " style='width:100%'";
				} else if (fldconf.domainid && NUT.domains[fldconf.domainid].iseditable || fldconf.fieldtype == "arrays" || fldconf.fieldtype == "json" || fldconf.fieldtype == "QR" || isGeom) {
					field.html.text = "<span class='nut-fld-helper'><button class='nut-but-helper' onclick='NUT.NWin.helper_onClick(this.parentNode.previousSibling,{fieldid:" + fldconf.fieldid + ",fieldtype:\"" + fldconf.fieldtype + "\",tabid:" + fldconf.tabid + ",alias:\"" + field.label + "\",domainid:" + fldconf.domainid + ",isreadonly:" + (conf.isviewonly || fldconf.isreadonly) + "})'>&nbsp;" + (fldconf.domainid ? "➕" : fldconf.fieldtype == "QR" ? "📇":"✏️") + "&nbsp;</button>" + (isGeom ? "<button class='nut-but-zoom' onclick='NUT.AGMap.zoomToCoords(JSON.parse(this.parentNode.previousSibling.value),\"" + fldconf.fieldtype + "\",true)'>&nbsp;🔍&nbsp;</button>" : "") + "</span>";
				}

				if (fldconf.placeholder) field.html.attr += " placeholder='" + fldconf.placeholder + "'";
				if (fldconf.fieldlength) field.html.attr += " maxlength=" + fldconf.fieldlength;
				if (fldconf.vformat) field.html.attr += " pattern='" + fldconf.vformat + "'";

				if (fldconf.fieldgroup) {
					if (fldconf.fieldgroup != group) {
						field.html.group = fldconf.fieldgroup;
						colGroup = field.html.column;
						group = fldconf.fieldgroup;
					} else {
						field.html.column = colGroup;
					}
				}
				fields.push(field);
			}
		}
		return fields;
	}
	static dialogSizeFromFields(fields) {
		var viewW = Math.max(document.documentElement ? document.documentElement.clientWidth : 0, window.innerWidth || 0, 360);
		var viewH = Math.max(document.documentElement ? document.documentElement.clientHeight : 0, window.innerHeight || 0, 480);
		var maxCol = 0;
		for (var i = 0; i < fields.length; i++) {
			var html = fields[i].html || {};
			var col = Number(html.column || 0);
			if (!isNaN(col)) maxCol = Math.max(maxCol, col);
		}
		var cols = Math.max(1, Math.min(maxCol + 1, 3));
		var rows = Math.max(1, Math.ceil(fields.length / cols));
		var width = 400 + (cols - 1) * 240;
		var height = 150 + Math.min(rows, 8) * 48;
		if (viewW <= 760) {
			width = Math.round(viewW * 0.94);
			height = Math.min(Math.max(360, height), Math.round(viewH * 0.78));
		} else {
			width = Math.min(Math.max(440, width), Math.round(viewW * 0.72));
			height = Math.min(Math.max(360, height), Math.round(viewH * 0.72), 560);
		}
		return { width: width, height: height };
	}
	static showNewDialog(conf, forEdit) {
		var fields = NWin.fieldsFromConfig(conf);
		var grid = w2ui["grid_" + conf.tabid];
		var parentKey = grid && grid.parentRecord ? grid.parentRecord[conf.linkparentfield] : null;
		if (conf.linktable) conf.default[conf.linkchildfield] = parentKey;
		var id = (forEdit ? "edit_" : "new_") + conf.tabid;
		var size = NWin.dialogSizeFromFields(fields);
		NUT.openDialog({
			title: forEdit ? "_Update" : "_New",
			id:id,
			width: size.width,
			height: size.height,
			floating: NUT.isGIS,
			div: '<div class="nut-full dv-record-dialog" id="' + id + '"></div>',
			onOpen(evt) {
				evt.onComplete = function () {
					var div = document.getElementById(id);
					var opt = {
						name: id,
						fields: fields,
						onChange: NWin.field_onChange,
						actions: {
							"_Close": function () {
								NUT.closeDialog();
							},
							[forEdit ? "_Update" : "_New"]: function (evt) {
								if (forEdit) {
									var hasChanged = NWin.saveEditData(frmNew, grid);
									if (hasChanged) {
										if (!conf.isForm) grid.mergeChanges();
									} else NUT.notify("⚠️ No change!", "yellow");
								} else {
									if (this.validate(true).length) return;
									var recRelate = null;
									if (conf.parenttabid) {
										if (conf.relatetable) {//lien ket n-n
											recRelate = {};
											recRelate[conf.relateparentfield] = parentKey;
										} else {
											this.record[conf.linkchildfield] = parentKey;
										}
									}
									var data = {};//remove null value
									var files = [], filename = {};
									for (var key in this.record) if (this.record.hasOwnProperty(key) && this.record[key] !== null) {
										var val = this.record[key];
										if (val instanceof Object) {//file upload
											var names = [];
											for (var f in val) if (val.hasOwnProperty(f) && val[f]) {
												var file = val[f].file;
												file.guid = NUT.genGuid(file.name);
												files.push(file);
												names.push(file.guid);
											}
											filename[key] = names;
											delete data[key];//them moi khong co filename se update sau
										} else data[key] = (val === "" ? null : val);
									}
									var columnkey = conf.table.columnkey;
									if (conf.beforechange) {
										if (conf.onchange) NUT.runComponent(conf.onchange, { action: item.id, data: data, config: conf });
									} else NUT.ds.insert({ url: conf.table.urledit, data: data, returnid: data[columnkey] === undefined }, function (res) {
										if (res.success) {
											var newid = data[columnkey] || res.result[0];
											if (files.length) {//upload file
												NUT.uploadFile(conf.tableid, newid, files);
												//update file name
												for (var key in filename) if (filename.hasOwnProperty(key)) {
													for (var i = 0; i < filename[key].length; i++) {
														filename[key][i] = "media/" + n$.user.siteid + "/" + conf.tableid + "/" + newid + "/" + filename[key][i];
													}
													filename[key] = JSON.stringify(filename[key]);
													data[key] = filename[key];
												}
												NUT.ds.update({ url: conf.table.urledit, data: data, where: [columnkey, "=", newid] });
											}
											NUT.notify("Record inserted.", "lime");
											data[columnkey] = newid;

											if (grid) grid.add(data, true);
											//grid.select(newid);
											if (recRelate) {
												recRelate[conf.relatechildfiled] = data[conf.linkchildfield];
												NUT.ds.insert({ url: conf.relatetable.urledit, data: recRelate }, function (res2) {
													if (res2.success) {
														NUT.notify("Record inserted.", "lime");
													} else NUT.notify("🛑 ERROR: " + res2.result, "red");
												});
											}
											if (conf.onchange) NUT.runComponent(conf.onchange, { action: item.id, data: data, config: conf });
										} else NUT.notify("🛑 ERROR: " + res.result, "red");
									});
								}
							}
						}
					}
					/*if (conf.table.hasattach) opt.actions.custom = {
						text: '<div style="background-image:url(&quot;img/ocr.png&quot;);background-repeat:no-repeat;background-position:center"><input type="file" style="width:60px;height:20px;opacity:0" onchange="NUT.NWin.scanFile_onChange(this)" title="Upload Scan"></div>'
					}*/
					var frmNew = (w2ui[id] || new w2form(opt));
					frmNew.record = forEdit || conf.default;
					if (conf.layout) frmNew.formHTML = conf.layout.outerHTML;
					frmNew.render(div);
					if (window.DaiVietUI && DaiVietUI.scheduleResizeW2UI) DaiVietUI.scheduleResizeW2UI(20);
				}
			}
		});
	}

	static async scanFile_onChange(input) {
		var id = NUT.w2popup.options.id;
		var pnode = document.getElementById(id).parentNode;
		if (!pnode.style.display) {
			pnode.style.display = "flex";
			NUT.w2popup.options.width += 400;
			NUT.w2popup.resize();
			pnode.z(["textarea", { id: "_scanOut" + id, cols: 70 }]);
		}
		NUT.loading(input.parentNode);
		var worker = await Tesseract.createWorker('vie');
		var res = await worker.recognize(input.files[0]);
		document.getElementById("_scanOut" + NUT.w2popup.options.id).value = res.data.text;
		worker.terminate();
		NUT.loading();
	}
	
	tool_onClick(evt) {
		var item = evt.detail.item;
		var subitem = evt.detail.subItem;
		var conf = this.box.parentNode.tag;
		var grid = w2ui["grid_" + conf.tabid];
		if (subitem && subitem.tag != -1) {//-1 is tool on dropdown menu
			if (subitem.tag) {//menu
				NUT.runComponent(subitem.tag, {
					records: grid.get(grid.getSelection()),
					parent: grid.parentRecord,
					config: conf,
					checked: subitem.checked
				});
			} else {//filter
				if (item.id.startsWith("FLT_")) grid.filterWhere = subitem.id;//fitler clause
				else {
					if (subitem.id === "") {//all
						for (var i = 0; i < grid.searchData.length; i++) {
							var search = grid.searchData[i];
							if (search.field == item.id) {
								grid.searchData.splice(i, 1);
								break;
							}
						}
					} else {
						var search = grid.getSearchData(item.id);
						if (search) search.value = subitem.id;
						else grid.searchData.push({ field: item.id, operator: "=", value: subitem.id });
						if (conf.table.maplayer) {
							var where = [];
							for (var i = 0; i < grid.searchData.length; i++) {
								var clause = grid.searchData[i];
								where.push([clause.field, clause.operator, clause.value]);
							}
							if (where.length) NUT.AGMap.filterLayer(conf, where);
						}
					}
				}
			}
			grid.reload();
		} else {
			if (item.tag)//component
				NUT.runComponent(item.tag, {
					records: grid.get(grid.getSelection()),
					parent: grid.parentRecord,
					config: conf,
					checked: item.checked
				});
			else if (item.rpt) NUT.runReport(item.rpt);
			else {
				var cmd = (subitem && subitem.tag == -1 ? subitem.id : item.id);
				var columnkey = conf.table.columnkey;
				var columnlock = conf.table.columnlock;
				var form = w2ui["form_" + conf.tabid];
				var timeArchive = (conf.table.archivetype == "auto") ? new Date() : null;
				switch (cmd) {
					case "EXPD":
						document.getElementById("cont_" + conf.tabid).style.height = item.checked ? "40vh" : "90vh";
						if (conf.isForm) form.resize(); else grid.resize();
						if (window.DaiVietUI && DaiVietUI.scheduleResizeW2UI) DaiVietUI.scheduleResizeW2UI(20);
						break;
					case "SWIT":
						NWin.switchFormGrid(conf, !item.checked);
						break;
					case "TREE":
						NWin.switchTree(conf, !item.checked);
						break;
					case "RELO":
						grid.reload();
						break;
					case "PREV":
					case "NEXT":
						var i = grid.getSelection(true)[0] + item.step;
						if (grid.records[i]) {
							grid.selectNone(true);
							grid.select(grid.records[i][grid.recid]);
						}
						break;
					case "OK":
						item.callback('hello');
						break;
					case "FIND":
						//grid.searchOpen(evt.originalEvent.target);
						var id = "find_" + conf.tabid;
						NUT.openDialog({
							title: "_Find",
							floating: NUT.isGIS,
							div: '<div id="' + id + '" class="nut-full"></div>',
							onOpen(evt) {
								evt.onComplete = function () {
									var div = document.getElementById(id);
									(w2ui[id] || new w2form({
										name: id,
										fields: grid.searches,
										onChange: NWin.field_onChange,
										actions: {
											"_Close": function () {
												NUT.closeDialog();
											},
											"_Advance": function (evt) {
												NUT.closeDialog();
												grid.searchOpen();
											},
											"_Reset": function (evt) {
												this.clear();
												grid.gisWhere = null;
												grid.searchReset();
												NUT.closeDialog();
											},
											"_Find": function (evt) {
												var changes = this.getChanges();
												if (NUT.isObjectEmpty(changes))
													grid.searchData = grid.originSearch ? [grid.originSearch] : [];
												else for (var key in changes) if (changes.hasOwnProperty(key)) {
													var val = changes[key];
													var search = grid.getSearchData(key);
													if (search) search.value = val;
													else grid.searchData.push({ field: key, operator: "=", value: val });
												}
												grid.reload();
											}
										}
									})).render(div);
								}
							}
						});
						break;
					case "NEW":
						if (conf.table.servicetype == "arcgis") NUT.AGMap.showEditor(conf.table.maplayer);
						else NWin.showNewDialog(conf);
						break;
					case "SAVE_A":
						timeArchive = new Date();
					case "SAVE":
						var hasChanged = NWin.saveEditData(form, grid, timeArchive);
						if (hasChanged) {
							if (!conf.isForm) grid.mergeChanges();
						} else NUT.notify("⚠️ No change!", "yellow");
						break;
					case "DEL_A":
						timeArchive = new Date();
					case "DEL":
						var recid = grid.getSelection();
						if (recid.length) NUT.confirm('DELETE selected record?', function (awnser) {
							if (awnser == "Yes" || awnser == "yes") {
								var cancel = false;
								if (conf.beforechange) cancel = NUT.runComponent(conf.beforechange, { action: "DELETE", recid: recid, tableid: conf.tableid });
								if (!cancel) {
									//grid.autoLoad=false;/*not reload on delete*/
									if (conf.table.servicetype == "arcgis") NUT.AGMap.submit({ url: conf.table.url + "/deleteFeatures?f=json", data: "objectIds=" + recid }, function (res) {
										if (res.error) NUT.notify("🛑 ERROR: " + res.error.message, "red");
										else NUT.notify(res.deleteResults.length + " record(s) deleted.", "lime");
									});
									else NUT.ds.delete({ url: conf.table.urledit, where: [columnkey, "in", recid] }, function (res) {
										if (res.success) {
											if (timeArchive) NWin.archiveRecords("DELETE", conf.tableid, grid.get(recid), timeArchive);
											grid.total -= recid.length;
											for (var k = 0; k < recid.length; k++)grid.remove(recid[k]);
											grid.selectNone(true);
											form.clear();
											NUT.notify(recid.length + " record(s) deleted.", "lime");
											if (conf.afterchange) NUT.runComponent(conf.afterchange, { action: "DELETE", recid: recid, tableid: conf.tableid });
										} else NUT.notify("⛔ ERROR: " + res.result, "red");
									});
								}
							}
						}); else NUT.notify("⚠️ No selection!", "yellow");
						break;
					case "LINK":
						var query = { url: conf.table.urlview, orderby: conf.orderby || conf.table.columndisplay, limit: NUT.QUERY_LIMIT }
						if (conf.whereclause) query.where = JSON.parse(conf.whereclause);
						var p = {
							ids: grid.getSearchData(columnkey).value,
							query: query,
							conf: conf,
							parentKey: (grid.parentRecord ? grid.parentRecord[conf.linkparentfield] : null),
							callback: function () { grid.reload() }
						}
						NUT.linkData(p);
						break;
					case "SEARCH":
						var changes = form.getChanges();
						if (NUT.isObjectEmpty(changes))
							grid.searchData = grid.originSearch ? [grid.originSearch] : [];
						else for (var key in changes) if (changes.hasOwnProperty(key)) {
							var search = grid.getSearchData(key);
							if (search) search.value = changes[key];
							else grid.searchData.push({ field: key, operator: "=", value: changes[key] });
						}
						grid.reload();
						break;
					case "IMP":
						var cols = [];
						for (var i = 0; i < conf.fields.length; i++)cols.push(conf.fields[i].columnname);
						NUT.importXls(conf.table.urledit, cols, function (res) {
							if (res.success) {
								grid.reload();
								NUT.notify("Data updated.", "lime");
							} else NUT.notify("🛑 ERROR: " + res.result, "red");
						});
						break;
					case "EXP":
						var cols = [];
						for (var i = 0; i < conf.fields.length; i++)cols.push(conf.fields[i].columnname);

						// define where
						var where = [];
						if (conf.menuWhere) where.push(conf.menuWhere);
						if (conf.whereclause) where.push(JSON.parse(conf.whereclause));
						for (var i = 0; i < grid.searchData.length; i++) {
							var search = grid.searchData[i];
							where.push(search.operator == "begins" ? [search.field, "like", search.value + "*"] : [search.field, search.operator, search.value]);
						}
						var orderby = undefined;
						if (grid.sortData.length) {
							var sorts = [];
							for (var i = 0; i < grid.sortData.length; i++)
								sorts.push(grid.sortData[i].field + " " + grid.sortData[i].direction);
							orderby = sorts.join(',');
						}
						NUT.exportXls(conf.table.urlview, cols, where, orderby);
						break;
					case "LOCK":
						var record = conf.isForm ? form.record : grid.record;
						var label = record[columnlock] ? "🔓 Unlock" : "🔒 Lock";
						NUT.confirm(label + ' selected record?', function (awnser) {
							if (awnser == 'Yes' || awnser == "yes") {
								var data = {};
								data[columnlock] = record[columnlock] ? false : true;
								NUT.ds.update({ url: conf.table.urledit, data: data, where: [columnkey, "=", record[columnkey]] }, function (res) {
									if (res.success) {
										record[columnlock] = data[columnlock];
										conf.isForm ? form.refresh() : grid.refresh();
										NWin.updateTabLock(conf, record);
									} else NUT.notify("🛑 ERROR: " + res.result, "red");
								});
							}
						});
						break;
					case "ARCH_D":
					case "ARCH":
						var isDelArchive = (cmd == "ARCH_D");
						var recid = conf.isForm ? form.record[columnkey] : grid.getSelection();
						var url = NUT.services[conf.table.serviceid].url;
						var where = isDelArchive ? [["tableid", "=", conf.tableid], ["action", "=", "DELETE"]] : [["tableid", "=", conf.tableid], ["recordid", "=", recid]];
						NUT.ds.select({ url: url + "data/n_archive", where: where, orderby: "archivetime desc" }, function (res) {
							if (res.success && res.result.length) {
								var id = "arch_" + conf.tabid;
								NUT.openDialog({
									title: subitem.text,
									div: '<div id="' + id + '" class="nut-full"></div>',
									onOpen(evt) {
										evt.onComplete = function () {
											var div = document.getElementById(id);
											var opt = {
												name: id,
												recid: 'archiveid',
												columns: [
													{ field: 'archiveid', text: 'ID', size: 50, sortable: true },
													{ field: 'archivetime', text: 'Time', sortable: true },
													{ field: 'action', text: 'Action', sortable: true },
													{
														field: 'archivejson', text: 'Archive', size: 300, sortable: true, info: {
															render: function (rec, idx, col) {
																var obj = JSON.parse(rec.archivejson);
																var str = "<table><caption><b>" + rec.action + "</b></caption>"
																for (var key in obj) if (obj.hasOwnProperty(key))
																	str += "<tr><td align='right'><i>" + key + "</i></td><td>" + obj[key] + "</td></tr>";
																return str + "</table>";
															},
															showOn: 'mouseover'
														}
													},
													{ field: 'recordid', text: 'Record ID', sortable: true }
												]
											};
											var gridArch = (w2ui[id] || new w2grid(opt));
											var records = res.result;
											if (isDelArchive) {//build tree of recordid
												var pids = [], lookup = {};
												for (var i = 0; i < records.length; i++) {
													var rec = records[i];
													pids.push(rec.recordid);
													lookup[rec.recordid] = rec;
												}
												NUT.ds.select({ url: url + "data/n_archive", where: [["recordid", "in", pids], ["action", "=", "SAVE"]], orderby: "archivetime desc" }, function (res2) {
													if (res2.success && res2.result.length) {
														for (var i = 0; i < res2.result.length; i++) {
															var rec2 = res2.result[i];
															var parent = lookup[rec2.recordid];
															if (!parent.w2ui) parent.w2ui = { children: [] };
															parent.w2ui.children.push(rec2);
														}
													}
													gridArch.records = records;
													gridArch.render(div);
												});
											} else {
												gridArch.records = [{ archiveid: 0, archivetime: (new Date()).toISOString(), action: "NOW", archivejson: JSON.stringify(grid.record), tableid: conf.tableid, recordid: recid }].concat(records);
												gridArch.render(div);
											}
										}
									}
								});
							} else NUT.notify("⚠️ No Archive data found!", "yellow");
						});
						break;
					case "ATTA":
						if (grid.record) {
							var recid = grid.record[columnkey];
							var base = n$.user.siteid + "/" + conf.tableid + "/" + recid + "/";
							NUT.FMan.showAttach(NUT.URL_UPLOAD, base, "/media/");
						}
						break;
				}
			}
		}
	}

	static saveEditData(form, grid, timeArchive) {
		var conf = form.box.parentNode.parentNode.tag;
		var columnkey = conf.table.columnkey;
		var change = null;
		if (conf.isForm) {
			if (form.validate(true).length) return false;
			var change = form.getChanges();
			if (NUT.isObjectEmpty(change)) return false;
			else change.recid = form.original.recid
		}
		var changes = change ? [change] : grid.getChanges();
		var data = [], oldData = [], uploads = [];
		for (var i = 0; i < changes.length; i++) {
			var change = changes[i];
			var recid = change.recid;
			var record = conf.isForm ? form.original : grid.get(recid);
			var obj = {};//remove "" value
			var oldObj = {};
			var files = [];
			for (var key in change) if (change.hasOwnProperty(key)) {
				var val = change[key];
				if (key == "recid") key = columnkey;
				if (val instanceof Object) {//file upload
					val = form.record[key];
					var names = [];
					for (var f in val) if (val.hasOwnProperty(f) && val[f]) {
						var file = val[f].file;
						file.guid = NUT.genGuid(file.name);
						files.push(file);
						names.push("media/" + n$.user.siteid + "/" + conf.tableid + "/" + recid + "/" + file.guid);
					}
					obj[key] = JSON.stringify(names);
				} else obj[key] = (val === "" ? null : val);
				oldObj[key] = record[key];
			}
			data.push(obj);
			oldData.push(oldObj);
			if (files.length) uploads.push({ recid: recid, files: files });
			//if (conf.isForm)grid.set(recid, obj);
		}
		var cancel = false;
		if (data.length) {
			if (conf.beforechange) cancel = NUT.runComponent(conf.beforechange, { action: "SAVE", tableid: conf.tableid, data: data, oldData: oldData });
			if (!cancel) {
				if (conf.table.servicetype == "arcgis") {
					var features = [];
					for (var i = 0; i < data.length; i++)features.push({ attributes: data[i] });
					NUT.AGMap.submit({ url: conf.table.url + "/updateFeatures?f=json", data: "features=" + JSON.stringify(features) }, function (res) {
						if (res.error) NUT.notify("🛑 ERROR: " + res.error.message, "red");
						else NUT.notify(res.updateResults.length + " record(s) updated.", "lime");
					});
				} else NUT.ds.update({ url: conf.table.urledit, data: data, key: columnkey }, function (res) {
					if (res.success) {
						for (var i = 0; i < uploads.length; i++)
							NUT.uploadFile(conf.tableid, uploads[i].recid, uploads[i].files);//upload file
						if (timeArchive) NWin.archiveRecords("SAVE", conf.tableid, oldData, timeArchive);

						NUT.notify("Record updated.", "lime");
						if (conf.afterchange) NUT.runComponent(conf.afterchange, { action: "SAVE", tableid: conf.tableid, data: data, oldData: oldData });
					} else NUT.notify("🛑 ERROR: " + res.result, "red");
				});
			}
		}
		return data.length && !cancel;
	}
	static field_onChange(evt) {
		var conf = null;
		var field = evt.detail.field;
		var current = evt.detail.value.current;
		if (field) {//form
			conf = this.get(field).tag;
			if (conf.fieldtype == "search") {
				var ele = this.get(field).el;
				if (ele) {
					var label = ele.nextElementSibling.lastElementChild;
					if (label) NUT.ds.select({ url: conf.linktable.urlview, select: conf.linktable.columndisplay, where: [conf.linktable.columncode || conf.linktable.columnkey, "=", current] }, function (res) {
						label.innerHTML = res.success && res.result.length ? res.result[0][conf.linktable.columndisplay] : "-/-";
					});
				}
			}
			if (conf.domainid) {
				var domain = NUT.domains[conf.domainid];
				var item = domain.lookup[current];
				if (item && item[2]) this.get(field).el.style.color = item[2];
			}
		} else {
			conf = this.columns[evt.detail.column].tag;
		}
		if (conf.children.length) {//
			NWin.updateChildFields(conf, evt.data);
		}
	}
	grid_onError(evt) {
		NUT.notify(evt.detail.response.message, "red");
	}
	grid_onRequest(evt) {
		var tabconf = this.box.parentNode.parentNode.tag;
		var postData = evt.detail.postData;
		var reqData = { limit: postData.limit, offset: postData.offset };
		if (postData.sort || tabconf.orderby) reqData.orderby = (postData.sort ? postData.sort[0].field + " " + postData.sort[0].direction : tabconf.orderby);

		// define where
		var where = [];
		if (this.gisWhere) where.push([tabconf.table.columnkey, "in", this.gisWhere]);
		if (tabconf.menuWhere) where.push(tabconf.menuWhere);
		if (tabconf.whereclause) where.push(JSON.parse(tabconf.whereclause));

		if (tabconf.workflowid) {
			where.push(["roleid", "=", n$.user.roleid]);
			where.push(["userid", "in", [0, n$.user.userid]]);
		}
		if (postData.search) {
			var clauses = [postData.searchLogic.toLowerCase()];
			for (var i = 0; i < postData.search.length; i++) {
				var search = postData.search[i];
				var val = search.value;
				var op = search.operator;
				if (op == "like") {
					if (!val.includes("%")) val = "%" + val + "%";
				} else if (op == "between") {
					val = (this.operatorsMap[search.type] == "date" ? "'" + val.join("' and '") + "'" : val.join(" and "));
				} else if (val && val.includes && val.includes("%")) op = "like";
				clauses.push([search.field, op, val]);
			}
			if (clauses.length) where.push(clauses);
		}
		if (postData.select) where.push(postData.select);

		reqData.where = where.length ? NUT.ds.decodeSql({ where: where.length == 1 ? where[0] : where }, true) : "1=1";
		if (this.filterWhere) reqData.where += " and " + this.filterWhere;
		evt.detail.postData = reqData;
		this.postData = reqData;

		if (tabconf.table.servicetype == "arcgis") {
			//reqData = { resultRecordCount: postData.limit, resultOffset: postData.offset, f: "geojson", outFields: "*", returnGeometry: false };
			var query = { resultRecordCount: reqData.limit, resultOffset: reqData.offset, where: reqData.where, outFields: ["*"] }
			if (reqData.orderby) query.orderByFields = [reqData.orderby];

			var lyr = NUT.AGMap.layers[tabconf.table.maplayer];
			var grid = this;
			grid.lock(undefined, true);
			lyr.queryFeatureCount(query).then(function (total) {
				lyr.queryFeatures(query).then(function (res) {
					grid.unlock();
					if (res.error) NUT.notify("🛑 ERROR: " + res.error.message, "red");
					else {
						var records = [];
						for (var i = 0; i < res.features.length; i++)records.push(res.features[i].attributes);
						grid.requestComplete({ success: true, result: records, total: total }, "load", function () { }, function () { }, function () { });
					}
				});
			});
			evt.isCancelled = true;
		}
	}
	grid_onLoad(evt) {
		var conf = this.box.parentNode.parentNode.tag;
		var data = evt.detail.data;
		var records = data.result;

		//chuan hoa time
		if (records.length) {
			var isGeoTable = (conf.table.servicetype == "arcgis");
			for (var i = 0; i < conf.fields.length; i++) {
				var fldconf = conf.fields[i];
				var datatype = fldconf.fieldtype;
				var columnname = fldconf.columnname;
				if (datatype == "date" || datatype == "time" || datatype == "datetime") {
					var len = (datatype == "date" ? 10 : (datatype == "time" ? 5 : 16));
					for (var j = 0; j < records.length; j++) {
						var rec = records[j];
						var val = rec[columnname];
						if (val) {
							val = (isGeoTable ? new Date(val).toISOString() : val);
							if (val) rec[columnname] = (len == 16 ? val.substring(0, len).replace("T", " ") : val.substring(0, len));
						}
					}
				}
			}
			if (conf.table.columnlock) {
				var dm = NUT.domains[conf.table.lockdomainid];
				if (dm) for (var j = 0; j < records.length; j++) {
					var rec = records[j]
					var item = dm.lookup[rec[conf.table.columnlock]];
					if (item && item[3]) rec.w2ui = { editable: false };
				}
			}
		}


		var total = data.total || 0;
		evt.detail.data.status = data.success ? "success" : "error";
		evt.detail.data.records = records;
		var select = this.getSelection().length;
		evt.onComplete = function () {
			if (total) {
				if (select == 0 && !conf.check) {
					this.selectNone(true);
					this.select(records[0][this.recid]);
					this.record = records[0];
				}
				if (total == 1) {
					w2ui["tool_" + conf.tabid].check("SWIT");
					NWin.updateFormRecord(conf, this.record, this.parentRecord);
				}
			}
			NWin.switchFormGrid(conf, total == 1);
			document.getElementById("rec_" + conf.tabid).innerHTML = total ? 1 : 0;
			document.getElementById("rec_" + conf.tabid).innerHTML = total ? 1 : 0;
			document.getElementById("total_" + conf.tabid).innerHTML = total;
		}
	}
	static zoom_onClick(input, obj) {
		NUT.AGMap.zoomToCoords(JSON.parse(input.value), obj.fieldtype);
	}
	static helper_onClick(ctrl, obj, data) {
		var form = w2ui[(NUT.w2popup.status == "open" ? "new_" : "form_") + obj.tabid];
		switch (obj.fieldtype) {
			case "QR":
				var scan = null;
				var id = (NUT.w2popup.status + obj.tabid) + obj.fieldid;
				NUT.openDialog({
					title: "📇 " + obj.alias,
					width: 400,
					height: 400,
					div: "<div id='"+id+"' class='nut-full'></div>",
					onClose() {
						if(scan)scan.stop();
						document.getElementById(id).outerHTML = "";
					},
					onOpen(evt) {
						evt.onComplete = function () {
							scan = new Html5Qrcode(id);
							scan.start(
								{ facingMode: "environment" },
								{ fps: 10, qrbox: { width: 300, height: 300 } },
								function (val) {
									if (form) {
										form.rememberOriginal();
										form.setValue(ctrl.id, val);
										form.onChange({ detail: { field: ctrl.id, value: { current: val } } });
									} else ctrl.value = val;
									NUT.closeDialog();
								}
							);
						}
					},
					actions: {
						"_Close": function () {
							NUT.closeDialog();
						}
					}
				});
				break;
			case "search":
				var table = NUT.tables[obj.linktableid];
				var query = { url: table.urlview, orderby: table.columndisplay, limit: NUT.QUERY_LIMIT }
				if (obj.whereclause) query.where = JSON.parse(obj.whereclause);
				var p = {
					id: ctrl.value,
					query: query,
					conf: { table: table, linkcolumn: obj.linkcolumn },
					callback: function (rec) {
						if (rec) {
							var val = rec[obj.linkcolumn || table.columnkey];
							if (form) {
								form.rememberOriginal();
								form.setValue(ctrl.id, val);
								form.onChange({ detail: { field: ctrl.id, value: { current: val } }, data: rec });
							} else ctrl.value = val;
						}
					}
				}
				NUT.linkData(p);
				break;

			case "polygon":
				NUT.AGMap.wzSketch.visible = true;
			case "polyline":
			case "point":
				var isGeom = true;
			case "select":
			case "arrays":
			case "json":
				var isJson = (obj.fieldtype == "json");
				var id = (NUT.w2popup.status + obj.tabid) + obj.fieldid;
				var record = {};
				var v = ctrl.value;
				if (obj.domainid) data = NUT.domains[obj.domainid].data;
				if (data) record[obj.fieldtype] = data;

				else if (v) record[obj.fieldtype] = v.startsWith('[') && v.endsWith(']') ? JSON.parse(v) : [v.split(',')];
				NUT.openDialog({
					title: "✏️ " + obj.alias,
					width: 400,
					height: 360,
					floating: true,
					div: '<div id="' + id + '" class="nut-full"></div>',
					onClose(evt) {
						document.getElementById(id).outerHTML = "";
						if (isGeom) {
							NUT.AGMap.view.graphics.removeAll();
							NUT.AGMap.wzSketch.visible = false;
						}
					},
					onOpen(evt) {
						evt.onComplete = function () {
							var div = document.getElementById(id);
							if (w2ui[id]) {
								w2ui[id].record = record;
								w2ui[id].tag = ctrl;
								w2ui[id].render(div);
							} else {
								var actions = {
									"_Close": function () { NUT.closeDialog() },
									"_Update": function (evt) {
										var val = this.record[obj.fieldtype];
										if (val._order) delete val._order;

										if (!isJson) for (var i = 0; i < val.length; i++) {
											var v = val[i];
											var items = Array.isArray(v) ? v : v.split(",");
											if (isGeom) {
												var err = NUT.AGMap.ddmmss2decimal(items);
												if (!Array.isArray(err)) NUT.notify(err, "yellow");
											}
											val[i] = (items.length == 1 ? items[0] : items);
										}
										if (obj.domainid) {
											NUT.ds.get({ url: NUT.URL_TOKEN + "editdomain/" + obj.domainid, data: [JSON.stringify(val)], method: "PUT" }, function (res) {
												if (res.success) NUT.notify("Password change", "lime");
												else NUT.notify("🛑 ERROR: " + res.result, "red");
											})
											var domain = NUT.array2domain(val);
											NUT.domains[obj.domainid] = domain;
											form.set(this.tag.id, { options: { items: domain.items } });
											val = val[val.length - 1][0];
										} else val = JSON.stringify(val);

										if (form) {
											form.rememberOriginal();
											form.setValue(this.tag.id, val);
											form.onChange({ detail: { field: this.tag.id, value: { current: val } } });
										} else this.tag.value = val;

										NUT.closeDialog();
									}
								};
								if (obj.fieldtype == "point") {
									actions["🛰️ GPS"] = function () {
										navigator.geolocation.getCurrentPosition(function (evt) {
											var xy = [evt.coords.longitude, evt.coords.latitude];
											var dlg = NUT.w2ui[id];
											dlg.setValue(obj.fieldtype, [NUT.AGMap.decimal2ddmmss(xy)]);
											NUT.AGMap.zoomToCoords([xy], "point");
										});
									}
								}

								var html = { label: obj.alias, span: isJson ? -1 : 6, key: { text: " = ", attr: 'placeholder="key" style="width:120px"' } };
								if (isJson) html.value = { attr: 'placeholder="value"' };
								if (isGeom) {
									html.value = { attr: "placeholder='X,Y or DD MM SS'" };
									actions["📍 Map"] = function () {
										if (obj.fieldtype == "polygon") {
											var feat = NUT.AGMap.view.graphics.getItemAt(0);
											if (feat) {
												var data = [];
												var vertices = obj.fieldtype == "polyline" ? feat.geometry.paths[0] : feat.geometry.rings[0];
												var skip = obj.fieldtype == "polyline" ? 0 : 1;
												for (var i = 0; i < vertices.length - skip; i++) {
													var p = vertices[i];
													var xy = NUT.AGMap.webMercatorUtils.xyToLngLat(p[0], p[1]);
													data.push(NUT.AGMap.decimal2ddmmss(xy));
													//label
													NUT.AGMap.view.graphics.add({
														geometry: {
															type: "point",
															longitude: xy[0],
															latitude: xy[1]
														},
														symbol: { type: "text", text: NUT.ALPHABET[i], color: "red", haloColor: "white", haloSize: 2, font: { size: 14, weight: "bold" } }
													});
												}
												var dlg = NUT.w2ui[id];
												dlg.setValue(obj.fieldtype, data);
											} else NUT.notify("⚠️ Draw an area using sketch tool!", "yellow");
										} else {
											NUT.AGMap.callback = function (res) {
												var data = [];
												for (var i = 0; i < res.vertices.length; i++) {
													var rec = res.vertices[i];
													var xy = NUT.AGMap.webMercatorUtils.xyToLngLat(rec[0], rec[1])
													data.push(NUT.AGMap.decimal2ddmmss(xy));
												}
												var dlg = NUT.w2ui[id];
												dlg.setValue(obj.fieldtype, data);
											}
											NUT.w2ui["tbrMap"].onClick({ target: obj.fieldtype });
										}
									};
								}

								new w2form({
									name: id,
									fields: [{ field: obj.fieldtype, type: (isJson ? "map" : "array"), disabled: obj.isreadonly, html: html }],
									record: record,
									actions: actions,
									tag: ctrl
								}).render(div);
							}
						}
					}
				});
				break;
		}
	}
	grid_onSelect(evt) {
		var selid = (evt.detail.clicked ? evt.detail.clicked.recid || evt.detail.clicked.recids : evt.detail.recid);
		if (selid && this.oldid != selid) {
			var conf = this.box.parentNode.parentNode.tag;
			this.record = this.get(selid);
			var lab = document.getElementById("rec_" + conf.tabid);
			lab.innerHTML = this.get(selid, true) + 1;
			lab.tag = conf.table.columnkey + "=" + selid;
			if (this.record) {
				//n$.record = this.record;
				//n$.parent = this.parentRecord;
				NWin.updateFormRecord(conf, this.record, this.parentRecord);
				for (var i = 0; i < conf.children.length; i++)
					NWin.updateChildGrid(conf.children[i], this.record);
			}
			if (conf.table.columnlock) NWin.updateTabLock(conf, this.record);
			this.oldid = selid;
		}
	}

	static updateTabLock(conf, record) {
		var isParentLock = conf.parentTab && conf.parentTab.isLock;
		var isLock = record[conf.table.columnlock];
		if (conf.table.lockdomainid) {
			var item = NUT.domains[conf.table.lockdomainid].lookup[isLock];
			isLock = item && item[3];
		}

		var tbr = w2ui["tool_" + conf.tabid];
		conf.isLock = isLock || isParentLock;
		if (conf.isLock) {
			if (isParentLock) tbr.disable("save", "SAVE", "del", "DEL", "new", "NEW");
			else tbr.disable("save", "SAVE", "del", "DEL");
		} else tbr.enable("save", "SAVE", "del", "DEL", "new", "NEW");
	}

	static updateFormRecord(conf, record, parentRecord) {
		var form = w2ui["form_" + conf.tabid];
		form.clear();
		form.record = record;
		form.parentRecord = parentRecord;
		form.refresh();
		//fire onchange
		for (var i = 0; i < form.fields.length; i++) {
			var field = form.fields[i];
			var key = field.field;
			if (field.type == "file") {
				var ctrl = document.getElementById(key).previousElementSibling;
				if (ctrl && record[key]) {
					ctrl = ctrl.children[1].children[0];
					if (ctrl) {
						ctrl.childNodes[2].remove();
						var files = JSON.parse(record[key]);
						for (var j = 0; j < files.length; j++) {
							var a = document.createElement("a");
							a.className = "nut-link";
							a.target = "_blank";
							a.href = files[j];
							a.innerHTML = "[ " + (j + 1) + " ]";
							ctrl.appendChild(a);
						}
					}
				}
			}
			if (field.type == "search" || field.type == "select" || field.tag.children.length)
				form.onChange({ detail: { field: key, value: { current: record[key] } } });
		}
	}

	static updateChildGrid(conf, record) {
		var grid = w2ui["grid_" + conf.tabid];
		if (record) {
			grid.needUpdate = true;
			grid.parentRecord = record;
		}

		if (grid.needUpdate && !grid.box.parentNode.parentNode.style.display) {
			var parentKey = grid.parentRecord[conf.linkparentfield];
			var search = grid.getSearchData(conf.linkchildfield);
			if (conf.relatetable) {//lien ket n-n
				NUT.ds.select({ url: conf.relatetable.urlview, select: conf.relatechildfield, where: [conf.relateparentfield, "=", parentKey], limit: NUT.QUERY_LIMIT }, function (res) {
					if (res.success) {
						var ids = [];
						for (var i = 0; i < res.result.length; i++) {
							ids.push(res.result[i][conf.relatechildfield]);
						}
						if (ids.length == 0) ids = [-0.101];
						grid.originSearch = { field: conf.linkchildfield, operator: "in", value: ids };
						if (search) search.value = ids;
						else grid.searchData.push(grid.originSearch);
						grid.reload();
					} else NUT.notify("🛑 ERROR: " + res.result, "red");
				});
			} else {
				grid.originSearch = { field: conf.linkchildfield, operator: "=", value: parentKey };
				if (search) search.value = parentKey;
				else grid.searchData.push(grid.originSearch);
				grid.reload();
			}
			grid.needUpdate = false;
		}
	}
	static updateChildFields(conf, data) {
		for (var i = 0; i < conf.children.length; i++) {
			var fldconf = conf.children[i];
			var form = w2ui["form_" + fldconf.tabid];
			var grid = w2ui["grid_" + fldconf.tabid];
			if (fldconf.fieldtype == "select") {
				var field = form.get(fldconf.columnname);
				var column = grid.getColumn(fldconf.columnname);
				var where = [fldconf.wherefieldname || conf.columnname, "=", grid.record[conf.columnname]];
				if (fldconf.whereclause) where = [where, JSON.parse(fldconf.whereclause)];
				var key = fldconf.linktableid + (where || "");
				var domain = NUT.dmlinks[key];
				if (domain) {
					form.set(fldconf.columnname, { options: { items: domain.items } });
					/*if (column.editable){
						column.editable.items=domain.items;
						grid.refresh();
					}*/
				} else {
					var columnkey = fldconf.bindfieldname || fldconf.linktable.columnkey;
					var columndisplay = fldconf.linktable.columndisplay || columnkey;
					NUT.ds.select({ url: fldconf.linktable.urlview, select: [columnkey, columndisplay], where: where }, function (res) {
						if (res.success) {
							domain = { items: [NUT.DM_NIL], lookup: {}, lookdown: {} };
							for (var i = 0; i < res.result.length; i++) {
								var data = res.result[i];
								var item = { id: data[columnkey], text: data[columndisplay] };
								domain.items.push(item);
								domain.lookup[item.id] = item;
								domain.lookdown[item.text] = item;
							}
							NUT.dmlinks[key] = domain;
							form.set(fldconf.columnname, { options: { items: domain.items } });
							/*if (column.editable){
								column.editable.items=domain.items;
								grid.refresh();
							}*/
						} else NUT.notify("🛑 ERROR: " + res.result, "red");
					});
				}
			}
			if (fldconf.bindfieldname && data) {
				form.record[fldconf.columnname] = data[fldconf.bindfieldname];
				form.refresh(fldconf.columnname);
				this.updateChildFields(fldconf);
			}
			if (fldconf.calculation && grid.record) {
				var _v = [];
				for (var v = 0; v < fldconf.calculationInfos.length; v++) {
					var info = fldconf.calculationInfos[v];
					if (info.func)//childs
						_v[v] = this.calculateChilds(info);
					else if (info.tab)//parent
						_v[v] = grid.parentRecord[info.field];
					else _v[v] = grid.record[info.field];
				}
				var val = eval(fldconf.calculation);
				form.record[fldconf.columnname] = val;
				form.refresh(fldconf.columnname);
				//w2ui["grid_"+fldconf.tabid].grid.refresh();
				this.updateChildFields(fldconf);
			}
			if (fldconf.displaylogic) {
				var val = eval(fldconf.displaylogic);
				//if(panel.fields){//is form
				var el = form.get(fldconf.columnname).el;
				el.style.display = val ? "" : "none";
				el.parentNode.previousElementSibling.style.display = el.style.display;
				//}else val?panel.showColumn(fldconf.columnname):panel.hideColumn(fldconf.columnname);
			}
		}
	}
	calculateChilds(info) {
		var records = w2ui["grid_" + info.tab].records;
		var result = (info.func == "min" ? Number.MAX_VALUE : (info.func == "max" ? Number.MIN_VALUE : 0));
		for (var i = 0; i < records.length; i++) {
			value = records[i][info.field];
			switch (info.func) {
				case "avg":
				case "sum": result += value; break;
				case "count": result++; break;
				case "min": if (value < result) result = value; break;
				case "max": if (value > result) result = value; break;
			}
		}
		if (info.func == "avg") result /= res.length;
		return result;
	}

	grid_onDblClick(evt) {
		if (NUT.isObjectEmpty(this.columns[evt.detail.column].editable)) {
			var conf = this.box.parentNode.parentNode.tag;
			w2ui["tool_" + conf.tabid].check("SWIT");
			NWin.switchFormGrid(conf, true);
		}
	}
	static switchFormGrid(conf, isForm) {
		var form = w2ui["form_" + conf.tabid];
		var grid = w2ui["grid_" + conf.tabid];
		form.box.style.display = isForm ? "" : "none";
		grid.box.style.display = isForm ? "none" : "";
		isForm ? form.resize() : grid.resize();
		if (window.DaiVietUI && DaiVietUI.scheduleResizeW2UI) DaiVietUI.scheduleResizeW2UI(20);
		conf.isForm = isForm;
	}
	static switchTree(conf, isTree) {
		var form = w2ui["form_" + conf.tabid];
		var grid = w2ui["grid_" + conf.tabid];
		if (isTree) {
			var lookup = {}; var parents = []; var lookupParent = {};
			var records = grid.records;
			for (var i = 0; i < records.length; i++)lookup[records[i].recid] = records[i];
			for (var i = 0; i < records.length; i++) {
				var rec = records[i];
				var key = rec[conf.table.columntree];
				var parent = lookup[key];
				if (parent) {
					if (!parent.w2ui) parent.w2ui = { children: [] };
					parent.w2ui.children.push(rec);
					if (!lookupParent[key]) {
						parents.push(parent);
						lookupParent[key] = parent;
					}
				} else parents.push(rec);
			}
			grid.records = parents;
			grid.total = grid.records.length;
			grid.refresh();
		} else grid.reload();
		conf.isTree = isTree;
	}
	static archiveRecords(action, tableid, data, time) {
		var archives = [];
		var table = NUT.tables[tableid];
		for (var i = 0; i < data.length; i++) {
			var obj = data[i];
			var recid = obj[table.columnkey];
			var objArch = {};//remove null
			for (var key in obj) if (obj.hasOwnProperty(key) && (key != table.columnkey || action == "DELETE") && obj[key] !== null)
				objArch[key] = obj[key];
			archives.push({
				action: action,
				archivetime: time,
				archivejson: JSON.stringify(objArch),
				recordid: recid,
				tableid: tableid,
				siteid: n$.user.siteid
			});
		}
		NUT.ds.insert({ url: NUT.services[table.serviceid].url + "data/n_archive", data: archives }, function (res) {
			if (res.success) NUT.notify("Record archived.", "lime");
			else NUT.notify("🛑 ERROR: " + res.result, "red");
		});
	}
}
