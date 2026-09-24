-- 2026-09-25 表编码 220605000144:一块物理电表先装二期、后拆装一期(用户拍板「拆一块装一块」)。
-- 证据(原册逐行核过):
--   二期2023年08月水电费·二期园区电 r27   广聚运通电 | 二车间 | 一楼102室 | 广聚运通 | 5491.8 → 6776.28
--   二期2024年2月水电费·二期园区电 r31    广聚运通电 | 二车间 | 一楼102室 | 广聚运通 | 7186.02 → 7186.02(用量 0)
--   202405水电表数据表·一期园区电          南盛物流电 | A座 | 四楼428室 | 南盛物流 | 7315.33 → 7500.23
--   读数一路接得上 = 同一块表;原档案(id 243,一期·南盛物流)用户已先删。
-- 这里只建两条表记录,不写读数:二期 2023-08 / 2024-02 两本原册重导一次,读数按当月在册落到广聚运通电
-- (依赖「同编码按当月在册认表」,METER-TIMELINE-SPEC §9)。
-- 「广聚运通」在租户档案里没有 → tenant_id 空,进待核。南盛物流合同 S10-0114 止于 2024-02-29,3 月起的合同系统里没有。
-- 回滚:DELETE FROM meter WHERE id IN (本脚本新建的两块);assign/status 级联删除,meter_archive_log 保留留痕。
START TRANSACTION;

SET @src_file = 'meter-220605000144-move-20260925.sql';
SET @op = '修数脚本';
SET @at = NOW();

-- ① 二期 · 广聚运通电:2023-08 起在册,2024-02 是最后抄表月 → 2024-03 起已拆
INSERT INTO meter (kind, zone, name, meter_type, code, factor, sort_no)
VALUES ('elec', 'p2', '广聚运通电', '户内用电', '220605000144', 1.00,
        (SELECT s FROM (SELECT COALESCE(MAX(sort_no), 0) + 1 s FROM meter WHERE kind = 'elec' AND zone = 'p2') t));
SET @gj = LAST_INSERT_ID();

INSERT INTO meter_assign (meter_id, from_ym, tenant_id, tenant_name, building_id, ownership,
                          area, spot, floor_label, side, room_no, sub_name, src)
VALUES (@gj, '2023-08', NULL, '广聚运通', 31, 'tenant', '二车间', '一楼102室', '一楼', NULL, '102室', '电表①', 'manual');
INSERT INTO meter_archive_log (meter_id, tbl, from_ym, action, before_json, after_json, src, file_name, operator, at)
VALUES (@gj, 'assign', '2023-08', 'insert', NULL,
        JSON_OBJECT('meterId', @gj, 'fromYm', '2023-08', 'tenantId', NULL, 'tenantName', '广聚运通', 'buildingId', 31,
                    'ownership', 'tenant', 'area', '二车间', 'spot', '一楼102室', 'floorLabel', '一楼', 'side', NULL,
                    'roomNo', '102室', 'subName', '电表①', 'contractId', NULL, 'tenantManual', 0, 'ownerManual', 0,
                    'locManual', 0, 'src', 'manual', 'batchId', NULL),
        'manual', @src_file, @op, @at);

INSERT INTO meter_status (meter_id, from_ym, status, src) VALUES
  (@gj, '2023-08', 'active', 'manual'),
  (@gj, '2024-03', 'removed', 'manual');
INSERT INTO meter_archive_log (meter_id, tbl, from_ym, action, before_json, after_json, src, file_name, operator, at) VALUES
  (@gj, 'status', '2023-08', 'insert', NULL,
   JSON_OBJECT('meterId', @gj, 'fromYm', '2023-08', 'status', 'active', 'src', 'manual', 'batchId', NULL), 'manual', @src_file, @op, @at),
  (@gj, 'status', '2024-03', 'insert', NULL,
   JSON_OBJECT('meterId', @gj, 'fromYm', '2024-03', 'status', 'removed', 'src', 'manual', 'batchId', NULL), 'manual', @src_file, @op, @at);

-- ② 一期 · 南盛物流电:2024-03 起在册
INSERT INTO meter (kind, zone, name, meter_type, code, factor, sort_no)
VALUES ('elec', 'p1', '南盛物流电', '户内用电', '220605000144', 1.00,
        (SELECT s FROM (SELECT COALESCE(MAX(sort_no), 0) + 1 s FROM meter WHERE kind = 'elec' AND zone = 'p1') t));
SET @ns = LAST_INSERT_ID();

INSERT INTO meter_assign (meter_id, from_ym, tenant_id, tenant_name, building_id, ownership,
                          area, spot, floor_label, side, room_no, sub_name, src)
VALUES (@ns, '2024-03', 168, '南盛物流', 13, 'tenant', 'A座', '四楼428室', '四楼', NULL, '428室', '电表①', 'manual');
INSERT INTO meter_archive_log (meter_id, tbl, from_ym, action, before_json, after_json, src, file_name, operator, at)
VALUES (@ns, 'assign', '2024-03', 'insert', NULL,
        JSON_OBJECT('meterId', @ns, 'fromYm', '2024-03', 'tenantId', 168, 'tenantName', '南盛物流', 'buildingId', 13,
                    'ownership', 'tenant', 'area', 'A座', 'spot', '四楼428室', 'floorLabel', '四楼', 'side', NULL,
                    'roomNo', '428室', 'subName', '电表①', 'contractId', NULL, 'tenantManual', 0, 'ownerManual', 0,
                    'locManual', 0, 'src', 'manual', 'batchId', NULL),
        'manual', @src_file, @op, @at);

INSERT INTO meter_status (meter_id, from_ym, status, src) VALUES (@ns, '2024-03', 'active', 'manual');
INSERT INTO meter_archive_log (meter_id, tbl, from_ym, action, before_json, after_json, src, file_name, operator, at)
VALUES (@ns, 'status', '2024-03', 'insert', NULL,
        JSON_OBJECT('meterId', @ns, 'fromYm', '2024-03', 'status', 'active', 'src', 'manual', 'batchId', NULL),
        'manual', @src_file, @op, @at);

SELECT @gj AS guangju_meter_id, @ns AS nansheng_meter_id;
COMMIT;
