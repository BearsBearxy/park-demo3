-- V20__import_log.sql — 导入历史(只读审计)。纯新增,不改现有表,无种子。
CREATE TABLE import_log (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  data_type   VARCHAR(32)  NOT NULL,               -- registry 键(ledger/s10/pv/charging_7/charging_8/elec/salary/office_13/office_14)
  type_label  VARCHAR(64)  NOT NULL,               -- 显示名(历史稳定,不随 registry 改动漂移)
  file_name   VARCHAR(255) NOT NULL,               -- 文件名;粘贴导入存 '（粘贴）'
  target      VARCHAR(64)  NULL,                    -- 目标槽人读串,如 '2026-05 · 综合公司';无则 NULL
  `rows`      INT          NOT NULL DEFAULT 0,      -- 解析总行
  ok          INT          NOT NULL DEFAULT 0,      -- 成功写入(=ImportResultDTO.imported)
  warn        INT          NOT NULL DEFAULT 0,      -- 跳过+错误数(=skipped + errors.size)
  status      VARCHAR(16)  NOT NULL,               -- complete | partial | rejected
  operator    VARCHAR(64)  NULL,                    -- 登录 displayName(单管理员)
  created_at  DATETIME     NOT NULL,               -- MyBatis-Plus 自动填充
  PRIMARY KEY (id),
  KEY idx_type_time (data_type, created_at),        -- 支撑「每类最新」
  KEY idx_time (created_at)                         -- 支撑「近 N 天倒序」
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
