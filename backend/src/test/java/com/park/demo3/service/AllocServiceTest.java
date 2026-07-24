package com.park.demo3.service;

import org.junit.jupiter.api.Test;
import java.math.BigDecimal;

import static org.junit.jupiter.api.Assertions.*;

// 公摊分摊计算纯函数(PB-ALLOCATION-SPEC §2)。锁 §2.6 锚点(2024-02 口径):
// AC43=302.50 元/层 / AC15=0.02 元/㎡ / AC27=0.08 元/㎡ / V10=145.37 元/层 / H48=302.5 /
// 一期 I4=6.16% / 二期组共率 J5=2.55% / 二期损耗成本额=ROUND(10793.8×1.25312,2)。
// Excel 原始用量不在库内:锚点用可逆构造输入复现输出(公式锁定,非数据回放)。
class AllocServiceTest {

    private static BigDecimal d(String s) { return new BigDecimal(s); }

    // AC43(floor 一期):元/层=ROUND((S43+S44+170)/3×1.11417,2)=302.50;全额先算后除层与 Excel 同锚
    @Test
    void floorP1_perFloor_ac43() {
        // 规则用量 644.5 + 人工加度 170 → 全额=ROUND(814.5×1.11417,2)=907.49
        BigDecimal cost = AllocService.r2(d("644.5").add(d("170")).multiply(d("1.11417")));
        assertEquals(0, cost.compareTo(d("907.49")));
        assertEquals(0, AllocService.unitStd(cost, d("3")).compareTo(d("302.50")));
        // H48:每户一份 weight=1 → 302.5;F63 对半 weight=0.5 → 151.25
        assertEquals(0, AllocService.r2(AllocService.unitStd(cost, d("3")).multiply(BigDecimal.ONE)).compareTo(d("302.50")));
        assertEquals(0, AllocService.r2(AllocService.unitStd(cost, d("3")).multiply(d("0.5"))).compareTo(d("151.25")));
    }

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
        // W/4.5/4×3 = W/6(等效系数复现,不建折扣字段)
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

    // 一期 I4=6.16%:I=−ROUND((E−G−adjQty)/C,4)+adjRate(E=−,G=86.8,A座人工减 1500 收编 loss_adj_qty)
    @Test
    void tenantLossRate_p1_i4() {
        BigDecimal i = AllocService.tenantLossRate(d("-3673.5"), d("86.8"), d("-1500"), d("0.003"), d("38572"));
        assertEquals(0, i.compareTo(d("0.0616")));
    }

    // 分表>总表特例(一期 B座 E=+80.67):只计公共电份额 I=ROUND(G/C,4)+adjRate
    @Test
    void tenantLossRate_subExceedsHead() {
        BigDecimal i = AllocService.tenantLossRate(d("80.67"), d("86.8"), null, d("0.003"), d("4000"));
        assertEquals(0, i.compareTo(d("0.0247")));   // 0.0217+0.003
    }

    // 二期组共率 J5=2.55%(二/三/四车间共用三车间总表):G=0,adjQty=Σ(300−2500+1000)=−1200,adjRate=0.002
    @Test
    void tenantLossRate_p2_group_j5() {
        BigDecimal i = AllocService.tenantLossRate(d("-10793.8"), BigDecimal.ZERO, d("-1200"), d("0.002"), d("408247"));
        assertEquals(0, i.compareTo(d("0.0255")));
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

    // unitStd 守卫:系数空/0 → null(规则配置不全不硬算)
    @Test
    void unitStd_guards() {
        assertNull(AllocService.unitStd(d("100"), null));
        assertNull(AllocService.unitStd(d("100"), BigDecimal.ZERO));
        assertNull(AllocService.tenantLossRate(d("-1"), null, null, null, BigDecimal.ZERO));
    }
}
