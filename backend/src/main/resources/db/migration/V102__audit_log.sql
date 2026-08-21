-- 操作审计日志（RBAC-SPEC §7 第三层）。
--
-- 为什么不并进 param_change_log / import_log：那两张表各有专用字段
-- （old_value/new_value/cfg_key、rows/ok/warn），合并就得塞 JSON，历史页反而难查。
-- 市面同样分开（Odoo 的 tracking vs logging、Jira 的 issue history vs audit log）。
-- P2 的「操作日志」屏把三张表 union 起来按时间倒序展示。
--
-- 本表只装现在无处可去的那些：账号与角色变更、编辑锁接管、密码重置、登录锁定。

CREATE TABLE auth_audit_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ts         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor      VARCHAR(64)  NOT NULL DEFAULT '',    -- 操作人 username（与 param_change_log.actor 同口径）
  action     VARCHAR(32)  NOT NULL,               -- user.create / role.update / lock.takeover ...
  target     VARCHAR(128) NULL,                   -- 被操作对象，如 user:zhangsan / role:finance_clerk
  -- 授权人：仅「主管授权接管编辑锁」这类**代他人执行**的动作有值。
  -- 审计必须记两个人 —— 只记操作人的话，"谁批准的"这个问题永远查不出来。
  authorizer VARCHAR(64)  NULL,
  detail     VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_aal_ts (ts),
  KEY idx_aal_actor (actor, ts),
  KEY idx_aal_action (action, ts)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='账号/角色/编辑锁 审计日志';
