-- V42__elec_cost.sql — 园区电费成本模型(ELEC-COST-SPEC §3)。纯新增,不改附表11 elec_*(原功能零改动,功能门入口分叉)。
-- 三表:elec_meter 电表主数据(8 种子) / elec_cost_entry 费项月度值 / elec_price_cfg 电价参数。

-- ── 电表(4 类 8 表):master 总表 / dorm 宿舍 / ops 运营性 ──
CREATE TABLE elec_meter (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name       VARCHAR(48)  NOT NULL,                 -- 电表名,唯一
  kind       VARCHAR(8)   NOT NULL,                 -- master / dorm / ops
  sort_no    SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_elec_meter_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO elec_meter (name, kind, sort_no) VALUES
  ('一期总表', 'master',  1),
  ('二期总表', 'master',  2),
  ('宿舍电表', 'dorm',   11),
  ('水泵房',   'ops',    21),
  ('消防泵',   'ops',    22),
  ('路灯',     'ops',    23),
  ('绿化用电', 'ops',    24),
  ('办公用电', 'ops',    25);

-- ── 费项月度值:uk 四元组;sub_key 空串=合计行(NOT NULL DEFAULT '' 防 NULL 唯一键失效)。
--    拆分口径:合计行与拆分行并存时照存不拦,前端黄警、读侧以拆分 Σ 为准(ELEC-COST-SPEC §3)。
--    fee_key:master=tou_industrial/basic_industrial/commercial/pv_grid_income/pf_reward;dorm=usage;ops=usage/allocated。
--    sub_key 值域:工业=bg/t3_industry,商业=a/t3_chuangye(服务层校验,DB 不枚举)。
CREATE TABLE elec_cost_entry (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  meter_id   INT UNSIGNED NOT NULL,
  acct_month CHAR(7)      NOT NULL,                 -- YYYY-MM
  fee_key    VARCHAR(24)  NOT NULL,
  sub_key    VARCHAR(16)  NOT NULL DEFAULT '',      -- 楼栋拆分;''=合计行
  amount     DECIMAL(14,2) NOT NULL DEFAULT 0,      -- 金额 元
  qty        DECIMAL(14,2) NULL,                    -- 电量 kWh(可空)
  note       VARCHAR(255) NULL,
  source     VARCHAR(12)  NOT NULL DEFAULT 'manual',-- manual / import / simulated
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_elec_cost_entry (meter_id, acct_month, fee_key, sub_key),
  KEY idx_ece_month (acct_month),
  CONSTRAINT fk_ece_meter FOREIGN KEY (meter_id) REFERENCES elec_meter(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 电价参数:acct_month ''=长期默认行(同 sub_key 空串归一化,防 NULL 唯一键失效)。
--    读规则=当月行优先,缺省回退默认行。公告价/执行价无种子(用户录或模拟填)。
CREATE TABLE elec_price_cfg (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  acct_month CHAR(7)      NOT NULL DEFAULT '',      -- YYYY-MM;''=长期默认
  cfg_key    VARCHAR(24)  NOT NULL,                 -- pv_grid_price / grid_posted_price / third_party_price / pf_reward_rate
  cfg_value  DECIMAL(12,6) NOT NULL,
  note       VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_elec_price_cfg (acct_month, cfg_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO elec_price_cfg (acct_month, cfg_key, cfg_value, note) VALUES
  ('', 'pv_grid_price',  0.453000, '广东存量项目机制电价(挂钩燃煤基准价,ELEC-COST-SPEC §2)'),
  ('', 'pf_reward_rate', 0.005000, '功率因数奖励率(保守中档 0.5%,ELEC-COST-SPEC §2)');
