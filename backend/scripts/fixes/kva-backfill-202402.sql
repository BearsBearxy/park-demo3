-- kva-backfill-202402.sql
-- 依据 2024-02 对账报告(scripts/verify_bill_notice_202402_report.txt L362-381 容量类"整类缺失")
-- 用户拍板口径: Excel 通知单 容量费金额 ÷ 22.6 反推 kVA(Excel I 列同时明示 kVA,均与反推一致)
-- 源册:
--   一期: 2025全年发生额、预算对比/2024年/2024年3月费用数据/2024年3月费用数据/一期/一期2024年2月水电费.xlsx
--   二期: .../二期/二期2024年2月水电费.xlsx
-- 引擎口径: BillNoticeService 容量费只认 起止日期齐全 的合同(MeterBindingService.covers L264);
--          故回填目标 = 覆盖 2024-02 的带日期在租合同(排 master_lease), 且 kva IS NULL 才改。
-- 所有 UPDATE 户起租日均早于 2024-01, 2024-02 为整月, 金额均为 22.6 整数倍, 无按天折疑义。
-- 执行前请先跑文末核对 SELECT。

-- ── 吴耀兰(tid151, Excel sheet 名=老板别名"吴跃平") 一期!吴跃平!K5=226 ÷22.6=10 (I5='10千伏安')
UPDATE contract SET kva = 10   WHERE id = 22  AND tenant_id = 151 AND kva IS NULL;  -- S10-0022 2023-11-01~2026-07-18

-- ── 陈相钊(tid133) 一期!陈相钊!K5=1130 ÷22.6=50 (I5='50千伏安')
UPDATE contract SET kva = 50   WHERE id = 18  AND tenant_id = 133 AND kva IS NULL;  -- S10-0018 2023-07-17~2029-07-16

-- ── 李卓伦(tid135) 一期!李卓伦!K5=339 ÷22.6=15 (I5='15千伏安')
UPDATE contract SET kva = 15   WHERE id = 19  AND tenant_id = 135 AND kva IS NULL;  -- S10-0019 2023-11-24~2025-11-23

-- ── 彭健宜(tid159) 一期!彭健宜!K5=565 ÷22.6=25 (I5='25千伏安')
UPDATE contract SET kva = 25   WHERE id = 331 AND tenant_id = 159 AND kva IS NULL;  -- S10-0077#1 2023-10-07~2026-10-06

-- ── 彭小兰(tid164) 一期!彭小兰!K5=587.6 ÷22.6=26 (I5='26千伏安')
UPDATE contract SET kva = 26   WHERE id = 336 AND tenant_id = 164 AND kva IS NULL;  -- S10-0082#1 2023-11-24~2026-11-23

-- ── 顺心鸿(tid370) 一期!顺心鸿!K5=226 ÷22.6=10 (I5='10千伏安')
UPDATE contract SET kva = 10   WHERE id = 393 AND tenant_id = 370 AND kva IS NULL;  -- C2024M-033 2023-07-01~2025-06-30

-- ── 碧沃丰(tid103) 一期!碧沃丰!K5=6780 ÷22.6=300 (I5='300千伏安')
--    tid103 另有无日期合同 cid4(S10-0004, 同楼栋 b20 同面积 3200, kva NULL)=旧档影子, 不动它。
UPDATE contract SET kva = 300  WHERE id = 131 AND tenant_id = 103 AND kva IS NULL;  -- S10-0131 2023-11-01~2026-10-31

-- ── 银纳(tid100) 一期!银纳!K5=1514.2 ÷22.6=67 (I5='67千伏安')
--    kva=67 现挂在无日期合同 cid2(S10-0002, b23/u297, area 744.85)上, 引擎不可见;
--    带日期合同 cid52(b39/u591, area 同为 744.85)=楼栋重建后同一场地, 故回填到 cid52。
--    ⚠ 若日后给 cid2 补日期, 须先清 cid2.kva 防双算。
UPDATE contract SET kva = 67   WHERE id = 52  AND tenant_id = 100 AND kva IS NULL;  -- S10-0052 2022-12-26~2025-12-25

-- ── 中科华贸(tid14) 二期!中科华贸!K35=565 ÷22.6=25 (I35='25千伏安')
--    唯一在租合同 cid219(S10-0219) 起止日期为 NULL → 本回填后引擎仍不可见,
--    容量费落地还需另补起止日期(date_missing 缺口, 不在本脚本范围)。
UPDATE contract SET kva = 25   WHERE id = 219 AND tenant_id = 14  AND kva IS NULL;  -- S10-0219 日期NULL

-- ══ 待核清单(不猜, 本脚本不动) ══
-- 以下户 kva 已在库且与 Excel 反推一致, 缺的是合同起止日期(covers() 拒 NULL 日期), 不属 kva 回填:
--   刘彪   tid55  cid199 S10-0199 kva=15  已有 | Excel 二期!刘彪!K5=339÷22.6=15; 另一带日期合同
--          cid368(b17, 一期场地)非容量所在场地, 不能把 15 填过去 → 应给 cid199 补日期。
--   力灏   tid48  cid192 S10-0192 kva=400 已有 | Excel 二期!力灏!K5=9040÷22.6=400 → 补日期。
--   罗立剑 tid54  cid198 S10-0198 kva=500 已有 | Excel 二期!罗立剑!K5=11300÷22.6=500 → 补日期。
--          三链逐链核过: cid451(S10-0198A#1, 2023-12-22起) / cid452(S10-0198B#1, 2024-01-06起) /
--          cid453(S10-0198C#1, 2024-02-22起) 均为 b29 小面积短租(146/45/73㎡), Excel 仅一行
--          500kVA 整数反推且与 cid198 主场地既有值吻合 → 三链不挂 kva, 不拆分。
--   汤周杰 tid131 cid16  S10-0016 kva=250 已有 | Excel 一期!汤周杰!K5=5650÷22.6=250; 另一带日期
--          合同 cid64(b29 另一场地)不能确定是容量所在场地 → 应给 cid16 补日期, 不填 cid64。
--   优硕达 tid163 cid30  S10-0030 kva=10  已有 | Excel 一期!优硕达!K5=226÷22.6=10; 且该 sheet
--          在对账中未匹配到租户(报告 L5) → 补日期 + 名称匹配两个缺口。

-- ══ 核对 ══
-- 预期 9 行受影响; 复查:
-- SELECT id, tenant_id, contract_no, start_date, end_date, kva FROM contract
--  WHERE id IN (22,18,19,331,336,393,131,52,219);
