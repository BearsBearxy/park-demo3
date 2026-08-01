-- V74__meter_location.sql — 电表位置结构化(刀A)。
-- 用户 2026-07-30 报障:「园区抄表的表格也没有按照用户 excel 表格里面一样使用楼栋/车间+楼层+方位的
-- 多字段来配合公共电核算选择电表来计算公摊,租户名字随时可以修改,楼栋楼层和单元应该是不会变动的字段」。
--
-- 病根:位置一直是自由文本 meter.spot('四楼西侧'/'天面'/'一楼101室'),同时被当作
-- 显示、分组、导入身份匹配(addrKey)、池选表过滤(spot.startsWith('四楼'))四种用途 —— 任一处不一致就全线塌。
-- 本迁移把 spot 拆成三个稳定结构字段;spot 原文保留不动(导入身份键 addrKey 仍走 spot,不动匹配行为)。
--
-- 解析规则与 scripts/derive_pool_location.py / AllocService.floorNum 同源:
--   floor_label: 天面/屋面/楼顶 → '天面';否则取开头的「负?N楼|层」;跨层(1-3楼/六、七楼)与
--                非楼层位置(门口/车间/消防分表) → NULL = 跨层或不适用(与池的 floor_label 空口径一致)
--   side:       东/西/南/北侧
--   room_no:    单个房号才回填;多房号(201室、202室)与房号区间(602-604室)一律 NULL,宁可不填不填错

ALTER TABLE meter
  ADD COLUMN floor_label VARCHAR(16) NULL COMMENT '楼层(四楼/负一层/天面);NULL=跨层或不适用。由 spot 解析,可人工改',
  ADD COLUMN side        VARCHAR(8)  NULL COMMENT '方位(东侧/西侧/南侧/北侧);NULL=不分侧',
  ADD COLUMN room_no     VARCHAR(16) NULL COMMENT '房号(101室);多房号/区间不回填。ponytail: 先做展示与分组字段,真要挂 unit 主数据再加 unit_id FK',
  ADD KEY idx_meter_loc (building_id, floor_label, side);

UPDATE meter SET
  floor_label = CASE
    WHEN spot IS NULL OR spot = '' THEN NULL
    WHEN spot LIKE '天面%' OR spot LIKE '屋面%' OR spot LIKE '楼顶%' THEN '天面'
    ELSE REGEXP_SUBSTR(spot, '^(负|地下)?[一二三四五六七八九十0-9]+(楼|层)')
  END,
  side = REGEXP_SUBSTR(COALESCE(spot, ''), '[东西南北]侧'),
  room_no = CASE
    WHEN spot IS NULL OR spot = '' THEN NULL
    -- 多房号(201室、202室 / 101、102室)或区间(602-604室):判不准,不回填
    WHEN spot REGEXP '[0-9]+室.*[0-9]+室' OR spot REGEXP '[0-9]+[-—–、][0-9]+室' THEN NULL
    ELSE REGEXP_SUBSTR(spot, '[0-9]+[A-Za-z]?室')
  END;
