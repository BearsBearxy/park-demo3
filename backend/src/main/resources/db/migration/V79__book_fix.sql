-- V79__book_fix.sql — 刀H §H1/§H2 两处数据订正(BOOK-REBUILD-SPEC)。
-- 结构依据:BOOK-STRUCTURE-2024-02.md(直读 xlsx 测绘)。用户 2026-07-31 拍板。

-- ── §H1 六车间电梯2(code=220605000026)倍率 50 → 40 ────────────────────────
-- 原册两张 sheet 倍率打架:
--   `公共电数据 H119 = 40` → L119 = ROUND((726.28−706.11)×40,2) = 806.80 度,V119 = 132.77 元/层
--     —— 这是**对外收费依据**,132.77 是租户实付单价;
--   `二期园区电 H88 = 50` → S88 = 1008.5 度 —— 抄表底稿。
-- 系统原按 50 出账(rule 22 std_value=165.96),每层多收 33.19 元(+25%)。
-- 用户 2026-07-31 拍板:按对外收费表(公共电数据 H119=40)。
UPDATE meter SET factor = 40.00
WHERE kind='elec' AND zone='p2' AND code='220605000026';

-- ⚠ meter_reading.factor_snap 是**快照**:只改档案倍率不会改历史月,重生成仍按 50。
-- 必须把该表已录读数的快照一并订正(库内仅 2024-02 / 2024-05 两条,不加 ym 限定=口径整条历史一致)。
-- 订正后锚点:rule 22 → qty_total=806.80 / cost_amount≈796.59 / std_value=132.77,与原册 L119/W119/V119 逐格相同。
UPDATE meter_reading r JOIN meter m ON m.id = r.meter_id
SET r.factor_snap = 40.00
WHERE m.kind='elec' AND m.zone='p2' AND m.code='220605000026';

-- ── §H2 新增 ownership 第 6 值 register:非计费计度寄存器 ───────────────────
-- register = 同一块物理表的附属计度寄存器(反向有功/正向无功/反向无功/需量/最大需量),
--            不是用电量 → 不进楼栋分表Σ、不进公摊池分母、不向租户收、不进抄表进度分母。
-- 三处判定都是**白名单**(AllocService.inSubSigma / meterSplit.inSubSigma 只认 tenant|share|park;
-- 租户计费只认 tenant;池分母走 alloc_rule_meter 显式绑定),故新值天然被排除,无需改公式。
ALTER TABLE meter MODIFY COLUMN `ownership` varchar(8) NOT NULL DEFAULT 'share'
  COMMENT 'tenant租户|share园区公摊|ops园区经营|infra配电总表|park园区自担(不收租户/不进公摊,仍入楼栋分表Σ)|register非计费计度寄存器(反向有功/需量等附属读数,不进任何Σ)';

-- `永龙反向有功`(id=1421,三车间·三楼302室,与 `永龙电` id=40 同一物理表)原被导成 ownership='tenant',
-- 正计入 building 32 的分表Σ(47884.05 里占 32.4%)。这是两个错叠加:
--   1) 原册 `二期园区电 r51` 整行只有 H51=100、N51=155.27,是另一个计度寄存器,不是用电量;
--   2) 原册 I51 为空,导入按 prev=0 起算,把一个绝对读数当成了本月增量 → S51=15527 度。
-- 预期变化(spec 明确允许):building 32 的 d_qty 47884.05 → 32357.05;
--                        二/三/四车间合并组 d_qty 81158.44 → 65631.44、e_qty −4511.56 → −20038.56。
-- owner_manual 保持 0:前端 classifyOwnership 已按名称关键词自动判 register,重导会自己判回来,不用上人工闩。
UPDATE meter SET ownership='register'
WHERE kind='elec' AND zone='p2' AND name='永龙反向有功';

-- 全库同类寄存器行盘查(只读 SQL,2026-07-31):
--   SELECT id,name FROM meter WHERE name LIKE '%有功%' OR name LIKE '%无功%' OR name LIKE '%需%'
--                                OR name LIKE '%寄存%' OR name LIKE '%功率因数%';
-- 结果**仅 1421 一行**(永龙反向有功),无其他同类行需处理。
