# transmission 增强套件（web-control 定制版）后端

本目录存放 fork 定制版的配套后端服务与部署文件。前端改动在 `../src/`。

## 组成

| 文件 | 作用 |
|---|---|
| `torrent-db` | 分类库后端：SQLite（分类/归属/设置三张表）+ HTTP API(38082) + 轮询搬移器。前端"分类管理"弹窗、左栏分类筛选、右键划入、绑定设置都走它 |
| `bind-watch` | 绑定执行器：从 torrent-db 的 settings 表读 `bind_interface`，跟随网卡地址改写 settings.json（s6 停 daemon → 改 → 起）；空值=还原默认绑定全部地址 |

## 数据库

SQLite 单文件库，由 torrent-db 首次启动时自动建库建表：

- 容器内路径：`/config/torrent-db.sqlite3`
- 宿主机侧：位于 config 映射目录内（即 `<config目录>/torrent-db.sqlite3`），随配置目录一起备份即可
- WAL 日志模式，多线程读写（HTTP 服务 + 轮询线程）并发安全

### 表结构

```sql
-- 分类表：分类名 → 目标目录
CREATE TABLE IF NOT EXISTS categories (
    name TEXT PRIMARY KEY,      -- 分类名，平铺无层级，不含 "/"
    path TEXT NOT NULL          -- 目标目录，必须位于 TORRENTDB_ROOTS 托管根之下
);

-- 归属表：种子名 → 分类（分类系统的核心）
CREATE TABLE IF NOT EXISTS files (
    name     TEXT PRIMARY KEY,  -- 种子名（transmission 里的 Name）
    category TEXT NOT NULL REFERENCES categories(name) ON DELETE CASCADE
);

-- 设置表：键值对（bind-watch / 前端共同消费）
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,     -- 目前仅有 bind_interface
    value TEXT NOT NULL         -- 网卡名；空字符串 = 不绑定（监听所有地址）
);
```

### 字段与行为说明

- **按种子名归属**：`files.name` 是 transmission 里的种子 Name。种子删除后记录**保留**，
  因此重加同名种子时轮询器会按名字自动归队到原分类目录。
- **按路径自动归类**：轮询器发现"不在 files 表里的种子，其 downloadDir 恰好等于
  某分类的 path"时，自动补一条归属记录（添加种子时选分类、外部工具添加的种子都覆盖）。
- **删除分类**（`ON DELETE CASCADE`）：级联删除 `files` 里的归属记录，**文件不动、
  不做任何搬移**，对应种子回到"未分类"；重新创建同名分类后，重新划入即可。
- **移动**：归位方式是 `torrent-set-location(move=true)`，只改 downloadDir 并搬移
  文件，不改动本库；本库永不删除或移动任何媒体文件。
- **同名约定**：`files.name` 与 transmission 的 Name 完全匹配，若在 transmission 里
  重命名了种子，需在前端重新划入。

### 备份

`torrent-db.sqlite3`（连同可选的 `-wal`/`-shm`）位于 `/config` 映射目录内，与
settings.json 一起纳入备份即可；删除库文件后服务会自动重建空库。

## API 接口文档

通用约定：

- 基础地址 `http://<宿主机地址>:38082`（端口由 `TORRENTDB_PORT` 决定）
- 仅允许内网地址访问（`TORRENTDB_ALLOW`，默认本机回环 + 192.168/10/172.16 私网段），其余返回 403
- 跨端口访问时后端回显请求的 `Origin` 头（CORS），`POST/DELETE` 会先响应 `OPTIONS` 预检
- 请求体均为 JSON；错误统一返回 `{"error": "说明"}`，HTTP 状态码 400/403/404/500/502
- `GET /api/data` 带 `?_=时间戳` 之类的查询串可绕过浏览器缓存，服务端会忽略

### GET /api/health

健康检查，附带当前生效配置。

```json
{"ok": true, "roots": ["/downloads"], "dry_run": false}
```

`dry_run=true` 时所有搬移只记日志不真执行（`TORRENTDB_DRY_RUN=1`）。

### GET /api/data

全量数据，前端（筛选下拉、右键菜单、管理弹窗、绑定页签）的唯一数据源。

```json
{
  "categories": [ {"name": "电影", "path": "/downloads/电影", "files": 3} ],
  "assignments": { "某种子名": "电影" },
  "settings":   { "bind_interface": "eth0" },
  "bind":       { "interface": "eth0", "ipv4": "192.0.2.10", "ipv6": "2001:db8::a1", "updated": "2026-09-20 22:00:00" }
}
```

- `files` 为该分类的归属记录数（含 transmission 中已不存在的种子，重加可自动归队）
- `bind` 为 bind-watch 写入的实时状态文件内容；未绑定或文件不存在时为 `null`

### GET /api/interfaces

宿主机网卡列表（host 网络即宿主接口），已过滤 lo、veth、docker 网桥等噪音。

```json
{"interfaces": [
  {"name": "eth0", "ipv4": "192.0.2.10",  "ipv6": "2001:db8::a1"},
  {"name": "eth1", "ipv4": "192.0.2.20", "ipv6": "2001:db8::b2"}
]}
```

### GET /api/ls?path=/downloads

列出托管根内某目录的下一级子目录（添加种子弹窗的路径补全数据源）。
仅允许 `TORRENTDB_ROOTS` 之下的路径，越界返回 403；目录不存在返回 404。

```json
{"path": "/downloads", "dirs": ["202603", "202604", "电影"]}
```

### POST /api/category

新建或修改分类。请求体：

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | string | 分类名（必填，≤100 字符，不含 `/`） |
| `path` | string | 保存目录（必填，必须在托管根 `TORRENTDB_ROOTS` 下） |
| `oldName` | string | 可选；改名时传原分类名，归属记录随之迁移 |

```json
{"name": "电影", "path": "/downloads/电影"}
{"name": "影片", "path": "/downloads/电影", "oldName": "电影"}
```

返回 `{"ok": true}`。修改 `path` 后，轮询器会把该分类下的种子自动搬到新目录。

### POST /api/category-delete 或 DELETE /api/category

删除分类。请求体：`{"name": "电影"}`。

只删除分类与归属记录，**文件保留原位、不做任何搬移**，对应种子回到"未分类"。分类不存在返回 404。

### POST /api/category-remove-unused

删除所有没有任何归属记录的分类（即"移除未使用的分类"）。无需请求体。

```json
{"ok": true, "removed": 2}
```

### POST /api/assign

把种子划入分类（立即搬移）或移出分类。请求体：

| 字段 | 类型 | 说明 |
|---|---|---|
| `names` | string[] | 种子名列表（transmission 里的 Name，必填） |
| `category` | string\|null | 分类名；`null` 表示移出分类 |

```json
{"names": ["A.2024.1080p", "B.2023.2160p"], "category": "电影"}
{"names": ["A.2024.1080p"], "category": null}
```

- 划入：写入归属记录后**立刻**调用 `torrent-set-location(move=true)` 搬移文件，目录已一致的种子会跳过；返回 `{"ok": true, "moved": 1}`
- 移出：仅删除归属记录，文件不动，返回 `{"ok": true, "moved": 0}`

### POST /api/settings

写入设置项。当前支持的键：`bind_interface`（空字符串 = 不绑定，监听所有地址；非空 = 网卡名，由 bind-watch 应用）。

```json
{"key": "bind_interface", "value": "eth0"}
```

返回 `{"ok": true}`。不支持的键或非法值返回 400。

## 与 Transmission 的集成方式

两个服务都跑在 **linuxserver/transmission 镜像**容器内（host 网络），借助镜像的
`/custom-services.d` 机制自动注册为 s6 常驻服务，无需改动镜像本身；只用 python3
标准库（sqlite3/http.server），零第三方依赖。前端（`src/` 部署到 public_html，
经 `TRANSMISSION_WEB_HOME` 生效）与后端、与 Transmission 的配合关系如下：

1. **种子操作走 RPC**（`http://127.0.0.1:38081/transmission/rpc`，host 网络下与
   daemon 同一网络栈）：
   - `torrent-get`（id/name/downloadDir）供轮询器比对；
   - `torrent-set-location {move:true}` 执行分类搬移（daemon 会先关闭文件句柄再
     移动，下载中的种子同样适用）；
   - RPC 的 409 会话握手（X-Transmission-Session-Id）自动处理。
2. **绑定管理走 settings.json**：transmission 只认这个文件且退出时会用内存配置
   回写，因此改写顺序为 `s6-rc 停 svc-transmission → 等进程退出 → 原子替换文件 →
   再拉起`，TCP/UDP 套接字随重启重新绑定到新地址。
3. **实时绑定状态**：bind-watch 把当前网卡与地址写入
   `/config/public_html/bind-status.txt`，transmission 的静态服务会原样透出
   （`/transmission/web/bind-status.txt`），前端底栏与设置页签都读它。
4. **分类数据**（torrent-db.sqlite3）与 Transmission 无关，是完全独立的一层；
   归属关系按"种子名"记录，种子删除后记录保留，重加同名种子自动归队。
5. **前端访问分类 API 是跨端口的**（页面 38081 / API 38082），后端对每个响应
   回显 `Origin` 头解决 CORS；接口仅对内网地址开放，请勿映射到公网。

## 部署（Docker 集成）

适用环境：任意 Docker 主机上运行的 **linuxserver/transmission** 镜像（需 s6-overlay
v3 + `/custom-services.d` 机制 + 镜像自带 python3，均为该镜像默认能力）。推荐 host
网络（绑定网卡地址的前提）。

目录布局示例（宿主机任意位置，如 `/opt/transmission`）：

```
/opt/transmission/
├── config/            ← 映射到容器 /config（settings.json、sqlite、public_html）
│   ├── public_html/   ← src/ 打包部署（WebUI + 前端定制）
│   ├── torrent-db.sqlite3
│   └── bind-status.txt
├── downloads/         ← 映射到容器 /downloads
├── torrent-db         ← backend/torrent-db
└── bind-watch         ← backend/bind-watch
```

compose 集成示例（transmission 服务关键字段）：

```yaml
services:
  transmission:
    image: linuxserver/transmission:latest
    container_name: transmission
    restart: unless-stopped
    network_mode: host            # 绑定网卡地址的前提
    volumes:
      - /opt/transmission/config:/config
      - /opt/transmission/downloads:/downloads
      - /opt/transmission/torrent-db:/custom-services.d/torrent-db:ro
      - /opt/transmission/bind-watch:/custom-services.d/bind-watch:ro
    environment:
      - PUID=1000
      - PGID=1000
      - TRANSMISSION_WEB_HOME=/config/public_html   # 启用定制版 WebUI
      - TORRENTDB_PORT=38082                        # 分类/绑定 API 端口
      - TORRENTDB_DRY_RUN=0                         # =1 时只记日志不真搬
      - BIND_INTERFACE=eth0                         # 仅首次种子值，之后以前端/SQLite 为准
```

步骤：

1. 把 `src/` 打包传到宿主机，替换 `<config>/public_html`（每次更新前端记得同步改
   index.html 里的 `?v=` 缓存参数，静态服务带 24h 强缓存）
2. `install -m755 backend/torrent-db <宿主机目录>/torrent-db`，bind-watch 同理
3. 按 compose 示例挂载到 `/custom-services.d/`（:ro），`docker compose up -d --force-recreate transmission`
4. 验证：`curl http://<宿主机地址>:38082/api/health` 返回 ok；界面底部出现绑定状态

注意：

- 脚本内容更新后必须 `--force-recreate`（挂载的是文件本体，运行中的进程不会自动重载）
- **API 与 RPC 均无鉴权**，务必不要把 38082/38081 端口映射到公网
- BIND_INTERFACE 只是首次启动的种子值；之后在 WebUI 设置 → 绑定 里修改即可

## 前端定制点（grep `[torrent-db]` / `[bind-watch]` 可定位全部改动）

- `src/index.html`：脚本改加载源码版；工具栏"分类管理"按钮（入口已移至左栏右键菜单）
- `script/torrent-db.js`：分类模块（左栏分类组/复合筛选/管理弹窗/右键划入/设置绑定页签接线/添加弹窗接线）
- `script/bind-status.js`：底栏绑定信息
- `script/system.js`：导航树分类组、onBeforeSelect 分类高亮拦截、loadTorrentToList 分类过滤、showContextMenu 分类菜单
- `template/dialog-torrent-db.html`：分类管理弹窗
- `template/dialog-system-config.html`：设置弹窗"绑定"页签
- `template/dialog-torrent-add.html` / `dialog-torrent-addfile.html`：添加种子分类下拉 + 保存目录补全
