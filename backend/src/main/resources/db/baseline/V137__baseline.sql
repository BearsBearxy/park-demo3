-- V137__baseline.sql — 新园区库的起点:老链 V1–V137 迁到底之后的表结构 + 每个园区都要的通用行(角色、权限、管理员账号、光伏判据线默认值)
-- + 占位行(光伏/电费期别 一期~三期、充电类别 运营商一/二,让空库录得进数)。
-- 不含任何园区数据。由 backend/src/test/java/com/park/demo3/BaselineSqlGenerator.java 生成,不要手改;
-- 重新生成:cd backend && ./mvnw -q test -Dtest=BaselineSqlGenerator
-- 管理员没有口令(password_hash 是任何口令都比不上的占位),部署时必须设 ADMIN_PASSWORD,首次启动时写进去(AdminInitializer)。

CREATE TABLE `alloc_cfg` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `scope` varchar(24) NOT NULL,
  `cfg_key` varchar(24) NOT NULL,
  `cfg_value` decimal(14,8) DEFAULT NULL COMMENT '价格类参数需8位小数',
  `acct_month` char(7) NOT NULL DEFAULT '',
  `mode` enum('from','month') NOT NULL DEFAULT 'from' COMMENT 'from=自acct_month起长期(空=初始版);month=仅该月',
  `note` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_alloc_cfg` (`scope`,`cfg_key`,`acct_month`,`mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `alloc_loss_result` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `ym` char(7) NOT NULL,
  `zone` varchar(8) NOT NULL,
  `head_building_id` int NOT NULL COMMENT '组头楼栋(共享总表组=供电栋)',
  `c_qty` decimal(14,2) DEFAULT NULL COMMENT '总表用电量',
  `cable_qty` decimal(14,2) DEFAULT NULL COMMENT '铝缆用电量(仅陈列)',
  `d_qty` decimal(14,2) DEFAULT NULL COMMENT '分表用电量Σ',
  `e_qty` decimal(14,2) DEFAULT NULL COMMENT '损耗量=D-C',
  `raw_rate` decimal(10,6) DEFAULT NULL COMMENT '原损耗率=E/C',
  `g_qty` decimal(14,2) DEFAULT NULL COMMENT '公摊分摊度数(园区公共池÷分摊栋数+g_adj;不分摊的期区为NULL)',
  `adj_qty` decimal(14,2) DEFAULT NULL COMMENT '调整度数',
  `adj_rate` decimal(10,6) DEFAULT NULL COMMENT '调整损耗加点',
  `variant` varchar(12) NOT NULL COMMENT 'net=净额式/share_only=纯公摊式/none=不核算',
  `tenant_rate` decimal(10,6) DEFAULT NULL COMMENT '收取租户损耗率',
  `formula_rate` decimal(10,6) DEFAULT NULL COMMENT '公式率(net/share_only 三式算出;手工率覆盖时备查)',
  `manual_rate` decimal(10,6) DEFAULT NULL COMMENT '手工收取率 loss_rate_manual(命中即覆盖 tenant_rate)',
  `denom_qty` decimal(14,2) DEFAULT NULL COMMENT '率分母:C 或 C+铝缆(loss_denom_cable)',
  `generated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_loss_result` (`ym`,`head_building_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='楼栋损耗快照;对账区(总电表vs合计)读时派生不落库';

CREATE TABLE `alloc_result` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `tenant_id` int NOT NULL,
  `ym` char(7) NOT NULL,
  `fee_key` varchar(24) NOT NULL,
  `rule_id` int unsigned DEFAULT NULL,
  `qty` decimal(12,2) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL DEFAULT '0.00',
  `rate_snap` decimal(10,6) DEFAULT NULL,
  `price_snap` decimal(12,6) DEFAULT NULL,
  `source` varchar(8) NOT NULL DEFAULT 'gen',
  `note` varchar(255) DEFAULT NULL,
  `generated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_alloc_result` (`tenant_id`,`ym`,`fee_key`),
  KEY `idx_alloc_result_ym` (`ym`),
  KEY `idx_alloc_result_rule` (`rule_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `alloc_rule` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `zone` varchar(8) NOT NULL,
  `name` varchar(64) NOT NULL,
  `book_block` varchar(32) DEFAULT NULL COMMENT '原册块名=源册合计行标签原文;无块=NULL',
  `book_key` varchar(64) DEFAULT NULL COMMENT '原册自然键=源册行标签原文(下游查找键);多行折一池的取首行',
  `book_row` smallint DEFAULT NULL COMMENT '原册行号(book_key 所在行)=块内排序依据;多行折一池的取首行',
  `building_id` int DEFAULT NULL,
  `method` varchar(10) NOT NULL COMMENT 'direct/area/floor/loss/none(不分摊,全额挂亏)/ref(纯标准行:只出std不出应分摊,不入合计)/carrier(冲减载体:表已在别池以sign=-1冲减,本行只陈列用量不出应分摊、不入金额合计)/manual(无电表:有分摊关系但没表,qty/cost恒NULL,金额人工录入或从总表回勾)',
  `coefficient` decimal(12,2) DEFAULT NULL COMMENT 'S21 退出引擎:分母只存 alloc_cfg rule:{id}.coefficient 版本链(本列仅历史,恒 NULL)',
  `extra_qty` decimal(10,2) NOT NULL DEFAULT '0.00' COMMENT 'S21 退出引擎:加度只存 alloc_cfg rule:{id}.extra_qty 版本链(本列仅历史,恒 0)',
  `fee_key` varchar(24) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `sort_no` smallint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `round_scale` tinyint NOT NULL DEFAULT '2' COMMENT 'V131 退出引擎:取整位只存 alloc_cfg rule:{id}.round_scale 版本链(本列仅历史)',
  `std_kind` varchar(20) DEFAULT NULL COMMENT '分摊标准算式:NULL=按zone默认(p2=amount_over_base,p1/dorm=qty_price_over_base);qty_over_base=广告字档(度数/面积,量纲混用复刻)',
  `base_key` varchar(32) DEFAULT NULL COMMENT '分摊基数取自价目簿键(area_base/lamp_area_base/elevator_area_base...),NULL=用coefficient',
  `floor_label` varchar(16) DEFAULT NULL COMMENT '楼层显示名(四楼/负一层);NULL=整栋(货梯这类跨层池)',
  `side` varchar(8) DEFAULT NULL COMMENT '侧向(东侧/西侧);NULL=整层',
  `fee_name` varchar(32) DEFAULT NULL COMMENT '费项显示名(走廊灯/消防/货梯),进自动池名末段',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `alloc_pool_meter_result` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `ym` char(7) NOT NULL,
  `rule_id` int unsigned NOT NULL,
  `meter_id` int unsigned NOT NULL,
  `sign` tinyint NOT NULL DEFAULT '1' COMMENT '+1计入/-1从池剔除(与 alloc_rule_meter.sign 同批快照)',
  `seq` smallint unsigned NOT NULL DEFAULT '0' COMMENT '池内行序(按表 sort_no/id),锁死屏上与导出的行序',
  `factor_snap` decimal(10,2) DEFAULT NULL COMMENT '倍率快照(取当月读数的 factor_snap,非档案现值)',
  `prev_total` decimal(14,2) DEFAULT NULL COMMENT '上月行至(总)',
  `curr_total` decimal(14,2) DEFAULT NULL COMMENT '本月行至(总)',
  `qty_total` decimal(14,2) DEFAULT NULL,
  `qty_sharp` decimal(14,2) DEFAULT NULL,
  `qty_peak` decimal(14,2) DEFAULT NULL,
  `qty_flat` decimal(14,2) DEFAULT NULL,
  `qty_valley` decimal(14,2) DEFAULT NULL,
  `cost_amount` decimal(14,2) DEFAULT NULL COMMENT '该表应分摊;仅 p1/dorm 逐表ROUND口径有值,p2 池级一次ROUND→NULL(金额只在池行)',
  `generated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pool_meter_result` (`ym`,`rule_id`,`meter_id`),
  KEY `idx_pmr_ym` (`ym`),
  KEY `fk_pmr_rule` (`rule_id`),
  CONSTRAINT `fk_pmr_rule` FOREIGN KEY (`rule_id`) REFERENCES `alloc_rule` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='池核算逐表明细快照(原册一表一行);金额口径见 cost_amount 注释';

CREATE TABLE `alloc_pool_result` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `ym` char(7) NOT NULL,
  `rule_id` int unsigned NOT NULL,
  `qty_total` decimal(14,2) DEFAULT NULL,
  `qty_sharp` decimal(14,2) DEFAULT NULL,
  `qty_peak` decimal(14,2) DEFAULT NULL,
  `qty_flat` decimal(14,2) DEFAULT NULL,
  `qty_valley` decimal(14,2) DEFAULT NULL,
  `extra_qty_snap` decimal(14,2) DEFAULT NULL COMMENT '当月加度/扣度(进标准分子不进应分摊)',
  `cost_amount` decimal(14,2) DEFAULT NULL COMMENT '应分摊',
  `base_snap` decimal(14,2) DEFAULT NULL COMMENT '分摊基数快照(层数/面积)',
  `std_value` decimal(14,8) DEFAULT NULL COMMENT '分摊标准(元每层/元每平米/整额)',
  `fold_add` decimal(14,8) DEFAULT NULL COMMENT '折入叠加档,std_value已含',
  `price_snap` decimal(14,8) DEFAULT NULL COMMENT 'p1/dorm合成单价;p2分时NULL',
  `allocated_amount` decimal(14,2) DEFAULT NULL COMMENT '引擎按受益人试算摊出(非实收)',
  `gap_amount` decimal(14,2) DEFAULT NULL COMMENT '差额=摊出−应分摊',
  `warn` varchar(255) DEFAULT NULL COMMENT '缺读数/断链等行级警告',
  `generated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pool_result` (`ym`,`rule_id`),
  KEY `fk_pr_rule` (`rule_id`),
  CONSTRAINT `fk_pr_rule` FOREIGN KEY (`rule_id`) REFERENCES `alloc_rule` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='池核算快照,账单依据,重导读数不漂移';

CREATE TABLE `alloc_rule_link` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `src_rule_id` int unsigned NOT NULL,
  `dst_rule_id` int unsigned NOT NULL,
  `link_type` varchar(12) NOT NULL COMMENT 'fold_price=src池分摊标准叠加进dst池标准;fold_qty=src池净度数计入dst池度数',
  `acct_month` char(7) NOT NULL DEFAULT '' COMMENT '''''=初始版;''YYYY-MM''=自该月起的版本组(按 dst 池分组)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_link` (`src_rule_id`,`dst_rule_id`,`link_type`,`acct_month`),
  KEY `fk_link_dst` (`dst_rule_id`),
  CONSTRAINT `fk_link_dst` FOREIGN KEY (`dst_rule_id`) REFERENCES `alloc_rule` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_link_src` FOREIGN KEY (`src_rule_id`) REFERENCES `alloc_rule` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='池间折入链,引擎按拓扑序计算,禁环';

CREATE TABLE `alloc_rule_member` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `rule_id` int unsigned NOT NULL,
  `tenant_id` int NOT NULL,
  `weight` decimal(6,3) DEFAULT NULL,
  `acct_month` char(7) NOT NULL DEFAULT '' COMMENT '''''=默认长期行;''YYYY-MM''=该月覆盖(月行优先回退默认)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_alloc_rule_member` (`rule_id`,`acct_month`,`tenant_id`),
  CONSTRAINT `fk_armb_rule` FOREIGN KEY (`rule_id`) REFERENCES `alloc_rule` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `alloc_rule_version` (
  `rule_id` int unsigned NOT NULL,
  `part` enum('meter','link') NOT NULL COMMENT 'meter=绑定表(按池);link=入向折入链(按 dst 池)',
  `acct_month` char(7) NOT NULL COMMENT '版本组起始月 YYYY-MM',
  PRIMARY KEY (`rule_id`,`part`,`acct_month`),
  CONSTRAINT `fk_arv_rule` FOREIGN KEY (`rule_id`) REFERENCES `alloc_rule` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='公摊池绑定表/折入链的版本组登记(空组靠它存在)';

CREATE TABLE `auth_audit_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `ts` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actor` varchar(64) NOT NULL DEFAULT '',
  `action` varchar(32) NOT NULL,
  `target` varchar(128) DEFAULT NULL,
  `authorizer` varchar(64) DEFAULT NULL,
  `detail` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_aal_ts` (`ts`),
  KEY `idx_aal_actor` (`actor`,`ts`),
  KEY `idx_aal_action` (`action`,`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='账号/角色/编辑锁 审计日志';

CREATE TABLE `auth_role` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(32) NOT NULL,
  `name` varchar(32) NOT NULL,
  `builtin` tinyint unsigned NOT NULL DEFAULT '0',
  `nav_layers` varchar(64) NOT NULL DEFAULT 'data,reports,analysis',
  `remark` varchar(128) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_role_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色(RBAC v2)';

CREATE TABLE `auth_role_perm` (
  `role_id` int unsigned NOT NULL,
  `perm` varchar(32) NOT NULL,
  PRIMARY KEY (`role_id`,`perm`),
  CONSTRAINT `fk_arp_role` FOREIGN KEY (`role_id`) REFERENCES `auth_role` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='角色持有的权限点';

CREATE TABLE `auth_session` (
  `id` char(32) NOT NULL COMMENT '会话 id,令牌里的 sid claim',
  `username` varchar(64) NOT NULL,
  `token_version` int unsigned NOT NULL COMMENT '签发这张令牌时的 token_version,便于排查',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `last_seen_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '节流写,不是每请求都更新',
  `expires_at` datetime NOT NULL COMMENT '= 签发时刻 + JWT 有效期,过期后行留着供审计',
  `revoked_at` datetime DEFAULT NULL,
  `revoked_by` varchar(64) DEFAULT NULL COMMENT 'relogin=本人在别处登录 / password=改密 / admin:<用户名> / self=主动登出',
  `client_ip` varchar(64) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_user_live` (`username`,`revoked_at`),
  KEY `idx_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='登录会话。只读展示与审计用,不在鉴权路径上';

CREATE TABLE `auth_user` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `display_name` varchar(64) NOT NULL,
  `status` tinyint unsigned NOT NULL DEFAULT '1',
  `role` varchar(16) NOT NULL DEFAULT 'admin',
  `must_change_password` tinyint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `token_version` int unsigned NOT NULL DEFAULT '0' COMMENT '令牌版本。登录/改密/停用/强制登出时 +1;令牌里烤了签发时的值,对不上即拒绝',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_name` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `auth_user_role` (
  `user_id` int unsigned NOT NULL,
  `role_id` int unsigned NOT NULL,
  PRIMARY KEY (`user_id`,`role_id`),
  KEY `idx_aur_role` (`role_id`),
  CONSTRAINT `fk_aur_role` FOREIGN KEY (`role_id`) REFERENCES `auth_role` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_aur_user` FOREIGN KEY (`user_id`) REFERENCES `auth_user` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='用户×角色(多对多:现实里有"主管兼管理员")';

CREATE TABLE `budget_row` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `year` smallint NOT NULL,
  `label` varchar(64) NOT NULL,
  `sub` tinyint(1) NOT NULL DEFAULT '0',
  `amount_budget` decimal(18,2) DEFAULT NULL,
  `amount_actual` decimal(18,2) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_budget` (`year`,`sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `building` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `phase` tinyint unsigned NOT NULL,
  `floor_count` tinyint unsigned NOT NULL,
  `total_area` decimal(10,2) NOT NULL,
  `rentable_area` decimal(10,2) NOT NULL,
  `status` tinyint unsigned NOT NULL DEFAULT '1',
  `per_floor` tinyint unsigned NOT NULL DEFAULT '0',
  `remark` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `zone` varchar(8) DEFAULT NULL COMMENT '期区(p1/p2/p3…/dorm);唯一事实来源。NULL=未标注,引擎回退按该栋首块表的 zone 猜',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_building_name` (`name`),
  KEY `idx_building_phase` (`phase`),
  KEY `idx_building_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `alloc_loss_note` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `ym` char(7) NOT NULL,
  `head_building_id` int unsigned NOT NULL COMMENT '组头楼栋=alloc_loss_result.head_building_id',
  `note` varchar(255) NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_loss_note` (`ym`,`head_building_id`),
  KEY `fk_loss_note_building` (`head_building_id`),
  CONSTRAINT `fk_loss_note_building` FOREIGN KEY (`head_building_id`) REFERENCES `building` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='楼栋损耗备注(人工填);独立于 alloc_loss_result,重算(先删后插)不丢';

CREATE TABLE `charging_cat` (
  `schedule_no` tinyint unsigned NOT NULL,
  `cat_id` varchar(16) NOT NULL,
  `name` varchar(32) NOT NULL,
  `short` varchar(12) NOT NULL,
  `tint` varchar(12) DEFAULT NULL,
  `sort_no` smallint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`schedule_no`,`cat_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `charging_record` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `schedule_no` tinyint unsigned NOT NULL,
  `cat` varchar(16) NOT NULL,
  `acct_month` varchar(7) NOT NULL,
  `kwh` decimal(14,2) NOT NULL DEFAULT '0.00',
  `fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `cost` decimal(14,2) NOT NULL DEFAULT '0.00',
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(8) NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_charging` (`schedule_no`,`cat`,`acct_month`),
  KEY `idx_charging_sched_acct` (`schedule_no`,`acct_month`),
  CONSTRAINT `fk_charging_cat` FOREIGN KEY (`schedule_no`, `cat`) REFERENCES `charging_cat` (`schedule_no`, `cat_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cp_power_usage` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `operator` varchar(32) NOT NULL,
  `vehicle_type` varchar(8) NOT NULL,
  `period` date NOT NULL,
  `meter_kwh` decimal(12,2) NOT NULL DEFAULT '0.00',
  `note` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cp_power_usage` (`operator`,`vehicle_type`,`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cp_station` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(48) NOT NULL,
  `operator` varchar(32) NOT NULL,
  `vehicle_type` varchar(8) NOT NULL,
  `sort_no` smallint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cp_station_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `cp_reading` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `station_id` int unsigned NOT NULL,
  `read_date` date NOT NULL,
  `charge_kwh` decimal(12,2) NOT NULL DEFAULT '0.00',
  `fee` decimal(12,2) NOT NULL DEFAULT '0.00',
  `revenue` decimal(12,2) NOT NULL DEFAULT '0.00',
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(12) NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cp_reading` (`station_id`,`read_date`),
  KEY `idx_cp_reading_date` (`read_date`),
  CONSTRAINT `fk_cp_reading_station` FOREIGN KEY (`station_id`) REFERENCES `cp_station` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `data_change_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `ym` char(7) NOT NULL,
  `source` varchar(16) NOT NULL COMMENT 'meter-archive|meter-reading',
  `changed_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_dcl_ym` (`ym`,`changed_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='抄表数据改动流水,给需重算用(METER-TIMELINE-SPEC §1.5)';

CREATE TABLE `elec_meter` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(48) NOT NULL,
  `kind` varchar(8) NOT NULL,
  `sort_no` smallint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_elec_meter_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `elec_cost_entry` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `meter_id` int unsigned NOT NULL,
  `acct_month` char(7) NOT NULL,
  `fee_key` varchar(24) NOT NULL,
  `sub_key` varchar(16) NOT NULL DEFAULT '',
  `amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `qty` decimal(14,2) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(12) NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_elec_cost_entry` (`meter_id`,`acct_month`,`fee_key`,`sub_key`),
  KEY `idx_ece_month` (`acct_month`),
  CONSTRAINT `fk_ece_meter` FOREIGN KEY (`meter_id`) REFERENCES `elec_meter` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `elec_phase` (
  `id` varchar(4) NOT NULL,
  `name` varchar(48) NOT NULL,
  `short` varchar(8) NOT NULL,
  `sort_no` smallint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `elec_price_cfg` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `acct_month` char(7) NOT NULL DEFAULT '',
  `cfg_key` varchar(24) NOT NULL,
  `cfg_value` decimal(12,6) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_elec_price_cfg` (`acct_month`,`cfg_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `elec_record` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `type` varchar(8) NOT NULL,
  `phase_id` varchar(4) NOT NULL,
  `acct_month` varchar(7) NOT NULL,
  `inv_date` varchar(10) DEFAULT NULL,
  `period` varchar(3) DEFAULT NULL,
  `cat` varchar(16) DEFAULT NULL,
  `unit` varchar(8) DEFAULT NULL,
  `qty` decimal(14,2) DEFAULT NULL,
  `demand` decimal(14,2) DEFAULT NULL,
  `price` decimal(14,6) NOT NULL DEFAULT '0.000000',
  `rate` decimal(6,4) NOT NULL DEFAULT '0.0000',
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(8) NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_elec_acct` (`acct_month`),
  KEY `idx_elec_phase` (`phase_id`),
  KEY `idx_elec_type` (`type`),
  CONSTRAINT `fk_elec_phase` FOREIGN KEY (`phase_id`) REFERENCES `elec_phase` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `import_log` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `data_type` varchar(32) NOT NULL,
  `type_label` varchar(64) NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `target` varchar(64) DEFAULT NULL,
  `rows` int NOT NULL DEFAULT '0',
  `ok` int NOT NULL DEFAULT '0',
  `warn` int NOT NULL DEFAULT '0',
  `status` varchar(16) NOT NULL,
  `operator` varchar(64) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_type_time` (`data_type`,`created_at`),
  KEY `idx_time` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `management_company` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(64) NOT NULL,
  `short` varchar(8) NOT NULL,
  `sort_no` smallint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `full_name` varchar(128) DEFAULT NULL COMMENT '法定全称,印在通知单落款与账户块;空则回落 name',
  `status` tinyint NOT NULL DEFAULT '1' COMMENT '1=启用 0=停用(停用不再出现在收款公司选择器,历史单不受影响)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_company_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `company_account` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `company_id` int unsigned NOT NULL,
  `kind` varchar(12) NOT NULL COMMENT 'bank对公银行/wechat/alipay/personal个人卡/other',
  `account_name` varchar(64) DEFAULT NULL COMMENT '户名(对公=公司全称,个人=收款人姓名)',
  `account_no` varchar(64) DEFAULT NULL COMMENT '账号/收款码标识',
  `bank_name` varchar(128) DEFAULT NULL COMMENT '开户行(bank/personal 用;wechat/alipay 留空)',
  `is_default` tinyint NOT NULL DEFAULT '0' COMMENT '该公司默认收款账户(导出时预选)',
  `sort_no` smallint NOT NULL DEFAULT '0',
  `remark` varchar(255) DEFAULT NULL COMMENT '备注(如「仅限水电费」)',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_company_account` (`company_id`),
  CONSTRAINT `fk_company_account` FOREIGN KEY (`company_id`) REFERENCES `management_company` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='公司收款账户;导出通知单账户块取默认';

CREATE TABLE `ledger_book` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `screen` varchar(12) NOT NULL COMMENT 'ledger=月度台账 | s10=附表10',
  `company_id` int unsigned DEFAULT NULL COMMENT 'ledger 屏:记账公司',
  `phase` tinyint unsigned DEFAULT NULL COMMENT 's10 屏:期区 1..4',
  `name` varchar(64) NOT NULL,
  `current_version_id` bigint unsigned DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_book_company` (`screen`,`company_id`),
  UNIQUE KEY `uk_book_phase` (`screen`,`phase`),
  KEY `fk_book_company` (`company_id`),
  CONSTRAINT `fk_book_company` FOREIGN KEY (`company_id`) REFERENCES `management_company` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `book_template_version` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `book_id` int unsigned NOT NULL,
  `ver` int NOT NULL,
  `definition` json NOT NULL COMMENT '两级表头定义:groups[{id,label,cols[{id,std,label,aliases,slot,hidden,w}]}]',
  `note` varchar(255) DEFAULT NULL,
  `created_by` varchar(64) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tpl` (`book_id`,`ver`),
  CONSTRAINT `fk_tpl_book` FOREIGN KEY (`book_id`) REFERENCES `ledger_book` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `book_month_pin` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `screen` varchar(12) NOT NULL COMMENT 'ledger | s10',
  `owner_id` int unsigned NOT NULL COMMENT 'ledger=company_id; s10=phase(1..4)',
  `period_year` smallint NOT NULL,
  `period_month` tinyint NOT NULL,
  `version_id` bigint unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pin` (`screen`,`owner_id`,`period_year`,`period_month`),
  KEY `idx_pin_lookup` (`screen`,`owner_id`,`period_year`,`period_month`),
  KEY `fk_pin_ver` (`version_id`),
  CONSTRAINT `fk_pin_ver` FOREIGN KEY (`version_id`) REFERENCES `book_template_version` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `meter` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `kind` varchar(8) NOT NULL,
  `zone` varchar(8) NOT NULL,
  `name` varchar(64) NOT NULL,
  `meter_type` varchar(32) DEFAULT NULL,
  `device_type` varchar(16) DEFAULT NULL COMMENT '表类型:single单相|three三相|multi多功能(分时)|demand需量|bidir双向;口径2026-07-27拍板',
  `code` varchar(32) DEFAULT NULL,
  `factor` decimal(10,2) NOT NULL DEFAULT '1.00',
  `sort_no` smallint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `suspect` varchar(16) DEFAULT NULL COMMENT '存疑档案(§F1 两级):shadow=疑似重复建档(四空且配到档案完整的同栋同类表、同月三格全等),不进楼栋分表Σ;incomplete=四空但配不上,只是档案不全,照常计入Σ;NULL=正常。标记不删数据',
  `is_dorm_room` tinyint NOT NULL DEFAULT '0' COMMENT '宿舍房间表(房号计费分间);判定树②居民价的唯一判据,建档时定死不在派生时猜',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_meter` (`kind`,`zone`,`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `alloc_rule_meter` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `rule_id` int unsigned NOT NULL,
  `meter_id` int unsigned NOT NULL,
  `sign` tinyint NOT NULL DEFAULT '1' COMMENT '+1计入/-1从池剔除(分表、转供子表这类)',
  `acct_month` char(7) NOT NULL DEFAULT '' COMMENT '''''=初始版;''YYYY-MM''=自该月起的版本组(前滚到更晚版本之前)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_alloc_rule_meter` (`rule_id`,`meter_id`,`acct_month`),
  KEY `fk_arm_meter` (`meter_id`),
  CONSTRAINT `fk_arm_meter` FOREIGN KEY (`meter_id`) REFERENCES `meter` (`id`),
  CONSTRAINT `fk_arm_rule` FOREIGN KEY (`rule_id`) REFERENCES `alloc_rule` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `meter_archive_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `meter_id` int unsigned NOT NULL,
  `tbl` varchar(8) NOT NULL COMMENT 'assign|status',
  `from_ym` char(7) NOT NULL,
  `action` varchar(8) NOT NULL COMMENT 'insert|update|delete',
  `before_json` json DEFAULT NULL,
  `after_json` json DEFAULT NULL,
  `src` varchar(12) NOT NULL,
  `batch_id` varchar(36) DEFAULT NULL,
  `file_name` varchar(255) DEFAULT NULL,
  `row_ref` varchar(64) DEFAULT NULL COMMENT '导入源行定位(sheet!行号)',
  `operator` varchar(64) NOT NULL DEFAULT '',
  `at` datetime NOT NULL COMMENT 'Java 时钟写',
  PRIMARY KEY (`id`),
  KEY `idx_mal_meter` (`meter_id`,`id`),
  KEY `idx_mal_batch` (`batch_id`),
  KEY `idx_mal_at` (`at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='表档案每一次写的前后像(METER-TIMELINE-SPEC §1.4)';

CREATE TABLE `meter_book_seen` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `meter_id` int unsigned NOT NULL,
  `ym` char(7) NOT NULL COMMENT '册子行的月份',
  `batch_id` varchar(36) NOT NULL COMMENT '导入批次(同 meter_archive_log.batch_id)',
  `file_name` varchar(255) DEFAULT NULL COMMENT '导入的文件名',
  `seen_at` datetime NOT NULL COMMENT 'Java 时钟写',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_meter_book_seen` (`meter_id`,`ym`,`batch_id`),
  KEY `idx_meter_book_seen_ym` (`ym`),
  KEY `idx_meter_book_seen_batch` (`batch_id`),
  CONSTRAINT `fk_meter_book_seen_meter` FOREIGN KEY (`meter_id`) REFERENCES `meter` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='某表在某月导入的册子里出现过(METER-TIMELINE-SPEC §10)';

CREATE TABLE `meter_reading` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `meter_id` int unsigned NOT NULL,
  `ym` char(7) NOT NULL,
  `prev_total` decimal(14,2) DEFAULT NULL,
  `curr_total` decimal(14,2) DEFAULT NULL,
  `prev_sharp` decimal(14,2) DEFAULT NULL,
  `prev_peak` decimal(14,2) DEFAULT NULL,
  `prev_flat` decimal(14,2) DEFAULT NULL,
  `prev_valley` decimal(14,2) DEFAULT NULL,
  `curr_sharp` decimal(14,2) DEFAULT NULL,
  `curr_peak` decimal(14,2) DEFAULT NULL,
  `curr_flat` decimal(14,2) DEFAULT NULL,
  `curr_valley` decimal(14,2) DEFAULT NULL,
  `factor_snap` decimal(10,2) NOT NULL DEFAULT '1.00',
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(12) NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_meter_reading` (`meter_id`,`ym`),
  KEY `idx_meter_reading_ym` (`ym`),
  CONSTRAINT `fk_meter_reading_meter` FOREIGN KEY (`meter_id`) REFERENCES `meter` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `meter_status` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `meter_id` int unsigned NOT NULL,
  `from_ym` char(7) NOT NULL,
  `status` varchar(8) NOT NULL COMMENT 'active 在用|retired 停用(在册不计)|removed 已拆(不在册);早于第一行 = 不在册',
  `src` varchar(12) NOT NULL COMMENT 'import|manual|migrate|contract',
  `batch_id` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_meter_status` (`meter_id`,`from_ym`),
  KEY `idx_meter_status_batch` (`batch_id`),
  CONSTRAINT `fk_meter_status_meter` FOREIGN KEY (`meter_id`) REFERENCES `meter` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='表的存在与状态按月分段(METER-TIMELINE-SPEC §1.3)';

CREATE TABLE `office_record` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `schedule_no` tinyint unsigned NOT NULL,
  `acct_month` varchar(7) NOT NULL,
  `belong_month` varchar(7) NOT NULL,
  `elec_qty` decimal(14,2) NOT NULL DEFAULT '0.00',
  `elec_price` decimal(14,6) NOT NULL DEFAULT '0.000000',
  `water_qty` decimal(14,2) NOT NULL DEFAULT '0.00',
  `water_price` decimal(14,6) NOT NULL DEFAULT '0.000000',
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(8) NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_office` (`schedule_no`,`acct_month`),
  KEY `idx_office_sched_acct` (`schedule_no`,`acct_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `param_change_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `ts` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `actor` varchar(64) NOT NULL DEFAULT '',
  `authorizer` varchar(64) DEFAULT NULL COMMENT '提权授权人(NULL=本人有权,非 NULL=经此人当场授权)',
  `tbl` enum('price','alloc') NOT NULL COMMENT 'price=tenant_price_cfg / alloc=alloc_cfg',
  `scope` varchar(24) NOT NULL,
  `cfg_key` varchar(32) NOT NULL,
  `acct_month` char(7) NOT NULL DEFAULT '',
  `mode` enum('from','month') NOT NULL DEFAULT 'from',
  `old_value` decimal(14,8) DEFAULT NULL,
  `new_value` decimal(14,8) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `action` enum('set','delete','recalc','migrate') NOT NULL DEFAULT 'set',
  `ym` char(7) DEFAULT NULL COMMENT 'recalc 动作的账期',
  PRIMARY KEY (`id`),
  KEY `idx_pcl_key` (`scope`,`cfg_key`,`acct_month`),
  KEY `idx_pcl_ts` (`ts`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='计费参数变更日志(S21)';

CREATE TABLE `pnl_row` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `schedule` varchar(4) NOT NULL,
  `year` int NOT NULL,
  `row_key` varchar(40) NOT NULL,
  `group_label` varchar(64) NOT NULL DEFAULT '',
  `label` varchar(160) NOT NULL,
  `kind` varchar(12) NOT NULL DEFAULT 'detail',
  `note` varchar(255) DEFAULT NULL,
  `m1` decimal(18,2) DEFAULT NULL,
  `m2` decimal(18,2) DEFAULT NULL,
  `m3` decimal(18,2) DEFAULT NULL,
  `m4` decimal(18,2) DEFAULT NULL,
  `m5` decimal(18,2) DEFAULT NULL,
  `m6` decimal(18,2) DEFAULT NULL,
  `m7` decimal(18,2) DEFAULT NULL,
  `m8` decimal(18,2) DEFAULT NULL,
  `m9` decimal(18,2) DEFAULT NULL,
  `m10` decimal(18,2) DEFAULT NULL,
  `m11` decimal(18,2) DEFAULT NULL,
  `m12` decimal(18,2) DEFAULT NULL,
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pnl` (`schedule`,`year`,`row_key`),
  KEY `idx_pnl` (`schedule`,`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pv_phase` (
  `id` varchar(4) NOT NULL,
  `name` varchar(48) NOT NULL,
  `short` varchar(8) NOT NULL,
  `online` varchar(7) DEFAULT NULL,
  `cost` decimal(16,2) NOT NULL DEFAULT '0.00',
  `capacity` decimal(12,6) NOT NULL DEFAULT '0.000000',
  `cap_note` varchar(32) DEFAULT NULL,
  `sort_no` smallint unsigned NOT NULL DEFAULT '0',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pv_record` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `phase_id` varchar(4) NOT NULL,
  `acct_month` varchar(7) NOT NULL,
  `occur_month` varchar(7) NOT NULL,
  `self_kwh` decimal(14,2) NOT NULL DEFAULT '0.00',
  `self_amt` decimal(14,2) NOT NULL DEFAULT '0.00',
  `grid_kwh` decimal(14,2) NOT NULL DEFAULT '0.00',
  `grid_amt` decimal(14,2) NOT NULL DEFAULT '0.00',
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(8) NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pv` (`phase_id`,`acct_month`,`occur_month`),
  KEY `idx_pv_acct` (`acct_month`),
  KEY `idx_pv_phase` (`phase_id`),
  CONSTRAINT `fk_pv_phase` FOREIGN KEY (`phase_id`) REFERENCES `pv_phase` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pv_station` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(48) NOT NULL,
  `phase` tinyint NOT NULL,
  `metered` tinyint unsigned NOT NULL DEFAULT '1' COMMENT '1=已装光伏计量表 0=未安装(不入任何分析,护栏分母排除)',
  `capacity_kwp` decimal(10,2) DEFAULT NULL,
  `panel_count` int unsigned DEFAULT NULL COMMENT '光伏板数量(块);空=未录',
  `panel_watt` decimal(7,1) DEFAULT NULL COMMENT '单块标称功率 W(出厂铭牌);空=未录',
  `price_yuan` decimal(8,4) DEFAULT NULL,
  `sort_no` smallint unsigned NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pv_station_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `pv_reading` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `station_id` int unsigned NOT NULL,
  `read_date` date NOT NULL,
  `gen_total` decimal(12,2) NOT NULL DEFAULT '0.00',
  `self_use` decimal(12,2) NOT NULL DEFAULT '0.00',
  `grid_feed` decimal(12,2) NOT NULL DEFAULT '0.00',
  `price_snap` decimal(8,4) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(12) NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_pv_reading` (`station_id`,`read_date`),
  KEY `idx_pv_reading_date` (`read_date`),
  CONSTRAINT `fk_pv_reading_station` FOREIGN KEY (`station_id`) REFERENCES `pv_station` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `recon_mark` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `year` int NOT NULL,
  `month` int NOT NULL,
  `tenant_id` int unsigned DEFAULT NULL,
  `tenant_name` varchar(128) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_mark` (`year`,`month`,`tenant_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `report_account` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `company_id` int unsigned NOT NULL,
  `statement` varchar(8) NOT NULL,
  `year` int NOT NULL,
  `month` int NOT NULL,
  `row_key` varchar(40) NOT NULL,
  `parent_key` varchar(40) DEFAULT NULL,
  `code` varchar(20) DEFAULT NULL,
  `label` varchar(160) NOT NULL,
  `level` int NOT NULL DEFAULT '0',
  `sort_order` int NOT NULL DEFAULT '0',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_acct` (`company_id`,`statement`,`year`,`month`,`row_key`),
  KEY `idx_acct_period` (`company_id`,`statement`,`year`,`month`),
  CONSTRAINT `fk_racct_company` FOREIGN KEY (`company_id`) REFERENCES `management_company` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `report_amount` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `company_id` int unsigned NOT NULL,
  `statement` varchar(8) NOT NULL,
  `year` int NOT NULL,
  `month` int NOT NULL,
  `row_key` varchar(32) NOT NULL,
  `field` varchar(8) NOT NULL,
  `amount` decimal(18,2) NOT NULL DEFAULT '0.00',
  `created_at` datetime NOT NULL,
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_amt` (`company_id`,`statement`,`year`,`month`,`row_key`,`field`),
  KEY `idx_period` (`company_id`,`statement`,`year`,`month`),
  CONSTRAINT `fk_ramt_company` FOREIGN KEY (`company_id`) REFERENCES `management_company` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `report_custom_row` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `company_id` int unsigned NOT NULL,
  `statement` varchar(8) NOT NULL,
  `row_key` varchar(40) NOT NULL,
  `parent_key` varchar(32) NOT NULL,
  `label` varchar(128) NOT NULL,
  `level` int NOT NULL DEFAULT '1',
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_row` (`company_id`,`statement`,`row_key`),
  KEY `idx_cr` (`company_id`,`statement`),
  CONSTRAINT `fk_rcr_company` FOREIGN KEY (`company_id`) REFERENCES `management_company` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `review_log` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `review_key` varchar(64) NOT NULL,
  `action` varchar(12) NOT NULL,
  `actor` varchar(64) NOT NULL DEFAULT '',
  `at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_rl_key` (`review_key`,`at`),
  KEY `idx_rl_at` (`at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审核动作留痕';

CREATE TABLE `review_state` (
  `review_key` varchar(64) NOT NULL,
  `kind` varchar(24) NOT NULL,
  `period` char(7) NOT NULL,
  `scope` varchar(16) DEFAULT NULL,
  `status` varchar(12) NOT NULL,
  `submitted_by` varchar(64) DEFAULT NULL,
  `submitted_at` datetime DEFAULT NULL,
  `reviewed_by` varchar(64) DEFAULT NULL,
  `reviewed_at` datetime DEFAULT NULL,
  `reason` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`review_key`),
  KEY `idx_review_period` (`period`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='审核态:一张表 × 一个月';

CREATE TABLE `s10_record` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` int DEFAULT NULL,
  `tenant_name` varchar(64) NOT NULL,
  `phase` tinyint NOT NULL,
  `acct_month` char(7) NOT NULL,
  `profile` varchar(16) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'manual',
  `office_rent` decimal(14,2) NOT NULL DEFAULT '0.00',
  `office_mgmt_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `factory_rent` decimal(14,2) NOT NULL DEFAULT '0.00',
  `factory_mgmt_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `land_rent` decimal(14,2) NOT NULL DEFAULT '0.00',
  `shop_rent` decimal(14,2) NOT NULL DEFAULT '0.00',
  `shop_mgmt_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `dorm_rent` decimal(14,2) NOT NULL DEFAULT '0.00',
  `dorm_facility_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `infra_office` decimal(14,2) NOT NULL DEFAULT '0.00',
  `infra_factory` decimal(14,2) NOT NULL DEFAULT '0.00',
  `infra_shop` decimal(14,2) NOT NULL DEFAULT '0.00',
  `infra_dorm` decimal(14,2) NOT NULL DEFAULT '0.00',
  `elevator_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `transformer_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `land_use_tax` decimal(14,2) NOT NULL DEFAULT '0.00',
  `network_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `access_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `other_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `elec_basic` decimal(14,2) NOT NULL DEFAULT '0.00',
  `elec_std` decimal(14,2) NOT NULL DEFAULT '0.00',
  `elec_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `water_std` decimal(14,2) NOT NULL DEFAULT '0.00',
  `water_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `guarantee_rent` decimal(14,2) NOT NULL DEFAULT '0.00',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `extra_fees` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_s10` (`phase`,`acct_month`,`tenant_name`),
  KEY `idx_s10_slot` (`phase`,`acct_month`),
  KEY `idx_s10_month` (`acct_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `salary_record` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `acct_month` varchar(7) NOT NULL,
  `emp_idx` int NOT NULL DEFAULT '0',
  `name` varchar(32) NOT NULL,
  `role` varchar(32) DEFAULT NULL,
  `base` decimal(12,2) NOT NULL DEFAULT '0.00',
  `post` decimal(12,2) NOT NULL DEFAULT '0.00',
  `perf` decimal(12,2) NOT NULL DEFAULT '0.00',
  `attend` decimal(12,2) NOT NULL DEFAULT '0.00',
  `skill` decimal(12,2) NOT NULL DEFAULT '0.00',
  `edu` decimal(12,2) NOT NULL DEFAULT '0.00',
  `other` decimal(12,2) NOT NULL DEFAULT '0.00',
  `lunch` decimal(12,2) NOT NULL DEFAULT '0.00',
  `heat` decimal(12,2) NOT NULL DEFAULT '0.00',
  `commission` decimal(12,2) NOT NULL DEFAULT '0.00',
  `should_days` smallint NOT NULL DEFAULT '0',
  `leave_days` smallint NOT NULL DEFAULT '0',
  `social` decimal(12,2) NOT NULL DEFAULT '0.00',
  `tax` decimal(12,2) NOT NULL DEFAULT '0.00',
  `other_deduct` decimal(12,2) NOT NULL DEFAULT '0.00',
  `sign` tinyint(1) NOT NULL DEFAULT '0',
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(8) NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_salary_acct` (`acct_month`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tenant_category` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(32) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tc_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tenant` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `company_name` varchar(128) NOT NULL,
  `contact_name` varchar(32) DEFAULT NULL,
  `contact_phone` varchar(32) DEFAULT NULL,
  `business_type` varchar(32) NOT NULL,
  `status` tinyint unsigned NOT NULL DEFAULT '1',
  `category_id` int unsigned DEFAULT NULL,
  `phase` tinyint unsigned DEFAULT NULL,
  `since` char(7) DEFAULT NULL,
  `remark` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `parent_id` int unsigned DEFAULT NULL,
  `aliases` varchar(255) DEFAULT NULL COMMENT '别名,逗号分隔(worksheet老板名/曾用名);导入与挂号匹配时与正名同权',
  `offbook` tinyint NOT NULL DEFAULT '0' COMMENT '账外户:出单但不入应收(notice_kind=offbook)',
  PRIMARY KEY (`id`),
  KEY `idx_tenant_status` (`status`),
  KEY `idx_tenant_cat` (`category_id`),
  KEY `idx_tenant_biz` (`business_type`),
  KEY `idx_tenant_name` (`company_name`),
  KEY `idx_tenant_parent` (`parent_id`),
  CONSTRAINT `fk_tenant_cat` FOREIGN KEY (`category_id`) REFERENCES `tenant_category` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tenant_parent` FOREIGN KEY (`parent_id`) REFERENCES `tenant` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `bill_note_override` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `ym` char(7) NOT NULL,
  `tenant_id` int unsigned NOT NULL,
  `fee_key` varchar(32) NOT NULL,
  `premise_key` varchar(64) NOT NULL DEFAULT '' COMMENT '行 premise 原文;无场地行空串',
  `meter_key` varchar(16) NOT NULL DEFAULT '' COMMENT 'meter_id 字符串;合并行=merged;无表行空串',
  `seg_key` varchar(8) NOT NULL DEFAULT '' COMMENT 'sharp/peak/flat/valley;非分时行空串',
  `note` varchar(255) NOT NULL,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_note_override` (`ym`,`tenant_id`,`fee_key`,`premise_key`,`meter_key`,`seg_key`),
  KEY `fk_note_override_tenant` (`tenant_id`),
  CONSTRAINT `fk_note_override_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='催缴单备注人工覆盖;独立于 bill_notice_line,重生成(先删后插)不丢';

CREATE TABLE `bill_notice` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `ym` char(7) NOT NULL,
  `tenant_id` int unsigned NOT NULL,
  `pay_company_id` int unsigned DEFAULT NULL COMMENT '收款主体;拆单键',
  `notice_kind` varchar(12) NOT NULL DEFAULT 'combined' COMMENT 'combined合一单/fee水电费单/maint维护费单/dorm宿舍单/offbook账外单(不入应收)',
  `premise_text` varchar(255) DEFAULT NULL COMMENT '位置原文,多场地逗号连接',
  `total_amount` decimal(14,2) NOT NULL DEFAULT '0.00',
  `prev_due` decimal(14,2) NOT NULL DEFAULT '0.00' COMMENT '上期欠费;催缴闭环接口点,S4 先留 0',
  `status` varchar(12) NOT NULL DEFAULT 'draft' COMMENT 'draft/issued/void;issued 不可被重跑覆盖',
  `warn` varchar(255) DEFAULT NULL COMMENT 'V126 之前的告警快照,只读;新告警在 bill_notice_warn',
  `gen_batch` varchar(32) DEFAULT NULL COMMENT '派生批次;重跑幂等键(先删 draft 后插)',
  `generated_at` datetime NOT NULL,
  `confirmed_at` datetime DEFAULT NULL COMMENT '点「确认无误」的时间',
  `confirmed_by` varchar(64) DEFAULT NULL COMMENT '确认人登录名',
  `exported_at` datetime DEFAULT NULL COMMENT '最近一次导出时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_notice` (`ym`,`tenant_id`,`pay_company_id`,`notice_kind`),
  KEY `idx_notice_ym` (`ym`),
  KEY `fk_notice_tenant` (`tenant_id`),
  CONSTRAINT `fk_notice_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='催缴单单头,一户一单(拆票则一户多单)';

CREATE TABLE `bill_notice_line` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `notice_id` int unsigned NOT NULL,
  `line_no` smallint unsigned NOT NULL,
  `fee_key` varchar(32) NOT NULL COMMENT 'elec/mgmt_fee/capacity/water/water_pipe/share_elec_*/share_green_water(沿用 alloc_result 词汇,BillFeeMap 映射收款主体)',
  `premise` varchar(64) DEFAULT NULL COMMENT '场地段(如 1栋201室);多场地租户分段小计用',
  `meter_id` int unsigned DEFAULT NULL COMMENT '来源表;公摊/容量费行为 NULL',
  `meter_label` varchar(16) DEFAULT NULL COMMENT '展示用「电表①」= meter.sub_name 或顺位补号(不回写档案)',
  `contract_id` int unsigned DEFAULT NULL COMMENT '出账时表→合同归属快照(resolveBinding 命中);无FK,纯审计快照',
  `seg` varchar(8) DEFAULT NULL COMMENT 'sharp/peak/flat/valley;单一价表 NULL',
  `prev_read` decimal(14,2) DEFAULT NULL,
  `curr_read` decimal(14,2) DEFAULT NULL,
  `factor_snap` decimal(10,2) DEFAULT NULL,
  `qty` decimal(14,2) DEFAULT NULL COMMENT '实际用量/吨/㎡',
  `price_snap` decimal(14,8) DEFAULT NULL COMMENT '实收单价快照(尖段按峰价时存峰价)',
  `price_key` varchar(32) DEFAULT NULL COMMENT '取价用的 cfg_key',
  `price_scope` varchar(32) DEFAULT NULL COMMENT '命中的 scope: tenant:{id}/p1/p2/dorm/'''' ← 事后审计「为什么按商业价」',
  `price_month` char(7) DEFAULT NULL COMMENT '命中的价目版本生效月(常数键可能早于本月)',
  `rule_branch` varchar(16) DEFAULT NULL COMMENT '判定分支: tou/resident/commercial/tenant_override/pool/fixed',
  `pool_rule_id` int unsigned DEFAULT NULL COMMENT '公摊行来源池(alloc_rule.id)',
  `share_src` varchar(16) DEFAULT NULL COMMENT '公摊份额来源: member/area/floor/auto;快照当时的解析路径',
  `base_snap` decimal(14,2) DEFAULT NULL COMMENT '该户份额基数快照(层数/面积/weight)',
  `amount` decimal(14,2) NOT NULL COMMENT '允许负值(读数回退/跨户转供冲减,历史册直接开负数单)',
  `note` varchar(255) DEFAULT NULL,
  `fee_group` varchar(8) DEFAULT NULL COMMENT 'rent/elec/water;板块分组与paymap首路由(S5 §1)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_line` (`notice_id`,`line_no`),
  KEY `fk_line_meter` (`meter_id`),
  CONSTRAINT `fk_line_meter` FOREIGN KEY (`meter_id`) REFERENCES `meter` (`id`),
  CONSTRAINT `fk_line_notice` FOREIGN KEY (`notice_id`) REFERENCES `bill_notice` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='催缴单明细行;price_scope+price_month+rule_branch 构成取价审计链';

CREATE TABLE `bill_notice_warn` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `notice_id` int unsigned NOT NULL,
  `code` varchar(24) NOT NULL COMMENT '告警类别=WarnCode 枚举常量名;库里不存文案',
  `payload` varchar(64) NOT NULL DEFAULT '' COMMENT '实例数据业务键(房号/价目键/计费行id/表id/费项键);无实例数据的类固定空串',
  `hint` varchar(64) NOT NULL DEFAULT '' COMMENT '第二段实例数据(表名/合同号·费项名);无则空串',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_warn` (`notice_id`,`code`,`payload`),
  CONSTRAINT `fk_warn_notice` FOREIGN KEY (`notice_id`) REFERENCES `bill_notice` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='催缴单告警条目;随单生随单死(CASCADE)';

CREATE TABLE `bill_pay_company` (
  `tenant_id` int unsigned NOT NULL,
  `fee_key` varchar(32) NOT NULL,
  `company_id` int unsigned NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`tenant_id`,`fee_key`),
  KEY `fk_bpc_company` (`company_id`),
  CONSTRAINT `fk_bpc_company` FOREIGN KEY (`company_id`) REFERENCES `management_company` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bpc_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `monthly_ledger` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `company_id` int unsigned NOT NULL,
  `tenant_id` int unsigned DEFAULT NULL,
  `tenant_name` varchar(128) DEFAULT NULL,
  `period_year` smallint unsigned NOT NULL,
  `period_month` tinyint unsigned NOT NULL,
  `factory_rent` decimal(14,2) NOT NULL DEFAULT '0.00',
  `factory_mgmt_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `shop_rent` decimal(14,2) NOT NULL DEFAULT '0.00',
  `dorm_rent` decimal(14,2) NOT NULL DEFAULT '0.00',
  `dorm_facilities_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `shop_mgmt_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `factory_infra_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `shop_infra_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `dorm_infra_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `elevator_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `transformer_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `land_use_tax` decimal(14,2) NOT NULL DEFAULT '0.00',
  `network_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `access_ctrl_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `office_other_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `dorm_other_fee` decimal(14,2) NOT NULL DEFAULT '0.00',
  `basic_electricity` decimal(14,2) NOT NULL DEFAULT '0.00',
  `standard_electricity` decimal(14,2) NOT NULL DEFAULT '0.00',
  `electricity_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `standard_water` decimal(14,2) NOT NULL DEFAULT '0.00',
  `water_maint` decimal(14,2) NOT NULL DEFAULT '0.00',
  `balance_prev` decimal(14,2) NOT NULL DEFAULT '0.00',
  `total_collected` decimal(14,2) NOT NULL DEFAULT '0.00',
  `note` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `extra_fees` json DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_ledger` (`company_id`,`period_year`,`period_month`,`tenant_id`),
  UNIQUE KEY `uk_ledger_soft` (`company_id`,`period_year`,`period_month`,((case when (`tenant_id` is null) then concat(_utf8mb4'n:',`tenant_name`) else concat(_utf8mb4't:',`tenant_id`) end))),
  KEY `idx_ledger_cym` (`company_id`,`period_year`,`period_month`),
  KEY `fk_ledger_tenant` (`tenant_id`),
  KEY `idx_ledger_ym` (`period_year`,`period_month`),
  CONSTRAINT `fk_ledger_company` FOREIGN KEY (`company_id`) REFERENCES `management_company` (`id`),
  CONSTRAINT `fk_ledger_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `tenant_price_cfg` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `scope` varchar(24) NOT NULL DEFAULT '',
  `cfg_key` varchar(32) NOT NULL,
  `acct_month` char(7) NOT NULL DEFAULT '',
  `mode` enum('from','month') NOT NULL DEFAULT 'from' COMMENT 'from=自acct_month起长期(空=初始版);month=仅该月',
  `cfg_value` decimal(14,8) NOT NULL,
  `note` varchar(255) DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_price` (`scope`,`cfg_key`,`acct_month`,`mode`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `unit` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `building_id` int unsigned NOT NULL,
  `floor` tinyint unsigned NOT NULL,
  `unit_no` varchar(16) NOT NULL,
  `area` decimal(10,2) NOT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_unit` (`building_id`,`unit_no`),
  KEY `idx_unit_bf` (`building_id`,`floor`),
  CONSTRAINT `fk_unit_building` FOREIGN KEY (`building_id`) REFERENCES `building` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `contract` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `contract_no` varchar(32) NOT NULL,
  `tenant_id` int unsigned NOT NULL,
  `building_id` int unsigned NOT NULL,
  `unit_id` int unsigned DEFAULT NULL,
  `rent_area` decimal(10,2) NOT NULL DEFAULT '0.00',
  `monthly_rent` decimal(12,2) NOT NULL DEFAULT '0.00',
  `deposit` decimal(12,2) NOT NULL DEFAULT '0.00',
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `sign_date` date DEFAULT NULL,
  `term_text` varchar(255) DEFAULT NULL,
  `term_type` varchar(16) DEFAULT NULL,
  `tier_price_note` varchar(500) DEFAULT NULL,
  `status` varchar(16) NOT NULL,
  `remark` varchar(255) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `building_area` decimal(12,2) DEFAULT NULL,
  `unit_price` decimal(12,4) DEFAULT NULL,
  `rent_free` text,
  `mgmt_fee_price` decimal(12,4) DEFAULT NULL COMMENT '企业管理服务费单价 元/㎡/月(含税)',
  `infra_fee_price` decimal(12,4) DEFAULT NULL COMMENT '基础设施维护费单价 元/㎡/月(含税)',
  `elevator_count` int DEFAULT NULL COMMENT '货梯数N(电梯维护费按货梯数×计费层数派生)',
  `elevator_floors` int DEFAULT NULL COMMENT '计费层数L(已扣首层)',
  `elevator_fee` decimal(12,2) DEFAULT NULL COMMENT '电梯维护费覆盖月额(优先于规则派生)',
  `transformer_fee` decimal(12,2) DEFAULT NULL COMMENT '变压器维护费覆盖月额(优先于按KVA的规则派生)',
  `power_type` varchar(16) DEFAULT NULL COMMENT '用电分类 industrial|commercial|resident',
  `kva` decimal(10,2) DEFAULT NULL COMMENT '配电容量KVA(仅大工业,人工补录)',
  `fee_src` json DEFAULT NULL COMMENT '字段级来源 {rent|mgmt|infra|elevator|transformer|area: import|manual}',
  `parent_contract_id` int unsigned DEFAULT NULL,
  `link_type` varchar(12) NOT NULL DEFAULT 'new' COMMENT '相对父期链接类型 new|renew|escalation',
  `kind` varchar(16) NOT NULL DEFAULT 'normal' COMMENT '合同性质 normal|master_lease(整体承租不计KPI)',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_contract_no` (`contract_no`),
  KEY `idx_ct_tenant` (`tenant_id`),
  KEY `idx_ct_building` (`building_id`),
  KEY `idx_ct_unit` (`unit_id`),
  KEY `idx_ct_status` (`status`),
  KEY `fk_contract_parent` (`parent_contract_id`),
  CONSTRAINT `fk_contract_parent` FOREIGN KEY (`parent_contract_id`) REFERENCES `contract` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ct_building` FOREIGN KEY (`building_id`) REFERENCES `building` (`id`),
  CONSTRAINT `fk_ct_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenant` (`id`),
  CONSTRAINT `fk_ct_unit` FOREIGN KEY (`unit_id`) REFERENCES `unit` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `contract_billing_term` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `contract_id` int unsigned NOT NULL,
  `location` varchar(255) DEFAULT NULL,
  `property_type` varchar(16) DEFAULT NULL,
  `fee_key` varchar(32) DEFAULT NULL,
  `fee_name` varchar(64) NOT NULL,
  `bill_mode` varchar(16) NOT NULL,
  `unit_price` decimal(12,4) NOT NULL,
  `area` decimal(12,2) DEFAULT NULL,
  `coeff` decimal(8,4) NOT NULL DEFAULT '1.0000',
  `tax_rate` decimal(6,4) DEFAULT NULL,
  `params` json DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'manual',
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `room_count` int DEFAULT NULL,
  `amount_override` decimal(12,2) DEFAULT NULL,
  `seq` int NOT NULL DEFAULT '0',
  `area_shared` decimal(12,2) DEFAULT NULL COMMENT '公摊面积;非空=area为建筑面积(分摊按area+area_shared,账单显示拆解),空=area已含公摊;宿舍留空(S5 §1)',
  PRIMARY KEY (`id`),
  KEY `idx_cbt_contract` (`contract_id`),
  CONSTRAINT `fk_cbt_contract` FOREIGN KEY (`contract_id`) REFERENCES `contract` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `billing_term_unit` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `term_id` int unsigned NOT NULL,
  `unit_id` int unsigned NOT NULL,
  `source` varchar(16) NOT NULL DEFAULT 'derived' COMMENT 'derived=位置文本推导|manual=人工指认',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_btu` (`term_id`,`unit_id`),
  KEY `idx_btu_unit` (`unit_id`),
  CONSTRAINT `fk_btu_term` FOREIGN KEY (`term_id`) REFERENCES `contract_billing_term` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_btu_unit` FOREIGN KEY (`unit_id`) REFERENCES `unit` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='计费行绑定单元(楼层级面积口径的数据基础;行级,比 contract_unit 细)';

CREATE TABLE `contract_rent_tier` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `contract_id` int unsigned NOT NULL,
  `fee_key` varchar(24) DEFAULT NULL,
  `seq` int NOT NULL,
  `label` varchar(64) DEFAULT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `unit_price` decimal(10,4) DEFAULT NULL,
  `monthly_amount` decimal(12,2) DEFAULT NULL,
  `note` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_tier` (`contract_id`,`fee_key`,`seq`),
  CONSTRAINT `fk_tier_contract` FOREIGN KEY (`contract_id`) REFERENCES `contract` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='合同租金阶梯期(参考排程,不参与计费)';

CREATE TABLE `contract_unit` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `contract_id` int unsigned NOT NULL,
  `unit_id` int unsigned NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_cu` (`contract_id`,`unit_id`),
  KEY `idx_cu_unit` (`unit_id`),
  CONSTRAINT `fk_cu_contract` FOREIGN KEY (`contract_id`) REFERENCES `contract` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_cu_unit` FOREIGN KEY (`unit_id`) REFERENCES `unit` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='合同附加单元(主单元在 contract.unit_id)';

CREATE TABLE `meter_assign` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `meter_id` int unsigned NOT NULL,
  `from_ym` char(7) NOT NULL COMMENT '自该月起生效;覆盖到下一行的 from_ym 之前',
  `tenant_id` int DEFAULT NULL,
  `tenant_name` varchar(64) DEFAULT NULL COMMENT '原册企业名称原文',
  `building_id` int DEFAULT NULL,
  `ownership` varchar(8) NOT NULL DEFAULT 'share' COMMENT 'tenant|share|ops|infra|park|register(同 meter.ownership)',
  `area` varchar(64) DEFAULT NULL,
  `spot` varchar(64) DEFAULT NULL,
  `floor_label` varchar(16) DEFAULT NULL,
  `side` varchar(8) DEFAULT NULL,
  `room_no` varchar(16) DEFAULT NULL,
  `sub_name` varchar(32) DEFAULT NULL,
  `contract_id` int unsigned DEFAULT NULL COMMENT '人工钉的合同,只对这一段有效',
  `tenant_manual` tinyint NOT NULL DEFAULT '0' COMMENT '租户人工设定,只锁这一段',
  `owner_manual` tinyint NOT NULL DEFAULT '0' COMMENT '归属(ownership/building_id)人工设定,只锁这一段',
  `loc_manual` tinyint NOT NULL DEFAULT '0' COMMENT '位置人工设定位掩码(同 V78):bit0 楼层/bit1 方位/bit2 房号',
  `src` varchar(12) NOT NULL COMMENT 'import|manual|migrate|contract',
  `batch_id` varchar(36) DEFAULT NULL COMMENT '导入批次(撤销导入用);其它来源为空',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_meter_assign` (`meter_id`,`from_ym`),
  KEY `idx_meter_assign_contract` (`contract_id`),
  KEY `idx_meter_assign_batch` (`batch_id`),
  CONSTRAINT `fk_meter_assign_contract` FOREIGN KEY (`contract_id`) REFERENCES `contract` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_meter_assign_meter` FOREIGN KEY (`meter_id`) REFERENCES `meter` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='表归属按月分段(METER-TIMELINE-SPEC §1.2)';

CREATE TABLE `user_notice` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `username` varchar(64) NOT NULL COMMENT '收件人',
  `kind` varchar(32) NOT NULL COMMENT 'NoticeService.Kind',
  `title` varchar(200) NOT NULL COMMENT '一句',
  `detail` varchar(500) DEFAULT NULL COMMENT '小字(理由等)',
  `ref` varchar(128) DEFAULT NULL COMMENT '跳转键(审核键 / bill-notices:YYYY-MM 等)',
  `actor` varchar(64) DEFAULT NULL COMMENT '谁造成的;系统(到期回调)为 NULL',
  `created_at` datetime NOT NULL COMMENT 'Java 时钟写',
  `seen_at` datetime DEFAULT NULL COMMENT 'NULL = 没看过',
  PRIMARY KEY (`id`),
  KEY `idx_user_notice_user` (`username`,`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='铃铛「有结果了」消息(每人最近 30 条)';

CREATE TABLE `user_seen` (
  `username` varchar(64) NOT NULL,
  `changelog_version` varchar(32) DEFAULT NULL COMMENT '看过的最新更新记录版本号',
  `bell_key` varchar(128) DEFAULT NULL COMMENT '上次开铃铛时系统组的内容键(前端拼)',
  `updated_at` datetime NOT NULL,
  PRIMARY KEY (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='系统类通知「看过」(跨电脑一致)';

INSERT INTO `auth_role` (`id`, `code`, `name`, `builtin`, `nav_layers`, `remark`) VALUES
  (1, 'admin', '系统管理员', 1, 'data,reports,analysis', '全部权限,含用户与角色管理'),
  (2, 'finance_manager', '财务主管', 1, 'data,reports,analysis', '业务全部可改,不含系统管理;可授权接管编辑锁'),
  (3, 'finance_clerk', '财务专员', 1, 'data,reports,analysis', '录入/抄表/出账运行;不可改档案、合同、计费口径、工资'),
  (4, 'gm', '总经理', 1, 'data,reports,analysis', '只读;除工资明细和系统管理外都能看'),
  (5, 'shareholder', '园区股东', 1, 'analysis,reports', '只读;导航有经营分析、账簿与报表'),
  (6, 'viewer', '只读账号', 1, 'data,reports,analysis', '只读;除工资明细和系统管理外都能看'),
  (7, 'reviewer', '审核员', 1, 'data,reports,analysis', '只审不录:能看除工资、系统管理外的各模块,不能改');

INSERT INTO `auth_role_perm` (`role_id`, `perm`) VALUES
  (1, 'analysis:view'),
  (1, 'billing-issue:edit'),
  (1, 'billing-run:edit'),
  (1, 'billing:view'),
  (1, 'book-template:edit'),
  (1, 'book-template:switch'),
  (1, 'company:manage'),
  (1, 'contract:edit'),
  (1, 'contract:view'),
  (1, 'elevate:request'),
  (1, 'entry:edit'),
  (1, 'entry:view'),
  (1, 'lock:takeover'),
  (1, 'master:edit'),
  (1, 'master:view'),
  (1, 'meter-master:edit'),
  (1, 'meter-reading:edit'),
  (1, 'meter:view'),
  (1, 'param-monthly:edit'),
  (1, 'param-policy:edit'),
  (1, 'param:view'),
  (1, 'report:edit'),
  (1, 'report:view'),
  (1, 'review:approve'),
  (1, 'salary:edit'),
  (1, 'salary:view'),
  (1, 'system:edit'),
  (1, 'system:view'),
  (2, 'analysis:view'),
  (2, 'billing-issue:edit'),
  (2, 'billing-run:edit'),
  (2, 'billing:view'),
  (2, 'contract:edit'),
  (2, 'contract:view'),
  (2, 'elevate:request'),
  (2, 'entry:edit'),
  (2, 'entry:view'),
  (2, 'lock:takeover'),
  (2, 'master:edit'),
  (2, 'master:view'),
  (2, 'meter-master:edit'),
  (2, 'meter-reading:edit'),
  (2, 'meter:view'),
  (2, 'param-monthly:edit'),
  (2, 'param-policy:edit'),
  (2, 'param:view'),
  (2, 'report:edit'),
  (2, 'report:view'),
  (2, 'salary:edit'),
  (2, 'salary:view'),
  (3, 'analysis:view'),
  (3, 'billing-run:edit'),
  (3, 'billing:view'),
  (3, 'contract:view'),
  (3, 'elevate:request'),
  (3, 'entry:edit'),
  (3, 'entry:view'),
  (3, 'master:view'),
  (3, 'meter-reading:edit'),
  (3, 'meter:view'),
  (3, 'param:view'),
  (3, 'report:edit'),
  (3, 'report:view'),
  (4, 'analysis:view'),
  (4, 'billing:view'),
  (4, 'contract:view'),
  (4, 'elevate:request'),
  (4, 'entry:view'),
  (4, 'master:view'),
  (4, 'meter:view'),
  (4, 'param:view'),
  (4, 'report:view'),
  (5, 'analysis:view'),
  (5, 'report:view'),
  (6, 'analysis:view'),
  (6, 'billing:view'),
  (6, 'contract:view'),
  (6, 'entry:view'),
  (6, 'master:view'),
  (6, 'meter:view'),
  (6, 'param:view'),
  (6, 'report:view'),
  (7, 'analysis:view'),
  (7, 'billing:view'),
  (7, 'contract:view'),
  (7, 'entry:view'),
  (7, 'master:view'),
  (7, 'meter:view'),
  (7, 'param:view'),
  (7, 'report:view'),
  (7, 'review:approve');

INSERT INTO `auth_user` (`id`, `username`, `password_hash`, `display_name`, `status`, `role`, `must_change_password`, `token_version`) VALUES
  (1, 'admin', '!unset:ADMIN_PASSWORD', '管理员', 1, 'admin', 0, 0);

INSERT INTO `auth_user_role` (`user_id`, `role_id`) VALUES
  (1, 1);

INSERT INTO `alloc_cfg` (`id`, `scope`, `cfg_key`, `cfg_value`, `acct_month`, `mode`, `note`) VALUES
  (169, '', 'pv_crit_cover_month', 0.90000000, '', 'from', '月抄表覆盖率下限'),
  (170, '', 'pv_crit_ledger', 0.03000000, '', 'from', '台账与理论装机差判据线 ±'),
  (171, '', 'pv_crit_yield_ratio', 0.85000000, '', 'from', '年等效小时/锚点 下限'),
  (172, '', 'pv_band_sigma', 2.00000000, '', 'from', '正常范围半宽=几倍稳健波动'),
  (173, '', 'pv_band_run', 3.00000000, '', 'from', '连续几个刻度同侧出范围才算一段');

INSERT INTO `pv_phase` (`id`, `name`, `short`, `online`, `cost`, `capacity`, `cap_note`, `sort_no`) VALUES
  ('p1', '一期', '一期', NULL, 0.00, 0.000000, NULL, 1),
  ('p2', '二期', '二期', NULL, 0.00, 0.000000, NULL, 2),
  ('p3', '三期', '三期', NULL, 0.00, 0.000000, NULL, 3);

INSERT INTO `elec_phase` (`id`, `name`, `short`, `sort_no`) VALUES
  ('p1', '一期', '一期', 1),
  ('p2', '二期', '二期', 2),
  ('p3', '三期', '三期', 3);

INSERT INTO `charging_cat` (`schedule_no`, `cat_id`, `name`, `short`, `tint`, `sort_no`) VALUES
  (7, 'op1', '运营商一', '运营商一', 'slate', 1),
  (7, 'op2', '运营商二', '运营商二', 'blue', 2),
  (8, 'op1', '运营商一', '运营商一', 'cyan', 1),
  (8, 'op2', '运营商二', '运营商二', 'slate', 2);

