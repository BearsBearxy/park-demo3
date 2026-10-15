# 灵睿 LinkSight（demo3）

工业园区管理系统：楼栋、租户、合同、抄表、公摊、催缴单、月度台账、财务报表、经营分析屏。
当前版本 **0.34.0**（唯一来源是 `frontend/package.json`）。

- 第一次来：读完这份，把前后端跑起来。
- 动手改代码前：读 [AGENTS.md](AGENTS.md)（必读清单、红线、发版规则、已知的坑、规范以谁为准）。
- 所有文档索引：[docs/README.md](docs/README.md)；用户拍过板的产品决定：[docs/DECISIONS.md](docs/DECISIONS.md)。
- 整个文件夹（含仓外的运维文档、设计稿、待办）总览：[../README.md](../README.md)。

---

## 1. 技术栈

| 部分 | 用什么 | 出处 |
|---|---|---|
| 前端 | Vue 3.5 + vue-router 4 + Pinia 2 + ECharts 6 + exceljs + lucide-vue-next；构建 Vite 5、TypeScript 5.5、vue-tsc；测试 Vitest 2 + jsdom | `frontend/package.json` |
| 后端 | Spring Boot 3.3.5、Java 17、MyBatis-Plus 3.5.7、jjwt、springdoc、Flyway；测试 JUnit + Testcontainers | `backend/pom.xml` |
| 数据库 | MySQL 8.0，utf8mb4 | `docker-compose.yml` |
| 部署 | Docker Compose 四个服务：mysql / backend / frontend（nginx）/ caddy（HTTPS，可选）；镜像在 GitHub Actions 上构建 | `docker-compose.yml`、`.github/workflows/` |

## 2. 先装这几样

| 软件 | 版本 | 为什么 |
|---|---|---|
| Docker Desktop | 任意新版 | 开发库是容器；后端集成测试（`*IT`）要它在跑 |
| JDK | 17 | 后端。Maven 不用另装，用仓里的 `backend/mvnw` |
| Node.js | 20（最低 18） | 前端。CI 和镜像都用 20 |
| Git Bash | — | Windows 上跑 `deploy/*.sh` |

## 3. 跑起来

### 方式 A：整套用容器起（只想看效果）

```bash
bash deploy/gen-env.sh localhost     # 生成 .env：随机口令，结尾会把 admin 口令打到屏幕上
docker compose up -d --build         # 本地构建镜像并启动
```

打开 http://localhost （`gen-env.sh` 生成的 `WEB_PORT` 是 80；`.env.example` 和 compose 不设时的默认才是 8081，以 `.env` 为准），用户名 `admin`，口令是 `.env` 里的 `ADMIN_PASSWORD`。
这样起的是**空园区**（起点链，库里没有业务数据）。端口被占就改 `.env` 里的 `WEB_PORT`。
**本机注意**：这台电脑上已经有 compose 项目 `demo3` 的旧数据卷 `demo3_mysql-data`，方式 A 会接上旧库和旧的 root 口令，新 `.env` 的 `DB_PASSWORD` 对不上。要空库就换项目名（`docker compose -p <新名> up -d --build`）或另建卷；删旧卷要先问项目主人。
出处：`docker-compose.yml:1-10`、`deploy/gen-env.sh:22`、`.env.example:6`、`docker volume ls`。

### 方式 B：开发模式（改代码用）

| 步 | 做什么 | 命令 | 出处 |
|---|---|---|---|
| 1 | 开发库 | 本机已有容器：`docker start demo3-mysql`（10-16 查时是停着的）。新机器：见下面「新建开发库」 | `.claude/dev-backend.cmd:5` |
| 2 | 后端（端口 8481） | Windows：`.claude\dev-backend.cmd`<br>其他系统：`cd backend && ./mvnw spring-boot:run -Dspring-boot.run.arguments="--server.port=8481 --DB_PORT=13306"` | `.claude/dev-backend.cmd:6-7` |
| 3 | 前端（端口 5173） | `npm --prefix frontend ci`（第一次）<br>`npm --prefix frontend run dev` → http://localhost:5173 ，`/api` 自动转到 8481 | `frontend/vite.config.ts:100-107` |
| 4 | 登录 | 见下面「登录口令」 | `backend/.../config/AdminInitializer.java` |

**本机 `demo3-mysql` 里有谁的库**（第 1 步之前看）：

| 库 | 是什么 | 出处 |
|---|---|---|
| `park_demo3` | 本地开发库（老链、带首个园区的历史数据）；10-10 时停在 V133，现在第几版**未核** | 记忆 import-center-redesign-2026-10-10 |
| `park_demo3_demo` | 宣传站 / 演示站会话的脱敏演示库（10-10 时 V140），不是你的，别动 | 记忆 dont-infer-delete-authorization |

起 master 后端会把连上的库往前迁移（Flyway），**迁了退不回去**。连 `park_demo3` 起后端前先双击仓根 `本地数据库备份.cmd` 备份一份（它只备份 `park_demo3`）。

用 Claude Code：`.claude/launch.json` 里有 `backend`、`frontend`、`frontend-wt`（5273，给 worktree 用）三个配置，直接按名字起。

**为什么是 8481 不是 8080**：8080 落在 Windows 保留端口段里绑不上。改端口要同时改 `frontend/vite.config.ts` 的代理。

**新建开发库**（未核：仓里没有建库脚本，下面这条是按 `application.yml` 和 `docker-compose.yml` 的 mysql 参数拼的，没在新机器上跑过）：

```bash
docker run -d --name demo3-mysql -p 13306:3306 \
  -e MYSQL_ROOT_PASSWORD=<application-dev.yml 里 datasource.password 的值> \
  -e MYSQL_DATABASE=park_demo3 \
  mysql:8.0 --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci
```

后端第一次连上空库会自己建表（Flyway）：

- 默认跑**老链**（`db/migration` + `db/common`）：老链是首个园区的历史迁移，只在本机用。
- 想要空园区：启动前设 `FLYWAY_LOCATIONS=classpath:db/baseline,classpath:db/common`。
- 两条链的区别见 `backend/src/main/resources/db/*/README.md`。

**登录口令**：

| 情况 | admin 口令 |
|---|---|
| 空库 + 老链 | V2 迁移里的种子口令。启动前设环境变量 `ADMIN_PASSWORD` 会把它改成你给的值（只在 admin 还是种子口令时生效） |
| 空库 + 起点链 | 没有口令，必须设 `ADMIN_PASSWORD` 再启动，否则谁都登不进 |
| 本机现有的 `demo3-mysql` | 被人改过，不是种子口令；现值未核，问项目主人 |

dev 档的弱默认口令（连库、JWT、只读账号）写在 `backend/src/main/resources/application-dev.yml`；仓根 `本地数据库备份.cmd` 里也写着同一个开发库口令（改法见 [../README.md](../README.md) §5.1）。

**连库查数**：本机没有单独的 mysql 客户端，用 MySQL Workbench 目录里的 `mysql.exe`，`-h127.0.0.1 -P13306`，加 `--default-character-set=utf8mb4`。
**备份本地库**：双击仓根的 `本地数据库备份.cmd`，产出 `backup-local-<时间>.sql`（已被 .gitignore 排除）。

## 4. 测试与检查

| 做什么 | 命令 | 在哪跑 |
|---|---|---|
| 前端类型检查（真门禁） | `npm run typecheck` | `frontend/` |
| 前端单测全量 | `npm run test` | `frontend/` |
| 前端单个文件 | `npx vitest run src/__tests__/changelog.spec.ts` | `frontend/` |
| 前端完整构建（含类型检查 + 令牌门禁） | `npm run build` | `frontend/` |
| 令牌门禁单跑 | `npm run token-check` | `frontend/` |
| 后端单个测试类 | `./mvnw -q test -Dtest=MigrationLayoutTest`（Windows 用 `mvnw.cmd`） | `backend/` |
| 后端全量（同 CI） | `./mvnw -B verify` | `backend/` |

- 别裸跑 `npx vue-tsc --noEmit`：根 tsconfig 是 `files: []`，它一个文件都不查，永远退出 0。
- 判断「过没过」看产物，不看管道后的退出码：vitest 加 `--reporter=json --outputFile=<文件>` 看 `success`；后端数 `target/surefire-reports/TEST-*.xml`。
- 加或改了迁移再跑 IT：设 `TESTCONTAINERS_REUSE_ENABLE=false`，别写进别人共用的复用库。
- 全站守卫测试在 `frontend/src/__tests__/`（更新公告格式、颜色字面量只减不增、暗色令牌、禁原生 select、源码禁园区真名等 8 个）。
- 更多坑见 [AGENTS.md §6](AGENTS.md#6-已知的坑)。

## 5. 发版与部署

- **合并进 master 就是发版**：`ci.yml`（任何 push / PR 都跑测试）在 master 上绿了以后，`deploy.yml` 自动构建镜像、推到 ghcr、部署生产。生产没有人工审批这一步。
- 版本号怎么涨、更新公告怎么写：见 [AGENTS.md §4](AGENTS.md#4-发版规则摘要)，原文 [docs/design/RELEASE-NOTES-SPEC.md](docs/design/RELEASE-NOTES-SPEC.md)。
- 手动重新部署或回滚：GitHub → Actions → deploy → Run workflow，ref 填提交号（或 `gh workflow run deploy -f ref=<sha>`）。只许 master 上 CI 通过过的提交。**数据库迁移只进不退**，回滚前确认旧代码能跑新库。
- 新服务器、HTTPS、新园区上线、同机开演示站：[deploy/README-部署指南.md](deploy/README-部署指南.md)（§9 新园区、§10 同机再开园区）。
- 环境变量清单：[.env.example](.env.example)。正式 `.env` 不手抄，用 `deploy/gen-env.sh` 生成。
- 服务器在哪、怎么登、备份、迁机：不在本仓，见 [../运维文档/README.md](../运维文档/README.md)。

## 6. 目录结构

| 路径 | 放什么 |
|---|---|
| `frontend/src/views/` | 各屏页面（公摊、分析层、楼栋、合同、抄表、台账、报表、导入中心、系统管理等） |
| `frontend/src/components/ds/` | 设计系统基础件（Button、Card、DatePicker、Select、Popover、KpiCard、Pagination；`icon.ts` 图标表） |
| `frontend/src/components/fp/` | 业务共用件（告警、编辑模式按钮、确认框、册月矩阵、状态色 `contractStatus.ts` 等） |
| `frontend/src/components/ana/` | 分析屏图表件；`anaTheme.ts` 图表配色与点标注，`anaSentence.ts` 读数句句型库，`echartsBundle.ts` 是全站唯一 echarts 装配点 |
| `frontend/src/components/shell/` | 外壳：图标栏、侧栏、页签条、顶栏、铃铛、命令面板、更新弹窗（`release/` 下各版配图） |
| `frontend/src/components/{fin,import,sched}/` | 财务报表屏、导入弹窗、附表类屏的共用件 |
| `frontend/src/{api,stores,composables,router,nav}/` | 接口封装、Pinia 状态、屏级复用逻辑、路由、导航与深链 |
| `frontend/src/{analysis,reports,utils,types}/` | 分析层计算、三大报表推导、纯函数、前后端共用类型 |
| `frontend/src/styles/` | `tokens.css`（设计令牌标准）、`base.css`、`motion.css`、`breakpoints.ts` |
| `frontend/src/brand.ts`、`assets/brand/logo.svg` | 界面上的产品名和标志；后端启动横幅另有一处（`Demo3Application.java:23`、`:25`） |
| `frontend/src/changelog.ts` | 更新公告（最新一版写在最前面） |
| `frontend/src/__tests__/` | 全站守卫测试 |
| `frontend/src/tools/` | 手动用 vite-node 跑的一次性数据工具，不进产物 |
| `backend/src/main/java/com/park/demo3/` | `controller` / `service` / `mapper` / `entity` / `dto` / `security`（权限点、读写门）/ `config`（启动配置、迁移链守卫）/ `common`（统一返回、全局异常） |
| `backend/src/main/resources/db/` | `migration/` 老链 V1–V137（冻结）、`baseline/` 新园区起点 V137（重新生成前先看 `migration-checksums.txt` 头注；算不算已冻结待用户定）、`common/` V138 起两链共用（下一个 V142） |
| `backend/src/test/` | 测试；`AbstractMysqlIT` 是集成测试基类；`resources/baseline/migration-checksums.txt` 钉死已发迁移 |
| `backend/scripts/fixes/` | 一次性修数 SQL（手动跑，不进迁移；很多已不能再跑，见 AGENTS.md §6） |
| `deploy/` | 部署指南 + `server-setup.sh` / `harden.sh` / `gen-env.sh` / `park.sh` + `Caddyfile` |
| `.github/workflows/` | `ci.yml`（只测试）、`deploy.yml`（构建镜像、部署、回滚） |
| `docs/` | 规格、计划、调研、拍板记录，见 [docs/README.md](docs/README.md) |
| `scripts/` | 早期对账核数用的 Python 脚本与清单（历史） |
| `stage-review-*.md` | 四轮阶段验收报告（历史） |
| `.claude/` | 已跟踪：`launch.json`、`dev-backend.cmd`；其余（worktrees、插件）只在本机 |

## 7. 文档在哪

| 找什么 | 看这里 |
|---|---|
| 改代码的规则、红线、坑、规范以谁为准 | [AGENTS.md](AGENTS.md) |
| docs/ 下每份文件是什么、还算不算数 | [docs/README.md](docs/README.md) |
| 用户拍过板的产品决定 | [docs/DECISIONS.md](docs/DECISIONS.md) |
| 页面级规范、功能规格 | `docs/design/`（索引在 docs/README.md） |
| 设计系统（颜色、字号、组件长相） | 标准在本仓：`frontend/src/styles/tokens.css`、`frontend/src/components/`；说明性的设计系统 skill 不在本仓，见 [AGENTS.md §8](AGENTS.md#8-设计系统在哪) |
| 设计稿 | 不在本仓，[../运维文档/设计稿/README.md](../运维文档/设计稿/README.md) |
| 部署 | [deploy/README-部署指南.md](deploy/README-部署指南.md) |
| 数据库迁移规矩 | `backend/src/main/resources/db/{migration,baseline,common}/README.md` |
| 待办、待用户拍板的事、仓外文件地图 | [../README.md](../README.md) |
