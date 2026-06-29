-- 附表12 · 工资明细(逐月人员工资)。一行 = 某员工某月。
-- 派生值绝不落库(wageTotal / gross / deduct / net / actualDays / fullAttend),service 读时算。
CREATE TABLE salary_record (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  acct_month    VARCHAR(7)  NOT NULL,               -- YYYY-MM 所属月份
  emp_idx       INT         NOT NULL DEFAULT 0,     -- 序号(种子排序;手动新增 0)
  name          VARCHAR(32) NOT NULL,
  role          VARCHAR(32) NULL,                   -- 职种/职务
  base          DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 基本
  post          DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 岗位
  perf          DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 绩效奖金
  attend        DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 全勤奖
  skill         DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 岗位技能津贴
  edu           DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 学历津贴
  other         DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 其它津贴
  lunch         DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 午餐补助
  heat          DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 高温及其他补贴
  commission    DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 招商提成
  should_days   SMALLINT NOT NULL DEFAULT 0,        -- 应出勤
  leave_days    SMALLINT NOT NULL DEFAULT 0,        -- 请假
  social        DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 社保
  tax           DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 上月个税
  other_deduct  DECIMAL(12,2) NOT NULL DEFAULT 0,   -- 其他扣款
  sign          TINYINT(1) NOT NULL DEFAULT 0,      -- 签收
  note          VARCHAR(255) NULL,
  source        VARCHAR(8)  NOT NULL DEFAULT 'manual',  -- seed / manual
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_salary_acct (acct_month)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
