-- 账册模板 pin 按月独立(2026-08-26 拍板,spec: docs/superpowers/specs/2026-08-26-per-month-template-pin-design.md):
-- 版本指针从「每册一个」改为「每册每月一个」。台账 owner=company_id,附表10 owner=phase。
-- 建表在这里,回填放 BookPinService.migrateExisting()(启动幂等)——它要按册解析当前版本,SQL 表达不便。
CREATE TABLE book_month_pin (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  screen       VARCHAR(12)     NOT NULL COMMENT 'ledger | s10',
  owner_id     INT UNSIGNED    NOT NULL COMMENT 'ledger=company_id; s10=phase(1..4)',
  period_year  SMALLINT        NOT NULL,
  period_month TINYINT         NOT NULL,
  version_id   BIGINT UNSIGNED NOT NULL,
  created_at   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_pin (screen, owner_id, period_year, period_month),
  -- 往前找最近一条(解析规则第 2 步)走这个索引
  KEY idx_pin_lookup (screen, owner_id, period_year, period_month),
  CONSTRAINT fk_pin_ver FOREIGN KEY (version_id) REFERENCES book_template_version(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
