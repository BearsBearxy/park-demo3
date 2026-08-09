-- ════════════════════════════════════════════════════════════════════════════
-- S12 罗立剑/刘彪 合同补全 + 星州/永龙 管理费 0.15 例外核档
--     (草稿 2026-08-09,**未执行**,待主会话审核;禁止直接写 dev 库)
--
-- 源册: 二期2024年2月水电费.xlsx(sheet「罗立剑」「刘彪」「星州」「永龙」,
--       scratchpad p2audit/tenants.json 结构化提取,原格逐录见各段取证)
-- 基线: 2024-02 = 297 单 / 3,934,541.57 / 批次 BN20260809191227(断言01 实测)
--
-- 三段:
--   §1 罗立剑(tid 54,=广州易采生物)合同198 → 真实合同补日期(推定区间)
--      + 单元手术:补挂 575(6F-601)、摘除 566(天面,floor=1 脏数据会污染楼层桶)
--      计费行 7 条**库里已与纸约逐格全等,一条不动**(断言03)
--   §2 刘彪(tid 55)kVA 归位:厂房链 368/369/221 三段补 kva=15(册面实收口径),
--      壳合同 199 的 kva 置 NULL(防日后补日期双收);纸约 70 千伏安不一致记 remark 待核
--   §3 星州(tid 22)/永龙(tid 23)mgmt 0.15 户级例外 → **库里已存在**(cfg id 98~101,
--      现行批次已生效,行级证据见段内)→ 本段只做幂等守卫 INSERT + 断言,不产生变更
--
-- ── §1 取证(二期册 sheet「罗立剑」,2024-02)────────────────────────────────
--   R5 原格: B5='电费' | D5='装机容量费' | I5='500千伏安' | J5=22.6 | K5=11300 (K_f==500*J5)
--   → 容量费 500 kVA × 22.6 = 11,300,contract.kva=500 库里已对,补日期即派生。
--   计费行 vs 纸约逐格对(断言03,全等):
--     厂房租金   7281.52×15.2 = 110,679.10   ← 纸约「首三年110679.10不含税」全等
--     企业管理   7281.52×5.0  =  36,407.60
--     基础设施   7281.52×1.8  =  13,106.74
--     电梯维护   per_month 1,200.00           ← 纸约「4梯×2层×150(首层不摊)」=1200 (刀二口径)
--     变压器维护 per_month   500.00
--     天面空地   56×10=560.00 、40×10=400.00
--     月租合计 162,853.44
--   楼层桶佐证(册面): 电梯用电 132.77/层×2=265.54、消防用电 134.89/层×2=269.78,
--     均「共2层」= 6F+7F。库中水表 176(六楼/601)/177(七楼/701)为现行 L2 楼层源(电表89 无楼层),
--     引擎现按 {六楼,七楼} 2 桶计(fire 160.56 / elevator 331.92,base_snap=2.00)。
--   ⚠ 单元手术是补日期的**前置护栏**:AllocService §D.1 楼层 L1=覆盖合同→contract_unit→unit.floor,
--     补日期后 L1 生效压过 L2。现挂 {566(天面,floor=1!),576(7F-701)} → L1 会算成 {一楼,七楼}:
--     丢六楼、多一楼(unit_no='天面' 而 floor=1 正是 AllocService 注释点名的脏数据模式,邓宇峰同款),
--     且两源冲突 warn 必响。故:+575(6F-601,billing_term_unit 325~334 早已把租金行挂到 575/576,
--     只是 contract_unit 漏了)、-566(天面不是楼层;天面空地租金走计费行 6804/6805+billing_term_unit
--     335/336,不经 contract_unit,摘除不影响租金)。手术后 L1={六楼,七楼}=L2,楼层桶零位移。
--     先例:力灏合同192 补挂单元 368(s10-tenant-data-20260809.sql §1LH,NOT EXISTS 守卫)。
--   推定区间:纸约九年自验收日,验收日未知;签约单 2022-09-16(原 remark 载明)。
--     台账末月 2025-10(断言06)、读数末月 2024-02 → 取 2022-09-16 ~ 2031-09-15,两端均覆盖。
--
-- ── §2 取证(二期册 sheet「刘彪」,2024-02)──────────────────────────────────
--   R5 原格: B5='电费\n' | D5='装机容量费' | I5='15千伏安' | J5=22.6 | K5=339 (K_f==15*J5)
--   → 册面按 **15 kVA 实收 339**,不是纸约的 70 kVA(70×22.6=1,582)。
--   拍板口径(同力灏 22.6 vs 纸约 23 先例):照册面收,纸约值写 remark 待核。
--   挂载方案:kva 补到**厂房链三段 368/369/221**(同一 kva=15),不给 199 补日期。理由:
--     ① 容量费引擎按「覆盖当月的合同段」取 kva(BillNoticeService §容量费,covers 口径),
--        2024-02 由 368(2022-12-26~2025-12-25,renewed)覆盖 → 挂 368 立即生效;
--        369/221 是同链后续段,同补则 2025-12 换档、2028-12 换档均不丢 kva —— 续签安全。
--     ② 给 199 补日期 = 凭空造一份与厂房链重叠的在租合同(199 无计费行、rent_area=0,
--        但会进在租名册/表绑定判定树),s9 教训「补合同日期会引爆潜伏派生」,改动面更大。
--     ③ 199.kva 置 NULL:199 现无日期不参与派生,但留着 15 就是一颗「日后谁补了日期
--        就双收 339」的雷,归位后拆掉。
--
-- ── §3 取证(星州/永龙 0.15)─────────────────────────────────────────────────
--   库况:tenant_price_cfg 98/99(tenant:22)、100/101(tenant:23),
--     cfg_key=mgmt_fee_commercial+mgmt_fee,cfg_value=0.15,acct_month=''(常数口径,
--     与包干先例 48~90 同款)→ **例外已在册,无需新增**。
--   现行批次生效证据(BN20260809191227 行级):
--     notice 5218 line7: 星州 mgmt_fee qty=16218 price_snap=0.15 price_scope='tenant:22' → 2,432.70
--     notice 5221 line7: 永龙 mgmt_fee qty=11977 price_snap=0.15 price_scope='tenant:23' → 1,796.55
--     宿舍段 5219/5222 各 mgmt 行同为 0.15。
--   起草稿曾报两条「与册面差异」,复核逐格重读 worksheet 后**均证伪,如实更正**:
--     ① 册面星州 r36-40 / 永龙 r40-44 用电维护费段就是 0.15×分时度数,Σ=2,432.70 / 1,796.55,
--        与 dev 分位全等——0.15 与本月册面**全等**,无差可拍板。
--     ② 永龙 r39 明载「基本用电费 375千伏安×22.6=8475」且计入合计,dev 两户各收 8475 与册一致,
--        「共变压器只收一头」疑点不存在。
--     真正待拍板的是:永龙册面另收 **A相反向有功×0.15 = 2,329.05**(r45-48)维护费,dev 未收——
--        又是那块反向有功寄存器(用户已示意搁置,记档不失踪)。
--
-- ── 与 25 户名单(s10 §1)的关系 ───────────────────────────────────────────────
--   s10 名单判据=「2024-02 有单但**租户级**无任一在租合同」→ 25 户。本刀四户全不在名单:
--     罗立剑有宿舍分约 451~454(带日期)、刘彪有 368、星州/永龙有 345/347,租户级 EXISTS 全过。
--   本刀补的是名单判据照不到的**合同级**缺口:主合同缺日期(198)/kva 挂在无日期壳合同(199)。
--   两刀改动集合零交集(s10: 8,32,113,114,116,134,165,207,219,236,240,278,135,192,30,460+新建;
--   本刀: 198,221,368,369,199,contract_unit(198)),互补不重叠,可任意顺序执行(s10 已执行)。
--
-- ⚠ 执行前置:先 mysqldump 备份(先例 backup-before-s7-alloc-20260808.sql)。
-- ⚠ 执行后重生成 2024-02:POST /api/bill-notices/generate?ym=2024-02
--    重生成前先导出基线:
--      SELECT tenant_id, notice_kind, total_amount FROM bill_notice WHERE ym='2024-02' ORDER BY 1,2;
-- ════════════════════════════════════════════════════════════════════════════
SET NAMES utf8mb4;

-- ══════════════════════════════════════════════════════════════════════════
-- §0 前置断言(任一不成立就别往下跑)
--    期望依次: 297|3934541.57 / 1 / 7 / 2 / 0 / 1 / 2 / 1 / 0 / 3 / 1 / 4 / 0 / 0
--    (2026-08-09 已对现库逐条实测通过)
-- ══════════════════════════════════════════════════════════════════════════
SELECT '断言01 基线单数|总额(期望 297|3934541.57)' k,
       COUNT(*) n, ROUND(SUM(total_amount),2) amt FROM bill_notice WHERE ym='2024-02';
SELECT '断言02 罗立剑合同198 缺日期、kva=500、面积7377.52、楼栋35 二期六车间、active(期望 1)' k,
       COUNT(*) v FROM contract
 WHERE id=198 AND tenant_id=54 AND status='active' AND sign_date IS NULL
   AND start_date IS NULL AND end_date IS NULL AND kva=500.00
   AND rent_area=7377.52 AND building_id=35
UNION ALL SELECT '断言03 罗立剑 7 条计费行与纸约逐格全等(期望 7,**不 INSERT 不 UPDATE**)',
       COUNT(*) FROM contract_billing_term WHERE contract_id=198 AND (
            (fee_key='rent_factory' AND unit_price=15.2000 AND area=7281.52)
         OR (fee_key='mgmt'         AND unit_price=5.0000  AND area=7281.52)
         OR (fee_key='infra'        AND unit_price=1.8000  AND area=7281.52)
         OR (fee_key='elevator'     AND amount_override=1200.00)
         OR (fee_key='transformer'  AND amount_override=500.00)
         OR (fee_key='rent_factory' AND unit_price=10.0000 AND area=56.00)
         OR (fee_key='rent_factory' AND unit_price=10.0000 AND area=40.00))
UNION ALL SELECT '断言04 合同198 现只挂 566(天面,floor=1)/576(7F-701) 两单元(期望 2)',
       COUNT(*) FROM contract_unit WHERE contract_id=198 AND unit_id IN (566,576)
UNION ALL SELECT '断言05 合同198 未挂 575(6F-601)(期望 0)',
       COUNT(*) FROM contract_unit WHERE contract_id=198 AND unit_id=575
UNION ALL SELECT '断言06 单元575 = 楼栋35 六层 601(期望 1)',
       COUNT(*) FROM unit WHERE id=575 AND building_id=35 AND floor=6 AND unit_no='601'
UNION ALL SELECT '断言07 罗立剑水表 176/177 楼层=六楼/七楼(L2 楼层源连续性,期望 2)',
       COUNT(*) FROM meter WHERE tenant_id=54 AND ownership='tenant' AND (
            (id=176 AND floor_label='六楼') OR (id=177 AND floor_label='七楼'))
UNION ALL SELECT '断言08 罗立剑台账末月=2025-10(推定上界 2031-09-15 须覆盖;期望 1 且无更晚行)',
       COUNT(DISTINCT 1) FROM monthly_ledger WHERE tenant_id=54 AND period_year=2025 AND period_month=10
UNION ALL SELECT '断言09 罗立剑台账不存在晚于 2025-10 的行(期望 0)',
       COUNT(*) FROM monthly_ledger WHERE tenant_id=54
         AND (period_year>2025 OR (period_year=2025 AND period_month>10))
UNION ALL SELECT '断言10 刘彪厂房链 368/369/221 三段日期齐全且 kva 全空(期望 3)',
       COUNT(*) FROM contract WHERE tenant_id=55 AND kva IS NULL AND (
            (id=368 AND start_date='2022-12-26' AND end_date='2025-12-25' AND status='renewed')
         OR (id=369 AND start_date='2025-12-26' AND end_date='2028-12-25' AND status='active')
         OR (id=221 AND start_date='2028-12-26' AND end_date='2031-12-25' AND status='active'))
UNION ALL SELECT '断言11 壳合同199 缺日期、kva=15、零计费行(期望 1)',
       COUNT(*) FROM contract c WHERE c.id=199 AND c.tenant_id=55
         AND c.start_date IS NULL AND c.end_date IS NULL AND c.kva=15.00
         AND 0=(SELECT COUNT(*) FROM contract_billing_term WHERE contract_id=199)
UNION ALL SELECT '断言12 星州/永龙 0.15 例外已在册(cfg 98~101 常数口径,期望 4)',
       COUNT(*) FROM tenant_price_cfg
 WHERE scope IN ('tenant:22','tenant:23')
   AND cfg_key IN ('mgmt_fee','mgmt_fee_commercial')
   AND cfg_value=0.15000000 AND acct_month=''
UNION ALL SELECT '断言13 现行批次刘彪单无容量费行(期望 0;补 kva 后应出 339)',
       COUNT(*) FROM bill_notice_line l JOIN bill_notice n ON n.id=l.notice_id
 WHERE n.ym='2024-02' AND n.tenant_id=55 AND l.fee_key='capacity'
UNION ALL SELECT '断言14 现行批次罗立剑单无租金组行(期望 0;补日期后应出 162,853.44)',
       COUNT(*) FROM bill_notice_line l JOIN bill_notice n ON n.id=l.notice_id
 WHERE n.ym='2024-02' AND n.tenant_id=54 AND l.fee_group='rent';

START TRANSACTION;

-- ══════════════════════════════════════════════════════════════════════════
-- §1 罗立剑(tid 54)合同198 —— 真实合同补日期(推定区间)
-- ──────────────────────────────────────────────────────────────────────────
-- 计费行/kva/term_type('relative')/term_text(纸约九年条款原文)均已在库,一律不动。
-- 原 remark「期限待人工补 | 纸约:…」重写为补录后口径(签约单/首三年档等事实保留)。
UPDATE contract SET
    sign_date  = '2022-09-16',   -- 签约单日期(原 remark 载明)
    start_date = '2022-09-16',   -- 推定:九年自验收日,验收日未知,以签约单日为下界
    end_date   = '2031-09-15',   -- 推定:签约单日 + 九年;覆盖台账末月 2025-10(断言08/09)
    remark     = LEFT(CONCAT(
                 '真实合同补日期(2026-08-09):起止为推定(签约单2022-09-16,纸约九年自验收日,',
                 '验收日待核);第四~六年档(132,720.27/43,652.71/15,698.96)未录待换档;',
                 '纸约=六车间6-7层+天面空地,首三年110679.10不含税,计费行7条与纸约逐格全等'), 255)
  WHERE id=198 AND tenant_id=54 AND start_date IS NULL AND end_date IS NULL;

-- 单元手术(楼层桶护栏,取证见文件头 §1):
-- +575(6F-601):billing_term_unit 早已把 601 的租金行挂到 575,contract_unit 漏挂;
--   先例=力灏 192 补挂 368(NOT EXISTS 守卫)。
INSERT INTO contract_unit (contract_id, unit_id)
SELECT 198, 575 FROM DUAL
 WHERE NOT EXISTS (SELECT 1 FROM contract_unit WHERE contract_id=198 AND unit_id=575);
-- -566(天面):unit.floor=1 是脏值,留着 L1 会把楼层算成 {一楼,七楼}(丢六楼+多一楼);
--   天面空地租金走计费行 6804/6805 + billing_term_unit 335/336,不经 contract_unit,摘除无损。
DELETE FROM contract_unit WHERE contract_id=198 AND unit_id=566;
-- 手术后 L1(合同单元)= {六楼,七楼} = L2(水表 176/177)→ 六车间 rule 20/22 楼层桶零位移。

-- ══════════════════════════════════════════════════════════════════════════
-- §2 刘彪(tid 55)kVA 归位 —— 厂房链三段补 kva=15,壳合同 199 卸下
-- ──────────────────────────────────────────────────────────────────────────
UPDATE contract SET
    kva    = 15.00,
    remark = LEFT(CONCAT(COALESCE(remark,''),
             CASE WHEN remark IS NULL OR remark='' THEN '' ELSE ' | ' END,
             'kVA=15 归位(2026-08-09):依2024-02二期册刘彪!I5「15千伏安」×22.6=339 实收;',
             '纸约70千伏安不一致,照册面收待核(同力灏22.6vs纸约23先例)'), 255)
  WHERE id IN (368,369,221) AND tenant_id=55 AND kva IS NULL;

UPDATE contract SET
    kva    = NULL,
    remark = LEFT(CONCAT(COALESCE(remark,''),
             CASE WHEN remark IS NULL OR remark='' THEN '' ELSE ' | ' END,
             'kva=15 已移挂厂房链368/369/221(2026-08-09),壳合同卸下,防日后补日期双收容量费'), 255)
  WHERE id=199 AND tenant_id=55 AND kva=15.00;

-- ══════════════════════════════════════════════════════════════════════════
-- §3 星州(22)/永龙(23)mgmt 0.15 —— 已在册(断言12),幂等守卫,预期 0 行插入
-- ──────────────────────────────────────────────────────────────────────────
-- 口径与包干先例(cfg 48~90)同:acct_month=''(常数),scope='tenant:<id>'。
-- 现行批次已按 0.15 出账(行级证据见文件头 §3);本段仅保证脚本可在空库/回滚后重放。
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note)
SELECT s.scope, s.cfg_key, '', 0.15000000, s.note FROM (
  SELECT 'tenant:22' scope, 'mgmt_fee_commercial' cfg_key, '星州 户级管理费0.15(§2.5)' note
  UNION ALL SELECT 'tenant:22', 'mgmt_fee',            '星州 户级管理费0.15(§2.5)'
  UNION ALL SELECT 'tenant:23', 'mgmt_fee_commercial', '永龙 户级管理费0.15(§2.5)'
  UNION ALL SELECT 'tenant:23', 'mgmt_fee',            '永龙 户级管理费0.15(§2.5)') s
 WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg t
                    WHERE t.scope=s.scope AND t.cfg_key=s.cfg_key AND t.acct_month='');

COMMIT;

-- ══════════════════════════════════════════════════════════════════════════
-- §验证段(执行后立即跑;重生成后另跑 §重生成对账)
-- ══════════════════════════════════════════════════════════════════════════
SELECT '验01 合同198 = 2022-09-16~2031-09-15、remark 含「真实合同补日期」(期望 1)' k,
       COUNT(*) v FROM contract
 WHERE id=198 AND sign_date='2022-09-16' AND start_date='2022-09-16' AND end_date='2031-09-15'
   AND remark LIKE '%真实合同补日期%'
UNION ALL SELECT '验02 合同198 覆盖台账末月 2025-10(期望 1)', COUNT(*) FROM contract
 WHERE id=198 AND start_date<='2025-10-31' AND end_date>='2025-10-01'
UNION ALL SELECT '验03 合同198 单元 = {575,576},566 已摘(期望 2)',
 COUNT(*) FROM contract_unit WHERE contract_id=198 AND unit_id IN (575,576)
UNION ALL SELECT '验04 合同198 不再挂 566(期望 0)',
 COUNT(*) FROM contract_unit WHERE contract_id=198 AND unit_id=566
UNION ALL SELECT '验05 合同198 计费行仍 7 条一条未动(期望 7)',
 COUNT(*) FROM contract_billing_term WHERE contract_id=198
UNION ALL SELECT '验06 刘彪 368/369/221 三段 kva=15(期望 3)',
 COUNT(*) FROM contract WHERE id IN (368,369,221) AND kva=15.00
UNION ALL SELECT '验07 壳合同199 kva 已卸(期望 1)',
 COUNT(*) FROM contract WHERE id=199 AND kva IS NULL
UNION ALL SELECT '验08 星州/永龙 0.15 例外恰 4 条无重复(期望 4)',
 COUNT(*) FROM tenant_price_cfg
 WHERE scope IN ('tenant:22','tenant:23') AND cfg_key IN ('mgmt_fee','mgmt_fee_commercial')
   AND acct_month='' AND cfg_value=0.15000000;

-- ══════════════════════════════════════════════════════════════════════════
-- §期望值总表(执行本脚本 + POST /api/bill-notices/generate?ym=2024-02 之后)
-- ──────────────────────────────────────────────────────────────────────────
--   项目                        金额        构成 / 依据(册面原格)
--   ────────────────────────  ──────────  ────────────────────────────────────────
--   基线(断言01)             3,934,541.57  297 单,批次 BN20260809191227
--   + 罗立剑 租金块          +162,853.44  110,679.10+36,407.60+13,106.74+1,200+500+560+400
--                                          (计费行 7 条 × 全月;免租期无)
--   + 罗立剑 容量费          + 11,300.00  500×22.6,册面 罗立剑!K5=11300 **逐格全等锚**
--   + 罗立剑 二期园区级池    +    110.67  路灯 7377.52×0.005=36.89(册 36.41,Δ+0.48)
--     (area 名册自动收编)                 + 绿化水 7377.52×0.01=73.78(册 72.82,Δ+0.96)
--                                          Δ因=分摊面积含天面空地 96㎡(BUILDING_RENT_KEYS
--                                          收全部 rent_factory 行),册面按 7281.52 算;
--                                          物业口径孰是待拍板,本刀不设户级例外
--   + 罗立剑 二期消防池      + ~110.66    0.015×7377.52(册面罗立剑 sheet **无**此行;
--     (±14.05 小池)                        星州/永龙/力灏单均有,预计入池;另一消防小池
--                                          14.05/户 是否收编,以重生成为准)
--   ± 罗立剑 六车间楼层桶    +      0.00  单元手术后 L1={六楼,七楼}=L2,fire 160.56 /
--                                          elevator 331.92 应原位不动(锚:base_snap 仍 2.00)
--   ± 罗立剑 损耗            +      0.00  损耗基数=场地电费+楼栋级 floor/elevator/fire,
--                                          不含租金/容量/园区级池 → 247.20 不动
--   + 刘彪 容量费            +    339.00  15×22.6,册面 刘彪!K5=339 **逐格全等锚**;
--                                          单 5257: 24,423.42 → 24,762.42
--   ± 星州/永龙 0.15         +      0.00  例外已在册已生效,幂等段 0 行插入
--   ────────────────────────  ──────────
--   期望总额                 ≈ 4,109,255 ± 125(消防两池不确定项 110.66+14.05)
--     下界 4,109,144.68(仅路灯+绿化) / 上界 4,109,269.39(消防两池全收编)
--   期望单数                 = 297 + 1±(罗立剑租金组若按收款公司拆新单则 +1;
--                              该户 rent 类费项无 bill_pay_company 映射,warn 会保留)
--
--   罗立剑户级合计 ≈ 10,114.87 → ≈184,490(**必须人工过目**,与力灏 37 万同为「补日期引爆」型)
--
-- ══════════════════════════════════════════════════════════════════════════
-- §重生成对账(五条)
-- ──────────────────────────────────────────────────────────────────────────
-- R1 罗立剑楼层桶零位移锚:重生成后 rule 20(消防)/22(电梯)中 tid 54 的行应仍是
--    base_snap=2.00、160.56/331.92 附近;若变成 3 桶或出现「楼层两源不一致」warn,
--    说明单元手术没生效或 566 摘除被绕过 —— 回滚排查。
-- R2 warn 消长:tid 54 的「缺起止日期,租金未派生」应消失;「有表未归属合同」预期消失
--    (厂房表 89/176/177 按楼栋对位绑 198;宿舍表绑 451~454 能否解 manual 以重生成为准);
--    「有费项未设置收款公司」会**保留并扩大**(rent 组新费项无 payMap)——不在本刀,另拍板。
-- R3 刘彪容量费锚:单 5257 新增 capacity 行 qty=15 price=22.60 amount=339.00,册面逐格全等。
--    刘彪既有缺口(楼层桶 38.5/72.59、路灯 6.74、绿化 13.48,因合同挂楼栋17「三期」不入
--    p2 名册)与本刀无关,不追。
-- R4 星州/永龙 mgmt 锚:mgmt_fee 行 price_snap=0.15、price_scope='tenant:22'/'tenant:23',
--    厂房段 16218×0.15=2,432.70 / 11977×0.15=1,796.55 应原位不动。
--    复核实证:册面两户维护费段就是 0.15×分时度数,与 dev 分位全等(见文件头 §3 更正)。
-- R5 总额残差:除期望值总表外的逐单位移必须能被 R1~R4 解释,解释不了就回滚。
--
-- ══════════════════════════════════════════════════════════════════════════
-- §回滚(未提交前直接 ROLLBACK;已提交则用备份恢复。以下仅作定位参考)
-- ──────────────────────────────────────────────────────────────────────────
-- UPDATE contract SET sign_date=NULL, start_date=NULL, end_date=NULL WHERE id=198;
-- DELETE FROM contract_unit WHERE contract_id=198 AND unit_id=575;
-- INSERT INTO contract_unit (contract_id, unit_id) VALUES (198, 566);
-- UPDATE contract SET kva=NULL  WHERE id IN (368,369,221);
-- UPDATE contract SET kva=15.00 WHERE id=199;
-- (§3 幂等段 0 行插入,无需回滚;remark 追加需按备份还原)
