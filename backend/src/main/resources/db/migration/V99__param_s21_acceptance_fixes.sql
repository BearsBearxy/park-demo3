-- V99 S21 验收后两处数据修正(spec §10 ②/⑦):
-- 1) 力美C201电 剔出 C座 总表/分表合计的起始月 = 2023-09(源册:一期 2023-08 C座分表Σ 未剔;09 起 `=SUM(S104:S132)-S117`,
--    p1_synthesis.md §1.1 D 列)。原 '' 初始版本行对 2023-08 也生效 → C座 2023-08 率 0.0057 ≠ 源册 0.0033(D 差 293.00)。
--    改为「2023-09 起长期」:2023-08 回到计入;2023-10/2024-02 不变(仍剔除,红线不动)。按表名定位,不写死 id。
UPDATE alloc_cfg c JOIN meter m ON c.scope = CONCAT('meter:', m.id)
   SET c.acct_month = '2023-09', c.mode = 'from',
       c.note = '抄表册段落Σ剔除行,不入损耗C/D:力美C201电 —— 源册 2023-09 起剔除(08 仍计入),S21 验收版本化'
 WHERE m.name = '力美C201电' AND c.cfg_key = 'loss_exclude' AND c.acct_month = '' AND c.mode = 'from';
-- 2) 备注里的内部标识(rule:/tenant:/dorm)改人话:这些 note 会在页面历史/变更抽屉与公共电核算备注列原样上屏(review_frontend M7)
UPDATE alloc_rule SET note = REPLACE(note, '|S21:默认扣度归0,扣度走 rule:{id}.extra_qty 月行', '｜S21：默认扣度归 0，当月扣度在「计费参数」页按月填') WHERE note LIKE '%S21:默认扣度归0%';
UPDATE tenant_price_cfg SET note = '水管网维护费默认;宿舍无管网费(宿舍区行为 0)' WHERE scope = '' AND cfg_key = 'water_pipe' AND acct_month = '';
UPDATE tenant_price_cfg SET note = 'S13§3 曹小芳 消防照抄实收175.48(L24+L99合成价250.68×0.7,2023 冻结参数见公共电核算「分摊标准」披露;拍板③)'
 WHERE cfg_key = 'fire_amount_fixed' AND note LIKE '%alloc_cfg rule:%';
UPDATE alloc_cfg SET note = '一期绿化水单价=水3.95+管0.50(S5 §3.1,与户级水价 4.45 例外同值)' WHERE scope = 'rule:100' AND cfg_key = 'price_override' AND acct_month = '';
INSERT INTO param_change_log (actor, tbl, scope, cfg_key, acct_month, mode, note, action)
  SELECT 'migrate', 'alloc', c.scope, 'loss_exclude', '2023-09', 'from', 'V99 力美C201电 剔除起始月版本化为 2023-09', 'migrate'
    FROM alloc_cfg c JOIN meter m ON c.scope = CONCAT('meter:', m.id) WHERE m.name = '力美C201电' AND c.cfg_key = 'loss_exclude';
