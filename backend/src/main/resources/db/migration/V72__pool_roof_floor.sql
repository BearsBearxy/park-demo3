-- V72__pool_roof_floor.sql — 天面回填:15 个货梯/客梯/楼梯间池的 floor_label 从 NULL 改回 '天面'。
-- 用户 2026-07-30 报障:「为什么公共电核算没有天面这个区域,用户分摊明细里面每个楼栋都有」。
-- 根因:V70 的生成脚本 derive_pool_location.py:225-226 把「绑定表在天面」判成 floor=None
-- (取了"跨层"语义、丢掉物理位置),核算屏「楼层·方位」列对这 15 行只能显 '–',
-- 原册「公共电分摊明细」每栋都有的天面段在屏上整体消失,与抄表屏(按 meter.spot,天面在)也对不上。
--
-- 安全性:「跨层」语义不依赖 floor_label=NULL —— AllocService.floorNum('天面') 恒返回 null
-- (AllocServiceTest:213 单测锁定),受益人候选与房号解析走的仍是整栋分支(AllocService:1401/1354),
-- 引擎全程不读 floor_label。**分摊数字一位不变**,无需重新生成快照。
-- 唯一行为变化是行序:带内从带首(前端 floorSort=-Infinity)移到带尾(floorRank 天面=99 /
-- 后端 floorNum null→MAX_VALUE),前后端一致,且与原册天面排在每座末尾的顺序相同。
--
-- 判据与 derive_pool_location.py 同源(绑定表 spot 含天面),不硬编码 id,便于任何库重放。

UPDATE alloc_rule r
  JOIN building b ON b.id = r.building_id
  SET r.floor_label = '天面',
      -- 与 AllocService.poolName 同规则:楼栋·(楼层+侧向)·费项
      r.name = CONCAT(b.name, '·天面', COALESCE(r.side, ''), '·', r.fee_name)
WHERE r.floor_label IS NULL
  AND r.fee_name IS NOT NULL
  AND EXISTS (SELECT 1 FROM alloc_rule_meter am JOIN meter m ON m.id = am.meter_id
              WHERE am.rule_id = r.id AND m.spot LIKE '天面%');

-- ── A座天面 spot 脏值清理:'天面 1' / '天面 到-1楼' → '天面' ──
-- 成因:原册这几行的「企业名称」列写的是电表描述(客梯1 / 客梯2（到-1楼）)而非租户名,
-- meterSplit.SPOT_RE 从中剥出「方位」(尾部数字 '1' / 括号内 '到-1楼'),
-- meterExcel 再把它拼到位置列后面 → A座天面在抄表屏裂成三组、derive 脚本也曾把它解析成 '1楼'。
-- 导入侧已在 meterExcel.ts 加闸(位置列非空时只接受方位型 split.spot),此处清存量。
UPDATE meter SET spot = '天面'
WHERE kind = 'elec' AND zone = 'p1' AND area = 'A座' AND spot LIKE '天面 %';
