-- V131__pool_monthly_config.sql — 公摊池按月配置(docs/superpowers/2026-09-26-pool-monthly-config-plan.md D1/D2/D3/D5)。
-- ① 绑定表 alloc_rule_meter、折入链 alloc_rule_link 加 acct_month,语义照抄受益人 alloc_rule_member(V69/S14):
--    同一池(折入链按 dst 池分)同一 acct_month 的行是一个版本组;站在 ym 取 acct_month<=ym 最大的那组;
--    ''=初始版;全在 ym 之后=空。存量行全部落 '',各月取值不变。
-- ② alloc_rule_version:登记「某池某部分自某月起换了一个版本组」。候选月 = 行的 acct_month ∪ 本表的 acct_month,
--    取到的组一行都没有 = 空组 —— 「从 M 月起一块都不绑 / 一条都不折入」靠它表示,行表里不出现 NULL 的表/源池。
--    初始版 '' 不登记(不登记与登记一个空的 '' 组取值相同)。删池级联删。
-- ③ 取整位 round_scale 进参数表(同 V97 搬 coefficient):≠2 的池写 rule:{id} 的 '' from 行(初始版本);
--    没有行 = 2。alloc_rule.round_scale 列保留但引擎不再读、改池不再写。
-- 唯一键:同一条 ALTER 里先删后加(新键仍以 rule_id / src_rule_id 打头,外键 fk_arm_rule / fk_link_src 仍有索引可用)。

ALTER TABLE alloc_rule_meter
  ADD COLUMN acct_month CHAR(7) NOT NULL DEFAULT '' COMMENT "''=初始版;'YYYY-MM'=自该月起的版本组(前滚到更晚版本之前)",
  DROP INDEX uk_alloc_rule_meter,
  ADD UNIQUE KEY uk_alloc_rule_meter (rule_id, meter_id, acct_month);

ALTER TABLE alloc_rule_link
  ADD COLUMN acct_month CHAR(7) NOT NULL DEFAULT '' COMMENT "''=初始版;'YYYY-MM'=自该月起的版本组(按 dst 池分组)",
  DROP INDEX uk_link,
  ADD UNIQUE KEY uk_link (src_rule_id, dst_rule_id, link_type, acct_month);

CREATE TABLE alloc_rule_version (
  rule_id    INT UNSIGNED NOT NULL,
  part       ENUM('meter','link') NOT NULL COMMENT 'meter=绑定表(按池);link=入向折入链(按 dst 池)',
  acct_month CHAR(7) NOT NULL COMMENT '版本组起始月 YYYY-MM',
  PRIMARY KEY (rule_id, part, acct_month),
  CONSTRAINT fk_arv_rule FOREIGN KEY (rule_id) REFERENCES alloc_rule(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='公摊池绑定表/折入链的版本组登记(空组靠它存在)';

INSERT IGNORE INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note)
  SELECT CONCAT('rule:', id), 'round_scale', round_scale, '', 'from', 'V131:自 alloc_rule.round_scale 列迁入(初始版本)'
  FROM alloc_rule WHERE round_scale <> 2;
ALTER TABLE alloc_rule
  MODIFY round_scale TINYINT NOT NULL DEFAULT 2 COMMENT 'V131 退出引擎:取整位只存 alloc_cfg rule:{id}.round_scale 版本链(本列仅历史)';

-- 日志:搬入的版本行逐条记 migrate(action=migrate 不算「改动」,不让已生成月亮「需重算」,见 ParamService 类头)
INSERT INTO param_change_log (actor, tbl, scope, cfg_key, acct_month, mode, new_value, note, action)
  SELECT 'migrate', 'alloc', scope, cfg_key, acct_month, mode, cfg_value, note, 'migrate'
  FROM alloc_cfg WHERE cfg_key = 'round_scale';
