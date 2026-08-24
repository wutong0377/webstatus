# WebStatus 网站状态监控

> 开源自托管的网站状态监控系统，**Node.js + Express + MySQL** 轻量实现，前后台电脑 / 手机全响应式。

支持多站点 HTTP 探测与延迟统计、四色状态体系（正常 / 卡顿 / 离线 / 维修）、SMTP 邮件告警、历史数据曲线与 CSV 导出、**Web 可视化安装向导（全新初始化 / 上传 SQL 备份恢复双模式）**、完整中文错误码解读库。

![技术栈](https://img.shields.io/badge/Node.js-Express-339933) ![数据库](https://img.shields.io/badge/MySQL-8.x-blue) ![License](https://img.shields.io/badge/License-MIT-green)

---

## 目录

- [功能特性](#功能特性)
- [技术栈与环境要求](#技术栈与环境要求)
- [快速开始（安装向导）](#快速开始安装向导)
- [手动部署教程](#手动部署教程)
- [PM2 进程守护](#pm2-进程守护)
- [Nginx 反向代理](#nginx-反向代理)
- [SMTP 邮件告警配置](#smtp-邮件告警配置)
- [邮件模板变量](#邮件模板变量)
- [站点配置说明](#站点配置说明)
- [数据库备份导入导出](#数据库备份导入导出)
- [错误码解读库说明](#错误码解读库说明)
- [安全注意事项](#安全注意事项)
- [高并发调优](#高并发调优)
- [GitHub 推送步骤](#github-推送步骤)
- [已知局限](#已知局限)
- [常见问题排错](#常见问题排错)

---

## 功能特性

- **多站点监控**：最多 10 个站点，每个站点独立 HTTP 探测（状态码 + 响应耗时）与后端 ping 延迟。
- **四色状态体系**：🟢 正常 / 🟠 卡顿（延迟超阈值）/ 🔴 离线（超时、连接失败、4xx/5xx）/ 🔵 维修维护。
- **维修模式**：后台一键开启，强制蓝色状态、忽略探测结果、**不发送任何告警邮件**，可填维修备注。
- **SMTP 邮件告警**：后台在线配置、多接收邮箱管理、HTML 模板在线编辑、抖动抑制（连续 N 次异常才告警）、告警冷却、异步发送队列、发送日志。
- **完整历史数据**：延迟降采样曲线图、状态时间线、故障记录、CSV 导出。
- **Web 安装向导 `/install`**：环境自检 → MySQL 连接测试 → **数据库模式二选一**（全新初始化 / 上传 SQL 备份恢复）→ 管理员 → 系统参数 → SMTP。安装完成后 `/install` **永久禁用（404）**。
- **数据库备份**：后台一键导出完整 `.sql` 备份，可直接用于安装向导「模式 B」恢复。
- **错误码解读库**：覆盖 HTTP 状态码、DNS、网络连接、SSL/TLS 与系统自定义异常，每条含中文名称、成因、诱因、排查建议、影响等级。
- **性能与安全**：探测与 Web 接口完全解耦、多级内存缓存、索引优化、双重限流（Node + Nginx）、参数化查询、CSRF 防护、SSRF 拦截、XSS 过滤、bcrypt 密码哈希、敏感配置不入库不入仓。
- **响应式 UI**：简约开源运维面板，slate 蓝灰主调，内联 SVG 图标，支持浅色 / 深色模式。

## 技术栈与环境要求

| 类别 | 技术 |
|---|---|
| 后端 | Node.js ≥ 16，Express 4 |
| 数据库 | MySQL 5.7 / 8.x（建议 8.x，utf8mb4） |
| 邮件 | nodemailer（SMTP） |
| 前端 | 原生 HTML + TailwindCSS(CDN) + Vanilla JS + Chart.js(CDN) |
| 部署 | PM2 + Nginx |

**环境要求**

- Linux / Windows 均可运行；
- 需要能访问公网（用于 CDN 静态资源与探测目标）；
- 建议使用**低权限 MySQL 账号**，**不建议直接使用 root**。

## 快速开始（安装向导）

```bash
# 1. 下载源码
git clone https://github.com/wutong0377/webstatus.git
cd webstatus

# 2. 安装依赖
npm install

# 3. 启动
npm start
```

启动后访问 `http://服务器IP:3000/install` 进入安装向导：

1. **环境自检**：自动检查 Node 版本、目录可写性等；
2. **数据库配置**：填写 MySQL 连接信息并测试连接；
3. **数据库初始化模式二选一**：
   - **模式 A · 全新初始化**：自动建库建表、写入系统参数；
   - **模式 B · 上传备份恢复**：上传以往导出的 `.sql` 备份，**需勾选风险确认**后导入历史数据（导入前会清空目标库）；
4. **模式 A 继续**：创建管理员账号 → 配置系统参数 → 可选配置 SMTP；
   （模式 B 导入成功后直接复用备份内全部配置，跳过第 4 步）
5. **完成安装**：生成 `config.json`，`/install` 路由永久禁用。

> ⚠️ **安装完成后请重启服务**（`pm2 restart webstatus` 或重新 `npm start`），随后访问 `/admin/login` 登录后台。

## 手动部署教程

```bash
npm install

# 方式一：直接启动
NODE_ENV=production node src/server.js

# 方式二：PM2（推荐）
npm install -g pm2
pm2 start ecosystem.config.js
```

首次访问 `/install` 完成安装；安装完成后重启进程生效。

## PM2 进程守护

项目已内置 `ecosystem.config.js`：

```bash
pm2 start ecosystem.config.js      # 启动
pm2 save                           # 保存进程列表
pm2 startup                        # 设置开机自启（按提示执行输出命令）
pm2 logs webstatus                 # 查看日志
pm2 restart webstatus              # 重启（安装完成后需要）
```

> 建议使用 **fork 单实例模式**（默认）。内存缓存与巡检定时任务基于单进程，多实例（cluster）会导致重复探测。

## Nginx 反向代理

完整配置见 [`deploy/nginx.conf`](deploy/nginx.conf)，包含：反向代理、伪静态、安全响应头、双重限流、静态资源缓存、上传大小限制、敏感文件禁止访问。

```bash
cp deploy/nginx.conf /etc/nginx/conf.d/webstatus.conf
# 修改 server_name 与 SSL 证书路径、确认 proxy_pass 端口后：
nginx -t && systemctl reload nginx
```

部署 HTTPS 时，请将 `config.json` 中 `app.cookie_secure` 设为 `true`（Session Cookie 仅经 HTTPS 传输）；`app.trust_proxy` 设为 `true`（位于 Nginx 反向代理后，正确识别客户端 IP；否则 `X-Forwarded-For` 可被伪造绕过限流，默认关闭）。若 SMTP 服务器使用自签名证书，可在后台勾选「忽略 TLS 证书校验」。

## 宝塔面板部署（10 步）

1. **软件商店**安装：Nginx、MySQL、Node.js（版本 ≥ 16）
2. **数据库 → 添加数据库**：库名 `webstatus`，密码记下来（勿用 root）
3. **上传代码**：GitHub 下载 ZIP → 上传 `/www/wwwroot/` 解压 → 改名 `webstatus` → 目录属主设 `www`
4. **网站 → Node项目 → 添加**：项目目录 `/www/wwwroot/webstatus`、启动命令 `npm run start`、端口 `3000`、绑定域名
5. **站点设置 → 伪静态**：粘贴下方「宝塔伪静态规则」
6. **SSL**：设置 → SSL → Let's Encrypt 申请（`*.`通配符选 **DNS 验证**，去域名商加 TXT 记录）
7. 访问 `你的域名/install`：填数据库信息 → 选 **模式 A 全新初始化** → 建管理员 → 完成
8. 回 **Node项目** 点「重启」
9. 编辑 `config.json`，在 `app` 里加 `"trust_proxy": true`、`"cookie_secure": true`，再重启
10. 访问 `你的域名/admin/login` 登录，添加站点开始监控

### 宝塔伪静态规则（网站 → 设置 → 伪静态 整段粘贴）

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_connect_timeout 10s;
    proxy_read_timeout    30s;
    proxy_send_timeout    30s;
}

location /install {
    client_max_body_size 20m;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}

add_header X-Content-Type-Options nosniff always;
add_header X-Frame-Options DENY always;
add_header Referrer-Policy no-referrer always;

location ~* ^/config(\.json)?$ { deny all; }
location ~* \.(sql|log|env)$ { deny all; }
location ~ /\. { deny all; }
```

> 完整反向代理配置见 [`deploy/nginx.conf`](deploy/nginx.conf)；伪静态专用文件见 [`deploy/bt-pseudo-static.conf`](deploy/bt-pseudo-static.conf)。

## 快速使用

安装完成后，系统有两个入口：

- **前台（公开状态面板，无需登录）**：`https://你的域名/`，任何人可查看全部站点状态
- **后台（管理控制台）**：`https://你的域名/admin/login`，用安装时创建的管理员账号登录

进入后台后，按下面顺序操作：

1. **添加监控站点**：「站点管理」→ 添加站点（填名称、域名、简介、图标 URL），最多 10 个，保存后自动开始探测
2. **配置邮件告警**：「邮件告警设置」→ 填 SMTP 并点「发送测试邮件」验证 → 添加接收邮箱 → 编辑告警模板
3. **看状态**：「仪表盘」看整体统计；前台首页看每个站点实时状态（绿正常/橙卡顿/红离线/蓝维修）
4. **查历史**：前台点进某个站点 → 延迟曲线、状态时间线、故障记录，可导出 CSV
5. **调参数**：「系统设置」→ 巡检间隔、卡顿阈值、抖动抑制次数、历史保留天数等
6. **做备份**：「系统设置」→ 导出数据库备份（.sql），用于迁移或恢复

## SMTP 邮件告警配置

后台 → **邮件告警设置** → **SMTP 配置**：

| 字段 | 说明 |
|---|---|
| SMTP 服务器 | 如 `smtp.qq.com` |
| 端口 | 465（SSL）或 587（STARTTLS） |
| SSL/TLS 加密 | 465 端口勾选 |
| 发件账号 | 邮箱账号 |
| 发件密码/授权码 | 邮箱 SMTP 授权码（非登录密码） |
| 发件人名称 / 发件邮箱 | 邮件显示的发件人 |

填写后点击「保存配置」，再点击「发送测试邮件」验证。

**SMTP 敏感凭证仅保存在 `config.json`**（已加入 `.gitignore`），数据库不存储明文密码。

**全局告警总开关**：SMTP 配置页顶部开关；关闭后不发送任何告警 / 恢复邮件。

**抖动抑制**：系统参数中「抖动抑制·连续异常次数」默认 3——连续 N 次探测异常才标记故障并触发告警，避免瞬时网络抖动轰炸；「邮件告警冷却」控制故障持续期间的重复提醒间隔。

## 邮件模板变量

后台 → **邮件告警设置** → **邮件模板**，支持以下变量（渲染时自动做 HTML 转义）：

| 变量 | 含义 |
|---|---|
| `{{site_name}}` | 站点显示名称 |
| `{{site_domain}}` | 站点域名 |
| `{{site_desc}}` | 站点简介 |
| `{{status}}` | 状态文本（正常/卡顿/离线/维修） |
| `{{delay}}` | 响应耗时(ms) |
| `{{http_code}}` | HTTP 状态码 |
| `{{error_explain}}` | 错误解读 |
| `{{occur_time}}` | 发生/通知时间 |

## 站点配置说明

后台 → **站点管理**，每个站点可配置：

- **名称 / 简介**：前台展示；
- **域名**：监控目标，需 `http(s)://` 开头；
- **SEO**：Title、Meta-Description、Meta-Keywords；
- **图标 URL**：仅支持**外部 URL**（不做文件上传，前端直接加载）；
- **启用监控**：关闭后停止探测该站点；
- **维修模式 + 维修备注**：开启后前台强制蓝色「维修」状态，忽略探测结果，**不触发任何告警**。

站点数量硬上限 **10 个**。

## 数据库备份导入导出

### 导出（后台）

后台 → **系统设置** → **运维操作** → **导出数据库备份**，一键下载完整 `.sql` 文件（含全部数据表结构与数据）。

### 恢复（安装向导）

在重新部署 / 迁移服务器时，进入 `/install` → 数据库模式选择 **模式 B · 上传备份恢复**：

1. 选择 `.sql` 备份文件（仅限 `.sql`，最大 16MB）；
2. 系统校验文件头部特征（必须是本系统导出的备份）；
3. **勾选风险确认**后执行导入；导入会**清空目标数据库现有全部数据**并恢复备份内容（管理员、站点、SMTP 配置、邮件模板、历史监控数据全部还原）；
4. 导入成功后直接复用备份内配置，进入后台登录页。

> ⚠️ **风险警告**：导入操作会覆盖目标数据库中的全部现有数据！请务必在导入前手动导出当前数据库备份，避免误操作造成数据丢失。上传文件在导入完成后会被自动删除，不残留服务器。

## 错误码解读库说明

系统内置完整错误码解读库（`src/data/errorCodes.js`），覆盖：

- **HTTP 状态码**：400/401/403/404/408/429/500/502/503/504/521/522/525 等；
- **DNS / 网络**：`ENOTFOUND`、`EAI_AGAIN`、`ETIMEDOUT`、`ECONNREFUSED`、`ECONNRESET`、`EHOSTUNREACH` 等；
- **SSL/TLS**：`CERT_HAS_EXPIRED`、`DEPTH_ZERO_SELF_SIGNED_CERT`、`UNABLE_TO_VERIFY_LEAF_SIGNATURE`、`ERR_TLS_CERT_ALTNAME_INVALID` 等；
- **系统自定义**：`SSRF_BLOCKED`、`TIMEOUT`、`PING_FAILED`、`URL_INVALID` 等。

每条包含：**错误代码、中文名称、故障成因、可能诱因、排查建议、影响等级**。前台异常卡片与后台故障日志均展示完整解读。

## 安全注意事项

- **凭证管理**：数据库与 SMTP 密码只存在 `config.json`，已加入 `.gitignore`，**严禁提交到 GitHub**。部署时请复制 `config.example.json` 为 `config.json` 使用；
- **低权限数据库账号**：建议为 WebStatus 单独创建 MySQL 账号并仅授予必要库权限，禁止使用 root；
- **全参数化查询**：所有数据库操作使用预编译参数绑定，杜绝 SQL 注入；
- **CSRF 防护**：后台全部 POST 操作校验 CSRF Token；Session 使用 HttpOnly + SameSite Cookie（HTTPS 部署建议开启 Secure）；
- **SSRF 防护**：探测目标 DNS 解析后校验，内网 / 回环 / 保留地址一律拦截；
- **XSS 防护**：前端输出全部转义，站点简介、公告、邮件模板等富文本输入做白名单过滤；
- **安装向导安全**：`/install` 仅在未安装时可用，安装完成后路由返回 404，SQL 上传导入接口一并失效；
- **限流**：公开接口、登录接口、后台接口均限流，登录失败 5 次临时锁定 15 分钟。

## 高并发调优

- **探测与 Web 解耦**：巡检为独立后台定时任务，页面访问只读已入库结果，不触发探测；
- **多级内存缓存**：公开状态接口、公告、站点信息带 TTL 缓存；
- **索引优化**：`status_history(site_id, checked_at)`、`fault_logs(site_id)`、`mail_logs(created_at)` 等均有索引；
- **降采样**：大范围历史图表查询后端按时间桶聚合，不返回海量原始记录；
- **自动清理**：可配置历史数据 / 日志保留天数；
- **双重限流**：Nginx 层 + Node 层。

## GitHub 推送步骤

```bash
# 初始化与关联远程仓库
git init -b main
git remote add origin https://github.com/你的用户名/webstatus.git

# 提交（config.json 已被 .gitignore 排除，不会上传）
git add .
git commit -m "feat: WebStatus 网站状态监控 v1.0"

# 推送
git push -u origin main
```

> ⚠️ 推送前请确认 `config.json` **不在**待提交列表（应被 `.gitignore` 忽略）；如误提交，请用 `git rm --cached config.json` 移除。

## 已知局限

- **Ping 权限**：系统通过调用系统 `ping` 命令获取延迟。部分环境（容器内无 ping 二进制、或进程无相关权限）会导致 ping 失败——属正常现象，系统会以 HTTP 探测结果为准；
- **容器环境**：Docker 容器需安装 `ping`（如 `iputils-ping`），且需保证 Node 进程可访问公网；
- **CDN 依赖**：前端样式（TailwindCSS）与图表库（Chart.js）通过 CDN 引入，内网部署时需自行将资源下载到 `src/views/assets` 并替换引用。

## 常见问题排错

| 问题 | 排查 |
|---|---|
| 安装向导访问 404 | 服务可能已完成安装（`/install` 已禁用）；或未启动服务 / 端口被占 |
| 数据库连接失败 | 确认 MySQL 已启动、账号密码正确、网络可达；模式 A 会自动建库，无需预先创建 |
| 导入备份被拒绝 | 备份文件必须是本系统导出的 `.sql`（含 `WebStatus Database Backup` 头部标识） |
| 站点显示「离线」但实际正常 | 多为目标站禁 ping / 防火墙拦截；可尝试调大超时阈值，或检查站点是否对探测 UA 有限制 |
| 收不到告警邮件 | 检查 SMTP 配置、全局告警开关、接收邮箱是否启用、邮件发送日志中的失败原因 |
| 中文乱码 | 数据库需使用 `utf8mb4`（安装向导自动创建，无需手动处理） |
| 安装完成后页面仍显示安装向导 | 未重启服务，请重启 Node 进程后再访问 |

---

**License** · [MIT](LICENSE)

**Made with ❤️ for the open-source community · 网站状态监控 WebStatus**
