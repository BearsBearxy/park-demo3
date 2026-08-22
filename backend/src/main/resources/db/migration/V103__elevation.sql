-- 主管当场授权提权(ELEVATION-SPEC)。权限从「墙」变成「减速带 + 留痕」:
-- 无权账号点得动写入口,由持有该权限的人当场输账号密码授权,30 分钟有效,双人留痕。

-- ═══ 1. 第 14 个权限点:elevate:request = 能不能发起提权请求 ═══
-- 做成权限点而不是 auth_role 上的一列 —— 它就走已有的角色矩阵屏,客户自己能配,零新 UI。
-- 不给 viewer / shareholder:这两个角色连编辑模式按钮都不该看见(用户拍板 2026-08-22)。
INSERT INTO auth_role_perm (role_id, perm)
SELECT id, 'elevate:request' FROM auth_role
WHERE code IN ('admin', 'finance_manager', 'finance_clerk', 'gm');

-- ═══ 2. param_change_log 补 authorizer ═══
-- 没有这一列的话整个功能的审计价值落空:最典型的提权场景就是改计费口径,
-- 而计费口径的日志走的是 param_change_log,不是 auth_audit_log。
ALTER TABLE param_change_log
  ADD COLUMN authorizer VARCHAR(64) NULL COMMENT '提权授权人(NULL=本人有权,非 NULL=经此人当场授权)' AFTER actor;
