-- V47__alloc.sql — 公摊分摊与损耗(PB-ALLOCATION-SPEC §1)。meter/elec_cost/bills 现有 schema 零改动。
-- 四类实体:规则(+表绑定/受益人) / 参数 / 分摊结果。用量唯一来源=meter_reading 派生,本刀只落「规则+钱」。

-- ── 分摊规则(≈30 条,人工录入无导入):method 四类 direct/area/floor/loss(§1 alloc_rule) ──
CREATE TABLE alloc_rule (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  zone        VARCHAR(8)   NOT NULL,                 -- p1 / p2
  name        VARCHAR(64)  NOT NULL,                 -- 规则名(如 B座电梯)
  building_id INT NULL,                              -- FK 楼栋(可空:园区级规则)
  method      VARCHAR(8)   NOT NULL,                 -- direct / area / floor / loss
  coefficient DECIMAL(12,2) NULL,                    -- area=受益面积Σ㎡;floor=层数(可小数);direct/loss 不用
  extra_qty   DECIMAL(10,2) NOT NULL DEFAULT 0,      -- 人工加度(电梯+170 等,AG 备注收编)
  fee_key     VARCHAR(24)  NOT NULL,                 -- 出口费项 share_elec_*
  note        VARCHAR(255) NULL,
  sort_no     SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 表绑定多对多:一规则多表合并(A座 4 部电梯/走廊灯+消防灯共系数),meter 表零改动 ──
CREATE TABLE alloc_rule_meter (
  id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_id  INT UNSIGNED NOT NULL,
  meter_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alloc_rule_meter (rule_id, meter_id),
  CONSTRAINT fk_arm_rule  FOREIGN KEY (rule_id)  REFERENCES alloc_rule(id) ON DELETE CASCADE,
  CONSTRAINT fk_arm_meter FOREIGN KEY (meter_id) REFERENCES meter(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 受益人:weight 语义随 method(floor=层份额,默认1/对半0.5/NULL=层内按面积二拆;area=忽略;direct=单行整笔)。
--    loss 规则无 member(受益人=当月有用电量的全部租户,生成时动态取)。tenant FK 不级联(租户删除 409 挡)。 ──
CREATE TABLE alloc_rule_member (
  id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  rule_id   INT UNSIGNED NOT NULL,
  tenant_id INT          NOT NULL,
  weight    DECIMAL(6,3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alloc_rule_member (rule_id, tenant_id),
  CONSTRAINT fk_armb_rule FOREIGN KEY (rule_id) REFERENCES alloc_rule(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- ── 参数:完全照抄 elec_price_cfg「月行('' 默认行)优先回退默认行」模式;新单价/新参数=加行不加列。
--    scope: p1/p2(单价类) 或 building:{id}(loss_adj_qty/loss_adj_rate/loss_head)。
--    cfg_key 首批:price_flat/price_sharp/price_peak/price_norm/price_valley/price_loss/loss_adj_qty/loss_adj_rate/park_share_div。 ──
CREATE TABLE alloc_cfg (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  scope      VARCHAR(24)  NOT NULL,
  cfg_key    VARCHAR(24)  NOT NULL,
  cfg_value  DECIMAL(12,6) NULL,
  acct_month CHAR(7)      NOT NULL DEFAULT '',       -- YYYY-MM;''=默认行(同 elec_price_cfg 防 NULL 唯一键失效)
  note       VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alloc_cfg (scope, cfg_key, acct_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 种子=spec 口径逆向锁定的常数(月均价每月变,月行由用户维护)
INSERT INTO alloc_cfg (scope, cfg_key, cfg_value, note) VALUES
  ('p1', 'price_flat',     1.114170, '一期单一商业价=供电局月均+0.16(创显承担电费!O3,2024-02 锚)'),
  ('p1', 'park_share_div', 6.000000, '一期园区级公共电均摊栋数'),
  ('p2', 'price_loss',     1.253120, '二期损耗计费价=1.09312+0.16(分摊分析 K27 硬编码常数收编)');

-- ── 分摊结果(粒度=租户×月×费项,生成动作写入=快照语义;重新生成=按 ym 先删后插 gen 行,manual 保留)。
--    fee_key: share_elec_fire/share_elec_elevator/share_elec_light/share_elec_floor/share_elec_loss/share_water(占位)。
--    表级明细不落库(抽屉现算);rate_snap=损耗率/元每层/元每㎡ 快照,price_snap=单价快照——钱才快照,派生不落库。 ──
CREATE TABLE alloc_result (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id    INT          NOT NULL,
  ym           CHAR(7)      NOT NULL,                -- YYYY-MM
  fee_key      VARCHAR(24)  NOT NULL,
  rule_id      INT UNSIGNED NULL,                    -- 损耗行/manual 行/多规则合并行为空
  qty          DECIMAL(12,2) NULL,                   -- 分摊电量
  amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  rate_snap    DECIMAL(10,6) NULL,
  price_snap   DECIMAL(12,6) NULL,
  source       VARCHAR(8)   NOT NULL DEFAULT 'gen',  -- gen / manual
  note         VARCHAR(255) NULL,
  generated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_alloc_result (tenant_id, ym, fee_key),
  KEY idx_alloc_result_ym (ym)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
