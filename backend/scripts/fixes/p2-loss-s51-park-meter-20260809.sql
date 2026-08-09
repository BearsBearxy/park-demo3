-- ============================================================================
-- 引擎刀一:二期二/三/四车间损耗链 0.2067 → 0.0255(2026-08-09)
--
-- 病根(取证结论):
--   源册「二期园区损耗」对二/三/四车间是**合并计损**(共用三车间总表):
--     F5 = E5+E6+E7-C6 = 12687.39+47884.05+20587-85670 = -4511.56
--     J5=J6=J7 = -ROUND((F5-H5)/C6-I5,4) = 0.0255(同一公式,不是巧合)
--   其中 E6=S56=SUM(S41:S55)-S44-S45 = 47884.05 **包含第 51 行**:
--     一条无名行(无位置/无租户/无表号),H51=100,N51=155.27,I51 空
--     → S51=ROUND((155.27-0)*100,2)=15527(紧挨 r50 永龙,即刀H注释里的「永龙反向有功」)。
--   这块表**从未导入**(dev 库无 ownership='register' 表、无 155.27 读数)
--   → 引擎链 D=65631.44,比源册少 15527
--   → 率 = -ROUND((65631.44-85670-(-2500))/85670,4)+0.002 = 0.2067(逐位复现)。
--   loss_head 归组配置(70/71:31,33→32)与引擎合并链算法均与源册口径一致,不动。
--   ⚠与用户指令「分开二三四车间」的出入:源册本身就是合并算(二/四车间总表=0,三车间供电),
--     物理上拆不开;合并链把同一率 0.0255 给到三栋,效果与「各车间 0.0255」完全一致。
--
-- 修复:按源册补建该无名行为 ownership='park'(园区自担:入损耗分表Σ、不向任何租户计费,
--   与 AllocService.inSubSigma 白名单 tenant/share/park 契合,零代码改动)+ 2024-02 读数。
--   owner_manual=1 防导入静默冲掉(该行无表号无名称,导入器本就跳过它)。
--
-- 预期(重生成 2024-02 后):
--   链 D = 65631.44+15527 = 81158.44 = 源册 E5+E6+E7
--   二/三/四车间收取率 = 0.0255(=源册 J 列);一车间 0.0271/五 0.0287/六 0.0381 不受波及
--   16 户损耗行合计 8125.95 → ≈1002.48(月度多收 ≈7123 元归零)
--   锚点(bill_notice_line share_elec_loss,base×率):
--     星州   3371.91 → 415.98   (base 16313.06)
--     永龙   1808.84 → 223.15   (base 8751.05)
--     健明包装 1302.28 → ≈160.66 (base 6300.36;刀二同时砍其一楼电梯份 169.26,base 会再降)
--     协作链(李李) 727.40 → 89.74 (base 3519.12)
--   注(复核更正,起草稿说"仅陈书谨有损耗行"是错的):册面 0.0255 损耗行约 20 户
--   (星州 631.74/永龙 563.64/广联 477.80/健明 183.61/李李 112.47/嘉荣 16.00 等)。
--   修率之后仍有两类既有缺口(本刀不动,记档待拍板):
--   ① dev 比册少出 4 户损耗行(广联/氙明/威玛斯/嘉荣,册收合计 509.47);
--   ② base 口径差:册 base=用电总金额**含容量费**(星州册 631.74 vs 修后 415.98,
--     差恰=容量 8475×0.0255),dev 的 E2 口径不含容量——两套口径,待用户拍板哪个为准。
--
-- ⚠2024-02 之后的月份:各月源册若仍有该无名行,需补该月读数,否则该月链率仍偏高。
-- ============================================================================

-- 1) 建表档案(幂等:已存在则跳过)
INSERT INTO meter (kind, zone, name, tenant_name, building_id, ownership, factor,
                   floor_label, owner_manual, loc_manual, sort_no)
SELECT 'elec', 'p2', '三车间S51未名行(永龙反向有功)', NULL, 32, 'park', 100.00,
       NULL, 1, 0, 0
WHERE NOT EXISTS (SELECT 1 FROM meter WHERE name = '三车间S51未名行(永龙反向有功)');

-- 2) 2024-02 读数(幂等)
INSERT INTO meter_reading (meter_id, ym, prev_total, curr_total, factor_snap, source, note)
SELECT m.id, '2024-02', 0.00, 155.27, 100.00, 'manual',
       '源册二期园区电!r51 无名行:S51=15527,入三车间段Σ(S56);损耗链D缺口修复'
FROM meter m
WHERE m.name = '三车间S51未名行(永龙反向有功)'
  AND NOT EXISTS (SELECT 1 FROM meter_reading r WHERE r.meter_id = m.id AND r.ym = '2024-02');

-- 3) 验证:链 C/D 与预期率(应得 C=85670.00, D=81158.44, rate=0.0255)
SELECT
  SUM(CASE WHEN m.ownership='infra' AND m.name NOT LIKE '%铝缆%'
           THEN (r.curr_total-r.prev_total)*r.factor_snap END)                       AS C_head,
  SUM(CASE WHEN m.ownership IN ('tenant','share','park')
           THEN (r.curr_total-r.prev_total)*r.factor_snap END)                       AS D_sub,
  -ROUND((SUM(CASE WHEN m.ownership IN ('tenant','share','park')
                   THEN (r.curr_total-r.prev_total)*r.factor_snap END)
          - SUM(CASE WHEN m.ownership='infra' AND m.name NOT LIKE '%铝缆%'
                     THEN (r.curr_total-r.prev_total)*r.factor_snap END)
          - (-2500))
         / SUM(CASE WHEN m.ownership='infra' AND m.name NOT LIKE '%铝缆%'
                    THEN (r.curr_total-r.prev_total)*r.factor_snap END), 4) + 0.002  AS rate_expect
FROM meter m
JOIN meter_reading r ON r.meter_id = m.id AND r.ym = '2024-02'
WHERE m.building_id IN (31, 32, 33) AND m.kind = 'elec' AND m.zone = 'p2';

-- 应用后:POST /api/alloc/generate?ym=2024-02 重生成,再重派 2024-02 催缴单批次。

-- 回滚:
-- DELETE r FROM meter_reading r JOIN meter m ON m.id=r.meter_id
--   WHERE m.name='三车间S51未名行(永龙反向有功)';
-- DELETE FROM meter WHERE name='三车间S51未名行(永龙反向有功)';
