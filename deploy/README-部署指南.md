# demo3 云服务器部署指南

分工：**你只负责买服务器（第 1-2 步，约 10 分钟）**，其余全部可由 Claude 远程执行（第 3 步起）。
本指南同时是手工部署的完整说明，不依赖任何人也能照做。

## 1. 买什么（一次性决定）

| 项 | 选择 | 说明 |
|---|---|---|
| 产品 | 腾讯云/阿里云 **轻量应用服务器** | 面板简单，带宽计费友好；不要选 ECS/CVM（配置项多） |
| 规格 | **2 核 4G**，系统盘 ≥50G | 4G 内存是硬要求：服务器上构建镜像（Maven+npm）+ MySQL + JVM 同时跑，2G 会内存不足 |
| 系统镜像 | **Ubuntu 22.04 LTS** | 本套脚本按它写 |
| 地域 | 国内城市（低延迟）或香港 | 测试期用 `http://IP` 访问，**国内地域也无需备案**；将来绑域名时国内须 ICP 备案（2-4 周），香港免备案但延迟略高。⚠️ 国内地域拉取 Docker 镜像必须走加速（初始化脚本已内置配置），若加速站失效则换香港地域最省事 |
| 时长 | 先买 1 个月 | 测试完可续可弃，约 ¥60-120/月 |

## 2. 买完后做两件事

1. **防火墙/安全组放行端口**：控制台 → 防火墙 → 添加规则，放行 **22（SSH）** 和 **80（网站）**。其余一律不开（MySQL 3306 不对外，compose 内网互通）。
2. 记下 **公网 IP** 和 **root 密码**（轻量服务器控制台可重置密码）。

到这里你的部分就完成了。把 IP 和密码交给 Claude 即可；以下为执行记录/手工步骤。

## 3. 上传代码（本地 Windows PowerShell 执行）

```powershell
cd C:\financial_dashboard
tar --exclude=node_modules --exclude=target --exclude=dist --exclude=demo3/.env -czf demo3.tgz demo3
scp demo3.tgz root@<IP>:/opt/
ssh root@<IP> "cd /opt && tar xzf demo3.tgz && rm demo3.tgz"
```

（`--exclude=demo3/.env` 不可省：本地开发用的 .env 是弱口令配置，绝不能带上公网服务器）

## 4. 服务器初始化 + 部署（SSH 到服务器执行）

```bash
cd /opt/demo3
bash deploy/server-setup.sh          # 装 Docker+Compose+镜像加速+swap(一次性)
bash deploy/gen-env.sh <公网IP>      # 生成 .env:随机 DB/JWT/admin/viewer 口令,prod profile
docker compose up -d --build         # 构建+启动三容器
```

注意三点：
- **gen-env 这步不能跳过**：compose 里 `DB_PASSWORD`/`JWT_SECRET`/`ADMIN_PASSWORD`/`CORS_ALLOWED_ORIGINS`
  四项已改成无兜底（fail-closed），缺任何一项 `up` 会直接报中文错误退出。以前「不建 .env 也能起」
  的做法已作废——那样起出来的是仓库公开 JWT 密钥 + 种子口令 admin/admin123 的可写实例，端口一开即等同无认证。
  （同理，`docker compose ps/logs/down` 也需要 .env 在场，正常部署后它一直在 /opt/demo3 下）
- **gen-env 若报「.env 已存在」必须停下检查**，不可带着来路不明的 .env 继续 up（会以弱口令上公网）
- 首次构建 **10-40 分钟视网络而定**（Maven/npm 依赖直连境外源）；构建中 mvn 步骤长时间无输出属正常，**不要中断**（中断后已下载的依赖不缓存，重来更慢）

## 5. 验收

```bash
docker compose ps        # 三个服务 STATUS 应为 healthy(mysql 初始化约 1-2 分钟)
docker compose logs backend | grep -E "Migrating|viewer|Started"
# 应看到: Flyway 迁移到 v32 / "viewer (read-only) user created" / "Started Demo3Application"
curl -sI http://localhost/ | grep -iE "x-frame-options|x-content-type|referrer-policy|content-security"
# 应看到四个安全响应头(nginx 下发,防点击劫持/MIME 嗅探/来源泄露/外链脚本注入)
```

若首次 up 偶发 backend 启动失败（与 MySQL 首次初始化竞速），再执行一次 `docker compose up -d` 即可（restart 策略平时会自动拉起）。

浏览器打开 `http://<IP>`：
- **admin / gen-env 生成的 ADMIN_PASSWORD**：管理员（可写），自己留用
- **viewer / 生成的 VIEWER_PASSWORD**：只读账号，**发这个给测试者**（任何编辑/导入/删除会被拦截并提示）

⚠️ 测试期为**明文 HTTP**：口令在网络上未加密传输。口令一对一私发（勿群发群聊），admin 避免在公共 WiFi 登录；正式使用前按第 7 节上 HTTPS。

数据说明：全新库由 Flyway 自动建表并灌入**演示数据**（演示楼栋/租户/合同/台账），测试者开箱即有数据可点。
不是你本机的真实数据——真实数据涉及 313 户租户财务明细，放公网前需单独决策（见第 7 节）。

## 5.5 自动发布（CD，2026-07-13 起启用）

推送到 master 且 CI 双职全绿后，GitHub Actions 自动发布到云服务器（整树替换、保留 .env、
数据卷不动），随后从公网做健康检查，失败会把该次运行标红并通知。
**日常更新只需：改代码 → git push → 等 Actions 页全绿**，手工的 tar/scp/up --build（下节）
从此只作为 CD 故障时的后备手段。回滚：服务器上保留上一版于 /opt/demo3.prev，
`cd /opt && rm -rf demo3 && mv demo3.prev demo3 && cd demo3 && docker compose up -d --build`。
凭据在仓库 Settings → Secrets（DEPLOY_HOST/DEPLOY_SSH_KEY），换服务器时更新这两项即可。

## 6. 日常命令（都在 /opt/demo3 下）

```bash
docker compose logs -f backend                # 看后端日志
docker compose restart backend                # 重启后端
docker compose up -d --build                  # 更新代码后重新部署(先重复第 3 步上传)
docker compose exec mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" park_demo3' > backup-$(date +%F).sql   # 备份
```

故障排查一则：如果改过/重生成过 `.env` 里的 `DB_PASSWORD`，MySQL 数据卷里还是旧口令，backend 会连不上库。
测试期数据可弃时用 `docker compose down -v && docker compose up -d` 重置（**-v 会清空全部数据**，重新灌演示种子）。

## 7. 将来"正式给很多人用"之前的清单（测试期不用做）

按顺序：
1. **拆 Flyway 演示种子**（审计已立项：seed 与 schema 同目录，正式库会混入演示数据）——上真实数据前必修
2. 真实数据迁移：本机 `mysqldump` → scp → 导入（此时不再走演示种子）
3. 域名 + HTTPS：买域名 → 国内地域办 ICP 备案（或迁香港）→ 前置 Caddy 自动签发 TLS 证书。
   上了 TLS 之后再回头给 `frontend/nginx.conf` 补 `Strict-Transport-Security`（明文 HTTP 下发 HSTS 无意义，
   所以现在故意不加）。注意 nginx 子 `location` 不继承父级 `add_header`，本文件里安全头一共写了 3 处，改要一起改。
   ~~CSP 收紧远程 webfont~~ —— 2026-08-11 已完成（远程 Google Fonts 已从 `tokens.css` 移除，CSP 三处同步收紧为 `'self'`）
4. 定期备份：第 6 节备份命令进 crontab（每日一份 + 异地留存）
5. 服务器加固：SSH 改密钥登录禁密码、fail2ban
6. 多用户/角色扩展视使用反馈再说（当前 admin+viewer 两级已够测试与汇报）
