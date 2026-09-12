-- 会话作废（SESSION-SPEC，2026-09-12 用户拍板三件一起做）。
--
-- 改前:JWT 完全无状态,签发之后服务端不再认识它。后果是改密码不会让已发出的令牌失效
-- ——「怀疑口令泄露,赶紧改密码」这个动作最多要等 120 分钟才真正生效。
-- (停用账号**已经**是立刻生效的:UserPermissionCache 只装 status=1,停用的查不到 → 401。)
--
-- 闸放在 token_version:它进 UserPermissionCache 的内存快照,过滤器逐请求比对,零查库。
-- auth_session 不在请求路径上,它记录「谁在线、从哪登的、什么时候」,供审计与系统屏展示。
-- 两者在同一个事务里一起写:换一次 token_version 就作废一次会话,不会出现「表里说还活着、
-- 闸上已经死了」这种两边不一致。

ALTER TABLE auth_user
  ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0
  COMMENT '令牌版本。登录/改密/停用/强制登出时 +1;令牌里烤了签发时的值,对不上即拒绝';

CREATE TABLE auth_session (
  id            CHAR(32)     NOT NULL COMMENT '会话 id,令牌里的 sid claim',
  username      VARCHAR(64)  NOT NULL,
  token_version INT UNSIGNED NOT NULL COMMENT '签发这张令牌时的 token_version,便于排查',
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '节流写,不是每请求都更新',
  expires_at    DATETIME     NOT NULL COMMENT '= 签发时刻 + JWT 有效期,过期后行留着供审计',
  revoked_at    DATETIME     NULL,
  revoked_by    VARCHAR(64)  NULL COMMENT 'relogin=本人在别处登录 / password=改密 / admin:<用户名> / self=主动登出',
  client_ip     VARCHAR(64)  NULL,
  user_agent    VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY idx_user_live (username, revoked_at),
  KEY idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登录会话。只读展示与审计用,不在鉴权路径上';
