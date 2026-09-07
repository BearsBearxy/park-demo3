-- 审核机制（SIDEBAR-UX-REDESIGN spec §7）。一张表 × 一个月 = 一把审核键。
--
-- 为什么不复用 auth_audit_log:那张表是「谁做了什么」的事后流水,没有状态;
-- 审核要的是「这把键现在处于哪一态」——可查询、可加锁的当前态。留痕另存 review_log。
--
-- 为什么没有 period_close 表:整月锁账 = 该月全部审核键 approved,派生(D20),不落库。
--
-- review_key 格式 kind[:scope]:period。最长 `ledger:{10 位 companyId}:YYYY-MM` = 25 字符,
-- VARCHAR(64) 留 2.5 倍余量;utf8mb4 下主键 256 字节,远低于 InnoDB 3072 上限。
--
-- 建表带 IF NOT EXISTS(照 V91):整份文件重放一遍什么都不该变。ReviewMigrationIT 就靠重放
-- 验那两条 INSERT 的 NOT EXISTS 守卫,dev 库手工补跑也不会炸在「表已存在」上。

CREATE TABLE IF NOT EXISTS review_state (
  review_key   VARCHAR(64)  NOT NULL,              -- kind[:scope]:period
  kind         VARCHAR(24)  NOT NULL,              -- ReviewKind 枚举,最长 charging-ebike(14)
  period       CHAR(7)      NOT NULL,              -- YYYY-MM
  scope        VARCHAR(16)  NULL,                  -- ledger=companyId / s10=phase / utilities=office|phase3
  status       VARCHAR(12)  NOT NULL,              -- submitted / approved / returned
  submitted_by VARCHAR(64)  NULL,
  submitted_at DATETIME     NULL,
  reviewed_by  VARCHAR(64)  NULL,
  reviewed_at  DATETIME     NULL,
  reason       VARCHAR(255) NULL,                  -- 退回 / 撤销的必填理由
  PRIMARY KEY (review_key),
  KEY idx_review_period (period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审核态:一张表 × 一个月';

-- 留痕。状态机每走一步落一行,进「操作日志」屏作第 4 张来源表(RBAC-SPEC §7)。
-- 不设 authorizer 列:审核不走提权(review:approve 进 Perm.NOT_ELEVATABLE),
-- 没有「代他人执行」这回事。AuditQueryMapper 的第 4 路写 NULL AS authorizer。
CREATE TABLE IF NOT EXISTS review_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_key VARCHAR(64)  NOT NULL,
  action     VARCHAR(12)  NOT NULL,                -- submit / approve / return / withdraw
  actor      VARCHAR(64)  NOT NULL DEFAULT '',
  at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reason     VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_rl_key (review_key, at),
  KEY idx_rl_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审核动作留痕';

-- 第 7 个预置角色(D16 录审分离:六个既有角色权限不变,财务主管默认不带审核权)。
-- nav_layers 三层与其余五个业务角色一致;system 层不进这个字段,跟 system:view 走。
INSERT INTO auth_role (code, name, builtin, nav_layers, remark)
SELECT 'reviewer', '审核员', 1, 'data,reports,analysis', '只审不录:只有 review:approve,零 :edit'
WHERE NOT EXISTS (SELECT 1 FROM auth_role WHERE code = 'reviewer');

-- admin 是「全部权限」角色(V101 起每个新权限点都给它),reviewer 是本权限点的正主。
-- 幂等 NOT EXISTS 子查询,照 V108 / V109 / V112 的形状。
INSERT INTO auth_role_perm (role_id, perm)
SELECT r.id, 'review:approve' FROM auth_role r
WHERE r.code IN ('admin', 'reviewer')
  AND NOT EXISTS (SELECT 1 FROM auth_role_perm p WHERE p.role_id = r.id AND p.perm = 'review:approve');
