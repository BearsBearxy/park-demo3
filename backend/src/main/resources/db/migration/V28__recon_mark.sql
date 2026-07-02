-- V28__recon_mark.sql — 收入核对处置标记(E5)。派生对照不落库,仅此一张处置小表,无种子。
-- 键用 tenant_name:未匹配实体无 id;同名即同实体(与 E1 一致)。
CREATE TABLE recon_mark (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  year        INT          NOT NULL,
  month       INT          NOT NULL,
  tenant_id   INT UNSIGNED NULL,                    -- 匹配上的真实租户
  tenant_name VARCHAR(128) NOT NULL,                -- 展示名/未匹配实体的键
  note        VARCHAR(255) NULL,
  created_at  DATETIME     NOT NULL,
  updated_at  DATETIME     NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_mark (year, month, tenant_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
