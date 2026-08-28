package com.park.demo3.service;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;

// 池核算引擎纯函数锚点(POOL-ENGINE-SPEC §3,公式权威=POOL-FORMULA-AUDIT-2024-02):
// 全部锚点取自 2024-02 两册缓存值逐格验算结果。旧 PB-ALLOCATION 口径中与审计冲突的锚点已按审计更新:
// ① extra_qty 从应分摊移到标准分子(AC43 加170只抬单价不抬 AD);② 损耗率变体由配置驱动不由 E 符号推断(F座 E>0 仍净额式)。
class AllocServiceTest {

    private static BigDecimal d(String s) { return new BigDecimal(s); }
    private static final BigDecimal AB = d("1.11416875");   // 一期商业价+维护费(创显承担电费!O3)
    // 二期分时价=电价+0.16 维护费
    private static final BigDecimal P_SHARP = d("1.66076875"), P_PEAK = d("1.36606875"),
        P_FLAT = d("0.88076875"), P_VALLEY = d("0.45116875");

    // ── p2 车间池(一车间消防 r4):尖20.1按峰价(r=0)+峰26.7+平60.3+谷53.7 → W=141.27,V=W未舍入/7→20.18 ──
    @Test
    void p2_pool_w4_v4() {
        BigDecimal unrounded = AllocService.p2Unrounded(d("20.1"), d("26.7"), d("60.3"), d("53.7"),
            P_SHARP, P_PEAK, P_FLAT, P_VALLEY, BigDecimal.ZERO);
        assertEquals(0, AllocService.r2(unrounded).compareTo(d("141.27")));
        assertEquals(0, AllocService.stdAmountOverBase(unrounded, d("7"), 2, null, null).compareTo(d("20.18")));
    }

    // ── p2 折入两段拼(V46=0.015):ROUND(2163.8508/148918.01,2)=0.01 + fold(六车间广告字 qty_over_base
    //    800/148918.01→ROUND3=0.005)——非 2163.85/面积一次除出 ──
    @Test
    void p2_foldPrice_v46() {
        BigDecimal fold = AllocService.stdQtyOverBase(d("800"), d("148918.01"), 3, null, null);
        assertEquals(0, fold.compareTo(d("0.005")));
        assertEquals(0, AllocService.stdAmountOverBase(d("2163.8508"), d("148918.01"), 2, fold, null)
            .compareTo(d("0.015")));
    }

    // ── p2 3位面积池(保安亭路灯 V95):685.0906/148918.01→ROUND3=0.005 ──
    @Test
    void p2_areaPool_v95() {
        assertEquals(0, AllocService.stdAmountOverBase(d("685.0906"), d("148918.01"), 3, null, null)
            .compareTo(d("0.005")));
    }

    // ── p1 加度(B座货梯 AC43):std=ROUND((152.7+491.8+170)/3×AB,2)=302.50;
    //    cost=逐表行ROUND再Σ=170.13+547.95(不含170——加度只抬单价不抬应分摊,审计口径) ──
    @Test
    void p1_extraQty_ac43() {
        assertEquals(0, AllocService.stdQtyPriceOverBase(d("644.5"), d("170"), d("3"), AB, 2, null, null)
            .compareTo(d("302.50")));
        BigDecimal cost = AllocService.r2(d("152.7").multiply(AB)).add(AllocService.r2(d("491.8").multiply(AB)));
        assertEquals(0, cost.compareTo(d("718.08")));
        assertEquals(0, AllocService.r2(d("152.7").multiply(AB)).compareTo(d("170.13")));
        assertEquals(0, AllocService.r2(d("491.8").multiply(AB)).compareTo(d("547.95")));
    }

    // ── p1 多表逐行ROUND(A座电梯 AD27..30):cost=151.30+298.82+225.28+335.78=1011.18
    //    (池级一次ROUND会错得1011.19);std=(907.57)/12487.04×AB→0.08 ──
    @Test
    void p1_perRowRound_a27() {
        BigDecimal cost = AllocService.r2(d("135.8").multiply(AB))
            .add(AllocService.r2(d("268.2").multiply(AB)))
            .add(AllocService.r2(d("202.2").multiply(AB)))
            .add(AllocService.r2(d("301.37").multiply(AB)));
        assertEquals(0, cost.compareTo(d("1011.18")));
        // 反例:池级一次 ROUND=1011.19 ≠ 逐行口径
        assertEquals(0, AllocService.r2(d("907.57").multiply(AB)).compareTo(d("1011.19")));
        assertEquals(0, AllocService.stdQtyPriceOverBase(d("907.57"), null, d("12487.04"), AB, 2, null, null)
            .compareTo(d("0.08")));
    }

    // ── p1 净量例外(招商净电 S8):+697.6+444.8-4.74-315.6,extra=-670→净152.06,一次ROUND(×AB)=169.42 ──
    @Test
    void p1_netPool_s8() {
        BigDecimal net = d("697.6").add(d("444.8")).subtract(d("4.74")).subtract(d("315.6")).add(d("-670"));
        assertEquals(0, net.compareTo(d("152.06")));
        assertEquals(0, AllocService.r2(net.multiply(AB)).compareTo(d("169.42")));
    }

    // ── ref 行(四车间电梯普通户档 V58 + 广联分摊 V64):coefficient=6→ROUND(1719.5155/6,2)=286.59;
    //    广联(ref,同4表,coefficient=18,fold_price←V58,std_add=100)=ROUND(1719.5155/18,2)+286.59+100=482.12 ──
    @Test
    void p2_ref_v58_v64() {
        BigDecimal v58 = AllocService.stdAmountOverBase(d("1719.5155"), d("6"), 2, null, null);
        assertEquals(0, v58.compareTo(d("286.59")));
        assertEquals(0, AllocService.stdAmountOverBase(d("1719.5155"), d("18"), 2, v58, d("100"))
            .compareTo(d("482.12")));
    }

    // ── 损耗率(变体按配置,POOL-FORMULA-AUDIT 损耗表增补节) ──
    @Test
    void lossRate_p1_a_net() {
        // A座 net(2024-02):C=38550,E=-3673.5,G=86.8,a=-1500(S21:原 g_adj 并入调整度数,G+g ≡ E−G−a)
        // → I=-ROUND((E-G-a)/C,4)+0.003=0.0616,与并入前 G=-1413.2 逐格相等
        assertEquals(0, AllocService.tenantLossRate("net", d("-3673.5"), d("86.8"), d("-1500"), d("0.003"), d("38550"))
            .compareTo(d("0.0616")));
        assertEquals(0, AllocService.tenantLossRate("net", d("-3673.5"), d("-1413.2"), null, d("0.003"), d("38550"))
            .compareTo(d("0.0616")));
    }

    // ── S21 §4.2 定稿四组(源册 2023-08) ──
    @Test
    void lossRate_s21_p1_a_net_2023_08() {
        // 一期 A座 H5:E=-13471.14,G=388.62,a=-8000(源册 D+8000 ⇒ a=-8000),C=106245 → -ROUND((E-G-a)/C,4)=0.0552
        assertEquals(0, AllocService.tenantLossRate("net", d("-13471.14"), d("388.62"), d("-8000"), null, d("106245"))
            .compareTo(d("0.0552")));
    }

    @Test
    void lossRate_s21_shareOnly_plusRate() {
        // 纯公摊式:ROUND(388.62/28792.8,4)=0.0135 + 加点 0.003 = 0.0165
        assertEquals(0, AllocService.tenantLossRate("share_only", d("-100"), d("388.62"), null, d("0.003"), d("28792.8"))
            .compareTo(d("0.0165")));
    }

    @Test
    void lossRate_s21_p2_denomCable() {
        // 二期 2023-08 二三四车间 G5=ROUND(F5/(C5+C6+C7+D6),4):E=-44.89,分母=总表 19220+铝缆 9972=29192 → 0.0015
        // (只取总表会算成 0.0023,源册不是这样)
        AllocService.GroupRate gr = AllocService.lossGroupRate("net", d("19220"), d("9972"), true,
            d("-44.89"), null, null, null, null);
        assertEquals(0, gr.denom().compareTo(d("29192")));
        assertEquals(0, gr.rate().compareTo(d("0.0015")));
        assertEquals(0, gr.formula().compareTo(d("0.0015")));
        assertNull(gr.manual());
        assertEquals(0, AllocService.lossGroupRate("net", d("19220"), d("9972"), false,
            d("-44.89"), null, null, null, null).rate().compareTo(d("0.0023")));
    }

    @Test
    void lossRate_s21_manualOverride_keepsFormula() {
        // 一期 2023-08 B座:手工率 0.0156 覆盖收取率,公式值仍算出并排(E=-277.6,G=388.62,C=28792.8 → 0.0231)
        AllocService.GroupRate gr = AllocService.lossGroupRate("net", d("28792.8"), null, false,
            d("-277.6"), d("388.62"), null, null, d("0.0156"));
        assertEquals(0, gr.rate().compareTo(d("0.0156")));
        assertEquals(0, gr.manual().compareTo(d("0.0156")));
        assertEquals(0, gr.formula().compareTo(d("0.0231")));
        assertEquals(0, gr.denom().compareTo(d("28792.8")));
        // 不核算栋:率与公式皆空,分母仍给出
        AllocService.GroupRate none = AllocService.lossGroupRate("none", d("100"), null, false, d("-1"), null, null, null, d("0.01"));
        assertNull(none.rate()); assertNull(none.formula()); assertEquals(0, none.denom().compareTo(d("100")));
    }

    @Test
    void lossRate_p1_b_shareOnly() {
        // B座 share_only(配置驱动,E=+80.67 不再由符号推断):I=ROUND(86.8/5318.4,4)+0.005=0.0213
        assertEquals(0, AllocService.tenantLossRate("share_only", d("80.67"), d("86.8"), null, d("0.005"), d("5318.4"))
            .compareTo(d("0.0213")));
    }

    @Test
    void lossRate_p2_group234() {
        // 二/三/四车间合并(三车间供电):C=85670,E=(12687.39+47884.05+20587)-85670=-4511.56,adjQty=-2500 → 0.0255
        BigDecimal e = d("12687.39").add(d("47884.05")).add(d("20587")).subtract(d("85670"));
        assertEquals(0, e.compareTo(d("-4511.56")));
        assertEquals(0, AllocService.tenantLossRate("net", e, null, d("-2500"), d("0.002"), d("85670"))
            .compareTo(d("0.0255")));
    }

    @Test
    void lossRate_p2_w5_netWithPositiveE() {
        // 五车间 E=+19.95>0 仍净额式(变体配置驱动的关键证据):adjQty=1000 → 0.0287
        assertEquals(0, AllocService.tenantLossRate("net", d("19.95"), null, d("1000"), d("0.002"), d("36685"))
            .compareTo(d("0.0287")));
    }

    // ── dorm:路灯 860.93×1.13156875/15510→0.06;绿化水 manual_qty 84吨×price_override 4.45/15510→0.02 ──
    @Test
    void dorm_lamp_green() {
        assertEquals(0, AllocService.stdQtyPriceOverBase(d("860.93"), null, d("15510"), d("1.13156875"), 2, null, null)
            .compareTo(d("0.06")));
        assertEquals(0, AllocService.stdQtyPriceOverBase(d("84"), null, d("15510"), d("4.45"), 2, null, null)
            .compareTo(d("0.02")));
    }

    // ── G 基数:ROUND(520.82/6,2)=86.80;A座 g=86.8+(-1500)=-1413.2 ──
    @Test
    void parkPool_g() {
        BigDecimal g = AllocService.r2(d("520.82").divide(d("6"), 10, java.math.RoundingMode.HALF_UP));
        assertEquals(0, g.compareTo(d("86.80")));
        assertEquals(0, g.add(d("-1500")).compareTo(d("-1413.2")));
    }

    // ── 刀I §I1(V84):原册块1 r5–r9 是**五个独立行**,不是一个分摊池 ──
    // 原册 AC/AD 逐行独立(32.88/20.67/113.10/169.42/244.21),五行唯一共用的是 AG5:AG9 合并的备注
    // 「计入园区损耗分摊」——去向标记而非分摊池。`一期园区损耗!G = ROUND(SUM(公共电分摊明细!S5:S9)/6,2)`
    // 取的就是这五行的 Σ。拆开后 Σ 与 G 必须与折成一池时逐格相同(拆池不是改数)。
    @Test
    void parkPool_fiveRows_sum_g() {
        BigDecimal[] qty = {d("29.51"), d("18.55"), d("101.51"), d("152.06"), d("219.19")};
        String[] cost = {"32.88", "20.67", "113.10", "169.42", "244.21"};
        BigDecimal sumQty = BigDecimal.ZERO;
        for (int i = 0; i < qty.length; i++) {
            // 拆出的 4 条 direct 行 = 单表逐表 ROUND(度×AB);r8 招商中心是净额行,净量后一次 ROUND —— 同一算式
            assertEquals(0, AllocService.r2(qty[i].multiply(AB)).compareTo(d(cost[i])), cost[i]);
            sumQty = sumQty.add(qty[i]);
        }
        assertEquals(0, sumQty.compareTo(d("520.82")));
        assertEquals(0, AllocService.r2(sumQty.divide(d("6"), 10, java.math.RoundingMode.HALF_UP))
            .compareTo(d("86.80")));
        // 块1 小计(原册 S11/AC11):六行 Σ 用量与 ROUND(Σ×AB),招商中心只算一次(刀前 fold_qty 让它进了两遍)
        BigDecimal s11 = sumQty.add(d("2683.80"));
        assertEquals(0, s11.compareTo(d("3204.62")));
        assertEquals(0, AllocService.r2(s11.multiply(AB)).compareTo(d("3570.49")));
    }

    // ══ 既有户级口径(PB-ALLOCATION,保留不动) ══

    // AC15(area 一期):分摊标准=ROUND(用量/1734.73×1.11417,2)=0.02 元/㎡;户金额=标准×户租赁面积(F8 型)
    @Test
    void areaP1_std_ac15() {
        BigDecimal cost = AllocService.r2(d("31.2").multiply(d("1.11417")));   // 34.76
        BigDecimal std = AllocService.unitStd(cost, d("1734.73"));
        assertEquals(0, std.compareTo(d("0.02")));
        assertEquals(0, AllocService.r2(std.multiply(d("120"))).compareTo(d("2.40")));
    }

    // AC27(A座电梯例外走 area):4 部电梯合并用量/12487㎡=0.08 元/㎡(「未完全出租」按面积不按层)
    @Test
    void areaP1_elevator_ac27() {
        BigDecimal cost = AllocService.r2(d("900").multiply(d("1.11417")));   // 1002.75
        assertEquals(0, AllocService.unitStd(cost, d("12487")).compareTo(d("0.08")));
    }

    // V10(floor 二期先金额后除层):W=843.15,层数 5.8 → 元/层=145.37;四车间电梯 3/4 折=等效系数 6
    @Test
    void floorP2_perFloor_v10() {
        assertEquals(0, AllocService.unitStd(d("843.15"), d("5.8")).compareTo(d("145.37")));
        BigDecimal w = d("981.36");
        BigDecimal direct = AllocService.r2(w.divide(d("4.5"), 10, java.math.RoundingMode.HALF_UP)
            .divide(d("4"), 10, java.math.RoundingMode.HALF_UP).multiply(d("3")));
        assertEquals(0, AllocService.unitStd(w, d("6")).compareTo(direct));
    }

    // 二期分时金额 W=ROUND(Σ各分时用量×分时价,2);null 段=0
    @Test
    void touAmount_roundsOnce() {
        assertEquals(0, AllocService.touAmount(d("20"), d("30"), d("40"), d("10"),
            d("1.71987"), d("1.39"), d("0.85"), d("0.41")).compareTo(d("114.20")));
        assertEquals(0, AllocService.touAmount(null, null, d("100"), null,
            null, null, d("0.85"), null).compareTo(d("85.00")));
    }

    // 户损耗费=ROUND(户用电量×I×price_loss,2);二期损耗成本额=ROUND(10793.8×1.25312,2)(F14 锚)
    @Test
    void lossFee_and_p2LossCost() {
        assertEquals(0, AllocService.lossFee(d("1000"), d("0.0616"), d("1.25312")).compareTo(d("77.19")));
        assertEquals(0, AllocService.r2(d("10793.8").multiply(d("1.25312"))).compareTo(d("13525.93")));
    }

    // weight=NULL 层内按面积二拆(H55 型):ROUND(元/层合计/层面积Σ×户面积,2);面积Σ=0 → null 不硬算
    @Test
    void floorAreaSplit_h55() {
        assertEquals(0, AllocService.floorAreaSplit(d("302.5"), d("1503.1"), d("500")).compareTo(d("100.63")));
        assertNull(AllocService.floorAreaSplit(d("302.5"), BigDecimal.ZERO, d("500")));
    }

    // ══ V69 池定位与受益人(用户 2026-07-30 拍板:池名不手写/受益人按月留痕) ══

    // 池名自动生成:非空段以「·」连接;楼层+侧向合成一段;楼栋空=园区级;楼栋名内空格去掉
    @Test
    void poolName_autoFromLocation() {
        assertEquals("一期 A座·四楼西侧·走廊灯", AllocService.poolName("p1", "一期 A座", "四楼", "西侧", "走廊灯"));
        assertEquals("一期 A座·货梯", AllocService.poolName("p1", "一期 A座", null, null, "货梯"));   // 楼层空=整栋
        assertEquals("二期 一车间·四楼·消防", AllocService.poolName("p2", "二期 一车间", "四楼", "  ", "消防"));
        // 楼栋空=园区级,前缀取期别:三个「路灯」池(一/二期/宿舍)靠期别区分,统一前缀会三撞一
        assertEquals("一期园区·路灯", AllocService.poolName("p1", null, null, null, "路灯"));
        assertEquals("二期园区·路灯", AllocService.poolName("p2", null, null, null, "路灯"));
        assertEquals("宿舍区·路灯", AllocService.poolName("dorm", null, null, null, "路灯"));
        assertEquals("二期园区·消防设施", AllocService.poolName("p2", "", null, null, "消防设施"));
        assertEquals("一期园区", AllocService.poolName("p1", " ", null, null, null));                  // 保底不空名
    }

    // 楼层名→unit.floor(受益人候选过滤与分组排序用)
    @Test
    void floorNum_labels() {
        assertEquals(Integer.valueOf(4), AllocService.floorNum("四楼"));
        assertEquals(Integer.valueOf(-1), AllocService.floorNum("负一层"));
        assertEquals(Integer.valueOf(3), AllocService.floorNum("3楼"));
        assertEquals(Integer.valueOf(11), AllocService.floorNum("十一楼"));
        assertEquals(Integer.valueOf(20), AllocService.floorNum("二十层"));
        assertNull(AllocService.floorNum("天面"));      // 非楼层(货梯/天面表挂整栋)
        assertNull(AllocService.floorNum(null));
    }

    private static com.park.demo3.entity.AllocRuleMember mem(int tenantId, String month) {
        com.park.demo3.entity.AllocRuleMember m = new com.park.demo3.entity.AllocRuleMember();
        m.setTenantId(tenantId); m.setAcctMonth(month);
        return m;
    }

    private static java.util.List<Integer> ids(java.util.List<com.park.demo3.entity.AllocRuleMember> ms) {
        return ms.stream().map(com.park.demo3.entity.AllocRuleMember::getTenantId).toList();
    }

    // 受益人版本组:零月行回退常态组/当月版本组精确命中/历史月不受未来版本影响(改 2026-07 不影响 2026-06 已出账)
    @Test
    void pickMembers_monthOverridesDefault() {
        var def = java.util.List.of(mem(7, ""), mem(8, ""));
        var withMonth = java.util.List.of(mem(7, ""), mem(8, ""), mem(9, "2026-07"));
        assertEquals(java.util.List.of(7, 8), ids(AllocService.pickMembers(def, "2026-07")));
        assertEquals(java.util.List.of(9), ids(AllocService.pickMembers(withMonth, "2026-07")));
        assertEquals(java.util.List.of(7, 8), ids(AllocService.pickMembers(withMonth, "2026-06")));
        assertTrue(AllocService.pickMembers(java.util.List.of(mem(9, "2026-07")), "2026-06").isEmpty());
    }

    // S14 版本组前滚(对齐价目 tenant_price_cfg):取 acct_month≤ym 的最大版本组整组快照,''=初始版最小;
    // 03 版本组自动沿用到 04/05…直到更晚版本覆盖,重生成历史月取历史版本组
    @Test
    void pickMembers_versionGroupRollForward() {
        var rows = java.util.List.of(mem(1, ""), mem(2, ""),        // 初始版
            mem(3, "2026-03"), mem(4, "2026-03"),                   // 03 版本组
            mem(5, "2026-05"));                                     // 05 版本组
        assertEquals(java.util.List.of(1, 2), ids(AllocService.pickMembers(rows, "2026-02")));  // 历史月取历史组
        assertEquals(java.util.List.of(3, 4), ids(AllocService.pickMembers(rows, "2026-03")));  // 当月版本组精确命中
        assertEquals(java.util.List.of(3, 4), ids(AllocService.pickMembers(rows, "2026-04")));  // 跨月前滚
        assertEquals(java.util.List.of(5), ids(AllocService.pickMembers(rows, "2026-06")));     // 更晚版本覆盖
    }

    // 已分摊分摊四法(V69,池 cost/std 摊到受益人;端到端由 AllocApiIT.poolMembers_* 复核同批数字):
    // area=标准×户面积 / floor=元每层×份额(份额空→层内按面积二拆)/ direct=整额 / none 与 ref 不摊
    @Test
    void memberShare_fourMethods() {
        BigDecimal perFloor = d("302.50");
        assertEquals(0, AllocService.r2(perFloor.multiply(d("1"))).compareTo(d("302.50")));
        assertEquals(0, AllocService.r2(perFloor.multiply(d("0.5"))).compareTo(d("151.25")));
        assertEquals(0, AllocService.floorAreaSplit(perFloor, d("1503.1"), d("500")).compareTo(d("100.63")));
        assertEquals(0, AllocService.r2(d("0.02").multiply(d("120"))).compareTo(d("2.40")));
        assertEquals(0, AllocService.r2(d("100").multiply(AB)).compareTo(d("111.42")));
    }

    // ══ 刀D 受益人楼层化(METER-LOC-MEMBER-SPEC §D.2/§D.3,用真实数值喂纯函数,不起服务) ══

    private static AllocService.FloorMember fm(int tenantId, String area, String... floors) {
        return new AllocService.FloorMember(tenantId, java.util.List.of(floors),
            area == null ? null : d(area));
    }

    private static BigDecimal sum(AllocService.FloorSplit s) {
        return s.amounts().values().stream().reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    // §D.3 锚点:rule 50 一期B座天面货梯——碧沃丰/可莱恩/雷莱 分居 2/3/4 层,perFloor=302.50
    // → 三个桶各一份 → 每户 302.50,合计 907.50(=账册已分摊 AE 907.5)。
    // 刀前实现「NULL 权重合摊一份」只摊出 302.50,18 个按层池同病(2024-02 共少摊 7992.32)。
    @Test
    void floorBuckets_rule50_threeFloorsThreeShares() {
        var split = AllocService.floorBuckets(java.util.List.of(
            fm(103, "500", "四楼"), fm(107, "500", "二楼"), fm(114, "500", "三楼")), d("302.50"));
        assertEquals(0, split.amounts().get(103).compareTo(d("302.50")));
        assertEquals(0, split.amounts().get(107).compareTo(d("302.50")));
        assertEquals(0, split.amounts().get(114).compareTo(d("302.50")));
        assertEquals(0, sum(split).compareTo(d("907.50")));
        assertEquals(0, split.unknownCount());
        // §D.6 明细串按楼层升序
        assertEquals("按 3 层拆:二楼 1 户 / 三楼 1 户 / 四楼 1 户",
            AllocService.floorNote(AllocService.floorBucketsOf(java.util.List.of(
                fm(103, "500", "四楼"), fm(107, "500", "二楼"), fm(114, "500", "三楼")))));
    }

    private static com.park.demo3.entity.AllocRuleMember memW(int tenantId, String weight) {
        com.park.demo3.entity.AllocRuleMember m = mem(tenantId, "");
        m.setWeight(weight == null ? null : d(weight));
        return m;
    }

    // §D.3 锚点:rule 49/77 显式份额 perFloor=82.67,weight 0.5/0.5/1/1/1
    // → 41.34/41.34/82.67×3,合计 330.69(现值一字不变);混进桶会变成 82.67/5=16.53(与账册差 66.14)。
    // **本用例只锁两侧的算术**(显式份额金额 + 桶内按面积二拆),分支划分是测试自己 filter 出来的
    // ——§F8 复核指出这句判断抄进测试就盖不住调度:删掉 AllocService 里 `if (m.getWeight() != null) continue;`
    // 这条照样绿。真正的分支边界由 AllocApiIT.poolFloorMixedWeight_explicitShareNotBucketed
    // 走 memberAmounts 真实调度路径锁住(weight 与 null 混合的 floor 池,删那行三处断言同时变红)。
    @Test
    void floorWeight_explicitShareArithmetic() {
        BigDecimal perFloor = d("82.67");
        var mems = java.util.List.of(memW(103, "1"), memW(107, "1"), memW(114, "1"),
            memW(125, "0.5"), memW(129, "0.5"), memW(200, null), memW(201, null));
        // 显式份额户:账册口径 ROUND(perFloor×weight,2),合计 330.69
        var explicit = new java.util.LinkedHashMap<Integer, BigDecimal>();
        for (var m : mems)
            if (m.getWeight() != null) explicit.put(m.getTenantId(), AllocService.r2(perFloor.multiply(m.getWeight())));
        assertEquals(0, explicit.get(125).compareTo(d("41.34")));
        assertEquals(0, explicit.get(103).compareTo(d("82.67")));
        assertEquals(0, explicit.values().stream().reduce(BigDecimal.ZERO, BigDecimal::add).compareTo(d("330.69")));
        // weight 为空的两户才入桶:同在三楼 → 只出 1 份 perFloor,桶内按面积 300/100 拆
        var byFloor = mems.stream().filter(m -> m.getWeight() == null)
            .map(m -> fm(m.getTenantId(), m.getTenantId() == 200 ? "300" : "100", "三楼")).toList();
        var split = AllocService.floorBuckets(byFloor, perFloor);
        assertEquals(1, AllocService.floorBucketsOf(byFloor).size());
        assertEquals(java.util.Set.of(200, 201), split.amounts().keySet());   // 显式户没进分桶产出
        assertEquals(0, split.amounts().get(200).compareTo(d("62.00")));
        assertEquals(0, split.amounts().get(201).compareTo(d("20.67")));
        assertEquals(0, sum(split).add(d("330.69")).compareTo(d("413.36")));  // 池摊出=显式 + 分桶
        // 反例(删掉 weight 分支会怎样):不过滤全量入桶 → 5 个显式户落「未定层」各只分 16.53
        var noFilter = AllocService.floorBuckets(java.util.List.of(
            fm(103, null), fm(107, null), fm(114, null), fm(125, null), fm(129, null),
            fm(200, "300", "三楼"), fm(201, "100", "三楼")), perFloor);
        assertEquals(5, noFilter.unknownCount());
        assertEquals(0, noFilter.amounts().get(103).compareTo(d("16.53")));
    }

    // §D.3 第 4 个锚点 rule 22(二期 六车间·电梯+低压电房照明):11 户,perFloor=165.96,
    // 应分摊 995.74,账册分母 coefficient=6.00。成员楼层按 §D.1 两级回退用只读 SQL 逐户核过(2024-02):
    //   L1 合同单元(覆盖本月的非草稿合同 → unit.building_id=35):50/51/52=五楼、57=四楼、58=三楼、
    //     59=三楼、60 邓宇峰=一楼+二楼(unit 566「天面」floor=1 与 567「2F整层」floor=2)、67=一楼、68=四楼
    //   L2 户内表(L1 空的两户):54 罗立剑=六楼+七楼(合同 198 起止日期为空 → covers()=false,不进 L1);
    //     55 刘彪=三楼(合同单元 221 在 17 栋,非本池楼栋被滤掉)
    // → 实测 **7** 个楼层桶。spec §D.3 写的「全部可从户内表定层」只按 L2 估(那样是 5 桶=829.80),
    //   实现按 §D.1 合同单元优先,故 7 桶;差异记在提交物里。
    // → 摊出 7×165.96=1161.72,三楼桶按面积拆多出 1 分 → 1161.73,超应分摊 165.99(§E5 落 warn 不封顶)
    @Test
    void floorBuckets_rule22_sevenFloorBuckets() {
        var mems = java.util.List.of(
            fm(50, "1700.00", "五楼"), fm(51, "2060.00", "五楼"), fm(52, "1092.00", "五楼"),
            fm(54, "7377.52", "六楼", "七楼"), fm(55, "2695.00", "三楼"), fm(57, "1100.00", "四楼"),
            fm(58, "1989.08", "三楼"), fm(59, "1430.54", "三楼"), fm(60, "9785.78", "一楼", "二楼"),
            fm(67, "6800.00", "一楼"), fm(68, "6413.76", "四楼"));
        var split = AllocService.floorBuckets(mems, d("165.96"));
        assertEquals(7, AllocService.floorBucketsOf(mems).size());
        assertEquals(0, split.unknownCount());
        assertEquals(0, split.amounts().get(54).compareTo(d("331.92")));   // 六楼+七楼=两整份
        assertEquals(0, split.amounts().get(60).compareTo(d("263.88")));   // 一楼与柯建伍按面积拆 97.92 + 二楼独占 165.96
        assertEquals(0, split.amounts().get(67).compareTo(d("68.04")));
        assertEquals(0, sum(split).compareTo(d("1161.73")));
        assertEquals("按 7 层拆:一楼 2 户 / 二楼 1 户 / 三楼 3 户 / 四楼 2 户 / 五楼 3 户 / 六楼 1 户 / 七楼 1 户",
            AllocService.floorNote(AllocService.floorBucketsOf(mems)));
        // 7 桶 > 分母 6.00 → §E5 告警(spec §E5 点名的 4 个池之外,rule 22 也超)
        assertEquals("池「二期 六车间·电梯+低压电房照明」按 7 层拆但账册分母为 6 层,"
                + "摊出超应分摊 165.99 元,请核对系数或成员楼层",
            AllocService.floorCoefWarn("二期 六车间·电梯+低压电房照明",
                AllocService.floorBucketsOf(mems).size(), d("6.00"), sum(split), d("995.74")));
    }

    // 桶内 Σ面积>0 → 按面积拆(300/100 → 0.75/0.25 份);两户同层只出 1 份 perFloor
    @Test
    void floorBuckets_sameFloorSplitByArea() {
        var split = AllocService.floorBuckets(java.util.List.of(
            fm(1, "300", "三楼"), fm(2, "100", "三楼")), d("400"));
        assertEquals(0, split.amounts().get(1).compareTo(d("300.00")));
        assertEquals(0, split.amounts().get(2).compareTo(d("100.00")));
        assertEquals(0, sum(split).compareTo(d("400")));
    }

    // 桶内 Σ面积=0 → 按户数均分(旧实现返回 null 直接跳过,这户的钱静默丢掉)
    @Test
    void floorBuckets_zeroAreaSplitsEvenly() {
        var split = AllocService.floorBuckets(java.util.List.of(
            fm(1, "0", "三楼"), fm(2, null, "三楼")), d("400"));
        assertEquals(0, split.amounts().get(1).compareTo(d("200.00")));
        assertEquals(0, split.amounts().get(2).compareTo(d("200.00")));
    }

    // 全部定不出楼层 → 「未定层」桶照样算 1 份(不摊=白丢钱)并报数要人补主数据
    @Test
    void floorBuckets_unknownBucketStillOneShare() {
        var split = AllocService.floorBuckets(java.util.List.of(
            fm(1, "300"), fm(2, "100")), d("400"));
        assertEquals(2, split.unknownCount());
        assertEquals(0, sum(split).compareTo(d("400")));
        assertEquals("按 1 层拆:未定层 2 户", AllocService.floorNote(AllocService.floorBucketsOf(
            java.util.List.of(fm(1, "300"), fm(2, "100")))));
    }

    // 一户跨多层 → 进多个桶,每桶各摊一份(电梯/楼梯间按层收,跨层户本就多用);「未定层」桶永远垫底
    @Test
    void floorBuckets_multiFloorTenantTakesMultipleShares() {
        var split = AllocService.floorBuckets(java.util.List.of(
            fm(1, "500", "二楼", "三楼"), fm(2, "500", "二楼"), fm(3, "500")), d("100"));
        assertEquals(0, split.amounts().get(1).compareTo(d("150.00")));   // 二楼半份 + 三楼整份
        assertEquals(0, split.amounts().get(2).compareTo(d("50.00")));
        assertEquals(0, split.amounts().get(3).compareTo(d("100.00")));   // 未定层独一份
        assertEquals("按 3 层拆:二楼 2 户 / 三楼 1 户 / 未定层 1 户",
            AllocService.floorNote(AllocService.floorBucketsOf(java.util.List.of(
                fm(1, "500", "二楼", "三楼"), fm(2, "500", "二楼"), fm(3, "500")))));
    }

    // 刀二:电梯池首层桶不参与分摊(纸约:力灏/罗立剑合同「首层租户不承担电梯维保费和维修费」;
    // 源册先例:B座货梯 3 份=2/3/4F 各 1,首层不摊)。力灏锚点:一楼+二楼+三楼 → 二楼+三楼 两份
    // 217.33×2=434.66(册值);首层独户=整桶剔除无金额;未定层桶照旧;旧签名默认不剔(消防/楼层公共照旧)。
    @Test
    void floorBuckets_skipFirstFloor_elevatorAnchor() {
        var mems = java.util.List.of(
            fm(48, "3000", "一楼", "二楼", "三楼"),   // 力灏:跨三层,首层份被剔
            fm(61, "500", "四楼"),
            fm(67, "800", "一楼"),                    // 首层独户 → 整桶剔除,无金额(不落行)
            fm(99, "100", "1F"),                      // 词汇兼容:1F 也是首层
            fm(3, "100"));                            // 未定层照旧一份
        var split = AllocService.floorBuckets(mems, d("217.33"), true);
        assertEquals(0, split.amounts().get(48).compareTo(d("434.66")));
        assertEquals(0, split.amounts().get(61).compareTo(d("217.33")));
        assertNull(split.amounts().get(67));
        assertNull(split.amounts().get(99));
        assertEquals(0, split.amounts().get(3).compareTo(d("217.33")));
        assertEquals(1, split.unknownCount());
        // 旧签名(=不剔):首层照摊——既有池与既有锚点不受影响(一楼桶 3000/800 按面积拆)
        var old = AllocService.floorBuckets(mems, d("217.33"));
        assertEquals(0, old.amounts().get(67).compareTo(d("45.75")));    // 217.33×800/3800
        assertEquals(0, old.amounts().get(99).compareTo(d("217.33")));   // 「1F」自成键独占一桶(归一在上游)
        // 读侧桶明细同口径:首层桶不再出现
        assertEquals("按 3 层拆:二楼 1 户 / 三楼 1 户 / 四楼 1 户",
            AllocService.floorNote(AllocService.floorBucketsOf(java.util.List.of(
                fm(48, "3000", "一楼", "二楼", "三楼"), fm(61, "500", "四楼"), fm(67, "800", "一楼")), true)));
    }

    // 分桶键归一:unit.floor=4 与户内表「4楼」「四楼」必须落同一个桶,否则同一层摊出两份
    @Test
    void floorLabel_normalizedToOneBucket() {
        assertEquals("四楼", AllocService.floorLabelOf(4));
        assertEquals("负一层", AllocService.floorLabelOf(-1));
        assertEquals("十楼", AllocService.floorLabelOf(10));
        assertEquals("十一楼", AllocService.floorLabelOf(11));
        assertEquals("四楼", AllocService.normFloor("4楼"));
        assertEquals("四楼", AllocService.normFloor("四楼"));
        assertEquals("天面", AllocService.normFloor("天面"));   // 非数字层保留原文
        // 归一由 memberFloor 在入桶前做(桶键即中文标准名):「4楼」「四楼」同桶,「天面」自成一桶
        assertEquals(2, AllocService.floorBucketsOf(java.util.List.of(
            fm(1, "1", AllocService.normFloor("4楼")), fm(2, "1", AllocService.normFloor("四楼")),
            fm(3, "1", AllocService.normFloor("天面")))).size());
    }

    // §D.1 两级回退:合同单元优先(取全部楼层),空了才看该户在本栋的户内表,再空=未定层
    @Test
    void memberFloor_twoLevelFallback() {
        var u2 = unit(20); u2.setFloor(2);
        var u3 = unit(20); u3.setFloor(3);
        var uOther = unit(21); uOther.setFloor(9);      // 别的楼栋不算数
        var byTenant = java.util.Map.of(100, java.util.List.of(u2, u3, uOther));
        var m4 = meter(114, 20, "tenant", "三楼");
        var mOther = meter(114, 21, "tenant", "九楼");
        var mShare = meter(115, 20, "share", "五楼");   // 公摊表不是户内表
        var metersByTenant = java.util.Map.of(114, java.util.List.of(m4, mOther), 115, java.util.List.of(mShare));
        // 一级:合同单元跨两层 → 两层都占
        assertEquals(java.util.List.of("二楼", "三楼"),
            AllocService.memberFloor(100, 20, byTenant, metersByTenant));
        // 二级:无合同单元 → 该户在本栋的户内表楼层
        assertEquals(java.util.List.of("三楼"),
            AllocService.memberFloor(114, 20, java.util.Map.of(), metersByTenant));
        // 三级:两处都无 → 空(=未定层桶)
        assertTrue(AllocService.memberFloor(115, 20, java.util.Map.of(), metersByTenant).isEmpty());
        assertTrue(AllocService.memberFloor(999, 20, byTenant, metersByTenant).isEmpty());
    }

    // ══ 刀E §E4/§E5 两条分摊告警(纯函数,不起服务) ══

    // §E4 真实脏数据:邓宇峰在宿舍四栋 合同单元=一楼+二楼,户内表却报二楼+四楼 →
    // 两源都非空且不相等 = 冲突,点名到户落 warn;**入桶的仍是合同单元**(优先级不反转)。
    @Test
    void floorConflict_warnsButKeepsUnitPriority() {
        var u1 = unit(29); u1.setFloor(1);
        var u2 = unit(29); u2.setFloor(2);
        var byTenant = java.util.Map.of(60, java.util.List.of(u1, u2));
        var metersByTenant = java.util.Map.of(60,
            java.util.List.of(meter(60, 29, "tenant", "二楼"), meter(60, 29, "tenant", "4楼")));
        var fs = AllocService.memberFloorSources(60, 29, byTenant, metersByTenant);
        assertEquals(java.util.List.of("一楼", "二楼"), fs.unit());
        assertEquals(java.util.List.of("二楼", "四楼"), fs.meter());
        assertEquals(java.util.List.of("一楼", "二楼"), fs.chosen());   // 已按合同单元计
        assertTrue(fs.conflict());
        assertEquals("池「一期 宿舍四栋·电梯」租户「邓宇峰」楼层两源不一致:合同单元=一楼+二楼、户内表=二楼+四楼,"
                + "已按合同单元计;请核对主数据",
            AllocService.floorConflictWarn("一期 宿舍四栋·电梯", "邓宇峰", fs));
    }

    // §E4 反向:两源说的是同一组楼层(写法不同,归一后同层)/ 只有一源有话说(那是回退不是冲突) → 不落 warn
    @Test
    void floorConflict_noWarnWhenAligned() {
        var u = unit(30); u.setFloor(4);
        var byTenant = java.util.Map.of(8, java.util.List.of(u));
        var byMeter = java.util.Map.of(8, java.util.List.of(meter(8, 30, "tenant", "4楼")));
        var same = AllocService.memberFloorSources(8, 30, byTenant, byMeter);
        assertFalse(same.conflict());
        assertNull(AllocService.floorConflictWarn("二期 一车间·消防", "铂超贸易", same));
        assertNull(AllocService.floorConflictWarn("二期 一车间·消防", "铂超贸易",
            AllocService.memberFloorSources(8, 30, byTenant, java.util.Map.of())));       // 只有合同单元
        assertNull(AllocService.floorConflictWarn("二期 一车间·消防", "铂超贸易",
            AllocService.memberFloorSources(8, 30, java.util.Map.of(), byMeter)));        // 只有户内表
    }

    // §E5 锚点 rule 3(二期一车间·电梯+低压电房照明):账册分母 5.80 层,实际 9 层各有人 →
    // 摊出 9×145.37=1308.33,超应分摊 843.14 共 465.19(与 rule 11 的 573.20 合计 1038.39
    // =spec §E5「合计超收约 1,038 元」)。**只告警不封顶**。
    @Test
    void floorCoef_warnsWhenBucketsExceedDenominator() {
        var mems = new java.util.ArrayList<AllocService.FloorMember>();
        String[] floors = {"一楼", "二楼", "三楼", "四楼", "五楼", "六楼", "七楼", "八楼", "九楼"};
        for (int i = 0; i < floors.length; i++) mems.add(fm(i + 1, "500", floors[i]));
        var split = AllocService.floorBuckets(mems, d("145.37"));
        assertEquals(9, AllocService.floorBucketsOf(mems).size());
        assertEquals(0, sum(split).compareTo(d("1308.33")));
        assertEquals("池「二期 一车间·电梯+低压电房照明」按 9 层拆但账册分母为 5.8 层,"
                + "摊出超应分摊 465.19 元,请核对系数或成员楼层",
            AllocService.floorCoefWarn("二期 一车间·电梯+低压电房照明",
                AllocService.floorBucketsOf(mems).size(), d("5.80"), sum(split), d("843.14")));
    }

    // §E5 反向:rule 50(B座天面货梯)3 桶 vs 分母 3.00 → 不超,不落 warn。
    // 它的超收 907.50 vs 应分摊 718.08 来自账册加度 170 度造的盈余(与 AE 907.5 吻合),不是桶数问题,
    // 封顶会打死这个已验证锚点 —— 这条用例把「不误报、不封顶」一起锁住。
    @Test
    void floorCoef_noWarnForRule50Surplus() {
        var mems = java.util.List.of(fm(103, "500", "四楼"), fm(107, "500", "二楼"), fm(114, "500", "三楼"));
        var split = AllocService.floorBuckets(mems, d("302.50"));
        assertEquals(0, sum(split).compareTo(d("907.50")));
        assertTrue(sum(split).compareTo(d("718.08")) > 0);   // 确实超收,但超收源于加度不是桶数
        assertNull(AllocService.floorCoefWarn("一期 B座·天面·货梯",
            AllocService.floorBucketsOf(mems).size(), d("3.00"), sum(split), d("718.08")));
    }

    private static com.park.demo3.entity.Meter meter(int tenantId, int buildingId, String ownership, String floorLabel) {
        var m = new com.park.demo3.entity.Meter();
        m.setTenantId(tenantId); m.setBuildingId(buildingId);
        m.setOwnership(ownership); m.setFloorLabel(floorLabel);
        return m;
    }

    // ── 园区级池受益人 fallback(用户 2026-07-30 拍板:园区级池受益人=全园在租自动带出) ──
    private static com.park.demo3.entity.AllocRule rule(Integer buildingId, String method) {
        var r = new com.park.demo3.entity.AllocRule();
        r.setBuildingId(buildingId); r.setMethod(method); r.setZone("p1");
        return r;
    }

    // 判定口径:园区级(building 空)+ 无显式受益人 + 能摊到户的 area/floor 才自动;显式勾了就以显式为准
    @Test
    void autoMembers_onlyParkLevelAreaFloorWithoutExplicit() {
        assertTrue(AllocService.autoMembers(rule(null, "area"), true));
        assertTrue(AllocService.autoMembers(rule(null, "floor"), true));
        assertFalse(AllocService.autoMembers(rule(null, "area"), false));    // 显式受益人优先
        assertFalse(AllocService.autoMembers(rule(13, "area"), true));       // 楼栋级不回退
        for (String m : new String[]{"direct", "none", "ref", "loss"})
            assertFalse(AllocService.autoMembers(rule(null, m), true));      // 整笔归户/不摊/纯标准行/损耗链
    }

    // 名册按期别切分:楼栋期别取该栋表的 zone(宿舍楼 phase=1 但 zone=dorm,用 phase 会把宿舍并进一期);
    // 多场地户同时入两期名册;无表楼栋(空地/三期)取不到期别 → 不入任何名册
    @Test
    void inForceByZone_splitsByBuildingZone() {
        var zoneOfBuilding = java.util.Map.of(13, "p1", 30, "p2", 26, "dorm");
        var c1 = contract(1, 100, 13, null);          // 一期 A座
        var c2 = contract(2, 200, 30, null);          // 二期 一车间
        var c3 = contract(3, 100, 30, null);          // 同一户第二场地 → 两期名册都在
        var c4 = contract(4, 300, 26, null);          // 宿舍楼(phase=1 但 zone=dorm)
        var c5 = contract(5, 400, 14, null);          // 一期 空地:无表 → 无期别
        var c6 = contract(6, 500, null, null);        // 只挂单元不挂栋 → 由单元的栋定期别
        var byZone = AllocService.inForceByZone(java.util.List.of(c1, c2, c3, c4, c5, c6),
            java.util.Map.of(6, java.util.List.of(unit(30))), zoneOfBuilding);
        assertEquals(java.util.List.of(100), byZone.get("p1"));
        assertEquals(java.util.List.of(200, 100, 500), byZone.get("p2"));
        assertEquals(java.util.List.of(300), byZone.get("dorm"));
        assertFalse(byZone.getOrDefault("p1", java.util.List.of()).contains(400));
    }

    // 自动名册面积按期别切:多场地户(厂房+宿舍两份合同)各期只算本期那份;
    // 同合同挂到外区的附加单元不把面积带过去;无期别楼栋(无表)的合同面积不入任何期别
    @Test
    void areaByZoneTenant_scopesAreaToOwnBuildingZone() {
        var zoneOfBuilding = java.util.Map.of(35, "p2", 26, "dorm");   // 14 号栋无表 → 取不到期别
        var factory = contract(1, 100, 35, null); factory.setRentArea(new BigDecimal("4892.89"));   // 二期六车间
        var dorm = contract(2, 100, 26, null);    dorm.setRentArea(new BigDecimal("72.94"));        // 宿舍一栋
        var mixed = contract(3, 200, 35, null);   mixed.setRentArea(new BigDecimal("3206.88"));     // 厂房合同挂了宿舍房间
        var land = contract(4, 300, 14, null);    land.setRentArea(new BigDecimal("500.00"));       // 空地(无表→无期别)
        var byUnit = contract(5, 400, null, null); byUnit.setRentArea(new BigDecimal("100.00"));    // 只挂单元
        // 计费行面积映射传空 → 全部走 rent_area 回退(S5 §1 回退分支即旧口径,期别切分断言不变)
        var area = AllocService.areaByZoneTenant(java.util.List.of(factory, dorm, mixed, land, byUnit),
            java.util.Map.of(3, java.util.List.of(unit(26)), 5, java.util.List.of(unit(35))), zoneOfBuilding,
            java.util.Map.of(), java.util.Map.of(), new java.util.HashSet<>());
        assertEquals(new BigDecimal("4892.89"), area.get("p2").get(100));
        assertEquals(new BigDecimal("72.94"), area.get("dorm").get(100));    // 厂房面积不进宿舍池
        assertNull(area.get("dorm").get(200));                               // 附加单元不带面积过区
        assertEquals(new BigDecimal("3206.88"), area.get("p2").get(200));
        assertEquals(2, area.size());                                        // 无期别楼栋的合同不入任何期别(300 户不出现)
        assertEquals(new BigDecimal("100.00"), area.get("p2").get(400));
    }

    // S15 §4 面积污染根修:宿舍计费行(property_type='dorm' 或 fee_key='rent_dorm')面积拆入 dorm zone,
    // 非宿舍行照旧按合同主楼栋 zone。锚点:双成 p1 路灯基数 448.01→416(32.01㎡ 宿舍行出 p1)、
    // 邓宇峰 p2 路灯基数 4892.89→4644.10(248.79㎡ 宿舍行出 p2)。
    @Test
    void areaByZoneTenant_dormRowsSplitToDormZone() {
        var zoneOfBuilding = java.util.Map.of(35, "p2", 26, "dorm");
        var mixed = contract(1, 100, 35, null);        // 邓宇峰型:厂房主楼栋 + 宿舍行
        var pureDorm = contract(2, 200, 26, null);     // 纯宿舍:主楼栋=宿舍楼
        pureDorm.setRentArea(new BigDecimal("999"));   // 有 dorm 租金行就不许回退 rent_area(回退=双计)
        var pureFactory = contract(3, 300, 35, null);  // 纯厂房:行为不变
        var tang = contract(4, 400, 26, null);         // 汤周杰型:主楼栋=宿舍楼但含厂房行
        var fallbackSet = new java.util.HashSet<Integer>();
        var area = AllocService.areaByZoneTenant(java.util.List.of(mixed, pureDorm, pureFactory, tang),
            java.util.Map.of(), zoneOfBuilding,
            java.util.Map.of(1, new BigDecimal("4644.10"), 3, new BigDecimal("500.00"), 4, new BigDecimal("300.00")),
            java.util.Map.of(1, new BigDecimal("248.79"), 2, new BigDecimal("72.94")),
            fallbackSet);
        assertEquals(new BigDecimal("4644.10"), area.get("p2").get(100));   // 邓宇峰 p2 基数 4892.89→4644.10
        assertEquals(new BigDecimal("248.79"), area.get("dorm").get(100));  // 宿舍行面积落 dorm zone
        assertEquals(new BigDecimal("72.94"), area.get("dorm").get(200));   // 纯宿舍不变(仍在 dorm zone)
        assertNull(area.get("p2").get(200));
        assertTrue(fallbackSet.isEmpty(), "纯宿舍合同不得回退 rent_area:" + fallbackSet);
        assertEquals(new BigDecimal("500.00"), area.get("p2").get(300));    // 纯厂房不变
        // 汤周杰型边界:厂房行仍按主楼栋 zone(=dorm)——主楼栋挂错是数据错,由 SQL 刀改对主楼栋,
        // 引擎不做 location 猜测
        assertEquals(new BigDecimal("300.00"), area.get("dorm").get(400));
    }

    private static com.park.demo3.entity.Contract contract(int id, int tenantId, Integer buildingId, Integer unitId) {
        var c = new com.park.demo3.entity.Contract();
        c.setId(id); c.setTenantId(tenantId); c.setBuildingId(buildingId); c.setUnitId(unitId);
        return c;
    }

    private static com.park.demo3.entity.Unit unit(int buildingId) {
        var u = new com.park.demo3.entity.Unit();
        u.setBuildingId(buildingId);
        return u;
    }

    // ── 在租三态(2026-07-30 修「判断不了→写成已退租」)──
    private static final java.time.LocalDate F = java.time.LocalDate.parse("2024-02-01");
    private static final java.time.LocalDate L = java.time.LocalDate.parse("2024-02-29");

    private static com.park.demo3.entity.Contract dated(String start, String end) {
        var c = new com.park.demo3.entity.Contract();
        c.setStatus("active");
        c.setStartDate(start == null ? null : java.time.LocalDate.parse(start));
        c.setEndDate(end == null ? null : java.time.LocalDate.parse(end));
        return c;
    }

    @Test
    void inForceState_threeWay() {
        // 日期齐全且覆盖 → yes
        assertEquals("yes", AllocService.inForceState(
            java.util.List.of(dated("2023-03-20", "2031-03-19")), F, L));
        // 日期齐全但不覆盖 → no
        assertEquals("no", AllocService.inForceState(
            java.util.List.of(dated("2024-03-01", "2025-02-28")), F, L));
        assertEquals("no", AllocService.inForceState(
            java.util.List.of(dated("2022-01-01", "2023-12-31")), F, L));
        // 双 NULL(汤周杰 S10-0016 型)→ unknown,不是退租
        assertEquals("unknown", AllocService.inForceState(java.util.List.of(dated(null, null)), F, L));
        // 一端 NULL 同样判不了 → unknown
        assertEquals("unknown", AllocService.inForceState(java.util.List.of(dated("2023-01-01", null)), F, L));
        assertEquals("unknown", AllocService.inForceState(java.util.List.of(dated(null, "2031-01-01")), F, L));
        // 多合同取最优:yes > unknown > no
        assertEquals("yes", AllocService.inForceState(
            java.util.List.of(dated(null, null), dated("2023-03-20", "2031-03-19")), F, L));
        assertEquals("unknown", AllocService.inForceState(
            java.util.List.of(dated("2022-01-01", "2023-12-31"), dated(null, null)), F, L));
        // 无非草稿合同 → no(不是 unknown:空集不该当成判不了)
        assertEquals("no", AllocService.inForceState(java.util.List.of(), F, L));
        // 草稿不算在租(covers 已挡)
        var draft = dated("2023-03-20", "2031-03-19");
        draft.setStatus("draft");
        assertEquals("no", AllocService.inForceState(java.util.List.of(draft), F, L));
    }

    // 守卫:系数/基数空或0 → null(配置不全不硬算)
    @Test
    void guards() {
        assertNull(AllocService.unitStd(d("100"), null));
        assertNull(AllocService.unitStd(d("100"), BigDecimal.ZERO));
        assertNull(AllocService.tenantLossRate("net", d("-1"), null, null, null, BigDecimal.ZERO));
        assertNull(AllocService.stdAmountOverBase(d("100"), null, 2, null, null));
        assertNull(AllocService.stdQtyPriceOverBase(d("100"), null, BigDecimal.ZERO, AB, 2, null, null));
        assertNull(AllocService.stdQtyOverBase(d("100"), null, 3, null, null));
    }

    // ── V77 §G3 电表标签位置段:缺了要说出来,不能静默少一截 ──
    private static com.park.demo3.entity.Meter lm(String area, String spot, String floorLabel, String side) {
        var m = new com.park.demo3.entity.Meter();
        m.setArea(area); m.setSpot(spot); m.setFloorLabel(floorLabel); m.setSide(side);
        m.setTenantName("已停用"); m.setSubName("电表①");
        return m;
    }

    @Test
    void meterLabel_locSegment() {
        // 有区域、位置与楼层皆空(meter 219 优凯A305电 的真实形态)→ 补占位段
        assertEquals("招商中心·(位置未录)·已停用·电表①", AllocService.meterLabel(lm("招商中心", null, null, null)));
        assertEquals("招商中心·(位置未录)·已停用·电表①", AllocService.meterLabel(lm("招商中心", "  ", "", null)));
        // 区域也空(园区级/跨栋表)→ 不适用,不补
        assertEquals("已停用·电表①", AllocService.meterLabel(lm(null, null, null, null)));
        // spot 有值但解析不出楼层 → 用 spot 原文,不补占位
        assertEquals("园区·招商中心门口 1·已停用·电表①", AllocService.meterLabel(lm("园区", "招商中心门口 1", null, null)));
        // spot 空但人工补了楼层/方位 → 用结构化段拼出「四楼西侧」
        assertEquals("一期 A座·四楼西侧·已停用·电表①", AllocService.meterLabel(lm("一期 A座", null, "四楼", "西侧")));
        assertEquals("一期 A座·四楼·已停用·电表①", AllocService.meterLabel(lm("一期 A座", null, "四楼", null)));
        // spot 优先于结构化段(原文保留=导入身份键)
        assertEquals("一期 A座·三楼东侧·已停用·电表①", AllocService.meterLabel(lm("一期 A座", "三楼东侧", "四楼", "西侧")));
    }

    // ── S13 §7 二期车间池 Σ层份 vs 账册系数T 守卫:差>0.01 才警;欠配文案注明「空置园区自担」──
    @Test
    void weightCoefWarn_thresholdAndWording() {
        assertNull(AllocService.weightCoefWarn("二期 二车间·消防", d("6.99"), d("7")), "差=0.01 视为闭合");
        assertNull(AllocService.weightCoefWarn("二期 二车间·消防", d("4.38"), null), "无系数不警");
        String under = AllocService.weightCoefWarn("二期 二车间·消防", d("4.38"), d("7"));   // 源册欠配 -2.62
        assertNotNull(under);
        assertTrue(under.contains("空置园区自担"), under);
        String over = AllocService.weightCoefWarn("二期 一车间·电梯", d("5.84"), d("5.8"));  // 超配 0.04
        assertNotNull(over);
        assertTrue(over.contains("超配"), over);
    }

    // ── S13 §8 表标签占位:ownership∈{share,park,ops,infra} 豁免「(位置未录)」显 '–';租户表保留提示 ──
    @Test
    void meterLabel_poolOwnershipDashNotTodo() {
        var m = lm("招商中心", null, null, null);
        m.setOwnership("share");
        assertEquals("招商中心·–·已停用·电表①", AllocService.meterLabel(m));
        m.setOwnership("park");
        assertEquals("招商中心·–·已停用·电表①", AllocService.meterLabel(m));
        m.setOwnership("infra");
        assertEquals("招商中心·–·已停用·电表①", AllocService.meterLabel(m));
        m.setOwnership("tenant");
        assertEquals("招商中心·(位置未录)·已停用·电表①", AllocService.meterLabel(m));
    }

    // ── §H4.2e 无表行(method=manual,原册 r12 联塑精铟 / r47–49 C座一楼西侧三户)──
    // computePool 对 manual 池早退返回这个常量:十二格全空。
    // qty/cost/std 为 NULL → 屏上合计(只加非空的 costAmount)自然不含它;
    // warn 为 NULL → 不报「缺读数」(这四行本就没有表可抄,报缺抄是假警报)。
    @Test
    void manualPool_allNullNoWarn() {
        AllocService.PoolCalc p = AllocService.MANUAL_POOL;
        assertNull(p.qtyTotal()); assertNull(p.sharp()); assertNull(p.peak());
        assertNull(p.flat()); assertNull(p.valley()); assertNull(p.extra());
        assertNull(p.cost(), "manual 池不出应分摊,否则会进合计");
        assertNull(p.base()); assertNull(p.std()); assertNull(p.foldAdd()); assertNull(p.price());
        assertNull(p.warn(), "manual 池不许报缺读数");
    }

    // ── V82 §H4.2a 一期定位归一:规则的位置是原册 C 列一格,meter 仍是两格 ──
    // 归一后 rule.floor_label='四楼西侧'/side=NULL,而 meter 是 floor_label='四楼'+side='西侧'。
    // 不剥方位,一期池的表候选会整片落空 —— 这里锁住剥法与「无方位不乱剥」两侧。
    @Test
    void sideOf_splitsMergedFloorLabel() {
        assertEquals("西侧", AllocService.sideOf("四楼西侧"));
        assertEquals("东侧", AllocService.sideOf("一楼东侧"));
        // 原册 26 行「天面」全部不带方位(东西之分在 D 列电表名称),不许剥出方位来
        assertNull(AllocService.sideOf("天面"));
        assertNull(AllocService.sideOf("二楼"));
        assertNull(AllocService.sideOf("负一层"));
        assertNull(AllocService.sideOf(null));
        assertNull(AllocService.sideOf("西侧"), "只有方位没有楼层 → 不当合成标签处理");
    }

    @Test
    void atLocation_mergedP1LabelStillMatchesTwoFieldMeter() {
        var west = lm("一期 A座", null, "四楼", "西侧");
        var east = lm("一期 A座", null, "四楼", "东侧");
        var roof = lm("一期 C座", null, "天面", null);
        west.setBuildingId(13); east.setBuildingId(13); roof.setBuildingId(21);
        // 一期归一后的一格写法
        assertTrue(AllocService.atLocation(west, 13, "四楼西侧", null));
        assertFalse(AllocService.atLocation(east, 13, "四楼西侧", null));
        // 二期照旧两格传参,行为不变
        assertTrue(AllocService.atLocation(west, 13, "四楼", "西侧"));
        assertFalse(AllocService.atLocation(east, 13, "四楼", "西侧"));
        // 天面池不再带 side:26 块天面表(side 全 NULL)这才能被选到 —— 旧的「天面+东侧」一块都选不出
        assertTrue(AllocService.atLocation(roof, 21, "天面", null));
        assertFalse(AllocService.atLocation(roof, 21, "天面", "东侧"));
        // 楼栋不符 → 直接否;楼栋 null=不限(园区级池)
        assertFalse(AllocService.atLocation(west, 21, "四楼西侧", null));
        assertTrue(AllocService.atLocation(west, null, null, null));
    }

    private static com.park.demo3.entity.Building building(int id, String zone) {
        var b = new com.park.demo3.entity.Building(); b.setId(id); b.setZone(zone); return b;
    }

    private static com.park.demo3.entity.Meter meterOn(int buildingId, String zone) {
        var m = new com.park.demo3.entity.Meter();
        m.setBuildingId(buildingId); m.setZone(zone); m.setKind("elec"); return m;
    }

    // building.zone 是唯一事实来源;列为 NULL 才回退「该栋首块表的 zone」。
    // 三期 0 块表 —— 靠列才有期区,这正是本次改动的目的。
    @Test
    void zoneOfBuilding_columnWinsOverMeterFallback() {
        var bs = java.util.List.of(building(30, "p2"), building(40, null), building(50, "p3"));
        var ms = java.util.List.of(meterOn(30, "dorm"), meterOn(40, "p1"));
        var z = AllocService.zoneOfBuilding(bs, ms);
        assertEquals("p2", z.get(30));    // 读列优先:30 号栋挂着 dorm 表也不许翻案
        assertEquals("p1", z.get(40));    // 列 NULL → 回退首块表
        assertEquals("p3", z.get(50));    // 无表,靠列才有期区
    }

    // 二期二车间实测挂着 p2:20 / p1:1 / dorm:1 三种表。回填后列是 p2,
    // 读列就不再依赖遍历顺序 —— 这是顺手修掉的那个不确定性。
    @Test
    void zoneOfBuilding_mixedMeterBuildingIsDeterministic() {
        var bs = java.util.List.of(building(31, "p2"));
        var ms = java.util.List.of(meterOn(31, "dorm"), meterOn(31, "p1"), meterOn(31, "p2"));
        assertEquals("p2", AllocService.zoneOfBuilding(bs, ms).get(31));
        // 表顺序反过来,结果必须一样
        var ms2 = java.util.List.of(meterOn(31, "p2"), meterOn(31, "p1"), meterOn(31, "dorm"));
        assertEquals("p2", AllocService.zoneOfBuilding(bs, ms2).get(31));
    }

    // 口径按参数取,不按期区名字。p1→0(flat) / p2→1(tou) 是回填值;p3 由用户配。
    // 取不到 = 该期区还没配 → 必须返回 null,让 ruleCostAmount return null,
    // 而不是默认成 flat 静默算出一个数来(那正是「算错了还不报错」)。
    @Test
    void calcKind_resolvesFromParamNotZoneName() {
        var flat = java.util.Map.of("p1|zone_calc_kind", new java.math.BigDecimal("0"));
        var tou  = java.util.Map.of("p2|zone_calc_kind", new java.math.BigDecimal("1"));
        var p3tou = java.util.Map.of("p3|zone_calc_kind", new java.math.BigDecimal("1"));
        assertEquals(AllocService.KIND_FLAT, AllocService.calcKind("p1", flat));
        assertEquals(AllocService.KIND_TOU,  AllocService.calcKind("p2", tou));
        assertEquals(AllocService.KIND_TOU,  AllocService.calcKind("p3", p3tou));
        assertNull(AllocService.calcKind("p3", java.util.Map.of()));   // 没配 → null,不猜
        assertNull(AllocService.calcKind("dorm", flat));               // 别的期区的配置不串味
    }
}
