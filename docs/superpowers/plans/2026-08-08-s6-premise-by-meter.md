# S6 场地标签按表定位 · 实现计划

规范：`docs/design/S6-PREMISE-BY-METER-SPEC.md`（本计划所有口径以规范为准，冲突时改规范不改实现）

## 全局约束（每个 task 都适用）

1. **TDD**：先写红测，再写实现，再跑绿。禁止先写实现后补测。
2. **金额一分不许动**。本刀只改 `premise` / `premise_text` 两列与前端配对键。任何触及 `amount`/`qty`/`price_snap`/`base_snap` 的改动都是越界。
3. **禁止并发跑 maven**（共享 `target/`）。任一时刻只能有一个 `mvnw` 进程。
4. 后端型检/测试：`cd backend && .\mvnw.cmd -q verify`；前端：`cd frontend && npm run typecheck && npm run test:unit`（**不是**裸 `vue-tsc --noEmit`，那是无效检查）。
5. dev 库：`docker exec demo3-mysql mysql -uroot -proot --default-character-set=utf8mb4 -e "…" park_demo3`。**改库前先 mysqldump 备份**到 `backend/scripts/fixes/`。
6. 不做规范 §4 列出的任何一项。发现新问题 → 记进 §5 数据债，不顺手改。

---

## T1 · 纯逻辑 + 单测（无容器）

**位置**：`BillNoticeService` 内 package-private static 方法（不新建生产类——单点使用，抽类是多余抽象）；测试 `backend/src/test/java/com/park/demo3/service/BillNoticePremiseTest.java`（纯 JUnit，不起 Spring）。

**实现**：规范 §2.1 `tok` / `roomTokens`、§2.2 `resolveMeterPremise`、§2.3 `synthesize`。

**先写的测**（红 → 绿）：
- `tok`：`202007151529`→∅（12 位整段落选）、`309.00`→{309}、`三楼 1-309`→{309}、`一楼商铺 2101、2102`→{2101,2102}、`501-504`→{501,504}、`二期11号楼西边301、401单元`→{301,401}（`11` 两位不入）
- `roomTokens` 优先级：name/room_no 非空则压 spot——锚 **表 929**（`name=411.00` + `spot=五楼 1-516` → {411}）
- `resolveMeterPremise` 三分支：唯一命中取原文 / 多命中回退 / 零命中回退
- `synthesize` 规范 §2.3 表格**逐行五例全等**
- `|inter|>1` 不合成（`一楼商铺 2101、2102` + location `宿舍区二号楼首层2101、2102室` → 原文）

**verify**：`.\mvnw.cmd -q -Dtest=BillNoticePremiseTest test` exit 0。

---

## T2 · 接入引擎 + IT

**改**：
- `BillNoticeService:528` → `resolveMeterPremise(m, row.contractId(), locs)`（`meterLine` 已有 `Meter m` 形参，签名不变）
- 回退且结果仍含「、」→ `warnByTenant` 加 `场地未定:{name}`（Set 去重，短）
- `:373` `premiseText` 超 5 项 → 前 5 项 + `,等N处`

**测**：`BillNoticeApiIT` 新增，**槽位 `2091-05`**（`2090-01..12`/`2091-01..04` 已占，`2091-01` 在 AllocApiIT、`2091-02` 在 AllocPoolContributionsIT）。造：
- 宿舍多间合同（逐间 location）→ 表行 premise = 该间原文
- 合并串合同（一条 location 列三间）→ 表行 premise = 合成单间
- 零命中 → premise 保持长串 + warn 含「场地未定」
- premiseText 项数 > 5 → 含「等」

**不许动** `:477` 现有 `rent.premise=="A座101"` 断言（租金行不走 premiseOf，本就不该变）。

**verify**：`.\mvnw.cmd -q verify` 全绿（不是只跑 `-Dit.test`）。

---

## T3 · 前端配对键 + spec

**改** `frontend/src/utils/billNoticeLogic.ts:127-131` `byPremise`：按 premise 过滤 → 取 distinct `meterId` → 恰好 1 个则挂该表首行，否则 null。

**测** `billNoticeLogic.spec.ts`：
- `:92`/`:109` 改成真实形态（表行与公摊行同为计费行 location 原文）并保持绿
- `:121` 长串用例降级为「回退路径」，语义注释更新
- `:136` 两间同 premise → 仍 extras（**必须保持绿**，这是防挂错间的护栏）
- 新增：分时一表 4 段 → 路灯挂该表首行且只挂一次

**verify**：`npm run typecheck && npm run test:unit` 全绿。

---

## T4 · 重生成 2024-02 + 前后对账

1. 先备份：`mysqldump … > backend/scripts/fixes/backup-before-s6-20260808.sql`
2. 记录改前基线（已测得，复核用）：290 单 / 3,535,971.77；可莱恩 2733=65062.55(31行) / 2734=6135.18(54行) / 2735=50477.60(4行)；表行含「、」宿舍 409 非宿舍 345；premise=64 字 276 行
3. 重启 dev 后端 → `POST /api/bill-notices/generate?ym=2024-02`
4. 出报告 `backend/scripts/fixes/s6-premise-recon-20260808.md`：规范 §6.1 金额护栏逐格对照 + §6.2 标签效果表 + 剩余长串行**逐条归入 D1/D2/D3**（不许有归不进去的）

**verify（硬门槛）**：§6.1 四个金额锚点与行数**逐格全等**；premise=64 字行数 = **0**；宿舍表行含「、」**≤16**。任一不满足 → 回到 T1/T2 查因，不许改验收标准。

---

## T5 · 回归 + 提交

- `.\mvnw.cmd -q verify` + `npm run typecheck` + `npm run test:unit` 三绿，**贴真实输出**
- 提交：规范 + 计划 + 后端 + 前端 + 对账报告，中文 commit message
- 更新 memory `demo3_s4_readiness_2026-08-05.md`：S6 结论 + §5 数据债待用户拍板项（D1 逐间面积 / D3 表挂错合同名单）
