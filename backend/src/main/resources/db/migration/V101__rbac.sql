-- RBAC-SPEC v2「读全开，写分权」。权限点只有 13 个，全部是写权限 + system:view + lock:takeover。
-- 读不分权:GET /api/** 任何已登录账号放行(与 V32 之前的现状一致),所以这里没有任何 *:view 业务权限。
-- 角色→权限是数据(客户自己配),权限点本身是代码常量(security/Perm.java),客户造不出系统里没有的权限。

CREATE TABLE auth_role (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  code        VARCHAR(32)  NOT NULL,                    -- 稳定标识,代码里引用它,不随显示名改
  name        VARCHAR(32)  NOT NULL,                    -- 显示名,客户可改
  builtin     TINYINT UNSIGNED NOT NULL DEFAULT 0,      -- 1=系统预置,不可删(可改权限)
  nav_layers  VARCHAR(64)  NOT NULL DEFAULT 'data,reports,analysis',
      -- 导航可见层,与权限脱钩(RBAC-SPEC §4)。取值来自 fpNav.ts 的 NavLayer.id。
      -- system 层不在这里 —— 它的可见性直接跟 system:view 走。
  remark      VARCHAR(128) NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id), UNIQUE KEY uk_role_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色(RBAC v2)';

CREATE TABLE auth_role_perm (
  role_id  INT UNSIGNED NOT NULL,
  perm     VARCHAR(32)  NOT NULL,                       -- 如 param-policy:edit,取值见 security/Perm.java
  PRIMARY KEY (role_id, perm),
  CONSTRAINT fk_arp_role FOREIGN KEY (role_id) REFERENCES auth_role(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色持有的权限点';

CREATE TABLE auth_user_role (
  user_id  INT UNSIGNED NOT NULL,
  role_id  INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, role_id),
  KEY idx_aur_role (role_id),
  CONSTRAINT fk_aur_user FOREIGN KEY (user_id) REFERENCES auth_user(id) ON DELETE CASCADE,
  CONSTRAINT fk_aur_role FOREIGN KEY (role_id) REFERENCES auth_role(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户×角色(多对多:现实里有"主管兼管理员")';

-- 首次登录强制改密(RBAC-SPEC 拍板 #3):管理员建号时置 1,本人改完密码置 0。
-- 老账号一律 0 —— 不能把现有 admin/viewer 挡在改密页后面。
ALTER TABLE auth_user ADD COLUMN must_change_password TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER role;

-- ═══ 6 个预置角色 ═══
INSERT INTO auth_role (code, name, builtin, nav_layers, remark) VALUES
  ('admin',           '系统管理员', 1, 'data,reports,analysis', '全部权限,含用户与角色管理'),
  ('finance_manager', '财务主管',   1, 'data,reports,analysis', '业务全部可改,不含系统管理;可授权接管编辑锁'),
  ('finance_clerk',   '财务专员',   1, 'data,reports,analysis', '录入/抄表/出账运行;不可改档案、合同、计费口径'),
  ('gm',              '总经理',     1, 'data,reports,analysis', '只读;导航全部可见'),
  ('shareholder',     '园区股东',   1, 'analysis',              '只读;导航只有经营分析'),
  ('viewer',          '只读账号',   1, 'data,reports,analysis', '只读;导航全部可见');

-- ═══ 角色权限 ═══
-- 系统管理员:13 个权限点全给
INSERT INTO auth_role_perm (role_id, perm)
SELECT id, p FROM auth_role, (
  SELECT 'master:edit' p UNION ALL SELECT 'contract:edit'      UNION ALL SELECT 'param-policy:edit'
  UNION ALL SELECT 'param-monthly:edit' UNION ALL SELECT 'meter-master:edit' UNION ALL SELECT 'meter-reading:edit'
  UNION ALL SELECT 'billing-run:edit'   UNION ALL SELECT 'billing-issue:edit' UNION ALL SELECT 'entry:edit'
  UNION ALL SELECT 'report:edit'        UNION ALL SELECT 'system:view'        UNION ALL SELECT 'system:edit'
  UNION ALL SELECT 'lock:takeover'
) x WHERE code = 'admin';

-- 财务主管:10 个业务 edit + 授权接管;无 system
INSERT INTO auth_role_perm (role_id, perm)
SELECT id, p FROM auth_role, (
  SELECT 'master:edit' p UNION ALL SELECT 'contract:edit'      UNION ALL SELECT 'param-policy:edit'
  UNION ALL SELECT 'param-monthly:edit' UNION ALL SELECT 'meter-master:edit' UNION ALL SELECT 'meter-reading:edit'
  UNION ALL SELECT 'billing-run:edit'   UNION ALL SELECT 'billing-issue:edit' UNION ALL SELECT 'entry:edit'
  UNION ALL SELECT 'report:edit'        UNION ALL SELECT 'lock:takeover'
) x WHERE code = 'finance_manager';

-- 财务专员:录入/抄读数/出账运行。不含 master/contract/param-policy/meter-master/billing-issue
-- (param-monthly 是每月照抄供电局账单的 13 个键,不给他催缴单就出不了账 —— RBAC-SPEC §2.1)
INSERT INTO auth_role_perm (role_id, perm)
SELECT id, p FROM auth_role, (
  SELECT 'param-monthly:edit' p UNION ALL SELECT 'meter-reading:edit' UNION ALL SELECT 'billing-run:edit'
  UNION ALL SELECT 'entry:edit'  UNION ALL SELECT 'report:edit'
) x WHERE code = 'finance_clerk';

-- 总经理 / 园区股东 / 只读账号:零 edit 权限。
-- 三者权限完全相同,差别只在 nav_layers —— 读全开之后"只能看"的角色之间本就没有权限差别。

-- ═══ 老账号迁移:按 auth_user.role 挂对应新角色 ═══
-- auth_user.role 列保留不动(老代码路径与 V32 的 JWT role claim 仍在用)。
INSERT INTO auth_user_role (user_id, role_id)
SELECT u.id, r.id FROM auth_user u JOIN auth_role r
  ON r.code = CASE WHEN u.role = 'viewer' THEN 'viewer' ELSE 'admin' END;
