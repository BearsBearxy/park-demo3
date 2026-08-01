-- V75__meter_suspect.sql — 存疑档案两级标记(刀E §E3 + 刀F §F1 修正)。
--
-- 病根(LOC-MEMBER-FIXUP-SPEC §E3):真档案的 name(标识名)里嵌了过期租户名(孙洋洋电/暨南医美电),
-- 新册那几行写成新租户名(幸悦电1/沈振电)且区域/位置列解析后为空 → 导入身份键三层
-- L1(编码)→L2(位置)→L3(标识名) 全部落空 → 静默新建第二份档案。宿舍册更狠:尖/峰/平/谷四列
-- 被当成四块独立表建档(「陈昌辉尖/峰/平/谷」对应真档案「陈昌辉总」)。
--
-- 【刀F §F1 修正】刀E 把「区域/位置/企业名称/编码四项全空」当成重复判据 —— 错。
-- 四空是**档案完整度**条件,不是**重复性**条件。照它标,`1415 黎镇源临电(栋30)/1416 佳亿兴电/
-- 1417 广聚运通电/1418 欧伟杰临电(栋31)/1419 广联临电(栋33)` 五块挂栋真表会被永久踢出楼栋分表Σ:
-- 今天读数恰为 0.00 所以不暴雷,下月抄出非零读数就静默消失,E=D−C 偏低、租户损耗费一起算少。
-- 故拆成两级:
--   shadow     = 四空 AND 能配到一块**档案完整**(area/code/tenant_name 至少一项非空)的
--                同 (kind, zone, building_id) 表,且**同月 prev_total + curr_total + factor_snap 三格全等**
--                → 疑似同一块物理表的第二份档案,护栏排除出楼栋分表Σ,屏上红底「存疑·疑似重复」。
--   incomplete = 四空但配不上 → 只是档案没填全,**照常计入Σ**,屏上黄底「档案不全」。
-- dev 实测(只读 SQL 复核):四空带读数 310 块 = shadow 10(全在一期,正是那批双份档案)
-- + incomplete 300(含上述 5 块 p2 临电、289 块宿舍分时表)。宿舍那 289 块配不上是**正确**的 ——
-- 它们是尖/峰/平/谷四列被拆成四块表,读数本就不相等,不是同一块表的两份档案。
--
-- 本迁移只做「识别与隔离」:标记,不删不合并 —— 合并要人工逐条认对,认错就丢读数。
-- 人工认对清单见 scripts/shadow-meter-audit.tsv;合并/清理留给下一刀。
--
-- 「且已有读数」这一条保留(刀E 加的,有正当理由):V65/V66 种子里的公摊表(A客梯1/一栋电梯…)同样四项全空,
-- 但它们是账册逐行核对过的正当档案、且种子不带读数;加这一条 CI 容器里命中 0 块,种子表不会被误标。

ALTER TABLE meter
  ADD COLUMN suspect VARCHAR(16) NULL
  COMMENT '存疑档案(§F1 两级):shadow=疑似重复建档(四空且配到档案完整的同栋同类表、同月三格全等),不进楼栋分表Σ;incomplete=四空但配不上,只是档案不全,照常计入Σ;NULL=正常。标记不删数据';

-- ① 四空且已有读数的先一律落 incomplete(保守档:照常计入Σ,只是屏上提示补档案)
UPDATE meter m
SET m.suspect = 'incomplete'
WHERE COALESCE(m.area, '') = ''
  AND COALESCE(m.spot, '') = ''
  AND COALESCE(m.tenant_name, '') = ''
  AND COALESCE(m.code, '') = ''
  AND EXISTS (SELECT 1 FROM meter_reading r WHERE r.meter_id = m.id);

-- ② 其中能配到「档案完整 + 同月三格全等」的同栋同类表的,升级成 shadow(护栏排除)。
--    外层多套一层派生表是 MySQL ERROR 1093 的标准绕法(UPDATE 的目标表不能直接出现在 WHERE 子查询里),
--    带 DISTINCT 的派生表必然物化,读到的是 ① 之后的稳定快照。<=> 是 NULL 安全等值。
UPDATE meter m
SET m.suspect = 'shadow'
WHERE m.suspect = 'incomplete'
  AND m.id IN (
    SELECT id FROM (
      SELECT DISTINCT m1.id
      FROM meter m1
      WHERE m1.suspect = 'incomplete'
        AND EXISTS (
          SELECT 1
          FROM meter m2
          JOIN meter_reading r2 ON r2.meter_id = m2.id
          JOIN meter_reading r1 ON r1.meter_id = m1.id AND r1.ym = r2.ym
          WHERE m2.id <> m1.id
            AND m2.kind = m1.kind
            AND m2.zone = m1.zone
            AND m2.building_id <=> m1.building_id
            AND (COALESCE(m2.area, '') <> '' OR COALESCE(m2.code, '') <> ''
                 OR COALESCE(m2.tenant_name, '') <> '')
            AND r1.curr_total IS NOT NULL
            AND r1.prev_total <=> r2.prev_total
            AND r1.curr_total <=> r2.curr_total
            AND r1.factor_snap <=> r2.factor_snap
        )
    ) AS t
  );
