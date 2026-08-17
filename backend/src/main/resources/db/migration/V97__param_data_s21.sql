-- V97__param_data_s21.sql — S21 计费参数中心 数据修正(S21-PARAM-CENTER-SPEC §2.4/§7.3):
-- ⓪ 池默认列归一:alloc_rule.coefficient/extra_qty 两列退出引擎——非空默认值搬成 alloc_cfg rule:{id} 的 '' from 行
--    (初始版本;已有 '' 行不覆盖),随后两列置 NULL/0 并改列注释(不 DROP,种子/测试仍写该列)。引擎同批改为只读参数表
--    (AllocService.coefficientOf/poolExtra),故迁移前后各月 base_snap/extra_qty_snap 一格不变。
-- ① 招商中心净电(rule 23,原册 r8):默认扣度 −670 归 0(它对所有月生效,是 2023-08 G 差 670÷6 的病根);
--    扣度改月参 rule:23.extra_qty:2023-12 −1470(源册 公共电分摊明细!N8=-800-670)、2024-02 −670(V65 已有月行)。
-- ② 一期 B/C 座损耗口径版本化:'' 行改 0(净额式,源册 08 公式/09-10 手工率),2023-11 起 = 1(纯公摊,源册 11/12 月
--    I=ROUND(G/C,4)+H,2024-02 同)。已生成 2024-02 取 2023-11 版本=1 与迁移前相同;G座(25)不动。
-- ③ 二期:loss_denom_cable p2 ''=1(2023-08/09 源册 G5=ROUND(F5/(C5+C6+C7+D6),4) 分母含铝缆),2023-10 起=0;
--    一车间 loss_head ''=五车间(08 跟五车间 I4=I8 / 09 与五车间联算),2023-10 起=自身(独立核算 F4=E4-C4)。
--    loss_denom_cable 是新键,引擎在 Task 6 才消费;先落行无害。
-- ④ A座电梯面积基数版本链(源册 公共电分摊明细!AA27 五月四值 + 2024-02):'' 14818.35 / 2023-09 12957.7 /
--    2023-10 12027.34(10、11 月同值) / 2023-12 12624.4 / 2024-02 12487.04(原 '' 行值)。已生成 2024-02 取值不变。
-- ⑤ 死行/退役键:green_rate_live/lamp_rate_live(BillNoticeService 已不分流,S13)、dorm.loss_rate(引擎不消费)、
--    p2.lamp_rate/p2.green_rate zone 行(引擎只认户级 tenant: 命中)、alloc_cfg price_norm/sharp/peak/valley(库中本无行)。
--    ⚠ p1.price_flat / p2.price_loss 两行**本迁移不删**:lossPrice()/ruleCostAmount() 仍在读,删了损耗费单价即空
--    → 户级损耗行全部消失。随 Task 6「损耗价/对账价改走价目簿月价」的迁移(V98)同批删。
-- 每条 UPDATE/INSERT 在空种子库上同样成立(INSERT IGNORE / 无行 UPDATE 不报错 / 名字查不到即 0 行)。

-- ── ⓪ 池默认列归一 ─────────────────────────────────────────────────────────
INSERT IGNORE INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note)
  SELECT CONCAT('rule:', id), 'coefficient', coefficient, '', 'from', 'S21:自 alloc_rule.coefficient 列迁入(初始版本)'
  FROM alloc_rule WHERE coefficient IS NOT NULL;
-- 招商中心净电按 book_key 识别(V80 落的原册 A 列自然键,与 V84 同源;不硬编码 id):它的默认扣度归 0 不搬,见 ①
INSERT IGNORE INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note)
  SELECT CONCAT('rule:', id), 'extra_qty', extra_qty, '', 'from', 'S21:自 alloc_rule.extra_qty 列迁入(初始版本)'
  FROM alloc_rule WHERE extra_qty <> 0 AND NOT (zone = 'p1' AND book_key = '招商中心电1');
UPDATE alloc_rule SET coefficient = NULL, extra_qty = 0;
ALTER TABLE alloc_rule
  MODIFY coefficient DECIMAL(12,2) NULL COMMENT 'S21 退出引擎:分母只存 alloc_cfg rule:{id}.coefficient 版本链(本列仅历史,恒 NULL)',
  MODIFY extra_qty  DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'S21 退出引擎:加度只存 alloc_cfg rule:{id}.extra_qty 版本链(本列仅历史,恒 0)';

-- ── ① 招商中心净电:默认扣度归 0(上面已置 0),扣度走月参 ────────────────────────
UPDATE alloc_rule SET note = CONCAT(IFNULL(note, ''), '|S21:默认扣度归0,扣度走 rule:{id}.extra_qty 月行')
WHERE zone = 'p1' AND book_key = '招商中心电1';
INSERT IGNORE INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note)
  SELECT CONCAT('rule:', id), 'extra_qty', -1470, '2023-12', 'month', '2023-12 源册 公共电分摊明细!N8=-800-670'
  FROM alloc_rule WHERE zone = 'p1' AND book_key = '招商中心电1';

-- ── ② 一期 B/C 座 loss_variant 版本化(按楼栋名定位,V65 同法) ───────────────────
UPDATE alloc_cfg c JOIN building b ON c.scope = CONCAT('building:', b.id)
  SET c.cfg_value = 0, c.note = 'S21:2023-10 及以前净额式(源册 08 公式/09-10 手工率)'
WHERE b.name IN ('一期 B座', '一期 C座') AND c.cfg_key = 'loss_variant' AND c.acct_month = '' AND c.mode = 'from';
INSERT IGNORE INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note)
  SELECT CONCAT('building:', b.id), 'loss_variant', 1, '2023-11', 'from',
         CONCAT('源册 2023-11 起 ', SUBSTRING_INDEX(b.name, ' ', -1), ' I=ROUND(G/C,4)+H')
  FROM building b WHERE b.name IN ('一期 B座', '一期 C座');

-- ── ③ 二期:分母含铝缆 08/09;一车间 08/09 并入五车间,10 起独立 ─────────────────
INSERT IGNORE INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note) VALUES
  ('p2', 'loss_denom_cable', 1, '',        'from', '二期 2023-08/09 源册 G5=ROUND(F5/(C5+C6+C7+D6),4) 分母含铝缆'),
  ('p2', 'loss_denom_cable', 0, '2023-10', 'from', '2023-10 起分母只取总表');
INSERT IGNORE INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note)
  SELECT CONCAT('building:', b1.id), 'loss_head', b5.id, '', 'from', '一车间 08 跟五车间(I4=I8)/09 与五车间联算'
  FROM building b1 JOIN building b5 ON b5.name = '二期 五车间' WHERE b1.name = '二期 一车间';
INSERT IGNORE INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note)
  SELECT CONCAT('building:', b1.id), 'loss_head', b1.id, '2023-10', 'from', '2023-10 起一车间独立核算 F4=E4-C4'
  FROM building b1 WHERE b1.name = '二期 一车间';

-- ── ④ 电梯面积基数版本链:原 '' 行(12487.04)改为 2024-02 版本,补 2023 四值 ────────
DELETE FROM tenant_price_cfg WHERE scope = 'p1' AND cfg_key = 'elevator_area_base' AND acct_month = '';
INSERT IGNORE INTO tenant_price_cfg (scope, cfg_key, acct_month, mode, cfg_value, note) VALUES
  ('p1', 'elevator_area_base', '',        'from', 14818.35, '2023-08 源册 公共电分摊明细!AA27'),
  ('p1', 'elevator_area_base', '2023-09', 'from', 12957.70, '2023-09 AA27'),
  ('p1', 'elevator_area_base', '2023-10', 'from', 12027.34, '2023-10/11 AA27'),
  ('p1', 'elevator_area_base', '2023-12', 'from', 12624.40, '2023-12 AA27'),
  ('p1', 'elevator_area_base', '2024-02', 'from', 12487.04, 'A座电梯面积基数(历史计费面积,原表硬编码) (POOL-FORMULA-AUDIT);S21 起为 2024-02 版本');

-- ── ⑤ 死行/退役键 ────────────────────────────────────────────────────────
DELETE FROM tenant_price_cfg WHERE cfg_key IN ('green_rate_live', 'lamp_rate_live');
DELETE FROM tenant_price_cfg WHERE cfg_key = 'loss_rate' AND scope = 'dorm';
DELETE FROM tenant_price_cfg WHERE scope = 'p2' AND cfg_key IN ('lamp_rate', 'green_rate');
DELETE FROM alloc_cfg WHERE cfg_key IN ('price_norm', 'price_sharp', 'price_peak', 'price_valley');

-- ── 日志(migrate 一条总记录 + 搬入的版本行逐条) ──────────────────────────────
INSERT INTO param_change_log (actor, tbl, scope, cfg_key, acct_month, mode, note, action)
  VALUES ('migrate', 'alloc', '', '', '', 'from', 'V97 S21 数据修正(见文件头 ⓪~⑤)', 'migrate');
INSERT INTO param_change_log (actor, tbl, scope, cfg_key, acct_month, mode, new_value, note, action)
  SELECT 'migrate', 'alloc', scope, cfg_key, acct_month, mode, cfg_value, note, 'migrate'
  FROM alloc_cfg WHERE note LIKE 'S21:%' OR note LIKE '源册 2023-11 起%' OR cfg_key IN ('loss_denom_cable')
     OR (cfg_key = 'loss_head' AND note LIKE '%一车间%') OR (cfg_key = 'extra_qty' AND acct_month = '2023-12');
