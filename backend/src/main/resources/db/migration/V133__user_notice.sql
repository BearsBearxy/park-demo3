-- V133__user_notice.sql — 铃铛「有结果了」的消息记录 + 系统类「看过」(PAGE-BEHAVIOR-SPEC §5.1 第二步、§5.3 末行)。
--
-- user_notice:每人一份、带已读。写入点(审核通过/撤销、远程授权结果、催缴单取消确认/作废、角色被改)
-- 调 NoticeService.add;插入后只留该人最近 30 条(§5.1「只留最近 30 条」)。seen_at NULL = 没看过,
-- 打开铃铛把本人全部置上。发给当前操作人自己的不写 —— 自己刚做的事是结果回执,不是通知。
-- 不挂 auth_user 外键:账号只停用不删,而写入点在别人的事务里,外键失败会把对方的业务动作一起回滚。
--
-- user_seen:系统类「看过」也存服务端,蓝点才跨电脑一致(§5.3 末行,10-01 照 06-G 改)。
--   changelog_version 看过的最新更新记录版本号(原 localStorage fp-seen-version:<账号>)
--   bell_key          上次打开铃铛时系统组的内容键(前端拼,服务端不解释),用来判「系统项自上次开铃后有新」

CREATE TABLE user_notice (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  username   VARCHAR(64)  NOT NULL COMMENT '收件人',
  kind       VARCHAR(32)  NOT NULL COMMENT 'NoticeService.Kind',
  title      VARCHAR(200) NOT NULL COMMENT '一句',
  detail     VARCHAR(500) NULL COMMENT '小字(理由等)',
  ref        VARCHAR(128) NULL COMMENT '跳转键(审核键 / bill-notices:YYYY-MM 等)',
  actor      VARCHAR(64)  NULL COMMENT '谁造成的;系统(到期回调)为 NULL',
  created_at DATETIME     NOT NULL COMMENT 'Java 时钟写',
  seen_at    DATETIME     NULL COMMENT 'NULL = 没看过',
  PRIMARY KEY (id),
  KEY idx_user_notice_user (username, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='铃铛「有结果了」消息(每人最近 30 条)';

CREATE TABLE user_seen (
  username          VARCHAR(64) NOT NULL,
  changelog_version VARCHAR(32) NULL COMMENT '看过的最新更新记录版本号',
  bell_key          VARCHAR(128) NULL COMMENT '上次开铃铛时系统组的内容键(前端拼)',
  updated_at        DATETIME    NOT NULL,
  PRIMARY KEY (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统类通知「看过」(跨电脑一致)';
