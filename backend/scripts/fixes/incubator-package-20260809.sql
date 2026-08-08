-- 孵化协议固定收取(包干)口径落地 — 草稿,未执行
-- 取证:一期2024年2月水电费.xlsx「一期租户分摊公共用电金额」I列 + 各户「缴费通知单」sheet
-- 结论:包干是"替换",一张纸单只留一行「公共用电分摊 xx元/月」,
--       楼层公共/消防照明(F)、电梯(H)、路灯公摊(K) 三项全部不再单独计费。
-- 前置:mysqldump 备份;主会话审核后执行。禁止直接在 dev 库上试跑。

-- ── ① 户级包干配置(复用 tenant_price_cfg,与 elec_package 同一条例外轨道) ──────────
-- acct_month='' = 长期行;某月要改额度就再插一条该月行(月行优先,与 alloc_cfg 同口径)。
-- ponytail: 无终止月字段,退出包干需插一条 0 值月行 —— 与既有 elec_package 例外同一天花板,
--           真需要按合同期自动失效时再上 contract_billing_term,别为 7 户先建表。
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note) VALUES
  ('tenant:266', 'share_elec_fixed', '', 232.00000000, '联塑精铟 孵化协议公共用电包干 232元/月,替换楼层公共+电梯+路灯(源册 zh!I6 / 联塑精铟!K6)'),
  ('tenant:116', 'share_elec_fixed', '',  47.20000000, '粤海华创 孵化协议公共用电包干 47.2元/月(源册 zh!I26 / 粤海华创!I6)'),
  ('tenant:118', 'share_elec_fixed', '',  63.80000000, '禹晨(册名精锐佳) 孵化协议公共用电包干 63.8元/月(源册 zh!I20 / 禹晨!I6)'),
  ('tenant:122', 'share_elec_fixed', '',  47.30000000, '优唯特 孵化协议公共用电包干 47.3元/月(源册 zh!I27 / 优唯特!I9)'),
  ('tenant:359', 'share_elec_fixed', '',  79.45000000, '重瞳 孵化协议公共用电包干 79.45元/月(源册 zh!I24 / 重瞳!K8)')
ON DUPLICATE KEY UPDATE cfg_value = VALUES(cfg_value), note = VALUES(note);

-- 黄路生(tenant 392, status=2 已退租):源册 zh!I28=100,但 2024-02 无缴费单 sheet、
-- 「2024年2月电费总表」无该户行 → 当月未实收。生效月待用户确认后再放开。
-- INSERT ... ('tenant:392', 'share_elec_fixed', '', 100.00000000, '黄路生 包干 100元/月(生效月待定)');

-- 帷幄:源册 zh!I22=31,租户档案不存在(tenant 表无「帷幄」),同样无缴费单/无总表行。
-- 需先决定是否补档(见 md §4),补档后再补本条配置。

-- ── ② 水包干(同一份纸单上的第二个包干,本轮不落,仅登记待拍板) ────────────────
-- 联塑精铟 155 / 粤海华创 31.5 / 禹晨 42.54 / 优唯特 31.6 / 重瞳 53 元/月
-- (源册 各户 sheet「公共用水分摊」行)。等电包干验收后同机制走 share_water_fixed。

-- ── ③ 受益人补漏:禹晨缺 A座四楼东侧公共池成员 ─────────────────────────────
-- 源册 公共电分摊明细!Z19 = 「精锐佳、重瞳、炳记、林观平」,禹晨=精锐佳(面积 212.68 全等),
-- 但 alloc_rule_member 里 rule 32 只有 林观平/炳记运输/重瞳 → 禹晨当月既无 floor 行也无电梯行。
-- 包干行要挂回该户的楼层公摊池(见 md §3),缺这条成员就没有落点。
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month) VALUES (32, 118, NULL, '')
ON DUPLICATE KEY UPDATE weight = VALUES(weight);

-- ── ④ 规则备注:把包干口径写进 rule 92 / rule 40,别只活在代码注释里 ───────────
UPDATE alloc_rule SET note = CONCAT(IFNULL(note,''), ';包干口径:该户按孵化协议 232元/月固定收取,',
  '出账时由 tenant_price_cfg tenant:266.share_elec_fixed 落一行并回挂本池(源册 AE12=AF12=232 手输常数)')
WHERE id = 92 AND note NOT LIKE '%包干口径%';

-- ── 回滚 ──────────────────────────────────────────────────────────────────
-- DELETE FROM tenant_price_cfg WHERE cfg_key='share_elec_fixed';
-- DELETE FROM alloc_rule_member WHERE rule_id=32 AND tenant_id=118 AND acct_month='';
