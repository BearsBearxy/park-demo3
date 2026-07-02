-- V24__report_account.sql — 科目余额表科目树按 (公司, 期) 存储(数据非模板)。纯新增,种子归 V25。
-- 金额复用 report_amount(statement='tb', field ∈ openDr/openCr/periodDr/periodCr/ytdDr/ytdCr/endDr/endCr)。
CREATE TABLE report_account (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  company_id  INT UNSIGNED NOT NULL,               -- FK management_company.id（同 V21 口径 INT UNSIGNED）
  statement   VARCHAR(8)   NOT NULL,               -- 'tb'
  year        INT          NOT NULL,
  month       INT          NOT NULL,
  row_key     VARCHAR(40)  NOT NULL,               -- 科目代码 或 合成 r<n>
  parent_key  VARCHAR(40)  NULL,                    -- 父科目 row_key(一级科目为 NULL)
  code        VARCHAR(20)  NULL,                    -- 科目代码(缩进型下级无代码为 NULL)
  label       VARCHAR(160) NOT NULL,               -- 科目名称(去前导空格)
  level       INT          NOT NULL DEFAULT 0,
  sort_order  INT          NOT NULL DEFAULT 0,      -- 文件行序
  created_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_acct (company_id, statement, year, month, row_key),
  KEY idx_acct_period (company_id, statement, year, month),
  CONSTRAINT fk_racct_company FOREIGN KEY (company_id) REFERENCES management_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
