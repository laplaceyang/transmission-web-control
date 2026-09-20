/**
 * [bind-watch] 底部状态栏显示 transmission 当前绑定地址（版本号左侧）。
 * 数据来自 bind-watch 服务写入的静态文件 /transmission/web/bind-status.txt。
 */
(function () {
	function label() {
		var lang = (window.system && system.lang && system.lang.name) || "";
		return lang.indexOf("zh") == 0 ? "绑定" : "Binding";
	}

	function render(text) {
		var bar = document.getElementById("m_statusbar");
		if (!bar) return;
		var el = document.getElementById("status_bind");
		if (!el) {
			el = document.createElement("span");
			el.id = "status_bind";
			el.style.cssText = "float:right;margin-right:8px;color:#888;cursor:default;";
			var ver = document.getElementById("status_version");
			if (ver && ver.parentNode === bar) {
				bar.insertBefore(el, ver.nextSibling);
			} else {
				bar.appendChild(el);
			}
		}
		var map = {};
		text.split(/\r?\n/).forEach(function (line) {
			var p = line.split("=");
			if (p.length === 2) {
				map[p[0].trim()] = p[1].trim();
			}
		});
		var parts = [];
		if (map.interface) parts.push(map.interface);
		if (map.ipv4) parts.push(map.ipv4);
		var v6 = map.ipv6 || "";
		if (v6.length > 24) v6 = v6.slice(0, 21) + "…";
		if (v6) parts.push(v6);
		el.innerHTML = label() + ": " + (parts.join(" / ") || "-");
		el.title = text;
	}

	function refresh() {
		fetch("/transmission/web/bind-status.txt", { cache: "no-store" })
			.then(function (r) {
				return r.ok ? r.text() : "";
			})
			.then(function (t) {
				if (t) render(t);
			})
			.catch(function () {});
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", refresh);
	} else {
		refresh();
	}
	setInterval(refresh, 60000);
})();
