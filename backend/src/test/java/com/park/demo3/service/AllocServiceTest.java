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
        // A座 net:C=38550,E=-3673.5,G=86.8+g_adj(-1500)=-1413.2 → I=-ROUND((E-G)/C,4)+0.003=0.0616
        assertEquals(0, AllocService.tenantLossRate("net", d("-3673.5"), d("-1413.2"), null, d("0.003"), d("38550"))
            .compareTo(d("0.0616")));
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

    // 受益人月行优先回退默认行(同 alloc_cfg):改 2026-07 不影响 2026-06 已出账
    @Test
    void pickMembers_monthOverridesDefault() {
        var def = java.util.List.of(mem(7, ""), mem(8, ""));
        var withMonth = java.util.List.of(mem(7, ""), mem(8, ""), mem(9, "2026-07"));
        assertEquals(java.util.List.of(7, 8), ids(AllocService.pickMembers(def, "2026-07")));
        assertEquals(java.util.List.of(9), ids(AllocService.pickMembers(withMonth, "2026-07")));
        assertEquals(java.util.List.of(7, 8), ids(AllocService.pickMembers(withMonth, "2026-06")));
        assertTrue(AllocService.pickMembers(java.util.List.of(mem(9, "2026-07")), "2026-06").isEmpty());
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
        var area = AllocService.areaByZoneTenant(java.util.List.of(factory, dorm, mixed, land, byUnit),
            java.util.Map.of(3, java.util.List.of(unit(26)), 5, java.util.List.of(unit(35))), zoneOfBuilding);
        assertEquals(new BigDecimal("4892.89"), area.get("p2").get(100));
        assertEquals(new BigDecimal("72.94"), area.get("dorm").get(100));    // 厂房面积不进宿舍池
        assertNull(area.get("dorm").get(200));                               // 附加单元不带面积过区
        assertEquals(new BigDecimal("3206.88"), area.get("p2").get(200));
        assertEquals(2, area.size());                                        // 无期别楼栋的合同不入任何期别(300 户不出现)
        assertEquals(new BigDecimal("100.00"), area.get("p2").get(400));
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
}
