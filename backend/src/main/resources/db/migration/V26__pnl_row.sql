-- V26__pnl_row.sql — 损益附表 1-5 通用宽表(园区全局,无公司维度)。行=科目细分,12 月金额列内联。
-- 月值 NULL=未录(区分 0);本年合计客端派生不落库;kind 按标签识别仅作渲染;整 (schedule,year) clear+insert。
CREATE TABLE pnl_row (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  schedule    VARCHAR(4)   NOT NULL,               -- 's1'..'s5'
  year        INT          NOT NULL,
  row_key     VARCHAR(40)  NOT NULL,               -- 合成 r<n>(整年 clear+insert,无跨年匹配需求)
  group_label VARCHAR(64)  NOT NULL DEFAULT '',    -- 分组列(区域/科目名称/项目/科目;向下填充合并单元格)
  label       VARCHAR(160) NOT NULL,               -- 科目细分
  kind        VARCHAR(12)  NOT NULL DEFAULT 'detail', -- detail|subtotal|pnl|total(按标签识别,仅渲染用)
  note        VARCHAR(255) NULL,                    -- 备注(文件尾列/逐行手录)
  m1 DECIMAL(18,2) NULL, m2 DECIMAL(18,2) NULL, m3 DECIMAL(18,2) NULL, m4 DECIMAL(18,2) NULL,
  m5 DECIMAL(18,2) NULL, m6 DECIMAL(18,2) NULL, m7 DECIMAL(18,2) NULL, m8 DECIMAL(18,2) NULL,
  m9 DECIMAL(18,2) NULL, m10 DECIMAL(18,2) NULL, m11 DECIMAL(18,2) NULL, m12 DECIMAL(18,2) NULL,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL,
  updated_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pnl (schedule, year, row_key),
  KEY idx_pnl (schedule, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
