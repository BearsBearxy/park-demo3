-- V96__param_mode_and_log.sql — S21 计费参数中心 Phase A(S21-PARAM-CENTER-SPEC §2.1/§7.1/§7.2):
-- ① alloc_cfg / tenant_price_cfg 同加 mode 列统一版本语义:from=自 acct_month 起长期(''=初始版本),month=仅该月;
--    唯一键改含 mode(同 (scope,key,月) 允许 from 与 month 并存,取值时 month 优先,VersionResolver)。
-- ② 现有行按旧语义转换 —— 红线:已生成三个月(2023-08/2023-10/2024-02)取值一格不变:
--    价目簿:电价 6 键月行 + 永龙照抄金额 loss_base_park_amount = 仅当月(month);其余常数键前滚(from,=旧语义)。
--    alloc_cfg:默认行 '' → from;2024-02 月行按键分类:extra_qty/manual_qty/loss_adj_qty/loss_g_adj → month(旧「仅当月」);
--    coefficient/std_add/price_override/loss_adj_rate/loss_variant/loss_exclude → from(自 2024-02 起长期;
--    已生成月 ≤ 2024-02,故 2023-08/2023-10 仍落默认行、2024-02 取值不变;2024-03 起自动沿用,spec §9.1)。
-- ③ loss_g_adj 并入 loss_adj_qty 后退役:两者是同一个「损耗调整度数」(G+g ≡ E−G−a 中 a=g,同签名),
--    同 (scope,月) 已有 loss_adj_qty 行则相加。A座 2024-02:g_qty 列 −1413.20 → 86.80(纯公摊均摊),adj_qty 0 → −1500,
--    tenant_rate 不变。
-- ④ 新表 param_change_log:参数变更日志(who/when/表/scope/key/月/mode/旧值/新值/动作);updated_at 不能当证据
--    (strictUpdateFill 冻结)。本次迁移把 alloc_cfg 全部行记一条 migrate 日志(price 表行数多且未改值,不记)。

ALTER TABLE alloc_cfg
  ADD COLUMN mode ENUM('from','month') NOT NULL DEFAULT 'from'
    COMMENT 'from=自acct_month起长期(空=初始版);month=仅该月' AFTER acct_month,
  DROP INDEX uk_alloc_cfg,
  ADD UNIQUE KEY uk_alloc_cfg (scope, cfg_key, acct_month, mode);

ALTER TABLE tenant_price_cfg
  ADD COLUMN mode ENUM('from','month') NOT NULL DEFAULT 'from'
    COMMENT 'from=自acct_month起长期(空=初始版);month=仅该月' AFTER acct_month,
  DROP INDEX uk_price,
  ADD UNIQUE KEY uk_price (scope, cfg_key, acct_month, mode);

-- 价目簿:电价 6 键月行=仅当月;永龙照抄金额=仅当月;其余保持 from(=旧常数键前滚语义)
UPDATE tenant_price_cfg SET mode='month' WHERE acct_month<>'' AND cfg_key IN
  ('elec_peak','elec_sharp','elec_flat','elec_valley','elec_resident','elec_commercial','loss_base_park_amount');

-- alloc_cfg:默认行 from;2024-02 月行按键分类(spec §7.2)
--   (coefficient/std_add/price_override/loss_adj_rate/loss_variant/loss_exclude 的月行保持 from = 自该月起长期)
UPDATE alloc_cfg SET mode='month' WHERE acct_month<>'' AND cfg_key IN ('extra_qty','manual_qty','loss_adj_qty','loss_g_adj');

-- loss_g_adj 并入 loss_adj_qty(同签名);同 (scope,月,month) 已有行相加。
-- 派生表 AS g 的写法是 MySQL 文档推荐形(避免 INSERT…SELECT + VALUES() 的歧义/弃用告警)。
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, acct_month, mode, note)
  SELECT * FROM (
    SELECT scope AS g_scope, 'loss_adj_qty' AS g_key, cfg_value AS g_value, acct_month AS g_month, 'month' AS g_mode,
           CONCAT('并自 loss_g_adj:', IFNULL(note, '')) AS g_note
    FROM alloc_cfg WHERE cfg_key='loss_g_adj'
  ) AS g
  ON DUPLICATE KEY UPDATE cfg_value = IFNULL(cfg_value, 0) + g.g_value;
DELETE FROM alloc_cfg WHERE cfg_key='loss_g_adj';

CREATE TABLE param_change_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ts         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor      VARCHAR(64)  NOT NULL DEFAULT '',
  tbl        ENUM('price','alloc') NOT NULL COMMENT 'price=tenant_price_cfg / alloc=alloc_cfg',
  scope      VARCHAR(24)  NOT NULL,
  cfg_key    VARCHAR(32)  NOT NULL,
  acct_month CHAR(7)      NOT NULL DEFAULT '',
  mode       ENUM('from','month') NOT NULL DEFAULT 'from',
  old_value  DECIMAL(14,8) NULL,
  new_value  DECIMAL(14,8) NULL,
  note       VARCHAR(255) NULL,
  action     ENUM('set','delete','recalc','migrate') NOT NULL DEFAULT 'set',
  ym         CHAR(7)      NULL COMMENT 'recalc 动作的账期',
  PRIMARY KEY (id),
  KEY idx_pcl_key (scope, cfg_key, acct_month),
  KEY idx_pcl_ts (ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='计费参数变更日志(S21)';

INSERT INTO param_change_log (actor, tbl, scope, cfg_key, acct_month, mode, new_value, note, action)
  SELECT 'migrate', 'alloc', scope, cfg_key, acct_month, mode, cfg_value, 'V96 mode 转换', 'migrate' FROM alloc_cfg;
