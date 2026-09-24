-- V128__meter_timeline.sql — 表档案按月记录(METER-TIMELINE-SPEC §1 / §7)。
--
-- 表档案不再是一份,而是一串「从某月起是这样」的记录:只记起始月,不记结束月。
-- 看某个月 = 取 from_ym ≤ 这个月的最后一行(MeterTimelineService.viewAt)。
-- 本迁移只建表 + 灌数;meter 上被搬走的旧列(归属/位置/人工标记/合同钉/三个账期)留到 V129 删,
-- 那一刀连同读侧换源一起做(A2),这里先不动,旧代码照旧读旧列。
--
-- 列类型逐列照抄 meter 现有同名列(V45 V46 V63 V68 V74 V76–V78 V87 V88):
--   tenant_id INT / building_id INT(都是有符号,照抄,不在这里顺手改)/ contract_id INT UNSIGNED(= contract.id)。
-- tenant_manual 是新列:meter 上从来没有租户人工标记,迁移一律 0。
-- loc_manual 沿用 V78 的位掩码(bit0 楼层 / bit1 方位 / bit2 房号)。

CREATE TABLE meter_assign (
  id            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meter_id      INT UNSIGNED NOT NULL,
  from_ym       CHAR(7)      NOT NULL COMMENT '自该月起生效;覆盖到下一行的 from_ym 之前',
  tenant_id     INT          NULL,
  tenant_name   VARCHAR(64)  NULL COMMENT '原册企业名称原文',
  building_id   INT          NULL,
  ownership     VARCHAR(8)   NOT NULL DEFAULT 'share' COMMENT 'tenant|share|ops|infra|park|register(同 meter.ownership)',
  area          VARCHAR(64)  NULL,
  spot          VARCHAR(64)  NULL,
  floor_label   VARCHAR(16)  NULL,
  side          VARCHAR(8)   NULL,
  room_no       VARCHAR(16)  NULL,
  sub_name      VARCHAR(32)  NULL,
  contract_id   INT UNSIGNED NULL COMMENT '人工钉的合同,只对这一段有效',
  tenant_manual TINYINT      NOT NULL DEFAULT 0 COMMENT '租户人工设定,只锁这一段',
  owner_manual  TINYINT      NOT NULL DEFAULT 0 COMMENT '归属(ownership/building_id)人工设定,只锁这一段',
  loc_manual    TINYINT      NOT NULL DEFAULT 0 COMMENT '位置人工设定位掩码(同 V78):bit0 楼层/bit1 方位/bit2 房号',
  src           VARCHAR(12)  NOT NULL COMMENT 'import|manual|migrate|contract',
  batch_id      VARCHAR(36)  NULL COMMENT '导入批次(撤销导入用);其它来源为空',
  PRIMARY KEY (id),
  UNIQUE KEY uk_meter_assign (meter_id, from_ym),
  KEY idx_meter_assign_contract (contract_id),
  KEY idx_meter_assign_batch (batch_id),
  CONSTRAINT fk_meter_assign_meter    FOREIGN KEY (meter_id)    REFERENCES meter(id)    ON DELETE CASCADE,
  CONSTRAINT fk_meter_assign_contract FOREIGN KEY (contract_id) REFERENCES contract(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='表归属按月分段(METER-TIMELINE-SPEC §1.2)';

CREATE TABLE meter_status (
  id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meter_id INT UNSIGNED NOT NULL,
  from_ym  CHAR(7)      NOT NULL,
  status   VARCHAR(8)   NOT NULL COMMENT 'active 在用|retired 停用(在册不计)|removed 已拆(不在册);早于第一行 = 不在册',
  src      VARCHAR(12)  NOT NULL COMMENT 'import|manual|migrate|contract',
  batch_id VARCHAR(36)  NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_meter_status (meter_id, from_ym),
  KEY idx_meter_status_batch (batch_id),
  CONSTRAINT fk_meter_status_meter FOREIGN KEY (meter_id) REFERENCES meter(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='表的存在与状态按月分段(METER-TIMELINE-SPEC §1.3)';

-- 不挂 meter FK:表删了,它的档案变更史也要留着。
-- tbl 不叫 `table`(SPEC 原文):table 是 MySQL 保留字,照 param_change_log.tbl 的先例改名。
CREATE TABLE meter_archive_log (
  id          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  meter_id    INT UNSIGNED NOT NULL,
  tbl         VARCHAR(8)   NOT NULL COMMENT 'assign|status',
  from_ym     CHAR(7)      NOT NULL,
  action      VARCHAR(8)   NOT NULL COMMENT 'insert|update|delete',
  before_json JSON         NULL,
  after_json  JSON         NULL,
  src         VARCHAR(12)  NOT NULL,
  batch_id    VARCHAR(36)  NULL,
  file_name   VARCHAR(255) NULL,
  row_ref     VARCHAR(64)  NULL COMMENT '导入源行定位(sheet!行号)',
  operator    VARCHAR(64)  NOT NULL DEFAULT '',
  at          DATETIME     NOT NULL COMMENT 'Java 时钟写',
  PRIMARY KEY (id),
  KEY idx_mal_meter (meter_id, id),
  KEY idx_mal_batch (batch_id),
  KEY idx_mal_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='表档案每一次写的前后像(METER-TIMELINE-SPEC §1.4)';

-- 「需重算」的第二个来源(第一个是 param_change_log)。changed_at 由 Java 时钟写,与快照 generated_at 同一口钟。
CREATE TABLE data_change_log (
  id         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ym         CHAR(7)     NOT NULL,
  source     VARCHAR(16) NOT NULL COMMENT 'meter-archive|meter-reading',
  changed_at DATETIME    NOT NULL,
  PRIMARY KEY (id),
  KEY idx_dcl_ym (ym, changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='抄表数据改动流水,给需重算用(METER-TIMELINE-SPEC §1.5)';

-- ── 灌数(SPEC §7):不写 meter_archive_log、不写 data_change_log ─────────────────────
--
-- 首月 first = LEAST(COALESCE(active_from_ym,'1900-01'), COALESCE(该表最早读数月,'9999-12'))
--   · 启用月为空 = 旧语义「一直在册」→ 1900-01 起在册,任何月份看都与旧口径一致;
--   · 启用月晚于最早读数(导入没来得及自愈)→ 取最早读数月,有读数的月份不会被判成不在册。

-- 归属:每块表在 {first} ∪ {它有读数的每个月} 各写一行,值全取当前档案(人工标记与合同钉每行都复制)。
-- 这样上线后每个有册子的月份都有自己的一行挡着(R4 的地基),再导哪个月的册子都只改那个月。
INSERT INTO meter_assign (meter_id, from_ym, tenant_id, tenant_name, building_id, ownership, area, spot,
                          floor_label, side, room_no, sub_name, contract_id,
                          tenant_manual, owner_manual, loc_manual, src)
SELECT m.id, f.ym, m.tenant_id, m.tenant_name, m.building_id, m.ownership, m.area, m.spot,
       m.floor_label, m.side, m.room_no, m.sub_name, m.contract_id,
       0, m.owner_manual, m.loc_manual, 'migrate'
FROM meter m
JOIN (
  SELECT m2.id AS meter_id,
         LEAST(COALESCE(m2.active_from_ym, '1900-01'), COALESCE(MIN(r.ym), '9999-12')) AS ym
  FROM meter m2 LEFT JOIN meter_reading r ON r.meter_id = m2.id
  GROUP BY m2.id
  UNION                                              -- UNION 去重:首月本身常常就是一个读数月
  SELECT DISTINCT meter_id, ym FROM meter_reading
) f ON f.meter_id = m.id;

-- 状态:active@first;retired_ym → retired 行;removed_ym → removed 行。
-- 旧语义「自该月起(含当月)」与新语义一致,月份原样搬。同月冲突时后者胜(active → retired → removed):
--   · 早于 first 的停用/拆除月夹到 first,与 active@first 撞键 → ON DUPLICATE KEY 让后写的覆盖
--     (旧口径下 first 之前本来就不在册,夹过去取值不变);
--   · 停用月与拆除月同月(dev 库 2026-09-24 实有 3 块:id 1422/1423/1424),或停用月晚于拆除月 → 停用行不写,只落 removed。
--     旧判定里拆除优先(removedGone 不显示),拆除之后再冒一行 retired 会让表重新出现在册上。
INSERT INTO meter_status (meter_id, from_ym, status, src)
SELECT m.id, LEAST(COALESCE(m.active_from_ym, '1900-01'), COALESCE(MIN(r.ym), '9999-12')), 'active', 'migrate'
FROM meter m LEFT JOIN meter_reading r ON r.meter_id = m.id
GROUP BY m.id;

INSERT INTO meter_status (meter_id, from_ym, status, src)
SELECT m.id, GREATEST(m.retired_ym, f.first_ym), 'retired', 'migrate'
FROM meter m
JOIN (SELECT meter_id, MIN(from_ym) AS first_ym FROM meter_assign GROUP BY meter_id) f ON f.meter_id = m.id
WHERE m.retired_ym IS NOT NULL AND (m.removed_ym IS NULL OR m.retired_ym < m.removed_ym)
ON DUPLICATE KEY UPDATE status = 'retired';

INSERT INTO meter_status (meter_id, from_ym, status, src)
SELECT m.id, GREATEST(m.removed_ym, f.first_ym), 'removed', 'migrate'
FROM meter m
JOIN (SELECT meter_id, MIN(from_ym) AS first_ym FROM meter_assign GROUP BY meter_id) f ON f.meter_id = m.id
WHERE m.removed_ym IS NOT NULL
ON DUPLICATE KEY UPDATE status = 'removed';
