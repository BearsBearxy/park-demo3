-- ════════════════════════════════════════════════════════════════════════════
-- S13 二期公摊层对齐源册 —— 数据刀(层份档案/面积池/绿化水翻转/损耗形态/漂移修正)
--     (草稿 2026-08-10,**未执行**,待主会话审核;禁止直接写 dev 库)
--
-- spec: docs/design/P2-SHARE-LAYER-SPEC.md (§2/§4/§5/§6/§9)
-- 源册: 二期2024年2月水电费.xlsx 全册56户逐户逆向
--       (scratchpad p2rules/extract_1..4.json = 逐户权威;diff_report.md = 对照)
-- 库况基线(2026-08-10 只读核实):
--   alloc_rule_member 二期13池成员数 = 2:15 / 3:15 / 5:5 / 6:5 / 7:9 / 8:2 /
--     10:6 / 11:6 / 12:3 / 14:9 / 16:10 / 20:12 / 22:11,weight 全 NULL,acct_month=''
--   tenant_price_cfg 已有: p2.area_base=148918.01(id≈)、p2.green_rate=0.01(117)、
--     p2.lamp_rate=0.005(116)、green_rate_live×16(119..143 奇数位)、lamp_rate_live×10
--   alloc_rule_link 已有: (15→13),(21→9),(11→12) 全 fold_price
--   alloc_cfg 已有: rule:{2,3,5,10,11,12,14,16,20,22}.coefficient(=T,2024-02)、
--     rule:12.std_add=100、rule:13/18/20/4.frozen_2023(M109/M99/L24/L99)
--
-- 段落: §0 前置断言 → §1 56户层份→成员weight → §2 面积池基数与折入(断言为主)
--       → §3 绿化水翻转+曹/刘消防例外 → §4 损耗形态flag → §5 漂移户weight折算
--       → §6 验证SELECT(Σweight vs T + 锚点)
-- 幂等: UPDATE 为绝对值;INSERT 全部 NOT EXISTS 守卫;DELETE 按键天然幂等。可整文件重跑。
-- ════════════════════════════════════════════════════════════════════════════
SET NAMES utf8mb4;

-- ════════════════════════════════════════════════════════════════════════════
-- §0 前置断言(只读;执行前逐条目视,与「预期」不符即停)
-- ════════════════════════════════════════════════════════════════════════════
-- 断言01 池成员基数(预期: 2=15,3=15,5=5,6=5,7=9,8=2,10=6,11=6,12=3,14=9,16=10,20=12,22=11)
SELECT '断言01 池成员数' AS chk, rule_id, COUNT(*) AS cnt
FROM alloc_rule_member WHERE rule_id IN (2,3,5,6,7,8,10,11,12,14,16,20,22)
GROUP BY rule_id ORDER BY rule_id;

-- 断言02 待补档租户存在(预期 4 行: 15 协作链/李李、53 方凯鑫、60 邓宇峰、69 陈书谨)
SELECT '断言02 租户在档' AS chk, id, company_name FROM tenant WHERE id IN (15,53,60,69) ORDER BY id;

-- 断言03 面积池底盘已在(预期 3 行链接 + 1 行 area_base=148918.01000000)
SELECT '断言03a fold链' AS chk, src_rule_id, dst_rule_id, link_type FROM alloc_rule_link
WHERE (src_rule_id, dst_rule_id) IN ((15,13),(21,9),(11,12));
SELECT '断言03b 基数' AS chk, scope, cfg_key, cfg_value FROM tenant_price_cfg
WHERE scope='p2' AND cfg_key='area_base';

-- 断言04 车间池 T 值(预期与 spec §1 表全等: 2=7,3=5.8,5=7,6=6,7=7,8=4,10=7,11=6,12=18,14=6.5,16=5.7,20=7,22=6)
SELECT '断言04 T值' AS chk, id, coefficient FROM alloc_rule
WHERE id IN (2,3,5,6,7,8,10,11,12,14,16,20,22) ORDER BY id;

-- ════════════════════════════════════════════════════════════════════════════
-- §1 56户 × 电梯/消防两套层份 → 车间池成员 weight(spec §4,全员显式)
--    口径拍板②: 层份两处不一致时以 K乘数=实收金额 为准(艾派斯消防0.25/黎镇源消防0.44/
--    刘彪消防0.29/管中旺电梯0.5),J文本差异在行旁注释(member 表无 note 列,remark 落注释)。
--    影响行数预估: UPDATE 99(92 层份 + 7 置零) / INSERT 10 / DELETE 9
-- ════════════════════════════════════════════════════════════════════════════

-- ── §1.1 一车间(8号楼) 消防池2(T=7) / 电梯池3(T=5.8) ─────────────────────────
UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=2 AND tenant_id=4;    -- 飞浪
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=2 AND tenant_id=5;    -- 魏杰瑜
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=2 AND tenant_id=378;  -- 苏明东
UPDATE alloc_rule_member SET weight=0.550 WHERE rule_id=2 AND tenant_id=7;    -- 谢福兵
UPDATE alloc_rule_member SET weight=0.550 WHERE rule_id=2 AND tenant_id=11;   -- 保奔路
UPDATE alloc_rule_member SET weight=0.550 WHERE rule_id=2 AND tenant_id=10;   -- 驰鸿印业
UPDATE alloc_rule_member SET weight=0.450 WHERE rule_id=2 AND tenant_id=9;    -- 张炳南
UPDATE alloc_rule_member SET weight=0.450 WHERE rule_id=2 AND tenant_id=8;    -- 铂超贸易
UPDATE alloc_rule_member SET weight=0.440 WHERE rule_id=2 AND tenant_id=360;  -- 黎镇源 ⚠K乘0.44,I除数/J文本0.4(源册两处不一致,K为准,多收10%)
UPDATE alloc_rule_member SET weight=0.390 WHERE rule_id=2 AND tenant_id=14;   -- 中科华贸
UPDATE alloc_rule_member SET weight=0.250 WHERE rule_id=2 AND tenant_id=12;   -- 达博普
UPDATE alloc_rule_member SET weight=0.250 WHERE rule_id=2 AND tenant_id=13;   -- 何育平
UPDATE alloc_rule_member SET weight=0.530 WHERE rule_id=2 AND tenant_id=3;    -- 恩科(无电梯,仅消防)
UPDATE alloc_rule_member SET weight=0.330 WHERE rule_id=2 AND tenant_id=2;    -- 锂朋(无电梯,仅消防)
UPDATE alloc_rule_member SET weight=0.200 WHERE rule_id=2 AND tenant_id=377;  -- 新疆三林(无电梯,仅消防)
-- Σ池2 = 6.94 (T=7,差-0.06,源册即欠 —— 刻意,不补偿)

UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=3 AND tenant_id=4;    -- 飞浪
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=3 AND tenant_id=5;    -- 魏杰瑜
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=3 AND tenant_id=378;  -- 苏明东
UPDATE alloc_rule_member SET weight=0.550 WHERE rule_id=3 AND tenant_id=7;    -- 谢福兵
UPDATE alloc_rule_member SET weight=0.550 WHERE rule_id=3 AND tenant_id=11;   -- 保奔路
UPDATE alloc_rule_member SET weight=0.550 WHERE rule_id=3 AND tenant_id=10;   -- 驰鸿印业
UPDATE alloc_rule_member SET weight=0.450 WHERE rule_id=3 AND tenant_id=9;    -- 张炳南
UPDATE alloc_rule_member SET weight=0.450 WHERE rule_id=3 AND tenant_id=8;    -- 铂超贸易
UPDATE alloc_rule_member SET weight=0.400 WHERE rule_id=3 AND tenant_id=360;  -- 黎镇源(电梯0.4,与消防0.44不同 —— 源册即如此)
UPDATE alloc_rule_member SET weight=0.390 WHERE rule_id=3 AND tenant_id=14;   -- 中科华贸
UPDATE alloc_rule_member SET weight=0.250 WHERE rule_id=3 AND tenant_id=12;   -- 达博普
UPDATE alloc_rule_member SET weight=0.250 WHERE rule_id=3 AND tenant_id=13;   -- 何育平
-- Σ池3 = 5.84 (T=5.8,差+0.04)

-- ── §1.2 二车间(9栋) 消防池5(T=7) / 电梯池6(T=6) ────────────────────────────
-- 李李(=佛山协作链供应链管理有限公司,tid 15)整户缺席两池 → 补(spec §10 四项全缺根因之一)
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 5, 15, 1.340, '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_member WHERE rule_id=5 AND tenant_id=15);
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 6, 15, 1.000, '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_member WHERE rule_id=6 AND tenant_id=15);

UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=5 AND tenant_id=16;   -- 陈曼娜
UPDATE alloc_rule_member SET weight=1.340 WHERE rule_id=5 AND tenant_id=15;   -- 李李(消防1.34≠电梯1.0,同户两行独立)
UPDATE alloc_rule_member SET weight=1.120 WHERE rule_id=5 AND tenant_id=19;   -- 健明包装(§5 漂移户,本段先记真层份,§5 再折算)
UPDATE alloc_rule_member SET weight=0.570 WHERE rule_id=5 AND tenant_id=17;   -- 联洛贸易
UPDATE alloc_rule_member SET weight=0.350 WHERE rule_id=5 AND tenant_id=18;   -- 欧伟杰(§5 漂移户)
UPDATE alloc_rule_member SET weight=0.000 WHERE rule_id=5 AND tenant_id=365;  -- 暨南中院:非源册56户,无2024-02单据 → 显式0(防楼层桶null警)
-- Σ池5(真层份) = 4.38 (T=7,欠-2.62 = 空置园区自担,刻意)

UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=6 AND tenant_id=16;   -- 陈曼娜
UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=6 AND tenant_id=15;   -- 李李
UPDATE alloc_rule_member SET weight=0.820 WHERE rule_id=6 AND tenant_id=19;   -- 健明包装(电梯0.82≠消防1.12)
UPDATE alloc_rule_member SET weight=0.570 WHERE rule_id=6 AND tenant_id=17;   -- 联洛贸易
UPDATE alloc_rule_member SET weight=0.350 WHERE rule_id=6 AND tenant_id=18;   -- 欧伟杰
UPDATE alloc_rule_member SET weight=0.000 WHERE rule_id=6 AND tenant_id=365;  -- 暨南中院 → 0
-- Σ池6 = 3.74 (T=6,欠-2.26,刻意)

-- ── §1.3 三车间(10号楼) 消防池7(T=7) / 电梯池8(T=4) ─────────────────────────
-- 邓宇峰(tid 60)三车间401链缺席两池 → 补(第3张维护费单 r122/r123,共0.5层)
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 7, 60, 0.500, '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_member WHERE rule_id=7 AND tenant_id=60);

UPDATE alloc_rule_member SET weight=1.120 WHERE rule_id=7 AND tenant_id=26;   -- 吉罗德(§5 漂移户)
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=7 AND tenant_id=22;   -- 星州
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=7 AND tenant_id=23;   -- 永龙
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=7 AND tenant_id=27;   -- 毅盛离合(§5 漂移户)
UPDATE alloc_rule_member SET weight=0.400 WHERE rule_id=7 AND tenant_id=25;   -- 管中旺(消防0.4;I除数亦0.4,一致)
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=7 AND tenant_id=60;   -- 邓宇峰(三车间401块)
UPDATE alloc_rule_member SET weight=0.330 WHERE rule_id=7 AND tenant_id=375;  -- 嘉荣(无电梯,仅消防)
UPDATE alloc_rule_member SET weight=0.250 WHERE rule_id=7 AND tenant_id=20;   -- 艾派斯 ⚠K乘0.25,I除数/J文本0.28(K为准,少收)
UPDATE alloc_rule_member SET weight=0.150 WHERE rule_id=7 AND tenant_id=21;   -- 易立(无电梯,仅消防)
UPDATE alloc_rule_member SET weight=0.000 WHERE rule_id=7 AND tenant_id=376;  -- 科文:非源册56户(与嘉荣共表'嘉荣科文电',status=0) → 显式0
-- Σ池7(真层份) = 4.25 (T=7,欠-2.75,刻意)

-- 池8 现员仅 艾派斯20/嘉荣375 —— 两户恰为源册「无电梯行户」,全删;真实六户全补。
DELETE FROM alloc_rule_member WHERE rule_id=8 AND tenant_id IN (20,375);
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 8, 26, 1.120, '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_member WHERE rule_id=8 AND tenant_id=26);  -- 吉罗德
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 8, 22, 0.500, '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_member WHERE rule_id=8 AND tenant_id=22);  -- 星州
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 8, 23, 0.500, '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_member WHERE rule_id=8 AND tenant_id=23);  -- 永龙
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 8, 27, 0.500, '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_member WHERE rule_id=8 AND tenant_id=27);  -- 毅盛离合
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 8, 25, 0.500, '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_member WHERE rule_id=8 AND tenant_id=25);  -- 管中旺 ⚠电梯K乘0.5,J文本0.4(K为准,spec §4 点名)
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 8, 60, 0.500, '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_member WHERE rule_id=8 AND tenant_id=60);  -- 邓宇峰(401块)
-- Σ池8 = 3.62 (T=4,差-0.38)

-- ── §1.4 四车间(11号楼) 消防池10(T=7) / 电梯池11(T=6) / 加价档池12(系数18,+100) ──
UPDATE alloc_rule_member SET weight=2.500 WHERE rule_id=10 AND tenant_id=28;  -- 广联(共5层×每层一半50%=2.5)
UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=10 AND tenant_id=29;  -- 氙明(共2层×0.5=1.0;电梯却是0.5,两行不同)
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=10 AND tenant_id=30;  -- 威玛斯
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=10 AND tenant_id=32;  -- 张木兰
UPDATE alloc_rule_member SET weight=0.200 WHERE rule_id=10 AND tenant_id=33;  -- 两岸食品
UPDATE alloc_rule_member SET weight=0.000 WHERE rule_id=10 AND tenant_id=31;  -- 许旭锐:非源册56户(rent_area=0) → 显式0
-- Σ池10 = 4.70 (T=7,欠-2.30,刻意)

-- V64 加价档三户从普通电梯池11摘除,挂池12(spec §4:广联2.5/氙明0.5/威玛斯0.5;
-- V64=482.12=池11总额÷18+V58+100,由 alloc_cfg rule:12 coefficient=18/std_add=100 + link 11→12 表达)
DELETE FROM alloc_rule_member WHERE rule_id=11 AND tenant_id IN (28,29,30);
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=11 AND tenant_id=32;  -- 张木兰(V58=286.59 口径)
UPDATE alloc_rule_member SET weight=0.200 WHERE rule_id=11 AND tenant_id=33;  -- 两岸食品
UPDATE alloc_rule_member SET weight=0.000 WHERE rule_id=11 AND tenant_id=31;  -- 许旭锐 → 0
-- Σ池11 = 0.70 (T=6;V64组已移池12,余欠为空置+V64组,刻意)

UPDATE alloc_rule_member SET weight=2.500 WHERE rule_id=12 AND tenant_id=28;  -- 广联 482.12×2.5=1205.30(源册K46全等)
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=12 AND tenant_id=29;  -- 氙明 482.12×0.5=241.06 ⚠J文本'共1层',K=I×0.5,K为准
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=12 AND tenant_id=30;  -- 威玛斯 482.12×0.5=241.06
-- Σ池12 = 3.50 (系数18为除数档,非T闭合口径)

-- ── §1.5 五车间(12号楼+五号楼) 消防池14(T=6.5) / 电梯池16(T=5.7) ─────────────
-- 方凯鑫(tid 53)五车间601块消防缺席池14 → 补(池16已在)
INSERT INTO alloc_rule_member (rule_id, tenant_id, weight, acct_month)
SELECT 14, 53, 0.500, '' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_member WHERE rule_id=14 AND tenant_id=53);

UPDATE alloc_rule_member SET weight=3.000 WHERE rule_id=14 AND tenant_id=48;  -- 力灏(消防3层≠电梯2层)
UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=14 AND tenant_id=49;  -- 彭云霞
UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=14 AND tenant_id=56;  -- 三龙
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=14 AND tenant_id=53;  -- 方凯鑫(五601块)
UPDATE alloc_rule_member SET weight=0.410 WHERE rule_id=14 AND tenant_id=61;  -- 朱漫钳
UPDATE alloc_rule_member SET weight=0.340 WHERE rule_id=14 AND tenant_id=65;  -- 张文峰(§5 漂移户:I公式漏÷层份)
UPDATE alloc_rule_member SET weight=0.210 WHERE rule_id=14 AND tenant_id=62;  -- 南一
UPDATE alloc_rule_member SET weight=0.160 WHERE rule_id=14 AND tenant_id=66;  -- 陈土生
UPDATE alloc_rule_member SET weight=0.110 WHERE rule_id=14 AND tenant_id=64;  -- 王红婷
UPDATE alloc_rule_member SET weight=0.000 WHERE rule_id=14 AND tenant_id=63;  -- 蚁润发:非源册56户(rent_area=0) → 显式0
-- Σ池14(真层份) = 6.73 (T=6.5,差+0.23,源册即超,刻意)

UPDATE alloc_rule_member SET weight=2.000 WHERE rule_id=16 AND tenant_id=48;  -- 力灏
UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=16 AND tenant_id=49;  -- 彭云霞
UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=16 AND tenant_id=56;  -- 三龙
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=16 AND tenant_id=53;  -- 方凯鑫(五601块;六102首层无电梯,不入池22)
UPDATE alloc_rule_member SET weight=0.410 WHERE rule_id=16 AND tenant_id=61;  -- 朱漫钳
UPDATE alloc_rule_member SET weight=0.340 WHERE rule_id=16 AND tenant_id=65;  -- 张文峰
UPDATE alloc_rule_member SET weight=0.210 WHERE rule_id=16 AND tenant_id=62;  -- 南一
UPDATE alloc_rule_member SET weight=0.160 WHERE rule_id=16 AND tenant_id=66;  -- 陈土生
UPDATE alloc_rule_member SET weight=0.110 WHERE rule_id=16 AND tenant_id=64;  -- 王红婷
UPDATE alloc_rule_member SET weight=0.000 WHERE rule_id=16 AND tenant_id=63;  -- 蚁润发 → 0
-- Σ池16 = 5.73 (T=5.7,差+0.03)

-- ── §1.6 六车间(13号楼+六号楼) 消防池20(T=7) / 电梯池22(T=6) ─────────────────
UPDATE alloc_rule_member SET weight=2.000 WHERE rule_id=20 AND tenant_id=54;  -- 罗立剑
UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=20 AND tenant_id=60;  -- 邓宇峰(13座2F块)
UPDATE alloc_rule_member SET weight=0.700 WHERE rule_id=20 AND tenant_id=68;  -- 曹小芳(口径异类:实收走 L24+L99 合成价,§3 户级例外照抄;层份仍0.7备查)
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=20 AND tenant_id=67;  -- 柯建伍(无电梯,仅消防)
UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=20 AND tenant_id=53;  -- 方凯鑫(六102块,首层)
UPDATE alloc_rule_member SET weight=0.420 WHERE rule_id=20 AND tenant_id=58;  -- 应塘
UPDATE alloc_rule_member SET weight=0.330 WHERE rule_id=20 AND tenant_id=50;  -- 丁天伦
UPDATE alloc_rule_member SET weight=0.330 WHERE rule_id=20 AND tenant_id=51;  -- 石荣杰
UPDATE alloc_rule_member SET weight=0.330 WHERE rule_id=20 AND tenant_id=52;  -- 徐翾
UPDATE alloc_rule_member SET weight=0.300 WHERE rule_id=20 AND tenant_id=57;  -- 庞俊妨
UPDATE alloc_rule_member SET weight=0.290 WHERE rule_id=20 AND tenant_id=55;  -- 刘彪 ⚠K乘0.29,I除数0.3(K为准;实收亦走L24+L99,§3 户级例外)
UPDATE alloc_rule_member SET weight=0.280 WHERE rule_id=20 AND tenant_id=59;  -- 欧培敬
-- Σ池20 = 6.98 (T=7,差-0.02)

UPDATE alloc_rule_member SET weight=2.000 WHERE rule_id=22 AND tenant_id=54;  -- 罗立剑
UPDATE alloc_rule_member SET weight=1.000 WHERE rule_id=22 AND tenant_id=60;  -- 邓宇峰(13座2F块)
UPDATE alloc_rule_member SET weight=0.700 WHERE rule_id=22 AND tenant_id=68;  -- 曹小芳
UPDATE alloc_rule_member SET weight=0.420 WHERE rule_id=22 AND tenant_id=58;  -- 应塘
UPDATE alloc_rule_member SET weight=0.330 WHERE rule_id=22 AND tenant_id=50;  -- 丁天伦
UPDATE alloc_rule_member SET weight=0.330 WHERE rule_id=22 AND tenant_id=51;  -- 石荣杰
UPDATE alloc_rule_member SET weight=0.330 WHERE rule_id=22 AND tenant_id=52;  -- 徐翾
UPDATE alloc_rule_member SET weight=0.300 WHERE rule_id=22 AND tenant_id=57;  -- 庞俊妨
UPDATE alloc_rule_member SET weight=0.290 WHERE rule_id=22 AND tenant_id=55;  -- 刘彪
UPDATE alloc_rule_member SET weight=0.280 WHERE rule_id=22 AND tenant_id=59;  -- 欧培敬
-- Σ池22 = 5.98 (T=6,差-0.02)

-- ── §1.7 无电梯行户从电梯池摘除(spec §4:首层不摊已由层份天然表达)────────────
-- 名单: 陈书谨69/柯建伍67/嘉荣375/锂朋2/恩科3/新疆三林377/艾派斯20/易立21(全部电梯池),
--       方凯鑫53 仅摘六车间池22(五车间池16 的 0.5 保留)。
-- 现库实际命中: 池3{2,3,377}=3行、池22{67}=1行(池8 的 20/375 已在 §1.3 删);其余为幂等防御。
DELETE FROM alloc_rule_member
WHERE rule_id IN (3,6,8,11,16,22) AND tenant_id IN (69,67,375,2,3,377,20,21);
DELETE FROM alloc_rule_member WHERE rule_id=22 AND tenant_id=53;
-- 陈书谨(钢构车间)本就不在任何车间池:无电梯/消防池,仅损耗J7+路灯+绿化 —— 无需动作。

-- ════════════════════════════════════════════════════════════════════════════
-- §2 园区面积池:基数固定 148918.01 + 池15/21 折入(spec §2)
--    库况核实(§0 断言03):基数与三条 fold_price 链**均已在库**,本段仅幂等守卫,预估 0 行变更。
--    折入键名已对齐引擎读法:alloc_rule_link.link_type='fold_price'
--    (AllocService.java:1557 拓扑序 foldAdd=Σsrc.std,src 先各自按 round_scale 舍入 —— 与
--     spec「分量各自ROUND后相加」同构:池9=ROUND(2dp)0.01+池21折入ROUND(3dp)0.005=0.015,
--     池13=ROUND(3dp)0.001+池15折入0.007=0.008,池18=0.005,池4=0.000)。
--    TODO(引擎刀对齐点): 折入后池15/21「不再单独向租户出行」——两池 member_cnt=0 且现行
--    批次未见其 pool_rule_id 行(§6 验证),若引擎刀改动受益人解析需保持 fold 源池不落行。
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO tenant_price_cfg (scope, cfg_key, acct_month, cfg_value, note)
SELECT 'p2', 'area_base', '', 148918.01000000,
       'S13§2 二期园区面积池固定基数(源册T列常数「园区企业」,非Σcovering;池4/9/13/18 共用)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='p2' AND cfg_key='area_base' AND acct_month='');

INSERT INTO alloc_rule_link (src_rule_id, dst_rule_id, link_type)
SELECT 15, 13, 'fold_price' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_link WHERE src_rule_id=15 AND dst_rule_id=13 AND link_type='fold_price');
INSERT INTO alloc_rule_link (src_rule_id, dst_rule_id, link_type)
SELECT 21, 9, 'fold_price' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_link WHERE src_rule_id=21 AND dst_rule_id=9 AND link_type='fold_price');
INSERT INTO alloc_rule_link (src_rule_id, dst_rule_id, link_type)
SELECT 11, 12, 'fold_price' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM alloc_rule_link WHERE src_rule_id=11 AND dst_rule_id=12 AND link_type='fold_price');

-- ── §2.1 池15/21 折入源化(主会话审核补,2026-08-10)────────────────────────────
-- 源册租户单上没有「广告字灯」行:两池只作费率分量折入池13/池9,不再单独向租户出行。
-- method='ref' → 引擎 AllocService:1667 cost=null(不出户级行、不入池合计),std 照算供 fold。
-- ⚠ std_kind 保持 'qty_over_base' 不改:源册折入分量=度数÷基数(V77=ROUND(L77/T77,3)=1065.9÷
--   148918.01=0.007、V113=ROUND(L113/T113,3)=800÷148918.01=0.005,均为 L 列度数),与主池的
--   金额÷基数(V46/V65/V95)不同——数据刀初稿判「改 amount_over_base」有误,已核源册公式纠正。
UPDATE alloc_rule SET method='ref' WHERE id IN (15,21) AND method<>'ref';

-- ════════════════════════════════════════════════════════════════════════════
-- §3 绿化水翻转 + 曹小芳/刘彪消防户级例外(spec §9 + 口径拍板③④)
--    现行引擎(BillNoticeService.collectPrice): p2 默认=冻结常数 p2.green_rate=0.01,
--      户级 green_rate_live=1 → 改取当月池核算率(0.008=0.001+池15折入0.007)。
--    翻转目标: 默认=池核算率(推导,不写死),0.01 为**收取价户级例外**。
--    数据刀落法(现行引擎下零行为变化,引擎刀翻转默认后自动接管):
--      ① M109 组 37 户 → tenant:{id}.green_rate=0.01 显式例外行(tenant scope 优先命中,
--         现在=与 p2 默认同值no-op;翻转后=例外生效)。
--      ② V65 组 17 户按核算率:16 户 green_rate_live 已在库(§0 核实 id 119..143),仅补
--         邓宇峰(60) —— ⚠现行引擎下此行立即生效:绿化行变 0.008×4892.89=39.14
--         (现状 0.01×4892.89=48.93,源册 36.41+21.00=57.41 双链两价,面积亦 4551+2100≠4892.89,
--         三个数都不等 —— 已知归因:需场地级费率+面积,TODO 引擎刀;按 spec §9 名单口径落 V65 组)。
--      ③ TODO(引擎刀,勿在本刀执行): p2 默认翻转为核算率后,p2.green_rate(id 117) 与
--         16+1 条 green_rate_live 行退役 —— 届时另出清理段,本刀不删。
--      ④ 路灯不动: 全册统一 0.005(V95≡M99 同值),宿舍 0.06/0.02 口径不变。
--    影响行数预估: INSERT 37(green_rate) + 1(green_rate_live t60) + 2(消防例外) = 40 行
-- ════════════════════════════════════════════════════════════════════════════
-- ── §3.1 M109 收取价 0.01 例外 37 户(名单=extract_1..4.json green.price_ref=公共电分摊!M109)──
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:54','green_rate','',0.01000000,'S13§3 罗立剑 绿化水收取价0.01例外(源册M109);翻转后默认=池核算率' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:54' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:68','green_rate','',0.01000000,'S13§3 曹小芳 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:68' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:55','green_rate','',0.01000000,'S13§3 刘彪 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:55' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:69','green_rate','',0.01000000,'S13§3 陈书谨 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:69' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:375','green_rate','',0.01000000,'S13§3 嘉荣 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:375' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:2','green_rate','',0.01000000,'S13§3 锂朋 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:2' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:3','green_rate','',0.01000000,'S13§3 恩科 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:3' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:12','green_rate','',0.01000000,'S13§3 达博普 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:12' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:377','green_rate','',0.01000000,'S13§3 新疆三林 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:377' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:20','green_rate','',0.01000000,'S13§3 艾派斯 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:20' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:16','green_rate','',0.01000000,'S13§3 陈曼娜 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:16' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:21','green_rate','',0.01000000,'S13§3 易立 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:21' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:11','green_rate','',0.01000000,'S13§3 保奔路 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:11' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:15','green_rate','',0.01000000,'S13§3 李李(协作链) 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:15' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:7','green_rate','',0.01000000,'S13§3 谢福兵 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:7' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:5','green_rate','',0.01000000,'S13§3 魏杰瑜 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:5' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:13','green_rate','',0.01000000,'S13§3 何育平 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:13' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:9','green_rate','',0.01000000,'S13§3 张炳南 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:9' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:4','green_rate','',0.01000000,'S13§3 飞浪 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:4' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:17','green_rate','',0.01000000,'S13§3 联洛贸易 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:17' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:10','green_rate','',0.01000000,'S13§3 驰鸿印业 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:10' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:378','green_rate','',0.01000000,'S13§3 苏明东 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:378' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:8','green_rate','',0.01000000,'S13§3 铂超贸易 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:8' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:28','green_rate','',0.01000000,'S13§3 广联 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:28' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:29','green_rate','',0.01000000,'S13§3 氙明 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:29' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:30','green_rate','',0.01000000,'S13§3 威玛斯 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:30' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:22','green_rate','',0.01000000,'S13§3 星州 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:22' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:23','green_rate','',0.01000000,'S13§3 永龙 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:23' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:32','green_rate','',0.01000000,'S13§3 张木兰 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:32' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:14','green_rate','',0.01000000,'S13§3 中科华贸 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:14' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:360','green_rate','',0.01000000,'S13§3 黎镇源 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:360' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:33','green_rate','',0.01000000,'S13§3 两岸食品 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:33' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:25','green_rate','',0.01000000,'S13§3 管中旺 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:25' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:18','green_rate','',0.01000000,'S13§3 欧伟杰 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:18' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:26','green_rate','',0.01000000,'S13§3 吉罗德 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:26' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:19','green_rate','',0.01000000,'S13§3 健明包装 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:19' AND cfg_key='green_rate' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:27','green_rate','',0.01000000,'S13§3 毅盛离合 绿化水收取价0.01例外(源册M109)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:27' AND cfg_key='green_rate' AND acct_month='');

-- ── §3.2 V65 组 17 户(主会话审核改,2026-08-10):引擎翻转已落地,零数据动作 ─────────
-- BillNoticeService.collectPrice 已翻转:p2 默认=当月池核算率(0.008 推导),户级 tenant:{id}.green_rate
-- 显式收取价=例外。V65 组(含邓宇峰)不落 tenant 行即自动吃核算率;green_rate_live 键退役不再被读,
-- 库中 16 条 live 行与 p2.green_rate(id 117)/p2.lamp_rate(id 116) 冻结常数成为惰性档案,本刀不删。
-- ⚠ 邓宇峰双链已知归因:源册=V65 0.008×4551 + M109 0.01×2100=57.41,dev 单费率单面积算不出,
--   翻转后=0.008×4892.89=39.14,差额-18.27 记对账归因(场地级费率待后续拍板)。

-- ── §3.3 曹小芳/刘彪 消防户级例外(口径拍板③:照抄源册实收)────────────────────
-- 源册: I=ROUND(公共电分摊!L24 + L99×面积/层份,2) × 层份(L24=205.39/L99=0.01 为 2023 冻结参数,
--       已在 alloc_cfg rule:20/rule:4 frozen_2023 备查),合成单价≈250.68/250.31,
--       约为 V107 口径邻户 1.7 倍 —— 全册仅此两户。
-- 曹小芳: ROUND(205.39+0.01×3170.35/0.7,2)=250.68 → ×0.7=175.48(源册面积3170.35≠合同3206.88,照实收)
-- 刘彪  : ROUND(205.39+0.01×1347.50/0.3,2)=250.31 → ×0.29=72.59(I除0.3/K乘0.29,K为准)
-- 引擎已支持(主会话落,2026-08-10):BillNoticeService.applyPackages 内 packageLine 走
-- fire_amount_fixed 键——该户全部 share_elec_fire 行(车间池+园区消防设施+稳压泵)整组替换为
-- 一条固定额行,时点在 E2 之前(损耗 base 的消防分量=实收合成额,源册 K42 同口径);
-- 车间池 weight 0.7/0.29 仍在册供 Σweight 对账(池侧「已分摊」以被吞行原池为锚)。
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note)
SELECT 'tenant:68','fire_amount_fixed','',175.48000000,
       'S13§3 曹小芳 消防照抄实收175.48(L24+L99合成价250.68×0.7,冻结参数见alloc_cfg rule:20/4;拍板③)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:68' AND cfg_key='fire_amount_fixed' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note)
SELECT 'tenant:55','fire_amount_fixed','',72.59000000,
       'S13§3 刘彪 消防照抄实收72.59(合成价250.31×0.29,I除0.3/K乘0.29以K为准;拍板③)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:55' AND cfg_key='fire_amount_fixed' AND acct_month='');

-- ════════════════════════════════════════════════════════════════════════════
-- §4 损耗 base 形态 flag(spec §6;率不动=车间J,只有 base 构成分形态)
--    ⚠ cfg_key='loss_base_form' 为**占位键**,取值编码待引擎刀定稿:
--      1=A形(默认B之上并入0.16电力管理费行) / 3=C形(base=第一张电费单合计,含容量费,
--      不含维护单任何行) / 6=F形(消防+管理费+户电费,不含电梯) / 7=G形(附加A相反向
--      有功电费,不含其0.15维护行)。B/D/E 形=现状默认,不落行。
--    F 形作用域=户×损耗链: 占位键 'loss_base_form#b32'(#b{building_id},32=二期三车间;
--      邓宇峰六车间链(b35)仍为 B 默认)—— 链作用域键名待引擎刀对齐(E2 链=head_building 分桶)。
--    庞俊妨(57): 源册漏加K7尖峰行 —— 拍板口径按正确 B 形算,**不落 flag**,差异对账归因。
--    影响行数预估: INSERT 33(A组) + 1(C) + 1(F) + 1(G) = 36 行
-- ════════════════════════════════════════════════════════════════════════════
-- ── §4.1 A 形 33 户(diff_report §2.2 两单标准形名单,已剔除单列 G 形的永龙)──────
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:64','loss_base_form','',1.00000000,'S13§4 王红婷 损耗A形:base含0.16电力管理费;占位键待引擎刀' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:64' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:66','loss_base_form','',1.00000000,'S13§4 陈土生 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:66' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:61','loss_base_form','',1.00000000,'S13§4 朱漫钳 损耗A形(管理费0.15/0.10单价异价照常计入)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:61' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:62','loss_base_form','',1.00000000,'S13§4 南一 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:62' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:67','loss_base_form','',1.00000000,'S13§4 柯建伍 损耗A形(无电梯行,base自然不含电梯)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:67' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:11','loss_base_form','',1.00000000,'S13§4 保奔路 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:11' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:7','loss_base_form','',1.00000000,'S13§4 谢福兵 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:7' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:5','loss_base_form','',1.00000000,'S13§4 魏杰瑜 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:5' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:13','loss_base_form','',1.00000000,'S13§4 何育平 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:13' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:9','loss_base_form','',1.00000000,'S13§4 张炳南 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:9' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:4','loss_base_form','',1.00000000,'S13§4 飞浪 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:4' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:17','loss_base_form','',1.00000000,'S13§4 联洛贸易 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:17' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:10','loss_base_form','',1.00000000,'S13§4 驰鸿印业 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:10' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:378','loss_base_form','',1.00000000,'S13§4 苏明东 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:378' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:8','loss_base_form','',1.00000000,'S13§4 铂超贸易 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:8' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:32','loss_base_form','',1.00000000,'S13§4 张木兰 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:32' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:14','loss_base_form','',1.00000000,'S13§4 中科华贸 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:14' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:360','loss_base_form','',1.00000000,'S13§4 黎镇源 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:360' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:33','loss_base_form','',1.00000000,'S13§4 两岸食品 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:33' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:25','loss_base_form','',1.00000000,'S13§4 管中旺 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:25' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:18','loss_base_form','',1.00000000,'S13§4 欧伟杰 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:18' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:26','loss_base_form','',1.00000000,'S13§4 吉罗德 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:26' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:19','loss_base_form','',1.00000000,'S13§4 健明包装 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:19' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:27','loss_base_form','',1.00000000,'S13§4 毅盛离合 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:27' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:375','loss_base_form','',1.00000000,'S13§4 嘉荣 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:375' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:2','loss_base_form','',1.00000000,'S13§4 锂朋 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:2' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:3','loss_base_form','',1.00000000,'S13§4 恩科 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:3' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:12','loss_base_form','',1.00000000,'S13§4 达博普 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:12' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:377','loss_base_form','',1.00000000,'S13§4 新疆三林 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:377' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:20','loss_base_form','',1.00000000,'S13§4 艾派斯 损耗A形(率引J5与J6同值0.0255,引用偏行不影响金额)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:20' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:16','loss_base_form','',1.00000000,'S13§4 陈曼娜 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:16' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:15','loss_base_form','',1.00000000,'S13§4 李李(协作链) 损耗A形' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:15' AND cfg_key='loss_base_form' AND acct_month='');
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note) SELECT 'tenant:28','loss_base_form','',1.00000000,'S13§4 广联 损耗A形(base 18737.11×J7=477.80,dev整行缺失随本刀补全)' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:28' AND cfg_key='loss_base_form' AND acct_month='');

-- ── §4.2 C 形:星州(22,全册唯一含容量费户)────────────────────────────────────
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note)
SELECT 'tenant:22','loss_base_form','',3.00000000,
       'S13§4 星州 损耗C形:base=第一张电费单合计K11(含装机容量费8475+四段分时),不含维护单任何行;占位键待引擎刀'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:22' AND cfg_key='loss_base_form' AND acct_month='');

-- ── §4.3 F 形:邓宇峰(60)仅三车间链(b32);六车间链仍 B 默认───────────────────
-- 键名已与引擎对齐(BillNoticeService:907):loss_base_form_b{楼栋id},链内任一成员楼栋可命中。
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note)
SELECT 'tenant:60','loss_base_form_b32','',6.00000000,
       'S13§4 邓宇峰 三车间401链 损耗F形:消防+电力管理费+户电费,不含电梯K122(率J6);b32=二期三车间'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:60' AND cfg_key='loss_base_form_b32' AND acct_month='');

-- ── §4.4 G 形:永龙(23)───────────────────────────────────────────────────────
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note)
SELECT 'tenant:23','loss_base_form','',7.00000000,
       'S13§4 永龙 损耗G形:base含A相反向有功电费11435.07(park表金额,4行硬编码度数×正价)+管理费,不含其0.15维护行(0.15维护费不收,用户搁置);占位键待引擎刀'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:23' AND cfg_key='loss_base_form' AND acct_month='');

-- ── §4.5 G 形配套:永龙 park 表指针(主会话审核补;引擎 BillNoticeService:352 读此键,
--    base 附加该表 2024-02 电费金额=度数×p2平段价;表1468=三车间S51无名行(反向有功),
--    ownership='park' 已于 S12 建档。0.15 维护费仍不收(用户搁置)。────────────────
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note)
SELECT 'tenant:23','loss_base_park_meter','',1468.00000000,
       'S13§4 永龙 G形park表指针:S51反向有功表id=1468,其电费金额入损耗base(0.15维护费不收,搁置)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:23' AND cfg_key='loss_base_park_meter' AND acct_month='');

-- ════════════════════════════════════════════════════════════════════════════
-- §5 漂移户消防修正(spec §5:面积项除数≠自身层份,以实收为准)—— weight 折算版
--    ⚠ 本段**覆写 §1 的真层份**(吉罗德1.12→6.116 等)。机制优先级(spec §5):
--    若引擎刀支持「面积池(池9)成员级有效面积/倍率」,则**跳过本段**,改用段尾注释的
--    倍率方案并保留 §1 真层份。零引擎改动时执行本段,K 与源册全等(残差≤0.01 见各行)。
--    折算式: w = (源册消防K − ROUND(0.015×dev合同面积,2)) ÷ 车间消防每层单价V
--    影响行数预估: UPDATE 5
-- ════════════════════════════════════════════════════════════════════════════
-- 吉罗德(26,池7,V34=28.10,面积5200): 源K=249.87(I=ROUND(28.10+0.015×5200/0.4,2)=223.10×1.12)
--   池9行=ROUND(0.015×5200,2)=78.00 → w=(249.87−78.00)/28.10=6.116 → 28.10×6.116=171.86,
--   合计249.86(残差−0.01,decimal(6,3)粒度极限)
UPDATE alloc_rule_member SET weight=6.116 WHERE rule_id=7 AND tenant_id=26;
-- 毅盛离合(27,池7,面积2270): 源K=56.62(I=ROUND(28.10+0.015×2270/0.4,2)=113.23×0.5)
--   池9行=34.05 → w=(56.62−34.05)/28.10=0.803 → 22.56+34.05=56.61(残差−0.01)
UPDATE alloc_rule_member SET weight=0.803 WHERE rule_id=7 AND tenant_id=27;
-- 欧伟杰(18,池5,V22=31.82,面积1543): 源K=17.99(I=ROUND(31.82+0.015×1543/0.57,2)=72.43
--   ×0.35×22/31 按天折算) 池9行=23.15 → w=(17.99−23.15)/31.82=−0.162 → −5.15+23.15=18.00
--   (残差+0.01) ⚠负权重:按天折算户合成后需负权扣回面积项超额 —— 引擎能否吃负 weight 待引擎刀验证
UPDATE alloc_rule_member SET weight=-0.162 WHERE rule_id=5 AND tenant_id=18;
-- 健明包装(19,池5,面积5040): 源K=184.18(I=ROUND(31.82+0.015×5040/0.57,2)=164.45×1.12)
--   池9行=75.60 → w=(184.18−75.60)/31.82=3.412 → 108.57+75.60=184.17(残差−0.01)
UPDATE alloc_rule_member SET weight=3.412 WHERE rule_id=5 AND tenant_id=19;
-- 张文峰(65,池14,V71=43.60,dev合同面积1738.75≠源册1665): 源K=23.32(I=43.60+0.015×1665
--   漏÷层份,×0.34) 池9行按dev面积=ROUND(0.015×1738.75,2)=26.08 → w=(23.32−26.08)/43.60
--   =−0.063 → −2.75+26.08=23.33(残差+0.01;若面积改回源册1665则 w=−0.038 残差0)
UPDATE alloc_rule_member SET weight=-0.063 WHERE rule_id=14 AND tenant_id=65;
-- 广联/氙明/威玛斯(池10): 源册「每层一半50%」在 I÷ 与 K× 两端互逆,面积项净=×1.0,
--   **无需修正行**(已验算全等): 广联 32.80×2.5+ROUND(0.015×9263,2)=82.00+138.95=220.95 ✓
--   氙明 32.80×1.0+55.58=88.38 ✓ 威玛斯 32.80×0.5+27.79=44.19 ✓
--
-- ── 替代方案(若引擎刀支持池9成员级有效面积倍率,启用下块并回填 §1 真层份)──────
-- -- TODO 引擎刀:面积池成员倍率键未定(alloc_rule_member.weight 在 area 池的语义扩展?)
-- -- UPDATE alloc_rule_member SET weight=1.120 WHERE rule_id=7  AND tenant_id=26;  -- 回真层份
-- -- UPDATE alloc_rule_member SET weight=0.500 WHERE rule_id=7  AND tenant_id=27;
-- -- UPDATE alloc_rule_member SET weight=0.350 WHERE rule_id=5  AND tenant_id=18;
-- -- UPDATE alloc_rule_member SET weight=1.120 WHERE rule_id=5  AND tenant_id=19;
-- -- UPDATE alloc_rule_member SET weight=0.340 WHERE rule_id=14 AND tenant_id=65;
-- -- INSERT 池9 成员倍率: 吉罗德×2.8(=1.12/0.4)、毅盛×1.25(=0.5/0.4)、欧伟杰×0.614×22/31、
-- --   健明×1.965(=1.12/0.57)、张文峰×0.34(且面积应取源册1665)

-- ════════════════════════════════════════════════════════════════════════════
-- §6 验证(只读;执行后逐条目视)
-- ════════════════════════════════════════════════════════════════════════════
-- 验证01 Σweight vs T 逐池(§5 执行后预期):
--   池2=6.940(T7) 池3=5.840(T5.8) 池5=6.160(T7,真层份4.38+漂移折算) 池6=3.740(T6)
--   池7=9.549(T7,真层份4.25+漂移折算) 池8=3.620(T4) 池10=4.700(T7) 池11=0.700(T6)
--   池12=3.500(系数18) 池14=6.327(T6.5,真层份6.73+张文峰折算) 池16=5.730(T5.7)
--   池20=6.980(T7) 池22=5.980(T6)
--   ※ 二/三/四车间欠配与漂移折算差均为已知刻意态 → 对账屏 warn 文案「空置园区自担」不阻断
SELECT r.id AS pool, r.name, r.coefficient AS T,
       ROUND(SUM(m.weight),3) AS sum_weight, COUNT(*) AS members,
       SUM(m.weight IS NULL) AS null_weights   -- 预期全 0(全员显式)
FROM alloc_rule r JOIN alloc_rule_member m ON m.rule_id=r.id
WHERE r.id IN (2,3,5,6,7,8,10,11,12,14,16,20,22)
GROUP BY r.id, r.name, r.coefficient ORDER BY r.id;

-- 验证02 成员数(预期: 2=15,3=12,5=6,6=6,7=10,8=6,10=6,11=3,12=3,14=10,16=10,20=12,22=10)
--   且电梯池不得再含无电梯行户(69,67,375,2,3,377,20,21 及 池22 的 53)
SELECT '验证02 电梯池违规残留' AS chk, rule_id, tenant_id FROM alloc_rule_member
WHERE (rule_id IN (3,6,8,11,16,22) AND tenant_id IN (69,67,375,2,3,377,20,21))
   OR (rule_id=22 AND tenant_id=53)
   OR (rule_id=11 AND tenant_id IN (28,29,30));   -- 预期 0 行

-- 验证03 tenant_price_cfg 落行数
--   green_rate(tenant:*)=37 / fire_amount_fixed=2 / loss_base_form=35(A33+C1+G1) /
--   loss_base_form_b32=1 / loss_base_park_meter=1(green_rate_live 16 条为退役惰性行,不计)
SELECT cfg_key, COUNT(*) AS cnt FROM tenant_price_cfg
WHERE (cfg_key='green_rate' AND scope LIKE 'tenant:%')
   OR cfg_key IN ('fire_amount_fixed','loss_base_form','loss_base_form_b32','loss_base_park_meter')
GROUP BY cfg_key ORDER BY cfg_key;

-- ════════════════════════════════════════════════════════════════════════════
-- §7 缺行修复数据侧(主会话审核补;spec §10,引擎刀根因清单 4/5/6 条)
-- ════════════════════════════════════════════════════════════════════════════
-- ── §7.1 欧伟杰(18) mgmt 缺失:三行压制配置删除(读数四段俱全 Σ596.2×0.16=95.40 与源册全等)──
DELETE FROM tenant_price_cfg WHERE scope='tenant:18'
  AND cfg_key IN ('elec_package','mgmt_fee','mgmt_fee_commercial') AND acct_month='';

-- ── §7.2 李李(15) 园区级池漏户:合同挂楼栋15「二期 一至四车间」──────────────────────
-- 主会话已目视定稿(2026-08-10):zoneOfBuilding 的 zone 来自**挂栋电表**(BillNoticeService:145-149),
-- 楼栋15 零表 → phase=2 也推不出 zone,方案A(改楼栋)无效 → 定方案B:三份 active 合同
-- (149/455/456,均 building_id=15)改挂二车间(31,=李李车间池5/6 所在栋)。
UPDATE contract SET building_id=31 WHERE tenant_id=15 AND building_id=15;

-- ── §7.3 中科华贸(14) 户面积=0:合同219 rent_area=0 且 rent_factory 行 area=NULL ──────
-- 主会话已目视定稿:rent_factory 行(7878) unit_price=0.0000 → 补 area=320 租金仍 0×320=0
-- 不变,只喂公摊面积基数(320 现挂在 infra 行 7875 上,1.96×320 基础设施费不动)。
UPDATE contract_billing_term SET area=320 WHERE contract_id=219 AND fee_key='rent_factory' AND area IS NULL;
UPDATE contract SET rent_area=320 WHERE id=219 AND rent_area=0;

-- ── §7.4 广联(28)/嘉荣(375) 户内电表缺失:**本刀不建**(遗留归因)────────────────────
-- 广联绑定「表体系差」遗留④(册按总表16738度×120,库按铺面表+52间分表,差≈8606度)——
-- 建总表会与52分表双计电费,须待表体系拍板;嘉荣需从源册补4段读数,随广联一并做。
-- 对账归因:广联 mgmt 2678.01+损耗477.80、嘉荣 mgmt 83.58+其户内电费,列遗留清单。

-- ════════════════════════════════════════════════════════════════════════════
-- §8 S13-b 对账修复轮(首轮重生成 BN20260810065959 对账后,主会话定稿 2026-08-10)
-- ════════════════════════════════════════════════════════════════════════════
-- ── §8.1 ⭐表77「六车间电梯2」倍率 50→40(源册公共电数据 r119 H=40 铁证;
--    dev 池22 每层 165.96 vs 源 V119=132.77 差 25%,10户电梯+8条损耗联动共18条随此归零)──
UPDATE meter SET factor=40 WHERE id=77 AND factor=50;
UPDATE meter_reading SET factor_snap=40 WHERE meter_id=77 AND ym='2024-02' AND factor_snap=50;

-- ── §8.2 漂移户第二批(源册层份两处不一致,拍板②以K乘数实收为准,weight 反推)──────────
-- 黎镇源(360,池2,V4=20.18): 源I÷0.4但K×0.44 → 面积项×1.1,w=0.44+1.80/20.18=0.529
UPDATE alloc_rule_member SET weight=0.529 WHERE rule_id=2 AND tenant_id=360;
-- 艾派斯(20,池7,V34=28.10): 源I÷0.28但K×0.25 → 面积项×0.893,w=0.25-2.01/28.10=0.179(残差+0.01)
UPDATE alloc_rule_member SET weight=0.179 WHERE rule_id=7 AND tenant_id=20;
-- 欧伟杰(18,池6): 中途入驻22天折算(源=169.26×0.35×22/32=40.73),w=0.35×22/32≈0.241(残差+0.06,
--   3dp粒度极限;真层份0.35,换月满月需回填——消防侧-0.162已含折算)
UPDATE alloc_rule_member SET weight=0.241 WHERE rule_id=6 AND tenant_id=18;

-- ── §8.3 易立(21) 损耗A形补漏(对账实证其 base 含管理费24.65,extract 初判B有误)──────
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note)
SELECT 'tenant:21','loss_base_form','',1.00000000,'S13§8 易立 损耗A形(对账补:base含管理费24.65)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:21' AND cfg_key='loss_base_form' AND acct_month='');

-- ── §8.4 永龙(23) G形 park 表金额月度覆盖(源册4行反向按各段正价Σ=11435.07,
--    单总读数×平段价=11191.38 推不出,逐月照抄册面;引擎 loss_base_park_amount 月行优先)──
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note)
SELECT 'tenant:23','loss_base_park_amount','2024-02',11435.07000000,
       'S13§8 永龙 G形2024-02反向有功电费金额照抄册面(4行分段正价Σ;无月行则回退度数×平段价)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:23' AND cfg_key='loss_base_park_amount' AND acct_month='2024-02');

-- ── §8.5 陈书谨(69) 消防免收(源册钢构无消防行;固定0=免收,吞园区面积项9.16 不落行)────
INSERT INTO tenant_price_cfg (scope,cfg_key,acct_month,cfg_value,note)
SELECT 'tenant:69','fire_amount_fixed','',0.00000000,'S13§8 陈书谨 钢构消防免收(源册无此行;固定0=吞行不落)'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM tenant_price_cfg WHERE scope='tenant:69' AND cfg_key='fire_amount_fixed' AND acct_month='');

-- ── §8.6 刘彪(55) 六车间壳合同199 补面积(1347.50㎡ 原只挂三期合同不入 p2 名册,
--    致路灯6.74/绿化13.48 两行缺失;199 无计费行(已目视),rent_area 只作公摊面积基数)──
UPDATE contract SET rent_area=1347.50 WHERE id=199 AND rent_area=0;
-- §8.6b 实测补刀两条:①areaByZoneTenant 只认计费行面积(rent_area 仅 splitShare 回退),光补 rent_area
-- 面积池仍不长行 → 按中科华贸同款(§7.3)补 0 价面积载体行(单价0不出租金,只作园区面积池基数);
-- ②199 起止日期 NULL(S12 壳合同卸雷)→ 不进 covering 名册,补链同款日期。潜伏计费行=仅此 0 价载体行,
-- 引爆量=0(力灏教训已量化);补后实测 刘彪路灯 6.74/绿化 13.48 精确落地,三期链租金 14822.50 原样。
INSERT INTO contract_billing_term (contract_id, location, property_type, fee_key, fee_name, bill_mode, unit_price, area, coeff, source, note)
SELECT 199, '二期13号楼', 'factory', 'rent_factory', '厂房租金', 'per_sqm_month', 0.0000, 1347.50, 1.0000, 'manual', 'S13§8.6b 面积载体行(单价0不出租金,只作园区面积池基数;真租金在三期链221/369)'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM contract_billing_term WHERE contract_id=199 AND fee_key='rent_factory');
UPDATE contract SET start_date='2022-12-26', end_date='2031-12-25' WHERE id=199 AND start_date IS NULL;

-- §8 验证: 表77 倍率、三 weight、四 cfg 行
SELECT '§8验证 表77' AS chk, factor FROM meter WHERE id=77;
SELECT '§8验证 weight' AS chk, rule_id, tenant_id, weight FROM alloc_rule_member
WHERE (rule_id=2 AND tenant_id=360) OR (rule_id=7 AND tenant_id=20) OR (rule_id=6 AND tenant_id=18);
SELECT '§8验证 cfg' AS chk, scope, cfg_key, acct_month, cfg_value FROM tenant_price_cfg
WHERE (scope='tenant:21' AND cfg_key='loss_base_form')
   OR (scope='tenant:23' AND cfg_key='loss_base_park_amount')
   OR (scope='tenant:69' AND cfg_key='fire_amount_fixed');
SELECT '§8验证 刘彪199' AS chk, id, rent_area FROM contract WHERE id=199;

-- 验证04 锚点(重生成 2024-02 批次后人工核对,本脚本不触发生成):
--   力灏(48): 电梯=五车间电梯池总额÷5.7×2 = 217.33×2 = 434.66 ✓(spec §11 锚点2,不回归)
--            消防=43.60×3 + ROUND(0.015×14105.63,2)=130.80+211.58=342.38 ✓
--   王红婷(64): 电梯=217.33×0.11=23.91 ✓ 损耗A形 base 487.29×0.0287=13.99 / 路灯2.59 / 绿化4.14
--            消防=43.60×0.11=4.80 + 0.015×517=7.76 → 12.56 vs 源册12.55:源册先合成
--            I=ROUND(43.60+70.50,2)=114.10 再×0.11 —— 拆行舍入序差 1 分,须引擎刀复刻 I 算序
--            (mergeMaintRows 合并行内先加总再舍)方可归零,数据层无解 —— 待引擎刀对齐。
--   广联(28): 电梯=池12 V64口径 482.12×2.5=1205.30(引擎须走 coefficient=18+std_add=100+
--            link 11→12 的加价档路径,现行引擎未接通 —— spec §4 接通项,待引擎刀)。
-- 验证05 折入源池不出行(现行批次;预期 0 行)
SELECT '验证05 池15/21出行' AS chk, COUNT(*) AS cnt FROM bill_notice_line WHERE pool_rule_id IN (15,21);
