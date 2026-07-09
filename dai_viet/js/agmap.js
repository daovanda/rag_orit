export class AGMap {
	static token = null;
	static map = null;
	static service = null;
	static basemaps = null;
	static view = null;
	static layers = {};
	static tables = [];//for vector-tile
	static extent = null;
	static backStack = [];
	static nextStack = [];
	static grids = {};
	static callback = null;
	static SYMBOL = {
		extent: { type: "simple-fill", style: "none", outline: { color: "black", width: 1 } },
		point: { type: "simple-marker", style: "cross", color: "lime", size: 10, outline: { color: "lime", width: 2 } },
		polyline: { type: "simple-line", color: "lime", width: 2 },
		polygon: { type: "simple-fill", style: "none", outline: { color: "lime", width: 2 } },
		circle: { type: "simple-fill", style: "none", outline: { color: "lime", width: 1 } }
	}
	constructor(para) {
		NUT.loading(para.divMap);
		AGMap.service = para.service;
		AGMap.div = para.divMap;
		AGMap.isWebMap = AGMap.service.url.includes("home/item.html?id=");
		AGMap.isVtpk = AGMap.service.url.endsWith(".json");
		/*if (AGMap.isVtpk) {
			var urls = [];
			for (var i = 0; i <= 10; i++) {
				urls.push("http://localhost:8081/gae5mx5mInBuildingOutdoor20251119/part-" + i.toString().padStart(5, "0") + "-6c039086-a2d7-4b4b-bacd-d03b71799467-c000.snappy.parquet");
			}
			AGMap.service.urls = [urls[9]];
		}*/
		document.head.z(["script", {
			src: "https://js.arcgis.com/4.32/init.js", onload: function () {
				require(["esri/config", "esri/identity/IdentityManager", "esri/Map", "esri/WebMap", "esri/views/MapView", "esri/views/draw/Draw", "esri/Graphic", "esri/symbols/support/symbolUtils", "esri/widgets/Editor", "esri/widgets/Sketch", "esri/widgets/Measurement", "esri/widgets/Print", "esri/widgets/Locate", "esri/widgets/BasemapGallery", "esri/Basemap", "esri/widgets/Legend", "esri/widgets/ScaleBar", "esri/widgets/Search", "esri/layers/TileLayer", "esri/layers/VectorTileLayer", "esri/layers/FeatureLayer", "esri/geometry/geometryEngine", "esri/geometry/support/webMercatorUtils", "esri/geometry/Extent", "esri/geometry/Point", "esri/geometry/Polyline", "esri/geometry/Polygon", "esri/geometry/Circle", "esri/layers/GraphicsLayer", "esri/geometry/Multipoint", "esri/rest/identify"], function (esriConfig, esriId, Map, WebMap, MapView, Draw, Graphic, symbolUtils, Editor, Sketch, Measurement, Print, Locate, BasemapGallery, Basemap, Legend, ScaleBar, Search, TileLayer, VectorTileLayer, FeatureLayer, geometryEngine, webMercatorUtils, Extent, Point, Polyline, Polygon, Circle, GraphicsLayer, Multipoint, identify) {
					AGMap.Map = Map;
					AGMap.MapView = MapView;
					AGMap.Graphic = Graphic;
					AGMap.FeatureLayer = FeatureLayer;
					AGMap.symbolUtils = symbolUtils;
					AGMap.Editor = Editor;
					AGMap.geometryEngine = geometryEngine;
					AGMap.webMercatorUtils = webMercatorUtils;
					AGMap.Point = Point;
					AGMap.Polyline = Polyline;
					AGMap.Polygon = Polygon;
					AGMap.Polygon = Circle;
					AGMap.GraphicsLayer = GraphicsLayer;
					AGMap.Multipoint = Multipoint;
					AGMap.Search = Search;
					AGMap.Locate = Locate;
					AGMap.identify = identify;
					var items = [
						{ type: 'radio', id: "pan", group: 1, icon: "hand-png", tooltip: "_Pan" },
						{ type: 'break' },
						{ type: 'radio', id: "identify", group: 1, icon: "info-png", tooltip: "_Identify" },
						{ type: 'radio', id: "select", group: 1, icon: "select-png", tooltip: "_Select" },
						{ type: 'button', id: "unselect", icon: "unselect-png", tooltip: "_ClearSelect" },
						{ type: 'break' },
						{
							type: 'menu', id: "measure", group: 1, icon: "ruler-png", tooltip: "_Measure", items: [
								{ id: "distance", text: "_Distance" },
								{ id: "area", text: "_Area" },
							]
						},
						{ type: 'button', id: "basemap", icon: "basemap-png", tooltip: "_Basemap" },
						{ type: 'button', id: "legend", icon: "legend-png", tooltip: "_Legend" },
						{ type: 'button', id: "print", icon: "printer-png", tooltip: "_Print" },
						{ type: 'break' },
						{ type: 'button', id: "fullextent", icon: "world-png", tooltip: "_FullExtent" }
					];
					AGMap.tool = "pan";
					(NUT.w2ui["tbrMap"] || new NUT.w2toolbar({
						name: "tbrMap",
						items: NUT.isMobile ? items : [{ type: 'radio', id: "zoomin", group: 1, icon: "zoomin-png", tooltip: "_ZoomIn" }, { type: 'radio', id: "zoomout", group: 1, icon: "zoomout-png", tooltip: "_ZoomOut" }].concat(items).concat([{ type: 'button', id: "backextent", icon: "back-png", tooltip: "_BackExtent" }, { type: 'button', id: "nextextent", icon: "next-png", tooltip: "_NextExtent" }]),
						onClick(evt) {
							var style = AGMap.view.container.style;

							AGMap.view.popupEnabled = (evt.target == "identify");
							AGMap.tool = evt.target;
							var action = null;

							switch (AGMap.tool) {
								case "pan":
									style.cursor = "grab";
									AGMap.draw.reset();
									break;
								case "point":
								case "polyline":
								case "polygon":
								case "circle":
									style.cursor = "crosshair";
									action = AGMap.draw.create(AGMap.tool);
									break;
								case "identify":
									style.cursor = "help";
									AGMap.draw.reset();
									break;
								case "zoomin":
									style.cursor = "zoom-in";
									action = AGMap.draw.create("rectangle");
									break;
								case "zoomout":
									style.cursor = "zoom-out"
									action = AGMap.draw.create("rectangle");
									break;
								case "select":
									style.cursor = "default";
									action = AGMap.draw.create(AGMap.isVtpk ? "circle" : "rectangle");
									break;
								case "unselect":
									for (var key in AGMap.layers) if (AGMap.layers.hasOwnProperty(key)) {
										var layer = AGMap.layers[key];
										if (layer.highlight) layer.highlight.remove();
									}
									AGMap.view.graphics.removeAll();
									break;
								case "fullextent":
									AGMap.view.goTo(AGMap.extent);
									break;
								case "backextent":
									var ext = AGMap.backStack.pop();
									if (ext) {
										AGMap.skipme = true;
										AGMap.nextStack.push(AGMap.view.extent);
										AGMap.view.goTo(ext);
									}
									break;
								case "nextextent":
									var ext = AGMap.nextStack.pop();
									if (ext) {
										AGMap.skipme = true;
										AGMap.view.goTo(ext);
									}
									break;
								case "measure:distance":
								case "measure:area":
									var a = NUT.createWindowTitle("measure", divTitle, function () {
										AGMap.wzMeasurement.clear();
									});
									if (a) {
										a.innerHTML = "Measure";
										AGMap.wzMeasurement = new Measurement({
											container: a.div,
											view: AGMap.view
										});
										AGMap.wzMeasurement.renderNow();
									}
									AGMap.wzMeasurement.activeTool = evt.detail.subItem.id;
									break;
								case "basemap":
									var a = NUT.createWindowTitle("basemap", divTitle);
									if (a) {
										a.innerHTML = "Basemap";
										var opt = {
											container: a.div,
											view: AGMap.view
										}
										if (AGMap.basemaps) opt.source = AGMap.basemaps;
										AGMap.wzBasemapGallery = new BasemapGallery(opt);
										AGMap.wzBasemapGallery.renderNow();
									}
									break;
								case "legend":
									var a = NUT.createWindowTitle("legend", divTitle);
									if (a) {
										a.innerHTML = "Legend";
										AGMap.wzLegend = new Legend({
											container: a.div,
											view: AGMap.view
										});
										AGMap.wzLegend.renderNow();
									}
									break;
								case "print":
									var a = NUT.createWindowTitle("print", divTitle);
									if (a) {
										a.innerHTML = "Print";
										AGMap.wzPrint = new Print({
											container: a.div,
											view: AGMap.view,
											printServiceUrl: "https://utility.arcgisonline.com/arcgis/rest/services/Utilities/PrintingTools/GPServer/Export%20Web%20Map%20Task"
										});
										AGMap.wzPrint.renderNow();
									}
									break;
							}
							if (action) {
								action.on("cursor-update", function (evt) {
									var p = evt.vertices;
									if (p.length >= 2) {
										var lyr = AGMap.view.graphics;
										var g = lyr.getItemAt(0);
										var isPoly = (AGMap.tool == "polyline" || AGMap.tool == "polygon");
										var geom = isPoly ? {
											type: AGMap.tool,
											rings: [p],
											paths: [p]
										} :(AGMap.tool == "circle" ? new Circle({
											center: { type: "point", x: p[0][0], y: p[0][1], spatialReference: AGMap.view.spatialReference },
											radius: Math.sqrt((p[0][0] - p[1][0]) * (p[0][0] - p[1][0]) + (p[0][1] - p[1][1]) * (p[0][1] - p[1][1]))
										}) : {
											type: "extent",
											xmin: p[0][0], ymin: p[0][1], xmax: p[1][0], ymax: p[1][1]
										});
										geom.spatialReference = AGMap.view.spatialReference;
										var symb = AGMap.SYMBOL[isPoly ? AGMap.tool : "extent"];

										if (g) {
											g.geometry = geom;
											g.symbol = symb;
										} else lyr.add({ geometry: geom, symbol: symb });
									}
								});
								action.on("draw-complete", function (evt) {
									AGMap.view.graphics.removeAll();
									var isGeom = AGMap.tool == "point" || AGMap.tool == "polyline" || AGMap.tool == "polygon";
									var p = evt.vertices;
									if (AGMap.tool == "point" || p.length > 1) {
										var geom = null;
										if (AGMap.tool == "circle") geom = new Circle({ center: { type: "point", x: p[0][0], y: p[0][1], spatialReference: AGMap.view.spatialReference }, radius: Math.sqrt((p[0][0] - p[1][0]) * (p[0][0] - p[1][0]) + (p[0][1] - p[1][1]) * (p[0][1] - p[1][1])) });
										else geom = isGeom ? (AGMap.tool == "point" ? { type: AGMap.tool, x: p[0][0], y: p[0][1] } : { type: AGMap.tool, paths: [p], rings: [p] }) : new Extent({ type: "extent", xmin: p[0][0], ymin: p[0][1], xmax: p[1][0], ymax: p[1][1] });
										geom.spatialReference = AGMap.view.spatialReference;
										switch (AGMap.tool) {
											case "point":
											case "polyline":
											case "polygon":
											case "circle":
												AGMap.view.graphics.add({
													geometry: geom,
													symbol: AGMap.SYMBOL[AGMap.tool]
												});
												if (AGMap.callback) AGMap.callback({ geometry: geom, vertices: evt.vertices });
												break;
											case "zoomin":
												AGMap.view.goTo(geom);
												break;
											case "zoomout":
												AGMap.view.goTo(geom.expand(AGMap.view.extent.width / geom.width + AGMap.view.extent.height / geom.height));
												break;
											case "select":
												style.cursor = "default";
												action = AGMap.draw.create(AGMap.isVtpk ? "circle" : "rectangle");
												var winconf = NUT.windows[n$.winid];
												var maplayer = winconf && winconf.tabs[0].table.maplayer;
												if (maplayer === undefined) NUT.notify("⚠️ Open layer's attribute for select!", "yellow");
												else {
													var query = AGMap.isVtpk ? {
														geometry: {
															type: "Polygon",
															coordinates: [[[geom.xmin, geom.ymin], [geom.xmin, geom.ymax], [geom.xmax, geom.ymax], [geom.xmax, geom.ymin], [geom.xmin, geom.ymin]]],
															wkid: geom.spatialReference.wkid
														}
													}:{
														geometry: {
															type: "polygon",
															rings: [[[geom.xmin, geom.ymin], [geom.xmin, geom.ymax], [geom.xmax, geom.ymax], [geom.xmax, geom.ymin], [geom.xmin, geom.ymin]]],
															spatialReference: geom.spatialReference
														}
													}
													AGMap.selectByQuery(maplayer, query);
												}
												break;
										}
									}
									NUT.w2ui["tbrMap"].onClick({ target: AGMap.tool });
								})
							}
						}
					})).render(AGMap.div.nextSibling);

					AGMap.generateToken(AGMap.service, function (error) {
						if (error) NUT.notify("🛑 ERROR: " + error.message, "red");
						else {
							var url = AGMap.service.url.split(AGMap.isWebMap ? "home/item.html?id=" : "arcgis/rest/services");
							if (AGMap.isWebMap) esriConfig.portalUrl = url[0];
							if (AGMap.service.accessuser) esriId.registerToken({ server: url[0], token: AGMap.token });

							if (para.basemaps.length) {
								AGMap.basemaps = [new Basemap({ id: 0, title: "BLANK", baseLayers: [], thumbnailUrl: "img/map/blank.png"})];
								for (var i = 0; i < para.basemaps.length; i++) {
									var ser = para.basemaps[i];
									AGMap.basemaps.push(new Basemap({ id: ser.serviceid, title: ser.servicename, baseLayers: [AGMap.isVtpk ? new VectorTileLayer({ style: ser.url }) : new TileLayer({ url: ser.url })] }));
								}
							}

							AGMap.map = AGMap.isWebMap ? new WebMap({ portalItem: { id: url[1] } }) : new Map({ layers: [AGMap.isVtpk ?		new VectorTileLayer({ url: para.service.url }) : new TileLayer({ url: para.service.url })] });
							
							var renderMap = function () {
								AGMap.view = new MapView({
									container: AGMap.div,
									map: AGMap.map,
									popupEnabled: false,
									ui: { components: [] },
									constraints: { lods: [] }
								});
								AGMap.view.on("click", function (evt) {
									if (AGMap.tool == "pan") {
										if (AGMap.tool === undefined || evt.mapPoint) {
											NUT.notify(NUT.AGMap.decimal2ddmmss([evt.mapPoint.longitude, evt.mapPoint.latitude]), "lime");
										}
									} else if (AGMap.tool == "identify") {
										if (AGMap.isVtpk) {
											var p = evt.mapPoint;
											var table = AGMap.tables[0];//top layer
											var t = 5 * AGMap.view.resolution;//tolerence=5*pixelsize
											var geom = {
												type: "Polygon",
												coordinates: [
													[
														[p.x - t, p.y - t],
														[p.x + t, p.y - t],
														[p.x + t, p.y + t],
														[p.x - t, p.y + t],
														[p.x - t, p.y - t]
													]
												],
												wkid: p.spatialReference.wkid
											};
											if(table)AGMap.querySqlGeometry({ table: table, geometry: geom }, function (res) {
												if (res.success && res.result.length)NUT.AGMap.notifyIdentify(res.result[0], evt.native.screenX, evt.native.screenY);
												else NUT.w2tooltip.hide();
											});
										} else AGMap.identify.identify(AGMap.service.url, { geometry: evt.mapPoint, layerOption: "top", tolerance: 3, mapExtent: NUT.AGMap.view.extent, returnGeometry: true }).then(function (res) {
											if (res.results.length) AGMap.notifyIdentify(res.results[0], evt.native.screenX, evt.native.screenY);
										});
									}
									if (AGMap.onClick) AGMap.onClick(evt);
								});
								AGMap.wzSketch = new Sketch({ view: AGMap.view, layer: AGMap.view.graphics, creationMode: "single", tooltipOptions: { enabled: true }, visible: false });
								AGMap.draw = new Draw({ view: AGMap.view });
								AGMap.view.when(AGMap.initMap);
							}
							if (AGMap.isWebMap) AGMap.map.load().then(renderMap).catch(function (err) {
								NUT.notify("🛑 " + err, "red");
							}); 
							else renderMap();
						}
					});

				});
			}
		}]);
	}
	static querySqlGeometry(query,callback) {
		var where = [];
		if (query.where) where.push(query.where);
		if (query.geometry) where.push(["Shape." + (query.relation || "STIntersects") + "(geometry::STGeomFromText('" + Terraformer.WKT.convert(query.geometry) + "'," + query.geometry.wkid + "))", "=", 1]);

		if (where.length) NUT.ds.select({ url: query.table.urledit, where: where }, function (res) {
			if (res.success) {
				for (var i = 0; i < res.result.length; i++) {
					var rec = res.result[i];
					var wtk = Terraformer.WKT.parse(rec.Shape);
					var json = {
						type: wtk.type.toLowerCase(),
						spatialReference: { wkid: NUT.AGMap.view.spatialReference.wkid }
					};
					switch (json.type) {
						case "point":
							json.x = wtk.coordinates[0];
							json.y = wtk.coordinates[1];
							break;
						case "polyline":
							json.paths = wtk.coordinates;
							break;
						case "polygon":
							json.rings = wtk.coordinates;
							break;
					}
					res.result[i] = new AGMap.Graphic({
						geometry: json,
						attributes: rec,
						layerId: query.table.tableid,
						layerName: (query.table.alias || query.table.tablename)
					});
				}
			}
			callback(res);
		}); else callback({ success: false,result:"No where to query!" })
	}
	static notifyIdentify(feat, x, y) {
		AGMap.view.graphics.removeAll();
		feat.symbol = AGMap.SYMBOL[feat.geometry.type];
		AGMap.view.graphics.add(feat);
		var grid = AGMap.grids[feat.layerId];
		if (grid) {
			grid.gisWhere = attr["OBJECTID"];
			grid.reload();
		} else {
			var attr = feat.attributes;
			var html = document.createElement("table");
			html.width = 300;
			html.innerHTML = '<caption class="w2ui-eaction w2ui-draggable" data-mousedown="startDrag|event"><b style="color:yellow">' + (feat.layerName || feat.origin.layerId) + '</b><b style="float:right" onclick="NUT.w2tooltip.hide(\'identify\')"> ⛌ </b></caption>';
			for (var key in attr) if (attr.hasOwnProperty(key)) {
				if (key != "Shape") {
					var row = html.insertRow();
					var val = attr[key]||"-/-";
					row.innerHTML = "<td align='right'><i><b>" + key + "</b></i>: </td><td>" + (val.startsWith && val.startsWith("http") ? "<a target='_blank' href='"+val+"'>Hình ảnh</a>":val) + "</td>";
				}
			}
			NUT.w2tooltip.show({ name: "identify", x: x, y: y, html: html.outerHTML, arrowSize: 0 });
		}
	}
	static ddmmss2decimal(latlng) {
		if (latlng.length == 2) {
			var result = [];
			for (var i = 0; i < 2; i++) {
				var val = latlng[i];
				var end = val[val.length - 1];
				var sign = (i == 0 && end == "N" || i == 1 && end == "E" ? 1 : (i == 0 && end == "S" || i == 1 && end == "W" ? -1 : 0));
				if (sign) {
					var tokens = val.substring(0, val.length - 1).split(" ");
					if (tokens.length < 4) {
						var dd = parseFloat(tokens[0]);
						var mm = tokens.length > 1 ? parseFloat(tokens[1]) : 0;
						var ss = tokens.length > 2 ? parseFloat(tokens[2]) : 0;
						if (0 <= dd && dd <= 180 && 0 <= mm && mm <= 180 && 0 <= ss && ss <= 180) result[1 - i] = sign * Math.round(1000000 * (dd + mm / 60 + ss / 3600)) / 1000000;
						else return "⚠️ DD MM SS is bellow 0 or over 180";
					} else return "⚠️ Cooridate not in DD MM SS";
				} else return "⚠️ Coordinate not end with N S E W";
			}
			return result;
		} else return "⚠️ Coordinates is not [lat,lng]";
	}
	static decimal2ddmmss(xy) {
		if (xy.length == 2) {
			var result = [];
			for (var i = 0; i < 2; i++) {
				var val = xy[i];
				if (-180 <= val && val <= 180) {
					var dd = Math.floor(val);
					var mmVal = (val - dd) * 60;
					var mm = Math.floor(mmVal);
					var ss = Math.floor((mmVal - mm) * 60);
					var subfix = "";
					if (val < 0) subfix = i ? "S" : "N";
					else subfix =
						result[1 - i] = dd + " " + mm + " " + ss + (val < 0 ? (i ? "S" : "W") : (i ? "N" : "E"));
				} else return ["⚠️ Decimal is bellow -180 or over 180"];
			}
			return result;
		} else return "⚠️ Coordinates is not [x,y]";
	}

	static generateToken(service, callback) {
		if (service.accessuser) {
			var url = AGMap.isWebMap ? service.url.split("home/item.html?id=")[0] + "sharing/" : service.url.split("rest/services")[0] + "tokens/";
			if (service.credential)
				NUT.AGMap.post({ url: url + "rest/oauth2/token?f=json&grant_type=client_credentials&client_id=" + service.accessuser + "&client_secret=" + service.accesspass + "&referer=" + location.origin }, function (res) {
					AGMap.token = res.access_token;
					callback(res.error);
				});
			else
				NUT.AGMap.submit({ url: url + "generateToken?f=json&client=referer&referer=" + location.origin, data: { username: service.accessuser, password: service.accesspass } }, function (res) {
					AGMap.token = res.token;
					callback(res.error);
				});
		} else callback();
	}
	static initMap() {
		NUT.loading();
		var lookupFind = {};
		for (var i = 0; i < NUT.findtables.length; i++) {
			var tbl = NUT.findtables[i];
			if (tbl.maplayer) lookupFind[tbl.maplayer] = tbl.columnfind;
		}
		var mnuMain = NUT.w2ui["mnuMain"];
		var sources = [];
		for (var i = 0; i < AGMap.map.allLayers.length; i++) {
			var lyr = AGMap.map.allLayers.getItemAt(i);
			switch (lyr.type) {
				case "feature":
					lyr.outFields = "*";
					AGMap.layers[lyr.id] = lyr;
					var columnfinds = lookupFind[lyr.id];
					if (columnfinds) {
						var finds = columnfinds.split(",");
						sources.push({
							layer: lyr,
							searchFields: finds,
							displayField: finds[0],
							outFields: finds,
							minSuggestCharacters: 2,
							maxSuggestions: 10
						});
					}
					break;
				case "subtype-group":
					for (var j = 0; j < lyr.sublayers.length; j++) {
						var slyr = lyr.sublayers.getItemAt(j);
						AGMap.layers[slyr.id] = slyr;
					}
					//add submenu
					var parent = mnuMain.get(lyr.id);
					//parent.group = !NUT.isMobile;
					parent.expanded = !NUT.isMobile && parent.isopen;
					var nodes = [];
					for (var j = lyr.sublayers.length - 1; j >= 0; j--) {
						var slyr = lyr.sublayers.getItemAt(j);
						var node = { id: slyr.id, maplayer: slyr.id, where: [slyr.subtypeField, "=", slyr.subtypeCode], tag: parent.tag, layerTitle: slyr.title, text: slyr.title };
						nodes.push(node);
					}
					mnuMain.insert(parent.id, null, nodes);
					break;
				case "tile":
					for (var j = 0; j < lyr.sublayers.length; j++) {
						var slyr = lyr.sublayers.getItemAt(j);
						AGMap.layers[slyr.id] = slyr;
					}
					break;
				case "vector-tile":
					var layers = lyr.currentStyleInfo.style.layers;
					var oldKey = null;
					for (var j = layers.length - 1; j >= 0; j--) {
						var sublyr = layers[j];
						var tblName = sublyr["source-layer"];
						if (!tblName.endsWith("/label")) {
							var key = tblName.substring(tblName.indexOf(".") + 1);
							if (key != oldKey) {
								var table = NUT.lookupTable[key];
								if (table) {
									AGMap.tables[key] = table;
									if (!AGMap.tables[0]) AGMap.tables[0] = table;
								}
								oldKey = key;
							}
						}
					}
					AGMap.layers["LYR_VECTORTILE"] = lyr;
					break;
			}
		}
		var lyr = new AGMap.GraphicsLayer({ id: 'LYR_GRAPHICS' });
		AGMap.map.add(lyr);
		NUT.AGMap.layers[lyr.id] = lyr;

		AGMap.view.watch("stationary", function (oldVal, newVal) {
			if (newVal) {
				if (AGMap.skipme) AGMap.skipme = false;
				else AGMap.backStack.push(AGMap.view.extent);
			}
		});

		AGMap.search = new AGMap.Search({
			view: AGMap.view,
			sources: sources
		});
		AGMap.view.ui.add(AGMap.search, "top-left");
		if (!NUT.isMobile) AGMap.view.ui.add("zoom", "top-left");
		AGMap.view.ui.add("compass", "top-right");
		AGMap.view.ui.add(new AGMap.Locate({ view: AGMap.view }), "top-right");
		AGMap.view.ui.add(AGMap.wzSketch, "bottom-left");

		mnuMain.onExpand = function (evt) {
			var menu = NUT.w2ui.mnuMain.get(evt.object.id);
			var lyr = AGMap.layers[menu.maplayer];
			if (lyr) {
				var flat = this.flat;
				switch (lyr.renderer.type) {
					case "simple":
						if (menu.nodes.length == 1) {
							var node = menu.nodes[0];
							AGMap.symbolUtils.renderPreviewHTML(lyr.renderer.symbol, { size: 12 }).then(function (res) {
								NUT.w2ui.mnuMain.set(node.id, { icon: res });
								if (flat) evt.object.items[0].icon = res;
							});
						}

						break;
					case "unique-value":
						if (menu.nodes.length == 1) {
							var nodes = [];
							AGMap.htmlSymbolNodes(menu, lyr.renderer, nodes, function () {
								NUT.w2ui.mnuMain.add(menu, nodes);
								if (flat) evt.object.items = evt.object.items.concat(nodes);
								lyr.originWhere = lyr.definitionExpression;
							});

						}
						break;
				}
			}
			event.stopPropagation();
		}
		mnuMain.handle = {
			width: 4,
			text: function (node) {
				var handle = "";
				var layer = AGMap.layers[node.maplayer];
				if (layer && !node.noHandle) {
					var visible = layer.visible;
					if (node.subvalue) {
						var parent = node.parent;
						for (var i = 1; i < parent.nodes.length; i++) {
							var n = parent.nodes[i];
							if (n.id == node.id) visible = n.visible;
						}
					}
					handle = "<input type='checkbox' " + (node.subvalue ? "style='margin-left:12px'" : "") + " onclick='event.stopPropagation();NUT.AGMap.visibleLayer(" + node.id + ",\"" + node.maplayer + "\",this.checked,\"" + (node.subvalue || "") + "\")'" + (visible ? " checked/>" : "/>");
				}
				return handle;
			}
		};
		mnuMain.refresh();
		AGMap.extent = AGMap.view.extent;
		if (AGMap.onInit) AGMap.onInit();
	}
	static visibleLayer(nodeid, maplayer, visible, subvalue) {
		var layer = AGMap.layers[maplayer];
		var node = NUT.w2ui.mnuMain.get(nodeid);
		if (node.subtype) {
			var where = [];
			if (layer.originWhere) where.push(layer.originWhere);
			for (var i = 1; i < node.nodes.length; i++) {
				var n = node.nodes[i];
				if (n.subvalue == subvalue) n.visible = visible;
				if (!n.visible) where.push(node.subtype + "<>" + n.subvalue);
			}
			if (layer.originWhere) where.push(layer.originWhere);
			layer.definitionExpression = where.join(" and ");
		}
		if (!subvalue) {
			if (layer.parent && layer.parent.type == "tile") layer.parent.visible = visible;
			else layer.visible = visible;
		}
	}
	static htmlSymbolNodes(menu, renderer, nodes, callback) {
		var i = nodes.length;
		if (i < renderer.uniqueValueInfos.length) {
			var inf = renderer.uniqueValueInfos[i];
			AGMap.symbolUtils.renderPreviewHTML(inf.symbol, { size: 12 }).then(function (res) {
				nodes.push({ id: menu.id + "_" + i, maplayer: menu.maplayer, tag: menu.tag, visible: true, icon: res, where: [renderer.field, "=", inf.value], subvalue: inf.value, layerTitle: inf.label, text: inf.label });
				AGMap.htmlSymbolNodes(menu, renderer, nodes, callback);
			});
		} else callback();
	}

	static zoomToCoords(coords, geomtype, label) {
		AGMap.view.graphics.removeAll();
		var xy = [];
		var texts = [];
		for (var i = 0; i < coords.length; i++) {
			xy.push(AGMap.ddmmss2decimal(coords[i]));
			if (label && geomtype == "polygon") {
				texts.push({
					geometry: {
						type: "point",
						longitude: xy[i][0],
						latitude: xy[i][1]
					},
					symbol: { type: "text", text: NUT.ALPHABET[i], color: "red", haloColor: "white", haloSize: 2, font: { size: 14, weight: "bold" } }
				});
			}
		}
		var geom = geomtype == "point" ? new AGMap.Point({ x: xy[0][0], y: xy[0][1] }) : (geomtype == "polygon" ? new AGMap.Polygon({ rings: [xy] }) : new AGMap.Polyline({ paths: [xy] }));
		if (geom) {
			AGMap.view.graphics.add({
				geometry: geom,
				symbol: AGMap.SYMBOL[geomtype]
			});
			AGMap.view.graphics.addMany(texts);
			AGMap.view.goTo(geomtype == "point" ? geom : geom.extent.expand(1.5));
		}
	}
	static selectByOID(maplayer, oid, zoom) {
		AGMap.view.graphics.removeAll();
		if (AGMap.isVtpk) {
			var table = AGMap.tables[maplayer];
			AGMap.querySqlGeometry({ table: table, where:["OBJECTID","in",oid] }, function (res) {
				if (res.result.length) {
					var ext = null;
					for (var i = 0; i < res.result.length; i++) {
						var feat = res.result[i];
						feat.symbol = AGMap.SYMBOL[feat.geometry.type];
						AGMap.view.graphics.add(feat);
						if (zoom && ext) ext.union(feat.geometry.extent);
					}
					if (zoom) AGMap.view.goTo(ext ? ext.expand(1.5) : res.result[0].geometry);
				}
			});
		} else {
			var layer = AGMap.layers[maplayer];
			oid = [(layer.oidOffset || 0) + oid];
			layer.queryFeatures({ objectIds: oid, returnGeometry: true }).then(function (res) {
				if (res.features.length) {
					var ext = null;
					for (var i = 0; i < res.features.length; i++) {
						var feat = res.features[i];
						feat.symbol = AGMap.SYMBOL[res.geometryType];
						AGMap.view.graphics.add(feat);
						if (zoom && ext) ext.union(feat.geometry.extent);
					}
					if (zoom) AGMap.view.goTo(ext ? ext.expand(1.5) : res.features[0].geometry);
				}
			});
		}
	}
	static selectByQuery(maplayer, query, zoom) {
		if (AGMap.isVtpk) {
			query.table = AGMap.tables[maplayer];
			AGMap.querySqlGeometry(query, function (res) {
				AGMap.selectFeatures(maplayer,res.result, zoom);
			});
		} else {
			var layer = AGMap.layers[maplayer];
			query.returnGeometry = true;
			layer.queryFeatures(query).then(function (res) {
				AGMap.selectFeatures(maplayer, res.results, zoom);
			});
		}
	}
	static selectFeatures(maplayer,feats, zoom) {
		AGMap.view.graphics.removeAll();
		if (feats.length) {
			var ext = null, oid = [];
			for (var i = 0; i < feats.length; i++) {
				var feat = feats[i];
				feat.symbol = AGMap.SYMBOL[feat.geometry.type];
				AGMap.view.graphics.add(feat);
				if (zoom && ext) ext.union(feat.geometry.extent);
				oid.push(feat.attributes.OBJECTID);
			}
			var grid = AGMap.grids[maplayer];
			grid.gisWhere = (oid.length ? oid : null);
			grid.reload();
			if (zoom) AGMap.view.goTo(ext ? ext.expand(1.5) : res.result[0].geometry);
		}
	}
	static filterLayer(conf, where) {
		var layer = AGMap.layers[conf.table.maplayer];
		if (layer.source) {//client-side
			NUT.ds.select({ url: conf.table.urlview, limit: 10000, where: where }, function (res) {
				if (res.success) {
					var graphics = [];
					for (var i = 0; i < res.result.length; i++) {
						var rec = res.result[i];
						graphics.push({
							geometry: {
								type: "point",
								x: rec.lng,
								y: rec.lat
							},
							attributes: rec
						});
					}
					layer.queryFeatures({ where: "1=1" }).then(function (res2) {
						layer.oidOffset = (layer.oidOffset || 0) + res2.features.length;
						layer.applyEdits({
							deleteFeatures: res2.features,
							addFeatures: graphics
						});
					});
				} else NUT.notify("🛑 ERROR: " + res.result, "red");
			});
		} else layer.definitionExpression = NUT.ds.decodeSql({ where: where });
	}
	
	static showEditor(maplayer) {
		var layerInfos = [];
		for (var i = 0; i < AGMap.map.editableLayers.length; i++) {
			var lyr = AGMap.map.editableLayers.getItemAt(i);
			layerInfos.push({ layer: lyr, enabled: maplayer == lyr.id });
		}
		var a = NUT.createWindowTitle("editor", divTitle, function () {
			AGMap.wzEditor.cancelWorkflow()
		});
		if (a) {
			AGMap.wzEditor = new AGMap.Editor({
				container: a.div,
				view: AGMap.view,
				layerInfos: layerInfos
			});
			AGMap.wzEditor.renderNow();
			a.innerHTML = "Editor";
		} else AGMap.wzEditor.layerInfos = layerInfos;
	}
	static get(p, onok) {
		var xhr = new XMLHttpRequest();
		xhr.onreadystatechange = function () {
			if (this.readyState == XMLHttpRequest.DONE) {
				if (this.status == 0 || (this.status >= 200 && this.status < 400)) {
					if (onok) onok(JSON.parse(this.response));
				} else this.onerror(this.status);
			}
		};
		xhr.onerror = this.onerror;
		xhr.open(p.method || "GET", p.url + (p.alldata ? "&resultOffset=" + (2000 * p.alldata.length) : "") + (p.token && this.token ? "&token=" + (p.token && this.token) : ""), true);
		xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
		xhr.send();
	}
	static getAll(p, onok) {
		AGMap.get(p, function (res) {
			if (res.error) onok(res);
			else if (res.features.length < 2000) {
				p.alldata.push(res.features);
				onok(p);
			} else {
				p.alldata.push(res.features);
				AGMap.getAll(p, onok)
			};
		});
	}
	static post(p, onok) {
		var xhr = new XMLHttpRequest();
		xhr.onreadystatechange = function () {
			if (this.readyState == XMLHttpRequest.DONE) {
				if (this.status == 0 || (this.status >= 200 && this.status < 400)) {
					if (onok) onok(JSON.parse(this.response));
				} else this.onerror(this.status);
			}
		};
		xhr.onerror = this.onerror;
		xhr.open("POST", p.url + (this.token ? "&token=" + this.token : ""), true);
		xhr.setRequestHeader("Content-Type", p.contentType || "application/json;charset=UTF-8");
		xhr.send(JSON.stringify(p.data));
	}
	static submit(p, onok) {
		var xhr = new XMLHttpRequest();
		xhr.onreadystatechange = function () {
			if (this.readyState == XMLHttpRequest.DONE) {
				if (this.status == 0 || (this.status >= 200 && this.status < 400)) {
					if (onok) onok(JSON.parse(this.response));
				} else this.onerror(this.status);
			}
		};
		xhr.onerror = this.onerror;
		xhr.open("POST", p.url + (this.token ? "&token=" + this.token : ""), true);
		xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
		xhr.send(new URLSearchParams(p.data));
	}
	static onerror(err) {
		alert("🛑 ERROR: " + err);
	}
}