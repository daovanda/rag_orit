import { w2ui, w2layout, w2toolbar, w2form, w2utils, w2popup, w2sidebar, w2tooltip, w2confirm, w2tabs, w2menu, w2grid, w2alert, w2prompt } from "../lib/w2ui.es6.min.js";
import { NWin } from "./window.js?v=20260707-modal1";
import { SqlREST } from "./sqlrest.js";
import { AGMap } from "./agmap.js";
import { FMan } from "./fileman.js";
w2utils.settings.dataType = "RESTFULL";

NUT.ds = SqlREST;
NUT.AGMap = AGMap;
NUT.NWin = NWin;
NUT.FMan = FMan;

NUT.w2ui = w2ui;
NUT.w2utils = w2utils;
NUT.w2confirm = w2confirm;	
NUT.w2popup = w2popup;
NUT.w2form = w2form;
NUT.w2layout = w2layout;
NUT.w2toolbar = w2toolbar;
NUT.w2sidebar = w2sidebar;
NUT.w2tooltip = w2tooltip;
NUT.w2tabs = w2tabs;
NUT.w2menu = w2menu;
NUT.w2grid = w2grid;
NUT.w2alert = w2alert;
NUT.w2prompt = w2prompt;


window.onload = function () {
	n$.theme = window.DaiVietUI ? DaiVietUI.currentTheme() : (localStorage.getItem("theme") || "sp");
	cssMain.href = "lib/" + n$.theme + ".css";
	if (window.DaiVietUI) DaiVietUI.applyTheme(n$.theme);
	n$.user = null;
	NUT.isMobile = w2utils.isMobile;
	document.body.classList.add("dv-login-screen");
	document.body.innerHTML = '<div id="divLogin"></div>';
	w2utils.locale(localStorage.getItem("locale") || w2utils.settings.locale).then(function (evt) {
		n$.locale = evt.data.locale;
		n$.lang = n$.locale.substring(0, 2);
		var cookie = NUT.cookie();
		(w2ui["frmLogin"] || new w2form({
			name: "frmLogin",
			style: "width:380px;height:330px;margin:0;overflow:hidden",
			//formHTML: divLogin.innerHTML,
			header: "_NUT",
			fields: [
				{ field: 'username', type: 'text', required: true, html: { label: "_Username", attr: "autocomplete='username'" } },
				{ field: 'sitecode', type: 'text', required: true, html: { label: "_Site", attr: "autocomplete='organization'" } },
				{ field: 'password', type: 'password', required: true, html: { label: "_Password", attr: "autocomplete='current-password'" } },
				{ field: 'savepass', type: 'checkbox', html: { label: w2utils.lang("_Remember") } }
			],
			record: cookie,
			actions: {
				"_Help": function () {
					window.open('help.html');
				},
				"_Login": function () {
					if (this.validate(true).length == 0) {
						var rec = this.record;
						login(rec);
						/*cookie.password ? login(rec) : NUT.w2utils.sha256(rec.password).then(function (md5) {
							rec.password = md5;
							login(rec);
						});*/
					}
				}
			},
		})).render(divLogin);

		document.body.z(["div", { className: "dv-login-options" },
			[["label", { innerHTML: w2utils.lang("_Language"), style: "color:gray" }], ["select", {
				innerHTML: "<option value='en-US'>🇺🇸-English</option><option value='vi-VN'>🇻🇳-Tiếng Việt</option>",
				value: evt.data.locale,
				onchange: function () {
					localStorage.setItem("locale", this.value);
					location.reload()
				}
			}], ["label", { innerHTML: w2utils.lang("_Theme"), style: "color:gray" }], ["select", {
				innerHTML: "<option value='sp'>Light</option><option value='sp-dark'>Dark</option>",
				value: n$.theme,
				onchange: function () {
					n$.theme = this.value;
					localStorage.setItem("theme", this.value);
					cssMain.href = "lib/" + this.value + ".css";
					if (window.DaiVietUI) DaiVietUI.applyTheme(this.value, { persist: true });
				}
			}]]
		]);
	});
}

function login(cookie) {
	NUT.loading(divLogin);
	NUT.ds.get({ url: NUT.URL_TOKEN, data: [cookie.username, cookie.sitecode, cookie.password], method: "POST" }, function (res) {
		if (res.success) {
			n$.user = res.result;
			if (n$.user.backdrop) n$.user.backdrop = JSON.parse(n$.user.backdrop)[0];
			if (n$.user.icon) n$.user.icon = JSON.parse(n$.user.icon)[0];
			document.body.style.backgroundImage = "url(" + n$.user.backdrop + ")";

			SqlREST.token = "Bearer " + n$.user.token;
			NUT.cookie(cookie);
			//user select role & org
			NUT.roles = res.result.roles || [];
			var roles = Object.values(NUT.roles);
			NUT.orgs = res.result.orgs || [];
			var orgs = Object.values(NUT.orgs);
			if (roles.length == 1 && orgs.length <= 1) {
				var orgid = orgs[0] ? orgs[0].id : 0;
				NUT.ds.get({ url: NUT.URL_TOKEN + "roleorg", data: [roles[0].id, orgid], method: "PUT" }, function (res) {
					if (res.success) {
						n$.user.roleid = roles[0].id;
						n$.user.orgid = orgid;
						NUT.access = res.result.access;
						NUT.apps = res.result.apps;
						NUT.notifies = res.result.notifies;
						openDesktop();
					} else NUT.notify("🛑 ERROR: " + res.result, "red");
				});
			} else {
				var fields = [{ field: 'roleid', type: 'select', html: { label: "_Role" }, options: { items: roles } }];
				var record = { roleid: roles[0].id };
				if (orgs.length) {
					fields.push({ field: 'orgid', type: 'select', html: { label: "_Org" }, options: { items: orgs } });
					record.orgid = orgs[0].id;
				}
				divLogin.innerHTML = "";
				if (w2ui["frmRoleOrg"]) w2ui["frmRoleOrg"].destroy();
				(new w2form({
					name: "frmRoleOrg",
					style: "width:360px;height:260px;margin:0;overflow:hidden",
					header: '_RoleOrg',
					fields: fields,
					record: record,
					actions: {
						"_Cancel": function () {
							location.reload();
						},
						"_Ok": function () {
							var rec = this.record;
							NUT.ds.get({ url: NUT.URL_TOKEN + "roleorg", data: [rec.roleid, rec.orgid || 0], method: "PUT" }, function (res) {
								if (res.success) {
									n$.user.roleid = rec.roleid;
									n$.user.orgid = rec.orgid;
									NUT.access = res.result.access;
									NUT.apps = res.result.apps;
									NUT.notifies = res.result.notifies;
									openDesktop();
								} else NUT.notify("🛑 ERROR: " + res.result, "red");
							});
						}
					}
				})).render(divLogin);
			}
			//renderMain();
		} else NUT.notify("🛑 ERROR: " + res.result, "red");
		NUT.loading();
	});
}

function getUiLayout() {
	return window.DaiVietUI && DaiVietUI.layoutForViewport ? DaiVietUI.layoutForViewport() : { topbar: 60, sidebar: 180, sidebarMin: 150, sidebarCollapsed: 45, logoWidth: 170, rightPanel: 660 };
}

function leftSidebarMinWidth() {
	var uiLayout = getUiLayout();
	return uiLayout.sidebarMin || 150;
}

function syncLeftSidebarToPanel() {
	var leftDiv = document.getElementById("divLeft");
	if (!leftDiv) return;
	leftDiv.style.width = "100%";
	leftDiv.style.height = "100%";
	leftDiv.querySelectorAll(".w2ui-flat, .w2ui-flat-left, .w2ui-flat-right").forEach(function (el) {
		el.remove();
	});
	if (w2ui.mnuMain && w2ui.mnuMain.resize) w2ui.mnuMain.resize();
}

function renderMainSidebar(opt) {
	if (w2ui["mnuMain"]) {
		w2ui["mnuMain"].flatButton = false;
		w2ui["mnuMain"].flat = false;
		if (w2ui["mnuMain"].destroy) w2ui["mnuMain"].destroy();
		else delete w2ui["mnuMain"];
	}
	(new w2sidebar(opt)).render(divLeft);
	syncLeftSidebarToPanel();
}

function applyResponsiveMainLayout() {
	if (!w2ui.layMain) return;
	var uiLayout = getUiLayout();
	var left = w2ui.layMain.get("left");
	if (left && !left.hidden) {
		left.minSize = leftSidebarMinWidth();
		if (w2ui.mnuMain && w2ui.mnuMain.flat) {
			w2ui.mnuMain.flat = false;
			if (w2ui.mnuMain.refresh) w2ui.mnuMain.refresh();
		}
		w2ui.layMain.sizeTo("left", Math.max(uiLayout.sidebar, left.minSize));
		syncLeftSidebarToPanel();
	}
	var right = w2ui.layMain.get("right");
	if (right && !right.hidden) w2ui.layMain.sizeTo("right", uiLayout.rightPanel);
	if (window.DaiVietUI && DaiVietUI.scheduleResizeW2UI) DaiVietUI.scheduleResizeW2UI(40);
}

function bindResponsiveMainLayout() {
	if (window.__dvResponsiveMainLayout) return;
	window.__dvResponsiveMainLayout = true;
	var timer = null;
	window.addEventListener("resize", function () {
		clearTimeout(timer);
		timer = setTimeout(applyResponsiveMainLayout, 120);
	});
}

function userOrgText() {
	return n$.user && n$.user.orgid && NUT.orgs[n$.user.orgid] ? NUT.orgs[n$.user.orgid].text : "";
}

function siteBrandHtml() {
	var org = userOrgText();
	var title = n$.user.sitename || n$.user.sitecode || "";
	var desc = NUT.translate(n$.user.sitedesc) || n$.user.sitecode || "";
	return '<b>' + title + (org ? '.' + org : '') + '</b><br/><i>' + desc + '</i>';
}

function updateTopbarBrandSite() {
	var logo = document.getElementById("imgAppLogo");
	var names = document.getElementById("divAppNames");
	if (logo && n$.user.icon) logo.src = n$.user.icon;
	if (names) names.innerHTML = siteBrandHtml();
}

function openDesktop(force) {
	var uiLayout = getUiLayout();
	document.body.classList.remove("dv-login-screen");
	var loginOptions = document.querySelector(".dv-login-options");
	if (loginOptions) loginOptions.remove();
	var root = document.getElementById("divLogin");
	if (root) {
		root.className = "nut-full";
		root.removeAttribute("style");
		root.removeAttribute("name");
		root.innerHTML = "";
	}
	(w2ui["layMain"] || new w2layout({
		name: "layMain",
		style: "width:100%;height:100%;top:0;margin:0",
		panels: [
			{ type: 'top', size: uiLayout.topbar, html: '<div id="divTop" class="nut-full"></div>' },
			{ type: 'left', size: Math.max(uiLayout.sidebar, leftSidebarMinWidth()), minSize: leftSidebarMinWidth(), resizable: true, html: '<div id="divLeft" class="nut-full"></div>', hidden: true },
			{ type: 'main', html: '<div id="divMain" class="nut-full" style="background:url(\'' + n$.user.backdrop + '\');background-size:cover"><div id="divApp" style="position:absolute;width:100%;top:40%"></div><div id="divTool" style="position:absolute;width:100%;top:10px"></div></div>' },
			{ type: 'right', size: uiLayout.rightPanel, resizable: true, html: '<div id="divRight" class="nut-full"></div>', hidden: true },
			{ type: 'bottom', size: "40%", resizable: true, html: '<div id="divBottom" class="nut-full"></div>', hidden: true }
		],
	})).render(divLogin);
	bindResponsiveMainLayout();
	applyResponsiveMainLayout();
	window.dispatchEvent(new CustomEvent("zilcode:login-ready", { detail: { user: n$.user } }));

	var items = [{ id: "sendmsg", text: "_Send" }, { text: '--' }];
	
	if (NUT.notifies.length) items[0].count = "<a onclick=\"event.stopPropagation();NUT.confirm('Delete all notifies?',function(aw){if(aw=='Yes'||aw=='yes')notifyReaded(0)})\" title='_DeleteAll'>➖</a>";
	var maxprior = 0;
	for (var i = 0; i < NUT.notifies.length; i++) {
		var rec = NUT.notifies[i];
		var text = (rec.tostepid ? " ℹ️ " + rec.windowname + " ID=" + rec.recordid : " 📧 ") + " " + rec.status   + " from " + rec.username + " at " + (new Date(rec.created)).toLocaleString();
		if (rec.note) text += "<br/>" + rec.note;
		if (rec.priority) {
			if (rec.priority > maxprior) maxprior = rec.priority;
			text = "<span style='color:" + (rec.priority == 2 ? "red" : "orange") + "'>" + text + "</span>";
		}

		items.push({ id: rec.flowid, text: text, tag: rec, count: "<a onclick='event.stopPropagation();notifyReaded(" + rec.flowid + ")' title='_Delete'>➖</a>" });
	}
	var count = NUT.notifies.length;
	if (maxprior) count = "<span style='color:" + (maxprior == 2 ? "red" : "orange") + "'>" + count + "</span>";
	(w2ui["tbrTop"] || new w2toolbar({
		name: "tbrTop",
		items: [
			{ type: 'html', id: 'logo', html: '<table width="' + uiLayout.logoWidth + '"><tr><td><img height="24" id="imgAppLogo" src="' + n$.user.icon + '"/></td><td>&nbsp;</td><td><div id="divAppNames">' + siteBrandHtml() + '</div></td></tr></table>' },
			{ type: 'spacer', id: 'shot' },
			{ type: 'spacer' },
			{ type: 'button', id: "home", text: "🏠", tooltip: "_Home" },
			{ type: 'menu', id: "notify", text: "🔔", tooltip: "_Notify", count: count, items: items },
			{ type: 'break' },
			{
				type: 'menu', id: 'user', text: "🤵 " + n$.user.username, tooltip: n$.user.fullname, items: [
					{ id: 'profile', text: '_Profile' },
					{ id: 'changepass', text: '_ChangePassword' },
					{ text: '--' },
					{ id: 'logout', text: '_Logout' }]
			},
			{ type: 'break' },
			{ type: 'button', id: "apps", text: "𓃑", tooltip: "_Application" }
		],
		onClick(evt) {
			if (evt.target.startsWith("notify:")) {
				if (evt.target == "notify:sendmsg") {
					var id = "frmSendMsg";
					NUT.openDialog({
						title: "_Send",
						width: 360,
						height: 300,
						div: '<div id="' + id + '" class="nut-full"></div>',
						onOpen(evt) {
							evt.onComplete = function () {
								var opt = {
									name: id,
									fields: [
										{ field: "roleid", type: "select", required: true, html: { label: "_Role" }, options: { items: NUT.appRoles } },
										{ field: "userid", type: "select", html: { label: "_User" } },
										{ field: "note", type: "textarea", html: { label: "_Note" } },
										{ field: "priority", type: "select", html: { label: "_Priority" }, options: { items: [{ id: 0, text: "Normal" }, { id: 1, text: "High" }, { id: 2, text: "Urgent" }] } }
									],
									onChange: function (evt) {
										if (evt.target == "roleid") {
											var that = this;
											NUT.ds.get({ url: NUT.URL_TOKEN + "roleusers/" + evt.detail.value.current }, function (res) {
												if (res.success) {
													var userItems = [];
													for (var i = 0; i < res.result.length; i++) {
														var rec = res.result[i];
														userItems.push({ id: rec.userid, text: rec.fullname });
													}
													that.set("userid", { options: { items: userItems } });
												} else NUT.notify("🛑 ERROR: " + res.result, "red");
											});
										}
									},
									actions: {
										"_Close": function () {
											NUT.closeDialog();
										},
										"_Send": function () {
											var record = this.record;
											NUT.ds.insert({ url: NUT.URL + "n_wfflow", data: { fromuserid: n$.user.userid, toroleid: record.roleid, touserid: record.userid, status:"NOTIFY", note: record.note, priority: record.priority, created: new Date(), siteid: n$.user.siteid } }, function (res2) {
												if (res2.success) NUT.notify("Message sent!", "lime");
												else NUT.notify("🛑 ERROR: " + res2.result, "red");
											});
										}
									}
								};
								var frm = (NUT.w2ui[id] || new NUT.w2form(opt));
								frm.render(document.getElementById(id));
							}
						}
					});
				} else {
					var tag = evt.detail.subItem.tag;
					if (n$.app && n$.app.appid == tag.appid) menu_onClick({ object: { tag: tag.windowid, where: [NUT.tables[tag.tableid].columnkey, "=", tag.recordid], isFlow: true } });	
					else NUT.notify("⚠️ Application " + NUT.apps[tag.appid].appname + " is not open yet.", "yellow");
				}
			} else switch (evt.target) {
				case "home":
					w2ui.layMain.hide("left");
					if (NUT.isGIS) w2ui.layMain.hide(NUT.isMobile ? "bottom" : "right");
					for (var i = 0; i < this.shotcut.length; i++)this.remove(this.shotcut[i]);
					n$.winid = null;
					n$.app = null;
					openDesktop(true);
					break;
				case "user:profile":
					NUT.alert("<table><tr><td><b><i>" + NUT.w2utils.lang("_Username") + ":</i></b></td><td>" + n$.user.username + "</td><td><b><i>" + NUT.w2utils.lang("_Site") + ":</i></b></td><td>" + n$.user.sitecode + "</td></tr><tr><td><b><i>" + NUT.w2utils.lang("_Fullname") + ":</i></b></td><td colspan='3'>" + n$.user.fullname + "</td></tr><tr><td><b><i>" + NUT.w2utils.lang("_Org") + ":</i></b></td><td>" + (n$.user.orgid ? NUT.orgs[n$.user.orgid].code : "") + "</td><td><b><i>" + NUT.w2utils.lang("_Email") + ":</i></b></td><td>" + n$.user.email + "</td></tr></table>", NUT.w2utils.lang("_Information") + " #<i>" + n$.user.userid + "</i>");
					break;
				case "user:changepass":
					var id = "_dlgChangePass";
					NUT.openDialog({
						width: 360, height: 260,
						title: "_ChangePassword",
						div: '<div id="' + id + '" class="nut-full"></div>',
						onOpen(evt) {
							evt.onComplete = function () {
								var div = document.getElementById(id);
								var opt = {
									name: id,
									fields: [
										{ field: 'oldpass', type: 'password', required: true, html: { label: "_OldPassword" } },
										{ field: 'password', type: 'password', required: true, html: { label: "_Password" } },
										{ field: 'confirmpass', type: 'password', required: true, html: { label: "_ConfirmPassword" } }
									],
									actions: {
										"_Close": function () { NUT.closeDialog() },
										"_Ok": function () {
											if (form.validate(true).length == 0) {
												var record = this.record;
												if (record.oldpass && record.password && record.confirmpass) {
													if (record.password == record.confirmpass)
														NUT.ds.get({ url: NUT.URL_TOKEN + "password", data: [record.oldpass, record.password], method: "PUT" }, function (res) {
															if (res.success) NUT.notify("Password change", "lime");
															else NUT.notify("🛑 ERROR: " + res.result, "red");
														})
													else NUT.notify("⚠️ Confirm password not match!", "orange");
												} else NUT.notify("⚠️ Old password, New password and Confirm password are all required!", "orange");
											}
										}
									}
								}
								var form = (w2ui[id] || new w2form(opt));
								form.render(div);
							}
						}
					});
					break;
				case "user:logout":
					window.dispatchEvent(new Event("zilcode:logout"));
					location.reload();
					break;
				case "apps":
					w2tooltip.show({ name: "mnuApps", html: NUT.shortcut, anchor: evt.detail.originalEvent.target, hideOn: ['doc-click'] })
					break;
				default: menu_onClick(evt.object ? evt : { object: { tag: evt.detail.subItem.tag } });
			}
		}
	})).render(divTop);
	updateTopbarBrandSite();
	var id = null;
	var appHtml = "<center>";
	var toolHtml = "<center>";
	var countApp = 0, idOnlyApp = null;
	for (var key in NUT.apps) if (NUT.apps.hasOwnProperty(key)) {
		var app = NUT.apps[key];
		if (!force && app.icon) app.icon = JSON.parse(app.icon)[0];
		if (app.appid != null) {
			if (id != app.appid) {
				id = app.appid;
				app.appname = NUT.translate(app.translate) || app.appname;
				app.description = NUT.translate(app.description);
				if (app.issystem) {
					toolHtml += "<div class='nut-tool' onclick='openApp(" + id + ")' title='" + app.appname + "'><img src='" + app.icon + "'/></div>";
				} else {
					appHtml += "<div title='" + app.description + "' class='nut-tile' style='background:#" + app.color + "' onclick='openApp(" + id + ")'><img width='64' height='64' src='" + app.icon + "'/><div>" + app.appname + "</div></div>";
					idOnlyApp = id;
					countApp++;
				}
			}
		}
	};
	divApp.innerHTML = appHtml + "</center>";
	divTool.innerHTML = toolHtml + "</center>";
	NUT.shortcut = "<div style='transform: scale(0.8)'>" + divTool.innerHTML + "<hr/>" + divApp.innerHTML + "</div>";
	if (countApp == 1 && !force) openApp(idOnlyApp);
}
window.notifyReaded=function(flowid){
	var ids = [];
	if (flowid == 0)for (var i = 0; i < NUT.notifies.length; i++)ids.push(NUT.notifies[i].flowid);
	else ids.push(flowid);
	NUT.ds.update({ url: NUT.URL + "n_wfflow", data: { isread: true }, where: ["flowid", "in", ids] }, function (res) {
		if (res.success) {
			for (var i = 0; i < ids.length; i++)w2ui["tbrTop"].hide("notify:"+ids[i]);
			NUT.notify(ids.length + " Notify deleted!", "lime");
		} else NUT.notify("🛑 ERROR: " + res.result, "red");
	});
}
window.openApp = function (id) {
	//load menu
	n$.app = NUT.apps[id];
	if (n$.app.apptype == "engine") {
		var win = window.open(n$.app.linkurl + "?userid=" + n$.user.userid + "&siteid=" + n$.user.siteid + "&theme=" + (n$.theme || "") + "&locale=" + n$.locale + "&token=" + n$.user.token);
		win.n$ = n$;
		win.NUT = NUT;
	} else {
		NUT.isGIS = (n$.app.apptype == "gis");
		if (n$.app.theme) cssMain.href = "lib/" + n$.app.theme + ".css";
		if (window.DaiVietUI) DaiVietUI.applyTheme(n$.app.theme || n$.theme);
		divMain.style.backgroundImage = "";
		w2ui.layMain.show("left");
		applyResponsiveMainLayout();

		NUT.appinfo = '<img width="64" height="64" src="' + n$.app.icon + '"/><br/><h2><b style="color:brown">' + n$.app.appname + '</b></h2><br/><hr/><br/><h3>' + n$.app.description + '</h3>';
		var titleHtml = '<div id="divTitle" class="nut-win-title">' + NUT.appinfo + '</div>';
		divMain.innerHTML = titleHtml;
		imgAppLogo.src = n$.app.icon;
		divAppNames.innerHTML = (NUT.isMobile ? '<b>' + n$.app.appname + '</b>' + (n$.user.orgid ? '<br/><i>' + NUT.orgs[n$.user.orgid].code + '</i>' : '') : '<b>' + n$.app.appname + (n$.user.orgid ? '.' + NUT.orgs[n$.user.orgid].text : '') + '</b><br/><i>' + NUT.translate(n$.app.description) + '</i>');

		NUT.ds.get({ url: NUT.URL_TOKEN + "app/" + id }, function (res) {
			if (res.success) {
				var result = res.result;
				var item = [n$.user.siteid, n$.user.sitecode];
				NUT.domains = { 0: { items: [{ id: item[0], text: item[1] }], lookup: { [item[0]]: item }, lookdown: { [item[1]]: item } } };

				for (var i = 0; i < result.domains.length; i++) {
					var data = result.domains[i];
					var domain = { items: [NUT.DM_NIL], lookup: {}, lookdown: {}, iseditable: data.iseditable };
					var items = JSON.parse(data.domainjson);
					for (var j = 0; j < items.length; j++) {
						var item = items[j];
						domain.items.push({ id: item[0], text: item[1], color: item[2] });
						domain.lookup[item[0]] = item;
						domain.lookdown[item[1]] = item;
					}
					NUT.domains[data.domainid] = domain;
				}
				NUT.services = result.services || {};
				NUT.relates = result.relates || {};
				NUT.tables = result.tables || {};
				var workflows = {};
				for (var i = 0; i < result.wfsteps.length; i++) {
					var step = result.wfsteps[i];
					step.ins = JSON.parse(step.ins);
					step.outs = JSON.parse(step.outs);
					var key = step.workflowid;
					if (!workflows[key]) workflows[key] = {};
					workflows[key][step.elementid] = step;
					workflows[key][step.stepid] = step;
					if (step.steptype == "bpmn:StartEvent")
						workflows[key][0] = step;
				}
				NUT.workflows = workflows;
				var wfusers = {};
				if (result.wfusers) for (var i = 0; i < result.wfusers.length; i++) {
					var user = result.wfusers[i];
					if (!wfusers[user.roleid]) wfusers[user.roleid] = [];
					wfusers[user.roleid].push({ id: user.userid, text: (user.fullname || user.username) });
				}
				NUT.wfusers = wfusers;
				//cached tables & finds
				NUT.findtables = [];
				NUT.lookupTable = {};
				for (var key in NUT.tables) if (NUT.tables.hasOwnProperty(key)) {
					var table = NUT.tables[key];
					NUT.lookupTable[table.tablename] = table;
					if (table.iscache) NUT.cacheDmLink(table);
					if (table.columnfind) NUT.findtables.push(table);
				}
				NUT.appRoles = [];
				for (var i = 0; i < result.roles.length; i++) {
					var role = result.roles[i];
					NUT.appRoles.push({ id: role.roleid, text: role.rolename });
				}

				var nodes = [], shotNodes = [], shotids = [], lookup = {}, openWinId = null;
				for (var i = 0; i < result.menus.length; i++) {
					var menu = result.menus[i];
					shotids.push(menu.menuid);
					var node = { id: menu.menuid, isopen: menu.isopen, issummary: menu.issummary, text: NUT.translate(menu.translate) || menu.menuname, tag: menu.linkwindowid || menu.execname, rpt: menu.reportid };
					if (menu.maplayer) {
						node.maplayer = menu.maplayer;
						node.nodes = [{ id: "sub_" + node.id, text: "<i>" + (menu.subtype || "&nbsp;") + "</i>", maplayer: node.maplayer, noHandle: true, tag: node.tag }];
						if (menu.subtype) node.subtype = menu.subtype;
					}
					var parent = lookup[menu.parentid];
					if (menu.icon) node.icon = menu.icon;
					if (menu.whereclause) node.where = JSON.parse(menu.whereclause);
					if ((menu.linkwindowid || menu.execname) && menu.isopen) openWinId = menu.linkwindowid || menu.execname;
					if (menu.menutype == "menu") {
						if (parent) {
							parent.group = !NUT.isMobile;
							parent.expanded = !NUT.isMobile && parent.isopen;
							if (parent.nodes) parent.nodes.push(node);
							else parent.nodes = [node];
						} else nodes.push(node);
					} else {//shotcut
						//node.tooltip=node.text;
						//node.text="";
						node.type = menu.haschild ? "menu" : "button";
						if (parent) {
							if (parent.items) parent.items.push(node);
							else parent.items = [node];
						} else shotNodes.push(node);
					}
					lookup[node.id] = node;
				};
				w2ui["tbrTop"].shotcut = shotids;
				if (shotNodes.length) w2ui["tbrTop"].insert('shot', shotNodes);
				var opt = {
					name: "mnuMain",
					flatButton: false,
					flat: false,
					nodes: nodes,
					topHTML: "<div class='dv-sidebar-search'><input id='_txttopsearch' class='w2ui-input' placeholder='" + NUT.w2utils.lang("_Search") + "' onchange='NUT.w2ui.mnuMain.search(this.value)'/></div>",
					onClick: menu_onClick
				}

				if (id == 1) {//LIST SYSTEM APPLICATIONS
					NUT.ds.get({ url: NUT.URL + "n_app", orderby: "seqno", where: ["siteid", "=", n$.user.siteid] }, function (res2) {
						if (res2.success) {
							var children = [];
							for (var i = 0; i < res2.result.length; i++) {
								var app = res2.result[i];
								children.push({ id: "app_" + app.appid, text: app.appname, tag: (app.apptype == "engine" ? 5 : 3), where: ["appid", "=", app.appid] });
							}
							opt.nodes.push({ id: "app_", text: w2utils.lang("_Application") + "<span></span><a class='nut-badge' onclick='event.stopPropagation();menu_onClick({object:{tag:3,newTab:4,nodes:[]}})' title='New Application'> ➕ </a>", group: !NUT.isMobile, expanded: !NUT.isMobile, nodes: children });
							renderMainSidebar(opt);
						} else NUT.notify("🛑 ERROR: " + res2.result, "red");
					});
				} else {
					renderMainSidebar(opt);
				}
				if (NUT.isGIS) {
					var pan = (NUT.isMobile ? "bottom" : "right");
					if (w2ui.layMain.get(pan).hidden) w2ui.layMain.show(pan);
					cssMap.href = "https://js.arcgis.com/4.32/esri/themes/" + ((n$.app.theme || n$.theme || "").includes("-dark") ? "dark" : "light") + "/main.css";

					divMain.innerHTML = "<div id='divMap' class='nut-full'></div><div id='tbrMap' style='position:absolute;top:10px;right:10px'></div><button style='position:absolute;border:none;top:2px;left:1px' onclick='this.checked=!this.checked;tbrMap.style.display=this.checked?\"none\":\"\"'>&nbsp;«&nbsp;</button><button style='position:absolute;border:none;top:2px;right:1px' onclick='NUT.w2ui.layMain.toggle(NUT.isMobile?\"bottom\":\"right\")'>&nbsp;»&nbsp;</button>";
					if (NUT.isMobile) {
						layout_layMain_resizer_bottom.innerHTML = "<center>➖</center>";
						divBottom.innerHTML = titleHtml;
					} else divRight.innerHTML = titleHtml;

					var sers = []; var basemaps = [];
					for (var key in NUT.services) if (NUT.services.hasOwnProperty(key)) {
						var ser = NUT.services[key];
						if (ser.servicetype == "arcgis") sers.push(ser);
						if (ser.servicetype == "basemap") basemaps.push(ser);
					}
					
					if (sers.length) NUT.mapObj = new AGMap({ divMap: divMap, service: sers[0], basemaps: basemaps });
					else NUT.notify("⚠️ App have no map service!", "yellow");
				}

				if (openWinId) menu_onClick({ object: { tag: openWinId } });
			} else NUT.notify("🛑 ERROR: " + res.result, "red");
		});

	}
}
window.menu_onClick = function (evt) {
	var menu = evt.object, tag = menu.tag;
	if (tag) {
		if (Number.isInteger(tag)) {
			var win = new NWin(tag);
			var conf = NUT.windows[tag];
			if (conf) {
				var tabconf = conf.tabs[0];
				tabconf.menuWhere = menu.where;
				if (menu.maplayer) tabconf.table.maplayer = menu.maplayer;
				if (menu.isFlow) tabconf.menuWhere = null;
				if (menu.newTab) NWin.showNewDialog(conf.lookupTab[menu.newTab]);
				else {
					var a = NUT.createWindowTitle(tag, divTitle);
					if (a) {
						win.buildWindow(a.div, conf, 0);
						a.innerHTML = NUT.translate(conf.translate) || conf.windowname;
						if (menu.layerTitle) document.getElementById("tabs_tabs_" + conf.windowid + "_0_tab_" + tabconf.tabid).innerHTML = menu.layerTitle;
					} else {
						var grid = w2ui["grid_" + tabconf.tabid];
						if (grid) grid.reload();
					}

				}
			} else {
				NUT.ds.get({ url: NUT.URL_TOKEN + "cache/" + tag }, function (res) {
					if (res.success) {
						var cache = res.result;
						if (cache && cache.configjson) {
							conf = NUT.configWindow(zipson.parse(cache.configjson), cache.layoutjson ? zipson.parse(cache.layoutjson) : null);
							var tabconf = conf.tabs[0];
							tabconf.menuWhere = menu.where;
							if (menu.maplayer) tabconf.table.maplayer = menu.maplayer;
							if (menu.isFlow) tabconf.menuWhere = null;
							conf.tabid = conf.windowid;
							conf.windowname = NUT.translate(conf.translate) || conf.windowname;
							NUT.windows[tag] = conf;
							if (menu.newTab) NWin.showNewDialog(conf.lookupTab[menu.newTab]);
							else {
								var a = NUT.createWindowTitle(tag, divTitle);
								if (a) {
									if (NUT.isObjectEmpty(conf.needCache)) {
										win.buildWindow(a.div, conf, 0);
										if (menu.layerTitle) document.getElementById("tabs_tabs_" + conf.windowid + "_0_tab_" + tabconf.tabid).innerHTML = menu.layerTitle;
									} else {
										var needCaches = [];
										for (var key in conf.needCache) {
											if (conf.needCache.hasOwnProperty(key) && !NUT.dmlinks[key]) needCaches.push(conf.needCache[key]);
										}
										win.cacheDmAndOpenWin(a.div, conf, needCaches, 0);
									}
									a.innerHTML = NUT.translate(conf.translate) || conf.windowname;
								}
							}
						} else NUT.notify("⚠️ No cache for window " + tag, "yellow");
					} else NUT.notify("🛑 ERROR: " + res.result, "red");
				});
			}
		} else if (tag.startsWith("https://") || tag.startsWith("http://")) window.open(tag);
		else if (tag.endsWith(".pdf") || tag.endsWith(".doc") || tag.endsWith(".xls")) window.open("site/" + n$.app.siteid + "/" + n$.app.appid + "/" + tag);
		else NUT.runComponent(tag);
	} else if (menu.rpt) NUT.runReport(menu.rpt);
}
