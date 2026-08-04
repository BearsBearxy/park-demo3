-- 鑫皇(租户113)按合同场地挂表(2026-08-04 用户指令:每份合同租的位置挂电表水表,含宿舍,多室合同挂多表)
-- 48块表全部已挂 tenant_id=113;此前已绑5块(248→432,249→431,591/593/597→434);本次补43块。
-- 房号↔表:宿舍表名=房号(水表名带.00),spot=楼层+栋-房号,已逐一核对无歧义。

-- C2024M-024#2 (431, A座502室现行段): 女厕/男厕水表(spot=五楼502室)
UPDATE meter SET contract_id=431 WHERE id IN (433,434) AND tenant_id=113;

-- C2024M-024B#1 (433, 宿舍四座529、531、533、535、537、539、541、543室): 8电+8水
UPDATE meter SET contract_id=433 WHERE id IN (783,785,787,789,791,793,795,797, 1082,1084,1086,1088,1090,1092,1094,1096) AND tenant_id=113;

-- C2024M-024C#1 (434, 宿舍一座306、308、312、505、507、509室): 电3块已绑,补电3+水6
UPDATE meter SET contract_id=434 WHERE id IN (644,646,648, 898,900,904,949,951,953) AND tenant_id=113;

-- C2024M-024D#1 (435, 宿舍四座538室): 电+水
UPDATE meter SET contract_id=435 WHERE id IN (792,1091) AND tenant_id=113;

-- C2024M-024E#1 (436, 宿舍一座419、519室): 2电+2水
UPDATE meter SET contract_id=436 WHERE id IN (631,658, 937,963) AND tenant_id=113;

-- C2024M-024F#1 (437, 宿舍四座234、245、331、445、447室临租): 5电+5水
UPDATE meter SET contract_id=437 WHERE id IN (707,718,731,772,774, 1009,1020,1032,1072,1074) AND tenant_id=113;

-- 核对:按合同分组计数(预期 431=3,432=1,433=16,434=12,435=2,436=4,437=10;NULL=0)
SELECT contract_id, COUNT(*) AS meters, GROUP_CONCAT(name ORDER BY name SEPARATOR ',') AS names
FROM meter WHERE tenant_id=113 GROUP BY contract_id ORDER BY contract_id;
