(function () {
	var DEFAULT_THEME = "sp";
	var STORAGE_KEY = "theme";
	var LAYOUT = {
		topbar: 60,
		sidebar: 180,
		sidebarMin: 150,
		sidebarCollapsed: 45,
		sidebarWide: 240,
		logoWidth: 170,
		rightPanel: 660
	};
	var root = document.documentElement;

	function viewportWidth() {
		return Math.max(root.clientWidth || 0, window.innerWidth || 0, 1280);
	}

	function layoutForViewport(width) {
		var value = Number(width || viewportWidth());
		var compact = value <= 640;
		var medium = value <= 1024;

		return {
			compact: compact,
			medium: medium,
			topbar: LAYOUT.topbar,
			sidebar: medium ? 160 : LAYOUT.sidebar,
			sidebarMin: LAYOUT.sidebarMin,
			sidebarCollapsed: LAYOUT.sidebarCollapsed,
			sidebarWide: medium ? 180 : LAYOUT.sidebarWide,
			logoWidth: compact ? 48 : (medium ? 112 : LAYOUT.logoWidth),
			rightPanel: Math.max(320, Math.min(LAYOUT.rightPanel, Math.round(value * (medium ? 0.55 : 0.42))))
		};
	}

	function queryTheme() {
		var params = new URLSearchParams(window.location.search || "");
		return params.get("theme") || "";
	}

	function normalizeTheme(theme) {
		var value = String(theme || "").trim();
		if (!value || value == "w2ui" || value == "w2ui.min") return DEFAULT_THEME;
		if (value == "dark" || value == "black") return "sp-dark";
		if (value == "light" || value == "white") return "sp";
		return value;
	}

	function modeFromTheme(theme) {
		return /dark|black|night/i.test(String(theme || "")) ? "dark" : "light";
	}

	function currentTheme() {
		return normalizeTheme(queryTheme() || storageGet(STORAGE_KEY) || DEFAULT_THEME);
	}

	function storageGet(key) {
		try {
			return localStorage.getItem(key);
		} catch (err) {
			return "";
		}
	}

	function storageSet(key, value) {
		try {
			localStorage.setItem(key, value);
		} catch (err) {
			/* Ignore private-mode storage errors. */
		}
	}

	var resizeTimer = null;
	var resizeObserver = null;
	var autoResizeBound = false;
	var resizeDragActive = false;

	function w2Registry() {
		if (window.NUT && window.NUT.w2ui) return window.NUT.w2ui;
		return window.w2ui || {};
	}

	function isVisibleBox(box) {
		if (!box || !box.isConnected) return false;
		if (box.offsetWidth || box.offsetHeight || box.getClientRects().length) {
			return window.getComputedStyle(box).display != "none";
		}
		return false;
	}

	function resizeVisibleW2UI() {
		normalizeFormGroups();
		var registry = w2Registry();
		Object.keys(registry).forEach(function (key) {
			var obj = registry[key];
			if (!obj || typeof obj.resize != "function" || !isVisibleBox(obj.box)) return;
			if (Array.isArray(obj.columns)) fitGridColumns(obj);
			try {
				obj.resize();
			} catch (err) {
				/* Some widgets are mid-render while panels are being dragged. */
			}
		});
	}

	function normalizeFormGroups() {
		var pages = document.querySelectorAll(".w2ui-form .w2ui-page");
		pages.forEach(function (page) {
			var columns = page.querySelector(":scope > .w2ui-column-container");
			if (!columns) return;
			var groups = Array.prototype.slice.call(columns.querySelectorAll(".w2ui-group"));
			if (!groups.length) return;

			var dock = page.querySelector(":scope > .dv-form-group-dock");
			if (!dock) {
				dock = document.createElement("div");
				dock.className = "dv-form-group-dock";
				columns.insertAdjacentElement("afterend", dock);
			}
			groups.forEach(function (group) {
				tagAdvancedGroup(group);
				dock.appendChild(group);
			});
		});
	}

	function tagAdvancedGroup(group) {
		var title = group.querySelector(".w2ui-group-title");
		var text = title ? title.textContent : "";
		var normalized = text.normalize ? text.normalize("NFD").replace(/[\u0300-\u036f]/g, "") : text;
		normalized = normalized.toLowerCase().replace(/\s+/g, " ").trim();
		group.classList.toggle("dv-form-group-advanced", /advanc|nang cao/.test(normalized));
	}

	function parseSize(value, fallback) {
		var size = parseInt(String(value || ""), 10);
		return Number.isFinite(size) && size > 0 ? size : fallback;
	}

	function clamp(value, min, max) {
		return Math.max(min, Math.min(max, value));
	}

	function fitGridColumns(gridOrColumns) {
		var columns = Array.isArray(gridOrColumns) ? gridOrColumns : gridOrColumns && gridOrColumns.columns;
		if (!Array.isArray(columns) || !columns.length) return columns;

		columns.forEach(function (col) {
			if (col && col.frozen) {
				col.__dvFrozenOriginal = col.frozen;
				col.frozen = false;
			}
		});

		var identity = columns.map(function (col) {
			return [col.field, col.text, col.hidden ? "h" : "", col.frozen ? "f" : ""].join(":");
		}).join("|");
		if (gridOrColumns) gridOrColumns.__dvColumnIdentity = identity;

		var visible = columns.filter(function (col) {
			return !col.hidden;
		});
		if (!visible.length) return columns;

		var total = 0;
		visible.forEach(function (col) {
			if (!col.__dvBaseSize) {
				col.__dvBaseSize = parseSize(col.sizeOriginal || col.size, 100);
			}
			total += col.__dvBaseSize;
		});
		if (!total) total = visible.length * 100;

		visible.forEach(function (col) {
			var pct = col.__dvBaseSize * 100 / total;
			col.size = Math.max(1, Math.round(pct * 100) / 100) + "%";
			col.min = clamp(Math.round(col.__dvBaseSize * 0.52), 56, 180);
			col.max = null;
			col.__dvPercentSized = true;
		});
		return columns;
	}

	function observeW2UIContainers() {
		if (!window.ResizeObserver || !document.body) return;
		if (!resizeObserver) {
			resizeObserver = new ResizeObserver(function () {
				scheduleResizeW2UI(80);
			});
		}
		var targets = document.querySelectorAll(".w2ui-layout, .w2ui-panel-content, #divMain, #divRight, #divBottom");
		targets.forEach(function (target) {
			if (target.__dvResizeObserved) return;
			target.__dvResizeObserved = true;
			resizeObserver.observe(target);
		});
	}

	function scheduleResizeW2UI(delay) {
		clearTimeout(resizeTimer);
		resizeTimer = setTimeout(function () {
			observeW2UIContainers();
			resizeVisibleW2UI();
		}, delay == null ? 80 : delay);
	}

	function isResizeHandle(target) {
		return !!(target && target.closest && target.closest(".w2ui-resizer"));
	}

	function isLayoutTransition(target) {
		return !!(target && target.matches && target.matches(".w2ui-layout, .w2ui-panel, #divLeft, #divMain, #divRight, #divBottom"));
	}

	function bindW2UIAutoResize() {
		if (autoResizeBound) return;
		autoResizeBound = true;
		window.addEventListener("resize", function () {
			scheduleResizeW2UI(80);
		});
		window.addEventListener("orientationchange", function () {
			scheduleResizeW2UI(120);
		});
		document.addEventListener("pointerdown", function (evt) {
			resizeDragActive = isResizeHandle(evt.target);
		}, true);
		document.addEventListener("mouseup", function (evt) {
			if (resizeDragActive || isResizeHandle(evt.target)) scheduleResizeW2UI(40);
			resizeDragActive = false;
		}, true);
		document.addEventListener("pointerup", function (evt) {
			if (resizeDragActive || isResizeHandle(evt.target)) scheduleResizeW2UI(40);
			resizeDragActive = false;
		}, true);
		document.addEventListener("transitionend", function (evt) {
			if (isLayoutTransition(evt.target)) scheduleResizeW2UI(40);
		}, true);
		scheduleResizeW2UI(120);
	}

	function applyTheme(theme, options) {
		var nextTheme = normalizeTheme(theme || currentTheme());
		var mode = modeFromTheme(nextTheme);

		root.dataset.dvTheme = mode;
		root.classList.toggle("dv-dark", mode == "dark");
		root.classList.toggle("dv-light", mode != "dark");
		root.style.colorScheme = mode;

		if (options && options.persist) storageSet(STORAGE_KEY, nextTheme);
		bindW2UIAutoResize();
		return nextTheme;
	}

	function setMode(mode) {
		return applyTheme(mode == "dark" ? "sp-dark" : "sp", { persist: true });
	}

	window.DaiVietUI = {
		defaultTheme: DEFAULT_THEME,
		layout: LAYOUT,
		layoutForViewport: layoutForViewport,
		normalizeTheme: normalizeTheme,
		modeFromTheme: modeFromTheme,
		currentTheme: currentTheme,
		applyTheme: applyTheme,
		setMode: setMode,
		fitGridColumns: fitGridColumns,
		bindW2UIAutoResize: bindW2UIAutoResize,
		resizeVisibleW2UI: resizeVisibleW2UI,
		normalizeFormGroups: normalizeFormGroups,
		scheduleResizeW2UI: scheduleResizeW2UI
	};

	applyTheme(currentTheme());
})();
