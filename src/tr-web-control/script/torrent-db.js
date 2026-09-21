/**
 * [torrent-db] 种子分类库前端模块（配合 backend/torrent-db 后端服务）
 *
 * - 左侧导航"分类"组：全部分类/未分类/各分类节点，点击即筛选（与状态节点互斥，
 *   qB 同款交互）；组节点右键 = 添加分类 / 移除未使用的分类
 * - 分类管理弹窗：新建/改名/改路径/删除分类（删除不动文件）
 * - 右键种子菜单：划入「分类」/ 移出分类（立即搬移）
 * - 系统设置弹窗"绑定"页签：绑定指定网卡（选项来自系统网卡列表）或不绑定
 *
 * 后端地址默认 http://<主机>:38082，可用 localStorage["torrentdb_port"] 覆盖。
 */
(function () {
	var PORT = localStorage.getItem("torrentdb_port") || "38082";
	var API = location.protocol + "//" + location.hostname + ":" + PORT;
	// 特殊筛选节点
	var NODE_PREFIX = "torrentdb-cat-";
	var NODE_ALL = "torrentdb-cat-all";
	var NODE_NONE = "torrentdb-cat-none";
	var UNCATEGORIZED = "@";
	// 数据同步节拍跟随页面自动刷新（system.js reloadData 里触发 load()）

	// 内置文案（个人 fork，不进 16 个 i18n 文件；en 缺失时回退中文）
	var TEXT = {
		zh_CN: {
			all: "全部分类",
			uncategorized: "未分类",
			manage: "分类管理",
			treeCategories: "分类",
			addCategory: "添加分类",
			removeUnused: "移除未使用的分类",
			noUnused: "没有未使用的分类",
			removeUnusedConfirm: "确定删除 {0} 个未使用的分类？<br>只删规则，文件保留原位。",
			moveOut: "移出分类",
			dialogTitle: "分类管理",
			colName: "分类名",
			colPath: "保存路径",
			colFiles: "记录数",
			colOp: "操作",
			edit: "编辑",
			del: "删除",
			save: "保存",
			cancel: "取消",
			close: "关闭",
			namePh: "分类名",
			pathPh: "保存路径（如 /downloads/电影）",
			hint: "删除分类只删除规则：文件保留原位，对应种子归入未分类",
			deleteConfirm: "删除分类「{0}」？<br>文件保留在原目录，对应种子将归入未分类。",
			assigned: "已划入「{0}」，文件开始搬移",
			assignTo: "划入「{0}」",
			unassigned: "已移出分类，文件保持原位",
			loadError: "分类服务不可达（torrent-db 后端）",
			bindNow: "当前绑定：",
			bindNone: "不绑定（监听所有地址）",
			bindIf: "绑定指定网卡：",
			bindSaved: "已保存，bind-watch 将在一分钟内应用（期间 transmission 短暂重启）",
			bindTip: "绑定后 transmission 只通过该网卡的地址收发；保存后 bind-watch 在 1 分钟内自动改写配置并重启生效。",
			bindNeedIf: "请选择网卡",
			bindUnknown: "未知（bind-watch 未上报）",
			bindTabTitle: "绑定",
			bindAddrNone: "该网卡当前没有全局地址",
			addCategoryLabel: "分类",
			addCategoryNone: "不指定（默认目录）",
			columnTitle: "分类"
		},
		en: {
			all: "All categories",
			uncategorized: "Uncategorized",
			manage: "Manage",
			treeCategories: "Categories",
			addCategory: "Add category",
			removeUnused: "Remove unused categories",
			noUnused: "No unused categories",
			removeUnusedConfirm: "Remove {0} unused categories?<br>Only rules are deleted; files stay in place.",
			moveOut: "Remove from category",
			dialogTitle: "Category manager",
			colName: "Name",
			colPath: "Save path",
			colFiles: "Records",
			colOp: "Actions",
			edit: "Edit",
			del: "Delete",
			save: "Save",
			cancel: "Cancel",
			close: "Close",
			namePh: "Name",
			pathPh: "Save path (e.g. /downloads/movies)",
			hint: "Deleting a category only removes the rule; files stay in place and become uncategorized",
			deleteConfirm: "Delete category \"{0}\"?<br>Files stay where they are; torrents become uncategorized.",
			assigned: "Assigned to \"{0}\", moving files",
			assignTo: "Assign to \"{0}\"",
			unassigned: "Removed from category, files untouched",
			loadError: "torrent-db backend unreachable",
			bindNow: "Current binding: ",
			bindNone: "No binding (listen on all addresses)",
			bindIf: "Bind to interface:",
			bindSaved: "Saved. bind-watch will apply it within a minute (transmission restarts briefly)",
			bindTip: "When bound, transmission only uses the addresses of that interface. bind-watch rewrites the config and restarts transmission within a minute.",
			bindNeedIf: "Please select an interface",
			bindUnknown: "unknown (no report from bind-watch)",
			bindTabTitle: "Binding",
			bindAddrNone: "No global address on this interface",
			addCategoryLabel: "Category",
			addCategoryNone: "None (default directory)",
			columnTitle: "Category"
		}
	};

	function t(key) {
		// 跟随页面已加载的语言（system.lang.name），zh 系用中文，其余用英文
		var lang = (system.lang && system.lang.name) || "zh_CN";
		var dict = TEXT[lang];
		if (!dict) {
			dict = lang.indexOf("zh") == 0 ? TEXT.zh_CN : TEXT.en;
		}
		return dict[key] !== undefined ? dict[key] : TEXT.zh_CN[key];
	}

	function fmt(s) {
		var args = Array.prototype.slice.call(arguments, 1);
		return String(s).replace(/\{(\d+)\}/g, function (m, i) {
			return args[parseInt(i, 10)];
		});
	}

	function errText(xhr) {
		try {
			var data = JSON.parse(xhr.responseText);
			if (data && data.error) return data.error;
		} catch (e) { /* ignore */ }
		return t("loadError");
	}

	function catNodeId(name) {
		return NODE_PREFIX + encodeURIComponent(name);
	}

	function catNameFromNodeId(id) {
		return decodeURIComponent(id.substr(NODE_PREFIX.length));
	}

	var TorrentDB = {
		categories: [],   // [{name, path, files}]
		assignments: {},  // 种子名 -> 分类名
		settings: {},     // 键值设置（bind_interface 等）
		bind: null,       // bind-watch 实时状态 {interface,ipv4,ipv6,updated}
		interfaces: [],   // 系统网卡列表（设置弹窗下拉用）
		current: "",      // 当前筛选："" 全部 / "@" 未分类 / 分类名（由左栏所选节点决定）

		// ---- 数据同步 -------------------------------------------------
		url: function (path) {
			return API + path;
		},

		load: function (cb) {
			$.getJSON(this.url("/api/data?_=" + new Date().getTime()), function (data) {
				TorrentDB.categories = data.categories || [];
				TorrentDB.assignments = data.assignments || {};
				TorrentDB.settings = data.settings || {};
				TorrentDB.bind = data.bind || null;
				// 当前所选分类被删除时回退到全部
				if (TorrentDB.current && TorrentDB.current != UNCATEGORIZED) {
					var alive = TorrentDB.categories.some(function (c) {
						return c.name == TorrentDB.current;
					});
					if (!alive) {
						TorrentDB.current = "";
					}
				}
				TorrentDB.updateCategoryTree();
				TorrentDB.refreshList();
				if (cb) cb(true);
			}).fail(function () {
				if (cb) cb(false);
			});
		},

		loadInterfaces: function (cb) {
			$.getJSON(this.url("/api/interfaces?_=" + new Date().getTime()), function (d) {
				TorrentDB.interfaces = d.interfaces || [];
				if (cb) cb(TorrentDB.interfaces);
			}).fail(function () {
				if (cb) cb([]);
			});
		},

		// ---- 左侧导航分类组 ---------------------------------------------
		navGroup: function () {
			return {
				id: "torrentdb",
				text: t("treeCategories"),
				iconCls: "iconfont tr-icon-labels",
				state: "open",
				children: [
					{ id: NODE_ALL, text: t("all"), iconCls: "iconfont tr-icon-home" },
					{ id: NODE_NONE, text: t("uncategorized"), iconCls: "iconfont tr-icon-empty" }
				]
			};
		},

		// 计算各分类在线种子数/未分类数（左栏树节点计数用）
		computeCounts: function () {
			var counts = {};
			var unc = 0;
			var all = transmission.torrents.all || {};
			for (var key in all) {
				var tt = all[key];
				if (!tt || !tt.name) continue;
				var cat = this.assignments[tt.name];
				if (cat) {
					counts[cat] = (counts[cat] || 0) + 1;
				} else {
					unc++;
				}
			}
			return { counts: counts, unc: unc };
		},

		// 按数据重建分类子节点（增/改文本/删失效节点），文本带在库种子计数。
		// 注意：easyui 的 tree 方法必须以 system.panel.left.tree(...) 形式调用
		// （不能把方法抽出来单独调用，会丢失 this 导致内部拿不到树元素）。
		updateCategoryTree: function () {
			if (!system.control || !system.control.torrentlist) return;
			try {
				var left = system.panel.left;
				if (!this._groupTarget) {
					var g = left.tree("find", "torrentdb");
					if (g && g.target) {
						this._groupTarget = g.target;
					}
				}
				if (!this._groupTarget) return;

				var self = this;
				var scan = function () {
					var byId = {};
					var list = left.tree("getChildren", self._groupTarget) || [];
					for (var i = 0; i < list.length; i++) {
						byId[list[i].id] = list[i];
					}
					return byId;
				};

				// 计算每个分类的在线种子数 / 未分类数
				var cnt = this.computeCounts();
				var counts = cnt.counts;
				var unc = cnt.unc;

				var byId = scan();
				// 移除已删除分类的节点
				for (var id in byId) {
					if (id != NODE_ALL && id != NODE_NONE && id.indexOf(NODE_PREFIX) == 0) {
						var name = catNameFromNodeId(id);
						var alive = this.categories.some(function (c) {
							return c.name == name;
						});
						if (!alive && byId[id].target) {
							left.tree("remove", byId[id].target);
						}
					}
				}

				// 添加缺失的分类节点
				byId = scan();
				for (var j = 0; j < this.categories.length; j++) {
					var c = this.categories[j];
					var nid = catNodeId(c.name);
					if (!byId[nid]) {
						system.appendTreeNode({ target: this._groupTarget }, [{
							id: nid,
							text: c.name,
							iconCls: "iconfont tr-icon-folder"
						}]);
					}
				}

				// 更新节点文本（带计数）+ 高亮当前分类筛选节点
				byId = scan();
				var setText = function (node, html) {
					if (node && node.target) {
						$(node.target).find("span.tree-title").html(html);
					}
				};
				for (var k = 0; k < this.categories.length; k++) {
					var cc = this.categories[k];
					setText(byId[catNodeId(cc.name)], cc.name + system.showNodeMoreInfos(counts[cc.name] || 0));
				}
				setText(byId[NODE_NONE], t("uncategorized") + system.showNodeMoreInfos(unc));
				var activeId = this.current == UNCATEGORIZED
					? NODE_NONE
					: (this.current ? catNodeId(this.current) : NODE_ALL);
				for (var m in byId) {
					if (!byId[m].target) continue;
					// 复用 easyui 原生选中样式，观感与"下载中"等节点一致（全行高亮）
					$(byId[m].target).toggleClass("tree-node-selected", m == activeId);
				}
			} catch (e) { /* 导航树未就绪时跳过，下一轮同步再试 */
				if (window.console && console.warn) console.warn("[torrent-db] updateCategoryTree:", e);
			}
		},

		// ---- 列表"分类"列 -------------------------------------------------
		// 列定义在 template/torrent-fields.json（tdb_category），system.js
		// 初始化时把标题/渲染接到这里；数据是归属表，随 reloadData 节拍刷新
		categoryColumnTitle: function () {
			return t("columnTitle");
		},

		categoryFormatter: function (value, row) {
			var cat = TorrentDB.assignments[row.name];
			return cat ? $("<span/>").text(cat).html() : "";
		},

		// 分类维度节点（全部分类/未分类/各分类）是独立于状态节点的筛选开关：
		// 点击只切换分类筛选并自行高亮，不移动树的光标，因此可以和
		// 左侧的状态节点（全部/下载中/做种…）同时生效（复合筛选）。
		isCategoryNode: function (id) {
			return id == NODE_ALL || id == NODE_NONE || (id && id.indexOf(NODE_PREFIX) == 0);
		},

		onCategoryNodeClick: function (node) {
			var id = node.id || "";
			if (id == NODE_ALL) {
				this.current = "";
			} else if (id == NODE_NONE) {
				this.current = this.current == UNCATEGORIZED ? "" : UNCATEGORIZED;
			} else if (id.indexOf(NODE_PREFIX) == 0) {
				var name = catNameFromNodeId(id);
				this.current = this.current == name ? "" : name;
			} else {
				return;
			}
			localStorage.setItem("torrentdb_current", this.current);
			this.updateCategoryTree();
			this.refreshList();
		},

		// 分类组右键菜单。返回 true 表示已处理（阻止浏览器默认菜单）
		onTreeContextMenu: function (node, e) {
			var id = node.id || "";
			if (id != "torrentdb" && id.indexOf(NODE_PREFIX) != 0) {
				return false;
			}
			this.treeMenu().menu("show", {
				left: e.pageX,
				top: e.pageY,
				hideOnUnhover: false
			});
			return true;
		},

		treeMenu: function () {
			var self = this;
			var parent = this._treeMenu;
			if (!parent) {
				parent = $("<div/>").attr("class", "easyui-menu").css({
					"min-width": "160px"
				}).appendTo(system.panel.main);
				this._treeMenu = parent;
				parent.menu();
			} else {
				parent.empty();
			}
			parent.menu("appendItem", {
				text: t("manage") + "...",
				iconCls: "iconfont tr-icon-labels",
				onclick: function () {
					self.openManage();
				}
			});
			parent.menu("appendItem", {
				text: t("removeUnused"),
				iconCls: "iconfont tr-icon-delete",
				onclick: function () {
					self.removeUnused();
				}
			});
			return parent;
		},

		removeUnused: function () {
			var unused = this.categories.filter(function (c) {
				return !c.files;
			});
			if (unused.length == 0) {
				$.messager.show({ msg: t("noUnused"), timeout: 3000 });
				return;
			}
			$.messager.confirm("", fmt(t("removeUnusedConfirm"), unused.length), function (ok) {
				if (!ok) return;
				$.ajax({
					url: TorrentDB.url("/api/category-remove-unused"),
					method: "POST",
					contentType: "application/json",
					data: "{}",
					success: function () {
						TorrentDB.load();
					},
					error: function (xhr) {
						$.messager.alert("", TorrentDB._err(xhr));
					}
				});
			});
		},

		// ---- 筛选 -------------------------------------------------------
		filterTorrents: function (torrents) {
			if (!torrents || !this.current) {
				return torrents;
			}
			// transmission.torrents.all 是字典、status[*] 是数组，用 for-in 兼容两者
			var cur = this.current;
			var self = this;
			var result = [];
			for (var key in torrents) {
				var t = torrents[key];
				if (!t || !t.name) continue;
				var cat = self.assignments[t.name];
				if (cur == UNCATEGORIZED) {
					if (!cat) result.push(t);
				} else if (cat == cur) {
					result.push(t);
				}
			}
			return result;
		},

		refreshList: function () {
			// 界面尚未初始化（如 transmission 里还没有种子）时跳过
			if (!system.control || !system.control.torrentlist) return;
			var node = system.panel.left.tree("getSelected");
			if (node == null) {
				// 没有选中节点时兜底到"全部"，保证归属更新后列表一定重绘
				node = system.panel.left.tree("find", "torrent-all");
			}
			if (node != null) {
				try {
					system.loadTorrentToList({ node: node });
				} catch (e) {
					if (window.console && console.warn) console.warn("[torrent-db] refreshList:", e);
				}
			}
		},

		// ---- 设置 -------------------------------------------------------
		saveSetting: function (key, value) {
			return $.ajax({
				url: this.url("/api/settings"),
				method: "POST",
				contentType: "application/json",
				data: JSON.stringify({ key: key, value: value })
			});
		},

		// 系统设置弹窗"绑定"页签（template/dialog-system-config.html 调用）
		initBindTab: function (dialog) {
			var self = this;
			var fill = function () {
				var value = self.settings.bind_interface || "";
				var sel = dialog.find("#tdb-bind-if-select");
				sel.empty();
				var names = self.interfaces.map(function (o) { return o.name; });
				if (value && $.inArray(value, names) == -1) names.push(value);
				for (var i = 0; i < names.length; i++) {
					$("<option/>").val(names[i]).text(names[i]).appendTo(sel);
				}
				sel.val(value).prop("disabled", !value);
				dialog.find("input[name='tdb-bind-mode'][value='" + (value ? "if" : "none") + "']").prop("checked", true);
				dialog.find("#tdb-bind-now").text(self.bindText(self.bind));
				dialog.find("#tdb-bind-now-label").text(t("bindNow"));
				dialog.find("#tdb-bind-none-text").text(t("bindNone"));
				dialog.find("#tdb-bind-if-text").text(t("bindIf"));
				dialog.find("#tdb-bind-tip").text(t("bindTip"));
				self.updateBindAddrLine(dialog);
				// 页签标题跟随语言（模板里是写死的）
				try {
					var tabs = dialog.find("#system-config-tabs");
					var list = tabs.tabs("tabs");
					for (var j = 0; j < list.length; j++) {
						var p = list[j];
						if (p.panel("options").title == "绑定") {
							tabs.tabs("update", { tab: p, options: { title: t("bindTabTitle") } });
							break;
						}
					}
				} catch (e) { /* 页签未就绪时跳过 */ }
			};
			dialog.find("input[name='tdb-bind-mode']").off("change.tdb").on("change.tdb", function () {
				var isIf = $("input[name='tdb-bind-mode']:checked", dialog).val() == "if";
				dialog.find("#tdb-bind-if-select").prop("disabled", !isIf);
				self.updateBindAddrLine(dialog);
			});
			dialog.find("#tdb-bind-if-select").off("change.tdb").on("change.tdb", function () {
				self.updateBindAddrLine(dialog);
			});
			// 每次打开都取最新网卡列表与绑定状态
			this.loadInterfaces(function () {
				self.load(function () { fill(); });
			});
		},

		// 选中网卡后在其下方显示该网卡的实时 IPv4/IPv6（分两行、完整显示）
		updateBindAddrLine: function (dialog) {
			var line = dialog.find("#tdb-bind-addr");
			if (line.length == 0) return;
			var mode = dialog.find("input[name='tdb-bind-mode']:checked").val();
			var name = dialog.find("#tdb-bind-if-select").val();
			if (mode != "if" || !name) {
				line.html("");
				return;
			}
			var info = null;
			for (var i = 0; i < this.interfaces.length; i++) {
				if (this.interfaces[i].name == name) {
					info = this.interfaces[i];
					break;
				}
			}
			if (!info || (!info.ipv4 && !info.ipv6)) {
				line.html("<div style='color:#888;'>" + name + ": " + t("bindAddrNone") + "</div>");
				return;
			}
			line.html(
				"<div>IPv4: " + (info.ipv4 || "-") + "</div>" +
				"<div>IPv6: " + (info.ipv6 || "-") + "</div>"
			);
		},

		// 设置弹窗点"保存"时调用：有变化才提交
		saveBindTab: function (dialog) {
			var mode = dialog.find("input[name='tdb-bind-mode']:checked").val();
			var value = mode == "if" ? $.trim(dialog.find("#tdb-bind-if-select").val()) : "";
			if (mode == "if" && !value) {
				$.messager.alert("", t("bindNeedIf"));
				return;
			}
			if (value == (this.settings.bind_interface || "")) {
				return;
			}
			this.saveSetting("bind_interface", value).done(function () {
				$.messager.show({ msg: t("bindSaved"), timeout: 4000 });
				TorrentDB.load();
			}).fail(function (xhr) {
				$.messager.alert("", TorrentDB._err(xhr));
			});
		},

		bindText: function (b) {
			if (!b || !b.interface) return t("bindUnknown");
			return b.interface + " / " + (b.ipv4 || "?") + " / " + (b.ipv6 || "-");
		},

		// 添加种子弹窗接线：分类下拉（选中自动改保存目录）+ 保存目录补全
		wireAddDialog: function (dialog) {
			var self = this;
			var sel = dialog.find("#tdb-add-category");
			dialog.find("#tdb-add-category-label").text(t("addCategoryLabel"));

			var fillCats = function () {
				var data = [{ value: "", text: t("addCategoryNone") }];
				for (var i = 0; i < self.categories.length; i++) {
					data.push({ value: self.categories[i].path, text: self.categories[i].name });
				}
				sel.combobox({
					valueField: "value",
					textField: "text",
					editable: false,
					panelHeight: "auto",
					onChange: function (path) {
						if (path) {
							dialog.find("#download-dir").combobox("setValue", path);
						}
					}
				});
				sel.combobox("loadData", data);
				sel.combobox("setValue", "");
			};

			// 保存目录补全：输入以 / 结尾时，把下一级子目录装进 combobox 自带的
			// 下拉面板里（与原生选项同一位置）；输入其他内容时恢复原始目录列表
			var combo = dialog.find("#download-dir");
			var box = combo.combobox("textbox");
			var origData = combo.combobox("getData");
			var timer = null;
			box.off("keyup.tdb").on("keyup.tdb", function () {
				var v = $(this).val();
				if (timer) clearTimeout(timer);
				if (!v || v.charAt(v.length - 1) != "/") {
					combo.combobox("loadData", origData);
					return;
				}
				timer = setTimeout(function () {
					$.getJSON(self.url("/api/ls?path=" + encodeURIComponent(v)), function (d) {
						if (!d.dirs || !d.dirs.length) {
							combo.combobox("loadData", origData);
							return;
						}
						var items = [{ value: v, text: v }].concat(d.dirs.map(function (n) {
							return { value: v + n + "/", text: v + n + "/" };
						}));
						combo.combobox("loadData", items);
						combo.combobox("showPanel");
					});
				}, 250);
			});
			fillCats();
		},

		bindText: function (b) {
			if (!b || !b.interface) return t("bindUnknown");
			return b.interface + " / " + (b.ipv4 || "?") + " / " + (b.ipv6 || "-");
		},

		// ---- 划入/移出 --------------------------------------------------
		// 添加种子后立即写入归属（添加响应里带种子名），不等轮询器按路径补录；
		// 写完刷新分类数据，树计数/列表列马上更新
		assignTorrent: function (name, category) {
			if (!name || !category) return;
			$.ajax({
				url: this.url("/api/assign"),
				method: "POST",
				contentType: "application/json",
				data: JSON.stringify({ names: [name], category: category }),
				success: function () {
					TorrentDB.load();
				},
				error: function (xhr) {
					if (window.console && console.warn) {
						console.warn("[torrent-db] assign failed:", errText(xhr));
					}
				}
			});
		},

		assign: function (category) {
			var rows = system.control.torrentlist.datagrid("getChecked");
			if (rows.length == 0) {
				rows = system.control.torrentlist.datagrid("getSelections");
			}
			if (rows.length == 0) return;
			var names = [];
			for (var i = 0; i < rows.length; i++) {
				names.push(rows[i].name);
			}
			$.ajax({
				url: this.url("/api/assign"),
				method: "POST",
				contentType: "application/json",
				data: JSON.stringify({ names: names, category: category }),
				success: function () {
					TorrentDB.load();
					if (category) {
						$.messager.show({ msg: fmt(t("assigned"), category), timeout: 3000 });
					} else {
						$.messager.show({ msg: t("unassigned"), timeout: 3000 });
					}
				},
				error: function () {
					$.messager.alert("", t("loadError"));
				}
			});
		},

		// ---- 种子右键菜单 -------------------------------------------------
		// 注：easyui 的 appendItem 不支持 children 子菜单，故扁平列出各分类
		appendContextMenu: function (parent) {
			var self = this;
			var checked = system.control.torrentlist.datagrid("getChecked");
			var disabled = checked.length == 0;
			$("<div class='menu-sep'></div>").appendTo(parent);
			for (var i = 0; i < this.categories.length; i++) {
				(function (name) {
					parent.menu("appendItem", {
						text: fmt(t("assignTo"), name),
						disabled: disabled,
						onclick: function () {
							self.assign(name);
						}
					});
				})(this.categories[i].name);
			}
			if (this.categories.length) {
				parent.menu("appendItem", {
					text: t("moveOut"),
					disabled: disabled,
					onclick: function () {
						self.assign(null);
					}
				});
			}
			parent.menu("appendItem", {
				text: t("manage") + "...",
				iconCls: "iconfont tr-icon-labels",
				onclick: function () {
					self.openManage();
				}
			});
		},

		// ---- 管理弹窗 ---------------------------------------------------
		openManage: function () {
			var self = this;
			system.openDialogFromTemplate({
				id: "dialog-torrent-db",
				options: {
					title: t("dialogTitle"),
					width: 660,
					height: 430,
					resizable: true,
					onBeforeClose: function () { self.load(); }
				}
			});
		}
	};

	// 供弹窗模板使用的辅助入口
	TorrentDB._t = t;
	TorrentDB._err = errText;

	// 对外暴露 & 启动
	window.TorrentDB = TorrentDB;

	// 立即预取归属数据：列表首次渲染要等语言/RPC 就绪（约 1-3 秒），这里
	// 抢在渲染前把 /api/data 拿到手，分类列/树计数首次渲染即有值，消除
	// "刷新后时有时无"的竞态；UI 未就绪时 updateCategoryTree/refreshList 自行跳过
	TorrentDB.load();

	$(function () {
		// 恢复上次的分类筛选
		TorrentDB.current = localStorage.getItem("torrentdb_current") || "";
		// 等 system 初始化到种子列表控件创建完成（initTorrentTable 之后）再拉数据。
		// 不用 uiIsInitialized：transmission 里没有种子时它永远不会置位。
		// 之后的周期同步由 system.js 的 reloadData 驱动（与页面自动刷新同节拍）
		var timer = setInterval(function () {
			if (window.system && system.control && system.control.torrentlist) {
				clearInterval(timer);
				TorrentDB.load();
				// 组节点 target 缓存建立前，每 5 秒补拉一次（easyui find 偶发失败会自愈）
				var fast = setInterval(function () {
					if (TorrentDB._groupTarget) {
						clearInterval(fast);
						return;
					}
					TorrentDB.load();
				}, 5000);
			}
		}, 500);
	});
})();
