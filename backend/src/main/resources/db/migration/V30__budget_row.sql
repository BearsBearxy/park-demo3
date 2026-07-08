-- V30__budget_row.sql — 年度预算行(全面预算总表,年度粒度)。一行=某年某科目;
-- 预算与发生额可只有其一(2026 只有预算,2022~2024 只有发生额);2025 发生额不落库(pnl 实时推算为单一事实源)。
-- 按 payload 出现年整年替换(delete+insert,同 pnl 惯例)。
CREATE TABLE budget_row (
  id            BIGINT        NOT NULL AUTO_INCREMENT,
  year          SMALLINT      NOT NULL,
  label         VARCHAR(64)   NOT NULL,              -- 科目(trim 后)
  sub           TINYINT(1)    NOT NULL DEFAULT 0,    -- 「其中：」子行
  amount_budget DECIMAL(18,2) NULL,                  -- 预算额,NULL=该年无预算
  amount_actual DECIMAL(18,2) NULL,                  -- 发生额,NULL=该年无发生额
  note          VARCHAR(255)  NULL,
  sort_order    INT           NOT NULL DEFAULT 0,
  created_at    DATETIME      NOT NULL,
  updated_at    DATETIME      NOT NULL,
  PRIMARY KEY (id),
  -- 唯一键用行序而非 label:真实总表每年有两个「其中：其他」子行(收入侧/成本侧)撞 label
  -- (复审 high:uk(year,label) 会让真实文件整包 1062 回滚);行序在整年替换语义下天然唯一。
  UNIQUE KEY uk_budget (year, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
