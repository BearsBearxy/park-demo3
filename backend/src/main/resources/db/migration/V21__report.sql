-- V21__report.sql — 通用报表存储(statement 参数化)。纯新增,不改现有表,无种子(种子归 V22)。
-- 小计不落库:report_amount 只存 normal 叶子行(含自定义行)。全部汇总跨公司同 rowKey/field 求和(前端只读)。
CREATE TABLE report_amount (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  company_id  INT UNSIGNED NOT NULL,               -- FK management_company.id
  statement   VARCHAR(8)   NOT NULL,               -- 'is'(利润表) | 'bs' | 'tb'
  year        INT          NOT NULL,
  month       INT          NOT NULL,
  row_key     VARCHAR(32)  NOT NULL,               -- 行次(常驻)或自定义行 id
  field       VARCHAR(8)   NOT NULL,               -- 'cur'(本月) | 'ytd'(本年累计)
  amount      DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at  DATETIME     NOT NULL,               -- MyBatis-Plus 自动填充
  updated_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_amt (company_id, statement, year, month, row_key, field),
  KEY idx_period (company_id, statement, year, month),
  CONSTRAINT fk_ramt_company FOREIGN KEY (company_id) REFERENCES management_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE report_custom_row (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  company_id  INT UNSIGNED NOT NULL,
  statement   VARCHAR(8)   NOT NULL,
  row_key     VARCHAR(40)  NOT NULL,               -- 自定义行稳定 id(如 'isc-<n>')
  parent_key  VARCHAR(32)  NOT NULL,               -- 父行次或父自定义行 id
  label       VARCHAR(128) NOT NULL,
  level       INT          NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL,               -- MyBatis-Plus 自动填充
  PRIMARY KEY (id),
  UNIQUE KEY uk_row (company_id, statement, row_key),
  KEY idx_cr (company_id, statement),
  CONSTRAINT fk_rcr_company FOREIGN KEY (company_id) REFERENCES management_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
