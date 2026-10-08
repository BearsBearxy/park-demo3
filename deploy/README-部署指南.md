# demo3 云服务器部署指南

分工：**你只负责买服务器（第 1-2 步，约 10 分钟）**，其余全部可由 Claude 远程执行（第 3 步起）。
本指南同时是手工部署的完整说明，不依赖任何人也能照做。

## 1. 买什么（一次性决定）

| 项 | 选择 | 说明 |
|---|---|---|
| 产品 | 腾讯云/阿里云 **轻量应用服务器** | 面板简单，带宽计费友好；不要选 ECS/CVM（配置项多） |
| 规格 | **2 核 4G**，系统盘 ≥50G | 日常更新由 CI 构建镜像、服务器只拉取（见 §6），4G 足够跑 MySQL+JVM+nginx。首次手工部署若在服务器上 `--build`，2C4G 是下限且大概率要靠 swap 顶（`server-setup.sh` 已配） |
| 系统镜像 | **Ubuntu 22.04 LTS** | 本套脚本按它写 |
| 地域 | 国内城市（低延迟）或香港 | 测试期用 `http://IP` 访问，**国内地域也无需备案**；将来绑域名时国内须 ICP 备案（2-4 周），香港免备案但延迟略高。⚠️ 国内地域拉取 Docker 镜像必须走加速（初始化脚本已内置配置），若加速站失效则换香港地域最省事 |
| 时长 | 先买 1 个月 | 测试完可续可弃，约 ¥60-120/月 |

## 2. 买完后做两件事

1. **防火墙/安全组放行端口**：控制台 → 防火墙 → 添加规则，放行 **22（SSH）**、**80**、**443**（80 不能省：Caddy 申请证书走 HTTP-01 验证，关了签不出来）。其余一律不开 —— MySQL 3306 不对外（compose 内网互通），**frontend 的 8081 也绝不能放行**（见 §8）。
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
bash deploy/gen-env.sh <公网IP>      # 生成 .env:随机 DB/JWT/admin 口令,prod profile,迁移走起点链(新园区空库起步,见 §9)
docker compose up -d --build         # 构建+启动三容器
```

注意三点：
- **gen-env 这步不能跳过**：compose 里 `DB_PASSWORD`/`JWT_SECRET`/`ADMIN_PASSWORD`/`CORS_ALLOWED_ORIGINS`
  四项已改成无兜底（fail-closed），缺任何一项 `up` 会直接报中文错误退出。以前「不建 .env 也能起」
  的做法已作废——那样起出来的是仓库公开 JWT 密钥 + 种子口令 admin/admin123 的可写实例，端口一开即等同无认证。
  （同理，`docker compose ps/logs/down` 也需要 .env 在场，正常部署后它一直在 /opt/demo3 下）
- **gen-env 若报「.env 已存在」必须停下检查**，不可带着来路不明的 .env 继续 up（会以弱口令上公网）
- 首次构建 **10-40 分钟视网络而定**（Maven/npm 依赖直连境外源）；构建中 mvn 步骤长时间无输出属正常，**不要中断**（中断后已下载的依赖不缓存，重来更慢）。
  这条只适用于**首次手工部署**——之后的更新走 CI 拉镜像（§6），服务器上不再编译。
  若首次 `--build` 就撞内存不足，可直接改用镜像：`docker login ghcr.io -u <你的GitHub用户名> -p <PAT>` 后
  `docker compose pull && docker compose up -d`（镜像随私有仓库私有，PAT 需 `read:packages` 权限）

## 5. 验收

```bash
docker compose ps        # 三个服务 STATUS 应为 healthy(mysql 初始化约 1-2 分钟)
docker compose logs backend | grep -E "Migrating|Started"
# 应看到: Flyway 迁移到最新版本(新园区从 "137 - baseline" 起,见 §9) / "Started Demo3Application"
curl -sI http://localhost/ | grep -iE "x-frame-options|x-content-type|referrer-policy|content-security"
# 应看到四个安全响应头(nginx 下发,防点击劫持/MIME 嗅探/来源泄露/外链脚本注入)
```

若首次 up 偶发 backend 启动失败（与 MySQL 首次初始化竞速），再执行一次 `docker compose up -d` 即可（restart 策略平时会自动拉起）。

浏览器打开 `https://atrilink.com`（2026-08-30 起走 HTTPS，见 §8）：
- **admin / gen-env 生成的 ADMIN_PASSWORD**：管理员（可写），自己留用。ADMIN_PASSWORD 只在 admin 还是种子口令（首次部署）时生效；之后在系统里改过的口令，重启、重新部署都不会被改回 .env 里的值，改 .env 也不再能重置它
  - **忘了 admin 口令的应急办法**（系统里没有别的 system:edit 账号能替它重置时）：把 admin 的口令列改成占位 `!unset:ADMIN_PASSWORD`，再重启后端，启动时就会重新用上 .env 里的 ADMIN_PASSWORD。
    不要改回种子哈希：AdminInitializer 在端口打开之后才跑，重启那几秒 admin/admin123 登得进（2026-10-05 实测）；占位在那几秒谁都登不进。
    ```
    echo 'UPDATE auth_user SET password_hash="!unset:ADMIN_PASSWORD" WHERE username="admin";' \
      | docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" park_demo3'
    docker compose restart backend
    ```
- **viewer**：2026-10-04 起 gen-env 不再生成 `VIEWER_PASSWORD`，新部署不建只读账号 ——建在客户库里就是一个客户不知道、口令在我们手里的账号。我园服务器 `.env` 里原有的那一行照旧生效

~~⚠️ 测试期为明文 HTTP~~ —— 2026-08-30 已上 HTTPS（§8）。口令不再明文过网，`http://` 与裸 IP 均已关闭。
仍建议口令一对一私发：HTTPS 保护的是传输链路，保护不了发错人。

数据说明：gen-env 生成的 `.env` 走起点链，全新库只有表结构 + 通用行 + 占位字典（见 §9），没有任何楼栋 / 租户数据。
老链 `db/migration` 灌进去的**不是演示数据，是我园的真实数据**（楼栋、租户、电表、单价、台账、工资），只给我园自己的环境用；空库遇到老链默认拒绝启动（`FlywayChainGuard`，2026-10-04）。

## 5.5 自动发布（CD，2026-07-13 起启用；2026-08-13 改为镜像分发）

推送到 master 且 CI 双职全绿后，GitHub Actions 依次做两件事：

1. **构建镜像**（`images` job）：在 runner 上编译前后端，推 `ghcr.io/bearsbearxy/park-demo3-{backend,frontend}`，
   打两个 tag —— `latest`（compose 默认拉的）与提交 sha（回滚锚点）。
2. **发布**（`deploy` job）：上传源码树 → 服务器 `docker compose pull && up -d` → 从公网健康检查。

**为什么把构建搬走**：2C4G 的机器跑 `vue-tsc` + Maven 会内存耗尽，v0.10.0-beta.1 部署实测撞过。
runner 是 4C16G 且构建缓存免费，服务器从此只负责跑。副作用是部署时间从十几分钟降到一两分钟。

源码树仍然上传——不为构建，而是让服务器留一份可应急 `--build` 的底子，且 compose/迁移文件与镜像同版本。

**日常更新只需：改代码 → git push → 等 Actions 页全绿。**

回滚两条路：
- 换镜像 tag（快）：`IMAGE_TAG=<上一次的提交sha> docker compose up -d`
- 整树回退：`cd /opt && rm -rf demo3 && mv demo3.prev demo3 && cd demo3 && docker compose up -d`

凭据在仓库 Settings → Secrets（DEPLOY_HOST/DEPLOY_SSH_KEY），换服务器时更新这两项即可；
ghcr 的推拉用 Actions 自带的 GITHUB_TOKEN，不需要额外配 secret。

## 6. 日常命令（都在 /opt/demo3 下）

```bash
docker compose logs -f backend                # 看后端日志
docker compose restart backend                # 重启后端
docker compose pull && docker compose up -d   # 拉 CI 构建好的新镜像重新部署(CD 就是跑这一条)
docker compose up -d --build                  # 应急:在本机构建(2C4G 慎用,见 §5.5)
docker compose exec mysql sh -c 'mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" park_demo3' > backup-$(date +%F).sql   # 备份
```

故障排查一则：如果改过/重生成过 `.env` 里的 `DB_PASSWORD`，MySQL 数据卷里还是旧口令，backend 会连不上库。
测试期数据可弃时用 `docker compose down -v && docker compose up -d` 重置（**-v 会清空全部数据**；之后按 `.env` 里的迁移链重新起库：起点链 = 空库，老链在空库上默认拒绝启动）。

## 7. 将来"正式给很多人用"之前的清单（测试期不用做）

按顺序：
1. ~~**拆 Flyway 演示种子**（审计已立项：seed 与 schema 同目录，正式库会混入演示数据）——上真实数据前必修~~ ——
   **2026-10-04 已拆，见 §9**。做法与当初设想不同：老链 `db/migration`（V1–V137，混着我园数据）原样冻结、我园生产继续跑它；
   新园区从 `db/baseline/V137__baseline.sql`（只有表结构 + 通用行）空库起步；V138 起的迁移写在 `db/common`，两条链共用
2. 真实数据迁移：本机 `mysqldump` → scp → 导入（此时不再走演示种子）
3. ~~域名 + HTTPS~~ —— **2026-08-30 已完成，见 §8**。实际与当初设想有两处不同：
   本机在香港地域，**免 ICP 备案**，买完域名当天就切完；HSTS 最终下在 Caddy 而非 `frontend/nginx.conf`
   （nginx 子 `location` 不继承父级 `add_header`，那边要写 3 处，Caddy 一处覆盖全站 —— TLS 在哪终止，
   HSTS 就该在哪下发）。`nginx.conf` 里那条"将来补 HSTS"的注释因此作废。
   ~~CSP 收紧远程 webfont~~ —— 2026-08-11 已完成（远程 Google Fonts 已从 `tokens.css` 移除，CSP 三处同步收紧为 `'self'`）
4. 定期备份：第 6 节备份命令进 crontab（每日一份 + 异地留存）
5. 服务器加固：SSH 改密钥登录禁密码、fail2ban
6. 多用户/角色扩展视使用反馈再说（当前 admin+viewer 两级已够测试与汇报）

## 8. HTTPS（2026-08-30 上线）

`https://atrilink.com` / `https://www.atrilink.com`。证书 Let's Encrypt，90 天有效期，**Caddy 自动续期，无需人工干预**。

架构：公网 → `caddy:80/443`（终止 TLS）→ `frontend:80`（nginx 静态 + /api 反代）→ `backend:8080`。

配置在 [`deploy/Caddyfile`](Caddyfile)。选 Caddy 而非 certbot 的唯一理由：证书申请与续期内置，
不用自己维护 cron、也不用续期后 reload nginx，少两个会坏的零件。

### 开关在 .env，不在 compose

`caddy` 服务挂了 `profiles: ["https"]`，**只有 `.env` 里写了 `COMPOSE_PROFILES=https` 才启动**。
本地开发与纯 IP 明文部署因此完全不受影响，`docker compose up -d` 一行不用改（CD 也就不用动）。

服务器 `.env` 相对 `gen-env.sh` 的产物多改了三项：

```
WEB_PORT=8081                                                        # 80 让给 caddy
CORS_ALLOWED_ORIGINS=https://atrilink.com,https://www.atrilink.com   # 原为 http://<IP>
COMPOSE_PROFILES=https                                               # 新增,开关
```

⚠️ `gen-env.sh` 仍按明文 HTTP 生成（`WEB_PORT=80`、`CORS` 走 `http://`）。**换机器重建时这三项要手工补**，
否则 caddy 起不来（80 被 frontend 占）。

⚠️ **8081 绝不能在安全组放行**。compose 的 `ports` 没法被 profile 摘掉，frontend 仍发布在宿主机
8081 上，靠安全组挡住。放行了就等于绕过 TLS 还能明文访问全站。

⚠️ **`caddy-data` 卷不能删**：证书存在里面。删了每次部署重新签发，Let's Encrypt 限额是同一组域名
每周 5 张重复证书，撞上就是一周签不出来。

### 增删域名的顺序

加 = 先配 DNS 并确认生效 → 再写进 `Caddyfile` 站点行 → push。
删 = 先从站点行拿掉 → 再动 DNS。

站点行里每多写一个域名，那个域名就必须已解析到本机 —— 否则它的 ACME challenge 失败会拖垮**整张**证书，
不是只少一个名字。

域名写死在两处：`deploy/Caddyfile` 与 `.github/workflows/ci.yml` 的健康检查 URL，改要一起改。

### 排障

```bash
docker compose logs -f caddy                    # 签发/续期日志,关键字 certificate obtained successfully
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile   # 改完先验语法再 up
curl -sI https://atrilink.com/ | grep -i strict  # 确认 HSTS 在
```

回滚到明文（应急，几十秒）：

```bash
cd /opt/demo3 && cp .env.bak .env && docker compose --profile https rm -sf caddy && docker compose up -d
```

### 已知行为

- `http://` 一律 `308` 跳 `https://`，路径与查询串保留。
- 裸 IP（`http://47.76.99.211/`）同样吃 `308` 跳 `https://<IP>/`，随后握手失败 —— 证书只签了域名。
  明文入口就此关死。
- HSTS 为 `max-age=31536000`，**不带** `includeSubDomains` / `preload`：那是不可撤销的承诺，
  跑稳几周后再考虑。
- CD 的健康检查（`ci.yml`）查 `https://atrilink.com/`，`curl` 默认校验证书，因此顺带看住了续期 ——
  续期挂了会在下次部署暴露，而不是等用户报错。

## 9. 新园区上线（每园一个库，2026-10-04 起）

用户 2026-10-04 拍板：产品卖给别的园区，程序跑在我们的服务器上，客户只用浏览器；**每个园区一个自己的库**，
客户能读到库里的一切。所以新园区的库**不能跑老迁移链**（`db/migration` 里混着我园的楼栋、租户、电表、单价、台账、工资），
要从起点链空库起步。我园自己的生产什么都不用改（`.env` 里不写 `FLYWAY_LOCATIONS` = 老链，和以前一样）。

| 迁移链 | `FLYWAY_LOCATIONS` | 起步后库里有什么 |
|---|---|---|
| 老链（我园生产、开发、测试） | 不写（默认 `classpath:db/migration,classpath:db/common`） | 我园全部历史数据，照旧 |
| 起点链（新园区） | `classpath:db/baseline,classpath:db/common` | 全部表结构 + 内置角色/权限 + 一个 admin + 光伏判据线默认值 + 占位字典（光伏/电费期别「一期~三期」、附表7/8 充电类别「运营商一/二」，让空库录得进数；名字要换得改库）；其余业务表全空。程序首次启动会自动建账册：每个管理公司一本台账册、附表10 四本期区册（一期厂房 / 二期厂房 / 三期厂房 / 宿舍区）和「台账通用模板」 |

步骤（在 §4 的基础上多一步，**必须在第一次 `up` 之前**）：

```bash
bash deploy/gen-env.sh <该园区的域名或IP>       # 生成 .env(随机 DB/JWT/admin 口令,已写好起点链 FLYWAY_LOCATIONS 与下面两个开关,不建只读账号)
grep FLYWAY_LOCATIONS .env                      # 确认是 classpath:db/baseline,classpath:db/common
grep -E 'PARK_TOOLS_ENABLED|RELEASE_BASELINE' .env   # 确认是 false 和当前版本号(如 0.29.0)
docker compose up -d                             # mysql 卷是新的 = 空库
docker compose logs backend | grep -E "Migrating schema|Successfully applied|admin password"
# 应看到: Migrating schema ... to version "137 - baseline" / Successfully applied 1 migration(以后会多出 V138+)
#         admin password reset from app.admin.password
```

- **库必须是空的**（新建的 database，一张表都没有）。客户自己开的云数据库（RDS）同理：建一个空库给我们，后端连过去。
  ⚠ 现在的 compose 把 `DB_HOST/DB_PORT/DB_USER` 写死为同机的 mysql 容器、库名用默认 `park_demo3`，连外部 RDS 要先改 compose 转这几项。
- **`.env` 里没有起点链就 `up` 了**（手写的 `.env`、或删掉了那一行）：空库遇到老链，后端拒绝启动，日志里是「空库不能跑老迁移链」，库里什么都没写 —— 补上 `FLYWAY_LOCATIONS` 再 `up` 即可（`FlywayChainGuard`）。
  拦截只认空库。万一绕过了拦截（设过 `FLYWAY_ALLOW_LEGACY_ON_EMPTY=true`）把老链灌了进去：同机 mysql 卷用 `docker compose down -v` 清掉重来；**外部 RDS 一旦灌入就视为已泄露** —— 快照、binlog、自动备份都在客户手里，删库收不回来，按数据泄露处理。
- **首次登录**：`admin` / `.env` 里的 `ADMIN_PASSWORD`（起点脚本里 admin 没有能用的口令，首次启动时才写成 `ADMIN_PASSWORD`，在那之前谁都登不进），显示名「管理员」。
  `.env` 缺 `ADMIN_PASSWORD` 或值为空：compose 直接拒绝 `up`，报「未设置 ADMIN_PASSWORD」，后端没起、`docker compose logs backend` 里什么都没有，补上再 `up`；不走 compose 起 prod 档同样起不来。只有不走 compose、以非 prod 档起或显式给空值时后端才会起来，那时 admin 谁都登不进，日志里有一行 `has no password yet` 写明要设 `ADMIN_PASSWORD` 再重启。
  进系统后从「系统管理」建该园区的账号和角色，从「楼栋 / 租户 / 合同 / 表档案」开始录数据或走导入中心。
- 检查库是干净的：`echo 'SELECT COUNT(*) FROM building; SELECT COUNT(*) FROM tenant;' | docker compose exec -T mysql sh -c 'mysql -uroot -p"$MYSQL_ROOT_PASSWORD" park_demo3'` 都应是 0。
- **两个部署开关**（2026-10-05 用户拍板「按你建议修改」）：gen-env.sh 已经写好；`.env` 不写这两行就是我园生产的样子，我园不用改任何配置。
  - `PARK_TOOLS_ENABLED=false`（我园默认 `true`）：光伏分栋、电费成本总览、充电桩分桩三处「模拟填充」按钮不显，接口回「这套系统没有模拟填充」，电费成本总览的缺源提示也不再写「可模拟填充」；损益附表进年不自动补缺失行。这几样按我园附表的口径推导，补的行名是我园的科目名。
  - `RELEASE_BASELINE=<生成 .env 时 frontend/package.json 的版本>`（我园默认 `0.0.0`）：「本次更新」弹窗、铃铛「系统」里的更新提示、更新记录只算比它新的版本 —— 客户刚装好时一条都没有，之后发了新版才出现。
  - 手写 `.env` 的新园区要自己补这两行。走起点链却漏了任一行（取到的是我园的默认值），后端拒绝启动，日志里写明要补哪两行；`RELEASE_BASELINE` 不是 `0.29.0` 这样的版本号（比如写成 `v0.29.0`）也拒绝启动（`DeployConfig`）。
- 以后的迁移只写进 `backend/src/main/resources/db/common`（V138 起），两条链都会跑，**不许写任何园区的数据**；
  `db/migration` 和 `db/baseline` 都冻结了（见各目录 README，`MigrationLayoutTest` 会查）。

## 10. 演示站（2026-10-09 起）

用户 2026-10-09：一套空库看新园区装好的样子，一套放脱敏数据，由用户自己登录、演示给客户看（不对外发账号）。
两套都和正式站在同一台机、用同一个镜像，发版时一起更新；各用各的库和 MySQL 账号，账号只授权自己那个库。

| 域名 | 库 / 账号 | 里面是什么 |
|---|---|---|
| `demo.atrilink.com` | `park_demo` / `demo_site` | 我园数据脱敏版（`运维文档/脱敏演示库.py` 换名缩放，再清掉账号与登录日志），老迁移链 |
| `new.atrilink.com` | `park_new` / `new_site` | 空库，新园区装好的样子（起点链、关模拟填充，同 §9） |

一次性步骤（在 `/opt/demo3` 下）：

1. 域名解析加 `demo`、`new` 两条 A 记录指向本机（先加，Caddy 才签得下证书）。
2. `bash deploy/demo-sites.sh init`：`.env` 补六个演示站变量（`DEMO_*` / `NEW_*`，已有的不动），建两个库和两个账号。
3. 把脱敏数据传上来，`bash deploy/demo-sites.sh load park_demo_export.sql.gz`。**必须在 `backend-demo` 第一次启动之前**：空库遇上老链后端会拒绝启动（`FlywayChainGuard`）。
4. `.env` 的 `COMPOSE_PROFILES` 加上 `demo`（如 `COMPOSE_PROFILES=https,demo`），`docker compose up -d`。
5. 登录：两站都是 `admin`，口令分别是 `.env` 里的 `DEMO_ADMIN_PASSWORD`、`NEW_ADMIN_PASSWORD`；进去后在「系统管理」建自己演示用的账号。

- **还原演示数据**：再跑一次 `bash deploy/demo-sites.sh load <同一个文件>`（清空 `park_demo` 重灌）。空库那套要还原：`DROP DATABASE park_new` 后重新 `init`、`up -d`。
- **关掉演示站**：`COMPOSE_PROFILES` 去掉 `demo`，再 `docker compose --profile demo rm -sf backend-demo frontend-demo backend-new frontend-new`。不删库也不影响正式站。
- **内存**：2C4G 一台机跑三个后端。演示站每个后端堆压在 384M、容器 700M 封顶，超了只重启演示站自己。
- **compose 里演示站的口令变量不能改成 `:?` 必填**：compose 不管 profile 开没开都会先插值全部服务，写成必填的话，`.env` 没有它们时正式站发版也会被拒。
