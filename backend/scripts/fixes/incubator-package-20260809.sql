-- ════════════════════════════════════════════════════════════════════════════
-- 孵化协议固定收取(包干)口径落地 — 草稿,未执行(主会话审核后执行;禁直接在 dev 库试跑)
--
-- 源册:2025全年发生额、预算对比\2024年\2024年3月费用数据\2024年3月费用数据\
--       一期\一期2024年2月水电费.xlsx
--
-- 【结论】包干是「替换」不是「附加」,一张纸单一项一行:
--   电侧「公共用电分摊 xx元/月」吞掉 楼层公共、消防照明(F) + 电梯用电(H) + 路灯公摊(K) 三项;
--   水侧「公共用水分摊 xx元/月」吞掉 绿化水公摊(G) 一项。
--   损耗照收,且**损耗基数含包干额**(联塑精铟 K7=ROUND(0.0616×(43.8+232),2)=16.99 逐格全等)。
--   宿舍段照收(联塑精铟 K18 宿舍路灯 4.47 / K26 宿舍绿化水 1.49 仍在纸单上)。
--
-- 【水侧取证 — 钉死「替的是绿化水公摊,不是水管网维护费」】
--   ① 五户纸单水块都是「水表行 + 公共用水分摊 xx元/月」,无绿化水公摊行。
--   ② 各户 sheet 底部「2024年2月水、电数据汇总」把这笔钱记进「绿化水公摊」行:
--        联塑精铟 O62/P62=155 | 粤海华创 O45/P45=31.5 | 禹晨 O45/P45=42.54
--        优唯特 绿化水公摊=31.6 | 重瞳 O49/P49=53
--      同一张汇总的「用水维护费」行(O61/O44/O48…)全为 0。
--   ③「2024年2月水费总表」逐户对上(D=用水度数 E=户内水费 F=用水维护费 G=绿化水公摊):
--        R37 联塑精铟 F=0 G=155 | R39 粤海华创 F=0 G=31.5 | R42 精锐佳(=禹晨) F=0 G=42.54
--        R48 优唯特   F=0 G=31.6 | R52 重瞳    F=0 G=53
--   ④ ⚠ 水管网维护费**不在吞掉之列**:三张明细型纸单上它仍是活公式而非硬 0 ——
--        联塑精铟 I12==I11 J12=0.5 | 优唯特 G14=0 H14=0.5 | 重瞳 I14=0 J14=0.5。
--        本月为 0 只因户内用水量为 0(联塑精铟源册 I11==SUM(I10:I10) 还漏了女厕那 1 吨,是源册自身的
--        少加一行,不是口径)。故引擎侧只吞 share_green_water,water_pipe 原样按吨计。
--
-- 【落地方式】户级包干配置 + 派生时短路(BillNoticeService.applyPackages);零 DDL:
--   cfg_key = share_elec_fixed / share_water_fixed(scope='tenant:{id}',单位 元/月)。
--   ⚠ share_elec_fixed 是白名单里 elevator_package 的改名(建键时以为包干只替电梯);改名时该键全库 0 行。
--   出账行沿用 fee_key = share_elec_floor / share_green_water:BillFeeMap 收款映射不动,
--   且 E2 损耗基数白名单(floor|elevator|fire)自动把电包干额算进损耗基数。
--   包干行回挂 pool_rule_id → §5.9 按池回填 allocated/gap,复刻源册「公共电分摊明细」AE/AF 两列。
--
-- 【只录 5 户,不给帷幄/黄路生录】(用户问「按月失效 vs 只录5户,哪个干净」→ 选后者)
--   理由:① tenant_price_cfg 没有终止月字段,「按月失效」只能靠补一条 0 值月行,是要长期维护的
--   影子配置,且对该月之前的任何一个月都是错的;② 帷幄在 tenant 表里根本没有档案,写不出
--   'tenant:{id}';③ 黄路生 100 元只在分摊册 J28 的盈亏列出现,2024-02 无缴费单、电费/水费总表
--   均无该户行 —— 没有「当月实收」的证据。等这两户拿到证据再各补一条,比现在录了再想办法失效干净。
--   另:引擎侧「当月无在租合同=不落包干行」已是第二道闸(applyPackages 只遍历 covering 户)。
-- ════════════════════════════════════════════════════════════════════════════
SET NAMES utf8mb4;

-- ══════════ 0. 前置断言(任一不成立就别往下跑) ══════════
-- 期望依次:5 / 0 / 1(rule 92 manual) / 1(rule 32 area) / 0(禹晨尚不在 rule 32) / 0(联塑精铟尚不在 rule 92)
SELECT '断言1 五户档案齐(期望5)' k, COUNT(*) v FROM tenant WHERE id IN (266,116,118,122,359)
UNION ALL SELECT '断言2 改名前的 elevator_package 全库 0 行', COUNT(*) FROM tenant_price_cfg WHERE cfg_key='elevator_package'
UNION ALL SELECT '断言3 rule 92 在且 method=manual', COUNT(*) FROM alloc_rule WHERE id=92 AND method='manual' AND fee_key='share_elec_floor'
UNION ALL SELECT '断言4 rule 32 在且 fee_key=share_elec_floor', COUNT(*) FROM alloc_rule WHERE id=32 AND fee_key='share_elec_floor'
UNION ALL SELECT '断言5 禹晨尚不在 rule 32', COUNT(*) FROM alloc_rule_member WHERE rule_id=32 AND tenant_id=118
UNION ALL SELECT '断言6 联塑精铟尚不在 rule 92', COUNT(*) FROM alloc_rule_member WHERE rule_id=92 AND tenant_id=266;

START TRANSACTION;

-- ── ① 电包干:替 楼层公共、消防照明 + 电梯用电 + 路灯公摊 ────────────────────────
-- acct_month='' = 长期行;某月要改额度就再插一条该月行(常数键版本自动前滚,月行优先)。
-- ponytail: 无终止月字段,退出包干需插一条 0 值月行 —— 与既有 elec_package 例外同一天花板,
--           真要按合同期自动失效时再上 contract_billing_term,别为 5 户先建表。
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note) VALUES
  ('tenant:266', 'share_elec_fixed', '', 232.00000000, '联塑精铟 孵化协议公共用电包干 232元/月(源册 联塑精铟!K6;汇总 P53=232、电梯 P52=0、厂房路灯=0)'),
  ('tenant:116', 'share_elec_fixed', '',  47.20000000, '粤海华创 孵化协议公共用电包干 47.2元/月(源册 粤海华创!I6;汇总 X36=47.2、X35=0、X38=0)'),
  ('tenant:118', 'share_elec_fixed', '',  63.80000000, '禹晨(册名精锐佳) 孵化协议公共用电包干 63.8元/月(源册 禹晨!I6;汇总 X36=63.8、X35=0、X38=0)'),
  ('tenant:122', 'share_elec_fixed', '',  47.30000000, '优唯特 孵化协议公共用电包干 47.3元/月(源册 优唯特!I9)'),
  ('tenant:359', 'share_elec_fixed', '',  79.45000000, '重瞳 孵化协议公共用电包干 79.45元/月(源册 重瞳!K8;汇总 X40=79.45、X39=0、X42=0)')
ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value), note = VALUES(note);

-- ── ② 水包干:替 绿化水公摊(取证见抬头 §水侧;水管网维护费不在其内) ─────────────
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note) VALUES
  ('tenant:266', 'share_water_fixed', '', 155.00000000, '联塑精铟 孵化协议公共用水包干 155元/月(源册 联塑精铟!K13;水费总表 R37 G=155 F=0)'),
  ('tenant:116', 'share_water_fixed', '',  31.50000000, '粤海华创 孵化协议公共用水包干 31.5元/月(源册 粤海华创!I10;水费总表 R39 G=31.5 F=0)'),
  ('tenant:118', 'share_water_fixed', '',  42.54000000, '禹晨(册名精锐佳) 孵化协议公共用水包干 42.54元/月(源册 禹晨!I10;水费总表 R42 G=42.54 F=0)'),
  ('tenant:122', 'share_water_fixed', '',  31.60000000, '优唯特 孵化协议公共用水包干 31.6元/月(源册 优唯特!I15;水费总表 R48 G=31.6 F=0)'),
  ('tenant:359', 'share_water_fixed', '',  53.00000000, '重瞳 孵化协议公共用水包干 53元/月(源册 重瞳!K15;水费总表 R52 G=53 F=0)')
ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value), note = VALUES(note);

-- 帷幄:源册 分摊册 I22=31,tenant 表无「帷幄」档案(写不出 scope),且当月无缴费单/无总表行。
-- 黄路生(tenant 392,status=2 已退租):分摊册 I28=100,同样无缴费单、电费/水费总表无该户行。
-- 两户都等拿到「当月实收」证据再补;见抬头【只录 5 户】。

-- ── ③ 池锚点:包干行要挂回该户的楼层公摊池,§5.9 才能把包干额回填进池的 AE 列 ──────
-- ⚠ alloc_rule_member 没有 note 列(id/rule_id/tenant_id/weight/acct_month),两条行的用途只能写在
--   这里与 rule.note 上(见 ④)。
-- ③a 禹晨补 rule 32 受益人 —— 这条是**真·补漏**,不只是锚点:
--     源册「公共电分摊明细」Z19 受益人原文=「精锐佳、重瞳、炳记、林观平」,禹晨=精锐佳(面积 212.68 全等),
--     库里 rule 32 只有 林观平/炳记运输/重瞳 → 禹晨当月既无 floor 行也无电梯行。
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month) VALUES (32, 118, NULL, '')
ON DUPLICATE KEY UPDATE weight = VALUES(weight);
-- ③b 联塑精铟挂 rule 92 —— 这条**仅作包干行 pool_rule_id 锚点**:rule 92 是 method='manual' 的无表池
--     (§H4.2e 早退,memberAmounts 的 switch 落 default 不产贡献行),加成员不会多出任何一条公摊行;
--     加它只是让 applyPackages 查得到「该户的 share_elec_floor 池」(源册 r12 的 AE12=AF12=232 就是它)。
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month) VALUES (92, 266, NULL, '')
ON DUPLICATE KEY UPDATE weight = VALUES(weight);

-- ── ④ 别名与规则备注 ──────────────────────────────────────────────────────
-- 禹晨的册名是「精锐佳」(纸单 A5=精锐佳电、A9=精锐佳水;水费总表 R42 抬头也是精锐佳),
-- 导入/对账按 aliases 三主径匹配(V86),不补这条以后重导会再走一次「待核」。
UPDATE tenant SET aliases = TRIM(BOTH ',' FROM CONCAT(COALESCE(aliases,''), ',精锐佳'))
  WHERE id = 118 AND COALESCE(aliases,'') NOT LIKE '%精锐佳%';

-- 复核提的 NULL 坑:note 为 NULL 时 `note NOT LIKE '%x%'` 恒为 NULL(非 TRUE),WHERE 直接筛掉该行 →
-- 幂等判据失效且首次也更新不到。用 COALESCE(note,'') 兜住。
UPDATE alloc_rule SET note = CONCAT(COALESCE(note,''), ';包干口径:该户按孵化协议 232元/月固定收取,',
  '出账时由 tenant_price_cfg tenant:266.share_elec_fixed 落一行并回挂本池(源册 AE12=AF12=232 手输常数)')
WHERE id = 92 AND COALESCE(note,'') NOT LIKE '%包干口径%';

COMMIT;

-- ══════════ 5. 验证段(逐条对期望值) ══════════
SELECT '验1 电包干 5 行,合计 469.75' k, COUNT(*) n, ROUND(SUM(cfg_value),2) amt
  FROM tenant_price_cfg WHERE cfg_key='share_elec_fixed';
SELECT '验2 水包干 5 行,合计 313.64' k, COUNT(*) n, ROUND(SUM(cfg_value),2) amt
  FROM tenant_price_cfg WHERE cfg_key='share_water_fixed';
-- 验3:五户的电包干锚点=该户 share_elec_floor 池 sort_no 最小者(期望 266→92 / 116→33 / 122→33 / 118→32 / 359→32)
SELECT '验3 池锚点' k, m.tenant_id, MIN(r.sort_no) min_sort,
       SUBSTRING_INDEX(GROUP_CONCAT(r.id ORDER BY r.sort_no), ',', 1) anchor_rule
  FROM alloc_rule_member m JOIN alloc_rule r ON r.id=m.rule_id
 WHERE m.tenant_id IN (266,116,118,122,359) AND r.fee_key='share_elec_floor'
   AND m.acct_month IN ('','2024-02')
 GROUP BY m.tenant_id;
SELECT '验4 禹晨别名含精锐佳(期望1)' k, COUNT(*) v FROM tenant WHERE id=118 AND aliases LIKE '%精锐佳%';
SELECT '验5 rule 92 备注已写包干口径(期望1)' k, COUNT(*) v FROM alloc_rule WHERE id=92 AND note LIKE '%包干口径%';

-- ══════════ 6. 重生成 2024-02 后必做的对账(POST /api/bill-notices/generate?ym=2024-02) ══════════
-- ① 联塑精铟(266):share_elec_floor 一条 232.00(pool_rule_id=92)、share_green_water 一条 155.00
--    (pool_rule_id=100)、share_elec_light 消失;share_elec_loss = ROUND((43.80+232.00)×0.0616,2)=16.99
--    ← 与源册 联塑精铟!K7 逐格全等,这是本刀的红线锚点。
-- ② 优唯特(122):损耗基数 26.53+47.30=73.83、损耗 4.55 ← 源册 优唯特!G10/I10 全等。
-- ③ 禹晨(118) 损耗基数 20.95+63.80=84.75、重瞳(359) 170.26、粤海华创(116) 221.24
--    ← 分别与源册 禹晨!G7 / 重瞳!I9 / 粤海华创!G7 全等(这三户源册损耗率硬置 0、库里按 0.0616 收,
--      是**另一刀**「户级损耗率例外」,本刀不碰;基数对上即说明包干额进对了地方)。
-- ④ 池侧:rule 92 allocated 由 0 → 232.00(源册 AE12);rule 33/34/40 的 allocated 各减去这几户原来的份额,
--    gap 走负 —— 那不是数据质量告警,就是源册「公共电分摊明细」AF 列的「盈/亏」。
--
-- ══════════ 回滚 ══════════
-- DELETE FROM tenant_price_cfg WHERE cfg_key IN ('share_elec_fixed','share_water_fixed');
-- DELETE FROM alloc_rule_member WHERE rule_id=32 AND tenant_id=118 AND acct_month='';
-- DELETE FROM alloc_rule_member WHERE rule_id=92 AND tenant_id=266 AND acct_month='';
-- UPDATE tenant SET aliases=NULLIF(REPLACE(CONCAT(',',aliases,','), ',精锐佳,', ','),'') WHERE id=118;  -- 手工核对后再跑
-- UPDATE alloc_rule SET note=SUBSTRING_INDEX(note, ';包干口径:', 1) WHERE id=92;
