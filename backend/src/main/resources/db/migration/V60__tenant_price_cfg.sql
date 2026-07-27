-- V60__tenant_price_cfg.sql — 价目管理储价(PRICE-CFG-SPEC §1/§5):派生引擎取价的单一事实源。
-- 照抄 alloc_cfg 模式,差异仅两处:cfg_value DECIMAL(14,8)(电价 8 位小数);scope 增加 tenant:{id} 层。
-- 扩展方式=加行不加列;月度池派生值(电梯每层基数/损耗率月算/宿舍路灯 0.06)不进本表。
CREATE TABLE tenant_price_cfg (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope      VARCHAR(24) NOT NULL DEFAULT '',  -- ''=全园 | p1|p2|dorm 分区 | tenant:{id} 户级
  cfg_key    VARCHAR(32) NOT NULL,             -- 受控白名单,见 §2(PriceCfgService.CFG_KEYS)
  acct_month CHAR(7)     NOT NULL DEFAULT '',  -- 'YYYY-MM' 月行 | ''=默认行(勿用 NULL,唯一键失效)
  cfg_value  DECIMAL(14,8) NOT NULL,
  note       VARCHAR(255) DEFAULT NULL,        -- 数值来源锚点(如 "2024-02 代理购电价表")
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_price (scope, cfg_key, acct_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── §5 种子:默认行/分区行按 §2 表格默认值列全量插入;月行=2024-02 六个电价。
--    户级例外不入迁移(tenant_id 环境相关),由录入页人工添加(§5 待录清单 9 项)。 ──

-- 电价·月变(2024-02 月行,全园 scope='')
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note) VALUES
  ('', 'elec_peak',       '2024-02', 1.20606875, '2024-02 代理购电价表(PRICE-CFG-SPEC §2 电价·月变)'),
  ('', 'elec_sharp',      '2024-02', 1.50076875, '2024-02 代理购电价表;名义价,实收按 sharp_as_peak_ratio 开关'),
  ('', 'elec_flat',       '2024-02', 0.72076875, '2024-02 代理购电价表'),
  ('', 'elec_valley',     '2024-02', 0.29116875, '2024-02 代理购电价表'),
  ('', 'elec_resident',   '2024-02', 0.63586875, '2024-02 代理购电价表;宿舍居民单一价'),
  ('', 'elec_commercial', '2024-02', 0.79416875, '2024-02 代理购电价表;商业');

-- 附加与开关/容量与水(全园默认行)
INSERT INTO tenant_price_cfg (scope, cfg_key, cfg_value, note) VALUES
  ('', 'mgmt_fee',            0.16,  '电力管理费(分时/居民)默认;户级例外 0.15/0.10 录入页维护(§5)'),
  ('', 'mgmt_fee_commercial', 0.32,  '商业维护费;商业综合=0.794+0.32(PRICE-CFG-SPEC §2)'),
  ('', 'sharp_as_peak_ratio', 0,     '政策开关:0=尖按峰收(PRICE-CFG-SPEC §2)'),
  ('', 'capacity_fee',        22.6,  '装机容量费 元/kVA·月,55 户实证;可莱恩 23 户级例外(§5)'),
  ('', 'water',               3.95,  '水价全园默认;户级例外 4.45 录入页维护(§5)'),
  ('', 'water_pipe',          0.5,   '水管网维护费默认;宿舍无管网费(dorm 行 0)'),
  ('', 'green_water',         0.008, '绿化水公摊 二期乙轨(PRICE-CFG-SPEC §2)');

-- 宿舍分区行
INSERT INTO tenant_price_cfg (scope, cfg_key, cfg_value, note) VALUES
  ('dorm', 'water',          3.85,  '宿舍水价(PRICE-CFG-SPEC §2)'),
  ('dorm', 'water_pipe',     0,     '宿舍无管网费(PRICE-CFG-SPEC §2)'),
  ('dorm', 'green_water',    0.02,  '宿舍绿化水推定常数(PRICE-CFG-SPEC §2)'),
  ('dorm', 'loss_rate',      0.012, '宿舍固定损耗率;厂房月算不入本表(PRICE-CFG-SPEC §2 特殊轨道)'),
  ('dorm', 'lamp_area_base', 15510, '宿舍路灯面积基数(月推分母,非全司常数)');

-- 二期分区行
INSERT INTO tenant_price_cfg (scope, cfg_key, cfg_value, note) VALUES
  ('p2', 'green_water_hi', 0.01,  '二期甲轨绿化水;归属楼栋群由 S3 裁(PRICE-CFG-SPEC §2)'),
  ('p2', 'lamp_sqm',       0.005, '二期路灯公摊单价;p1/dorm 月推无常数'),
  ('p2', 'fire_sqm',       0.015, '园区消防公摊;一期无此项');

-- 一期分区行
INSERT INTO tenant_price_cfg (scope, cfg_key, cfg_value, note) VALUES
  ('p1', 'elevator_sqm',    0.08,  '电梯公摊 元/㎡·月;A座专用算法(PRICE-CFG-SPEC §2)'),
  ('p1', 'lamp_area_base',  80000, '一期路灯面积基数(月推分母)'),
  ('p1', 'green_area_base', 15510, '一期绿化 0.009 月推分母(PRICE-CFG-SPEC §2)');
