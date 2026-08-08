-- ════════════════════════════════════════════════════════════════════════════
-- 2024-02「源册收了钱、库里没单」四户修缮  (草稿 2026-08-09,待主会话审核后执行)
--
-- 源册: 2025全年发生额、预算对比\2024年\2024年3月费用数据\2024年3月费用数据\
--       一期\一期2024年2月水电费.xlsx
--       sheet「一期租户分摊公共用电金额」(下称 zh 表,列 F=楼层公共消防照明 G=空调风机
--       H=电梯用电 I=孵化协议固定收取 J=盈/亏)、「2024年2月电费/水费总表」、
--       「一期园区电/水」(抄表原册)、per-租户纸质通知单 sheet(优硕达 / 博浩)。
--
-- 四户结论(与任务书给的初判有两处出入,见 §3 / §4):
--   ① 黄路生  = 真·2024-02 在租、2024-03 起退租 → 补合同日期(2月后自动消失) 【建档】
--   ② 周应佳  = 真·2024-02 在租、2024-03 起退租 → 新建档案+合同+挂表        【建档】
--   ③ 张执盛  = 博浩(tid 162)的老板名,**不是独立租户** → 并档,不建合同      【合并】
--   ④ 优硕达  = 在租至今(台账 2024-10~2025-07) → 只补合同日期,**不可截到 2月**【补日期】
--
-- ⚠ 执行前置:先备份。 mysqldump 已在 demo3/ 有先例(backup-before-supplement-20260804.sql)
-- ⚠ 执行后必须重生成 2024-02 催缴单,并 diff 全量 289 单总额:
--      期望「只增不改」——新增 3 张单(黄路生/周应佳/优硕达),张执盛 0.00 单消失,
--      其余 286 单逐单金额不动。若既有单金额有位移,说明 A座/C座 area 池的
--      面积基数(covering 口径)被新合同稀释了,须回滚并先做池名册对账。
-- ════════════════════════════════════════════════════════════════════════════
SET NAMES utf8mb4;

-- ══════════ 0. 前置断言(任一不成立就别往下跑) ══════════
-- 期望依次:  392 / 1 / 460 / 1(draft) / 390 / 1 / 162 / 1 / 163 / 1 / 30 / 1 / 1424 / 1 / 0(周应佳无档)
SELECT '断言1 黄路生档案在'   k, COUNT(*) v FROM tenant   WHERE id=392 AND company_name='黄路生'
UNION ALL SELECT '断言2 黄路生占位合同 460 是 draft 且缺日期',      COUNT(*) FROM contract WHERE id=460 AND tenant_id=392 AND status='draft' AND start_date IS NULL AND end_date IS NULL
UNION ALL SELECT '断言3 张执盛伪档 390 在且无合同',                  COUNT(*) FROM tenant   WHERE id=390 AND company_name='张执盛' AND NOT EXISTS(SELECT 1 FROM contract WHERE tenant_id=390)
UNION ALL SELECT '断言4 张执盛两只水表(498/499)挂在伪档 390',        COUNT(*) FROM meter    WHERE id IN (498,499) AND tenant_id=390
UNION ALL SELECT '断言5 博浩 162 在且 F座401 合同覆盖 2024-02',      COUNT(*) FROM contract WHERE tenant_id=162 AND building_id=24 AND start_date<='2024-02-29' AND end_date>='2024-02-01' AND status<>'draft'
UNION ALL SELECT '断言6 优硕达合同 30 缺日期(kva=10, 面积 91.43)',   COUNT(*) FROM contract WHERE id=30 AND tenant_id=163 AND start_date IS NULL AND end_date IS NULL AND kva=10.00
UNION ALL SELECT '断言7 周应佳电表 1424 未挂户且 2024-03 退场',      COUNT(*) FROM meter    WHERE id=1424 AND tenant_id IS NULL AND removed_ym='2024-03' AND retired_ym='2024-03'
UNION ALL SELECT '断言8 周应佳档案尚不存在(期望 0)',                 COUNT(*) FROM tenant   WHERE company_name='周应佳';

START TRANSACTION;

-- ══════════════════════════════════════════════════════════════════════════
-- 1. 黄路生(tid 392)——补合同日期,让他只在 2024-02(及之前)出现
-- ──────────────────────────────────────────────────────────────────────────
-- 源册证据:
--   zh 表 R28「黄路生公共 | A座 | 四楼420室 | 黄路生 | 面积 330.28 |
--            F 楼层公共 23.12 | H 电梯 26.42 | I 孵化协议固定收取 100 | J 盈亏 50.46」
--   → J = 100 − (23.12+26.42) = 50.46 全等,即 100 元是**替代 F/H 实际分摊的包干价**,不是租金。
--   一期园区电 R64:电表 220605000146(库中 meter 239)2024-02 上=下=9625.40 → 用量 0。
--   电费总表/水费总表 均无「黄路生」行 → 当月户内电费/水费皆 0,唯一应收=100 元包干。
-- 库中现状:
--   tenant 392 status=2(停用) —— 与「2024-03 起退租」一致,保留不改。
--   contract 460 = 'HIST-HLS-01',status=draft,日期全空,
--     remark 已写「黄路生历史租约占位(2023-01~2024-02 A座420)」← 日期取值即据此。
--   meter 239 已改名「暨南医美电」并改挂 tid 172(后手接 420 室);用量 0,不动它,
--     故本刀不会给黄路生派生任何水电行。
UPDATE contract SET
    status      = 'active',
    start_date  = '2023-01-01',   -- 推定值:取自 460.remark 的历史占位区间起点,待核
    end_date    = '2024-02-29',   -- 硬证据侧:2024-03 起 420 室由暨南医美接手,zh 表 3 月无此户
    building_id = 13,             -- 一期 A座
    rent_area   = 330.28,         -- zh 表 E 列
    term_type   = 'explicit',   -- 枚举只收 explicit|multiple|relative|none(ContractCreateReq @Pattern),推定意图写在 term_text
    term_text   = '推定 2023-01-01 至 2024-02-29(依 460.remark 占位区间 + 2024-03 暨南医美接手)',
    remark      = CONCAT(COALESCE(remark,''),
                  ' | 2026-08-09 补日期:据 一期2024年2月水电费.xlsx「一期租户分摊公共用电金额」R28。',
                  '起租日为推定值待核;止租日 2024-02-29 有 2024-03 交接硬证。')
  WHERE id=460 AND tenant_id=392 AND start_date IS NULL;

-- ⚠ 100 元「孵化协议固定收取」**本脚本不处理**,归口 incubator-package-20260809.sql
--   (同日并行刀,已把 5 户包干配置写成 tenant_price_cfg.share_elec_fixed,
--    并把黄路生这条留成注释「生效月待用户确认」)。
--   本刀只补合同日期 —— 让他成为「2024-02 的在租户」;包干金额由那一刀放开。
--   附一条本刀取到的证据给那边参考:zh 表 J28 = 100 − (23.12+26.42) = 50.46 全等,
--   即园区侧确实按 100 元入账并记了 50.46 的「盈」,不是未实收。

-- ══════════════════════════════════════════════════════════════════════════
-- 2. 周应佳——新建档案 + 合同 + 挂表;2024-03 起自动消失
-- ──────────────────────────────────────────────────────────────────────────
-- 源册证据:
--   zh 表 R33「周应佳公共 | A座 | 四楼428、435室 | 周应佳 | 面积 158.66 | F 11.11 | H 12.69」→ 分摊应收 23.80
--   一期园区电 R68:电表 220605000033,倍率 60,上 15.83 → 下 16.82,用量 =(16.82−15.83)×60 = 59.4 度
--   一期园区水 R45:「东佛水 A座 四楼428、435室 周应佳 水表①」上=下=16 → 用量 0(库中无此表,不建)
--   电费总表/水费总表 无「周应佳」行(该户未进户侧实收表,只在抄表册+分摊册)
-- 库中现状:meter 1424 = 'A座-四楼428室-电表①' code 220605000033,tenant_id 空,
--   retired_ym=removed_ym='2024-03'(2026-08-04「补充租户总手术」按退租停用过)。
--   → 挂户后 2024-02 出行,2024-03 起 MeterService.outOfService 自动挡掉,正是用户要的效果。
INSERT INTO tenant (company_name, status, offbook, phase, remark)
VALUES ('周应佳', 2, 0, 1,   -- phase 是 tinyint:1=一期
        '2026-08-09 补建:2024-02 在租(A座四楼428、435室,面积158.66),2024-03 起退租。'
        '来源=一期2024年2月水电费.xlsx「一期租户分摊公共用电金额」R33 +「一期园区电」R68');
SET @tid_zyj = LAST_INSERT_ID();

INSERT INTO contract (contract_no, tenant_id, building_id, rent_area, monthly_rent,
                      start_date, end_date, status, kind, term_type, term_text, remark)
VALUES ('HIST-ZYJ-01', @tid_zyj, 13, 158.66, 0.00,
        '2023-10-01',    -- 推定值:取 meter 1424 最早读数月(2023-10)作起点,待核
        '2024-02-29',    -- 硬证据侧:meter 1424 removed_ym='2024-03'
        'active', 'normal', 'explicit',
        '推定 2023-10-01 至 2024-02-29(起点=最早抄表月;止点=电表 2024-03 退场)',
        '2026-08-09 补建。租金要素源册无载(该户不在电费/水费总表,也无纸质通知单),'
        '故不建计费行——只让他成为「2024-02 的在租户」,水电按表派生');

-- 挂表:1424 → 周应佳(仅此一只;水表源册用量 0 且库中无对应记录,不建)
UPDATE meter SET tenant_id=@tid_zyj, tenant_name='周应佳', contract_id=(SELECT id FROM contract WHERE contract_no='HIST-ZYJ-01')
  WHERE id=1424 AND tenant_id IS NULL;

-- 收款方映射:户内电费→一泽(4),电维护费→创燊高(6)。口径抄自同册 优硕达/博浩 两张纸质通知单落款
INSERT INTO bill_pay_company (tenant_id, fee_key, company_id) VALUES
  (@tid_zyj,'elecStd',4), (@tid_zyj,'elecMaint',6)
  ON DUPLICATE KEY UPDATE company_id=VALUES(company_id);

-- ══════════════════════════════════════════════════════════════════════════
-- 3. 张执盛(伪档 390)——并入博浩(162),**不建合同**
-- ──────────────────────────────────────────────────────────────────────────
-- ⚠ 与任务书初判「张执盛=有单无 active 合同」不同:他根本不是一个租户。证据链:
--   ① sheet「博浩」= 一张 2024-02 缴费通知单,抬头「佛山市博浩生物科技有限公司」,
--      位置「一期F座四楼401室」,而单内每一条电费行的表名都是「张执盛电表1/2」、
--      公摊行叫「张执盛公共」。
--   ② zh 表 R82「张执盛公共 | F座 | 四楼401室 | 张执盛 | 面积 3200 | F 14.71 | H 202.69」
--      —— 面积 3200 与库中 博浩合同 334(building 24 F座, rent_area 3200, kva 625)全等;
--      F/H 两数与「博浩」sheet 第 50/51 行逐格全等。
--   ③ 水费总表 R99「张执盛 | F座四楼401室 | 绿化水公摊 28.8」= 博浩 sheet 第 58 行 28.8。
--   ④ 库中电表 385/386(名「张执盛电表1/2」)早已挂 tid 162 博浩,只有两只水表 498/499 掉在伪档上。
--   → 与 memory 里「李富全=鑫皇老板」「欧培仪=雷莱」同一模式:worksheet 用老板名。
UPDATE tenant SET aliases = TRIM(BOTH ',' FROM CONCAT(COALESCE(aliases,''), ',张执盛,张执盛东侧,张执盛西侧'))
  WHERE id=162;
UPDATE meter SET tenant_id=162, tenant_name='博浩' WHERE id IN (498,499) AND tenant_id=390;
-- 其余可能挂在 390 上的引用一并迁移(当前实测均为 0 行,防御性保留)
UPDATE monthly_ledger    SET tenant_id=162 WHERE tenant_id=390;
UPDATE s10_record        SET tenant_id=162 WHERE tenant_id=390;
UPDATE alloc_rule_member SET tenant_id=162 WHERE tenant_id=390;
DELETE FROM bill_pay_company WHERE tenant_id=390;   -- 实测 0 行,防御性
-- 伪档留下的 2024-02 空单(id 4528, 0.00)先删,重生成时不会再出
DELETE FROM bill_notice WHERE tenant_id=390;   -- 行由 FK CASCADE 连删
DELETE FROM tenant WHERE id=390
  AND NOT EXISTS(SELECT 1 FROM contract WHERE tenant_id=390)
  AND NOT EXISTS(SELECT 1 FROM meter    WHERE tenant_id=390)
  AND NOT EXISTS(SELECT 1 FROM monthly_ledger WHERE tenant_id=390);

-- ══════════════════════════════════════════════════════════════════════════
-- 4. 优硕达(tid 163)——只补合同日期,**不能截到 2024-02**
-- ──────────────────────────────────────────────────────────────────────────
-- ⚠ 与「历史退租户」不同:优硕达至今在租(monthly_ledger 有 2024-10~2025-07 共 20 行)。
--   任务书说的「覆盖 2024-02 的最小合理区间」只适用于 §1/§2 两个退租户;这里若截到 2 月,
--   会把 2024-10 以后每一个月的单都砍掉。
-- 源册证据(sheet「优硕达」= 两张 2024-02 纸质通知单,合计 249.84):
--   一泽单 228.88 = 基本用电费 226(10千伏安 × 22.6) + 水费 2.88(C座二楼东/西侧各 6 度 × 3.95 × 面积分摊)
--   创燊高单 20.96 = 电维护费 19.78(楼层公共 3.34 + 电梯 12.48 + 线路损耗 0.30 + 路灯公摊 3.66)
--                  + 水维护费 1.18(0.18+0.18+绿化水公摊 0.82)
--   面积 91.43㎡,位置 一期C座202室 —— 与库中 contract 30(building 21 C座, unit 432=2F-202,
--   rent_area 91.43, kva 10.00)全等。库中 tenant_price_cfg#10 capacity_fee=22.60 → 10×22.6=226 ✓
--   zh 表 R55 登记在老板名「张勇」名下(面积 91.43、F 3.34、H 12.48 与纸单全等)→ 补别名。
-- 补日期后本刀能立刻找回的是**容量费 226 元**;水/公摊要等 C座二楼共用表(295/459/460,
-- 现 tenant_id 空)按面积分摊建池,那是另一刀,不在此脚本。
UPDATE tenant SET aliases = TRIM(BOTH ',' FROM CONCAT(COALESCE(aliases,''), ',张勇,佛山市优硕达自动化有限公司'))
  WHERE id=163;
UPDATE contract SET
    start_date = '2024-01-01',   -- 推定值:须 ≤ 2024-02(源册当月已在租);实际签约日待核
    end_date   = '2025-12-31',   -- 推定值:须 ≥ 2025-07(台账末月);实际到期日待核
    term_type  = 'explicit',   -- 同上
    term_text  = '推定 2024-01-01 至 2025-12-31(下界=2024-02 源册在租,上界=台账末月 2025-07),待核',
    remark     = CONCAT(COALESCE(remark,''),
                 ' | 2026-08-09 补日期:据 一期2024年2月水电费.xlsx sheet「优硕达」两张纸质通知单'
                 '(一泽 228.88 + 创燊高 20.96)。起止日均为推定值,须向物业核实真实租期')
  WHERE id=30 AND tenant_id=163 AND start_date IS NULL;

COMMIT;

-- ══════════ 5. 验证段(逐条对期望值) ══════════
SELECT '验1 黄路生合同覆盖 2024-02 且 2024-03 失效(期望 1/0)' k,
       SUM(start_date<='2024-02-29' AND end_date>='2024-02-01') feb,
       SUM(start_date<='2024-03-31' AND end_date>='2024-03-01') mar
  FROM contract WHERE id=460;
SELECT '验2 周应佳:档案1 合同1 表1(期望 1/1/1)' k,
       (SELECT COUNT(*) FROM tenant WHERE company_name='周应佳') t,
       (SELECT COUNT(*) FROM contract WHERE contract_no='HIST-ZYJ-01' AND start_date<='2024-02-29' AND end_date='2024-02-29') c,
       (SELECT COUNT(*) FROM meter WHERE id=1424 AND tenant_id IS NOT NULL) m;
SELECT '验3 张执盛伪档已清、两水表归博浩(期望 0/2)' k,
       (SELECT COUNT(*) FROM tenant WHERE id=390) t,
       (SELECT COUNT(*) FROM meter WHERE id IN (498,499) AND tenant_id=162) m;
SELECT '验4 优硕达合同覆盖 2024-02 且覆盖 2025-07(期望 1/1)' k,
       SUM(start_date<='2024-02-29' AND end_date>='2024-02-01') feb,
       SUM(start_date<='2025-07-31' AND end_date>='2025-07-01') jul
  FROM contract WHERE id=30;
-- 验5:2024-02「有单但当月无在租合同」的户数,期望由 25 降到 23(黄路生本就无单,张执盛单已删)
SELECT '验5 无在租合同仍出单的户数(执行前 25)' k, COUNT(DISTINCT n.tenant_id) v, ROUND(SUM(n.total_amount),2) amt
  FROM bill_notice n WHERE n.ym='2024-02'
   AND NOT EXISTS (SELECT 1 FROM contract c WHERE c.tenant_id=n.tenant_id AND c.status<>'draft'
        AND c.start_date IS NOT NULL AND c.end_date IS NOT NULL
        AND c.start_date<='2024-02-29' AND c.end_date>='2024-02-01');

-- ══════════ 6. 重生成后必做的对账(在 POST /api/bill-notices/generate?ym=2024-02 之后) ══════════
-- ① 优硕达应新增一张单,含 capacity 行 10 kVA × 22.60 = 226.00(与纸单「基本用电费」全等)
-- ② 周应佳应新增一张单,含 elec 59.40 度 + mgmt_fee 59.40 × 0.32
-- ③ 全量总额 diff:执行前 289 单 / 3,558,407.47 元。期望新总额 = 3,558,407.47 − 0.00(张执盛空单)
--    + 优硕达单 + 周应佳单,**其余 286 单逐单不动**。逐单 diff 用:
--    SELECT tenant_id, notice_kind, total_amount FROM bill_notice WHERE ym='2024-02' ORDER BY 1,2;
--    (跑前先把这张表导出一份做基线)
