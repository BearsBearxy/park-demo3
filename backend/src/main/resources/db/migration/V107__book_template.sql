-- 账册工作台地基(BOOK-WORKBENCH-SPEC §2):
-- 账册=真落库实体(建册=INSERT,红线:任何用户操作不触发 DDL);模板=版本链,现行版指针挂账册;
-- 自定义列=行级 extra_fees JSON(方案A,键=列固定id 如 c_parking,绝非显示名)。

CREATE TABLE ledger_book (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  screen VARCHAR(12) NOT NULL COMMENT 'ledger=月度台账 | s10=附表10',
  company_id INT UNSIGNED NULL COMMENT 'ledger 屏:记账公司',
  phase TINYINT UNSIGNED NULL COMMENT 's10 屏:期区 1..4',
  name VARCHAR(64) NOT NULL,
  current_version_id BIGINT UNSIGNED NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_book_company (screen, company_id),
  UNIQUE KEY uk_book_phase (screen, phase),
  CONSTRAINT fk_book_company FOREIGN KEY (company_id) REFERENCES management_company(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE book_template_version (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  book_id INT UNSIGNED NOT NULL,
  ver INT NOT NULL,
  definition JSON NOT NULL COMMENT '两级表头定义:groups[{id,label,cols[{id,std,label,aliases,slot,hidden,w}]}]',
  note VARCHAR(255) NULL,
  created_by VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tpl (book_id, ver),
  CONSTRAINT fk_tpl_book FOREIGN KEY (book_id) REFERENCES ledger_book(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 方案A 弹性口袋:文件没这列=键不出现;显式 0=清零。存量零迁移(NULL=无自定义值)。
ALTER TABLE monthly_ledger ADD COLUMN extra_fees JSON NULL;
ALTER TABLE s10_record ADD COLUMN extra_fees JSON NULL;
