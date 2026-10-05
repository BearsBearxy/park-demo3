-- 数据修改记录(用户 2026-10-05 拍板「2按你建议，3，4一起做」第 4 条):
-- 台账、抄表读数、工资、三大报表、损益附表、经营分析「目标与阈值」每一次手改,记谁、什么时候、哪张表哪一行哪一格、改前、改后。
-- 导入不逐格记 —— import_log 已经记了谁、何时、哪个文件、多少行。
-- 进「系统 → 操作日志」(AuditQueryMapper 的 change 一路);一行记录说的是哪张表,就要那张表的查看权才看得见(SystemService.auditLogs)。
-- 值一律存成屏上显示的字符串:各表的数值类型、精度不一(decimal(14,2) / (18,2) / int / NULL=未录),存字符串才放得进同一列。
-- 两条链都跑:只建表,不写任何数据。
CREATE TABLE value_change_log (
  id      BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  at      DATETIME     NOT NULL COMMENT 'Java 时钟写',
  actor   VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '用户名,与 auth_audit_log.actor 同口径',
  tbl     VARCHAR(32)  NOT NULL COMMENT 'monthly_ledger|meter_reading|salary_record|report_amount|pnl_row|analysis_setting',
  row_ref VARCHAR(255) NOT NULL DEFAULT '' COMMENT '人看得懂的行定位,如 公司 · 2025-06 · 租户',
  field   VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '列的人话名;整行/整批的摘要行为空',
  old_val VARCHAR(255) DEFAULT NULL COMMENT 'NULL = 原来没有这一格',
  new_val VARCHAR(255) DEFAULT NULL COMMENT 'NULL = 删掉了',
  note    VARCHAR(255) DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_vcl_at (at),
  KEY idx_vcl_actor (actor, at),
  KEY idx_vcl_tbl (tbl, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='手改数据的逐格记录';

-- 经营分析「目标与阈值」(同日拍板第 2 条):从各人浏览器挪进库,全员看同一份,只有「账簿报表」编辑权能改。
-- 一行一个设置项;没有行 = 用默认值(默认值不落库,新园区和我园都一样)。
CREATE TABLE analysis_setting (
  setting_key   VARCHAR(32)   NOT NULL COMMENT 'occTarget|collectTarget|churnTh|spikeTh|breakevenFixedRatio|pvInvestment',
  setting_value DECIMAL(16,4) NOT NULL,
  updated_by    VARCHAR(64)   NOT NULL DEFAULT '',
  updated_at    DATETIME      NOT NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='经营分析目标与阈值(全员一份)';
