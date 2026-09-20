<p align="center">
<img src="https://github.com/ronggang/transmission-web-control/raw/master/src/tr-web-control/logo.png"><br/>
<a href="https://github.com/ronggang/transmission-web-control/releases" title="GitHub Releases"><img src="https://img.shields.io/github/release/ronggang/transmission-web-control.svg"></a>
<img src="https://img.shields.io/badge/transmission-%3E=2.40%20(RPC%20%3E14)-green.svg" title="Support Transmission Version">
<a href="https://github.com/ronggang/transmission-web-control/LICENSE" title="GitHub license"><img src="https://img.shields.io/github/license/ronggang/transmission-web-control.svg"></a>
<a href="https://t.me/transmission_web_control"><img src="https://img.shields.io/badge/Telegram-Chat-blue.svg?logo=telegram" alt="Telegram"/></a>
</p>

----

## 项目说明

本项目继承自 [ronggang/transmission-web-control](https://github.com/ronggang/transmission-web-control)（原项目由 [栽培者](https://github.com/ronggang) 发起，最早托管于 Google Code，后迁移至 GitHub，2025.06 起原作者归档项目）。

本仓库在该项目基础上继续开发：保留原有 WebUI 的全部能力，同时新增了一套**种子分类系统**与**网卡绑定管理**，并配套一个轻量后端服务。安装方式与原项目一致，适用于所有原项目支持的环境。

本项目是一套自定义 WebUI 及其配套后端，不能代替 Transmission 工作，用户需要自行安装 Transmission 后才可正常使用。Transmission 安装方法请移步至官网：https://www.transmissionbt.com/

## 本 fork 的新增功能

- **分类**：左侧导航新增"分类"组（全部分类 / 未分类 / 各分类），分类筛选与状态节点（全部/下载中/做种…）可同时生效；种子右键菜单可直接划入/移出分类
- **自动搬家**：划入分类立即把种子文件搬移到分类目录；正在下载的种子也能搬；种子删除后重加同名种子会自动归位
- **分类管理**：弹窗内新建 / 改名 / 改路径 / 删除分类（删除只删规则、文件保留原位），也支持一键清理无种子的分类
- **绑定管理**：设置弹窗新增"绑定"页签，可将 Transmission 绑定到指定网卡（列表自动从系统读取），地址变化自动跟随，也可一键恢复为监听所有地址
- **添加种子选分类**：添加种子（链接/文件）时可直接选分类，保存目录自动填充；保存目录输入 `/` 会列出下一级子目录供点选
- **底栏绑定状态**：页面底部实时显示当前绑定的网卡与 IPv4 / IPv6 地址

## 后端服务

上述功能由一个轻量后端支撑（`backend/` 目录，python3 标准库实现、零额外依赖），通过 Transmission 镜像的 `/custom-services.d` 机制随容器自动运行：

- `backend/torrent-db` —— 分类库（SQLite）+ HTTP API + 按路径自动归类/搬移
- `backend/bind-watch` —— 监听配置的网卡地址变化，自动改写 settings.json 并重启生效

后端的部署步骤、与 Transmission 的集成方式（RPC / settings.json / 静态服务）以及全部 API 接口说明，见 **[backend/README.md](backend/README.md)**。

----

## 国内镜像源
- https://gitee.com/culturist/transmission-web-control

## 关于（原版说明）
本项目主要目的是想加强[Transmission](https://www.transmissionbt.com/) Web的操作能力，本项目原本在[Google Code](https://code.google.com/p/transmission-control/)托管，现迁移至GitHub。
本项目设计之初仅针对PT站，因此增加了 Tracker 服务器分组及状态，但这不并适用于普通BT种子。

## 界面预览
![screenshots](https://user-images.githubusercontent.com/8065899/38598199-0d2e684c-3d8e-11e8-8b21-3cd1f3c7580a.png)

## 安装方法及更多内容，请参考：[中文帮助](https://github.com/ronggang/transmission-web-control/wiki/Home-CN) 
### DSM7.0
在这个版本中，需要额外修改权限以实现自动更新的功能
在 `root` 权限下执行以下命令，其中：
 - `YOUR_USERNAME` 替换为你登录和更新脚本时候选择的用户
 - `/var/packages/transmission/target/share/transmission/web/` 这串路径为 transmission 的安装路径（默认应该是这个）
```shell
sed -i '/sc-transmission/s/$/YOUR_USERNAME/' /etc/group
chown sc-transmission:sc-transmission /var/packages/transmission/target/share/transmission/web/* -R
chmod 774 /var/packages/transmission/target/share/transmission/web/* -R
```

## 更新日志 [查看](https://github.com/ronggang/transmission-web-control/blob/master/CHANGELOG.md)

## 项目日常维护
原项目：栽培者、DarkAlexWang
本 fork（分类系统与绑定管理扩展）：laplaceyang
