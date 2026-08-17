package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// 损耗率表一行(读时派生,§2.4):headQty=总表量C,subQty=分表ΣD,lossQty=E=D−C(负=有损耗),
// rawRate=E/C,shareQty=G,adjQty/adjRate=人工项(alloc_cfg),tenantRate=收取租户损耗率I。
// S21:formulaRate=三式公式率;manualRate=手工率(非空即覆盖 tenantRate);denomQty=率分母(C 或 C+铝缆);
// gParts=G 分解(一期园区公摊池 池名+当月净量,Σ÷park_share_div=G;二期 null)。
public record AllocLossRowDTO(
    String zone, Integer buildingId, String buildingName,
    BigDecimal headQty, BigDecimal subQty, BigDecimal lossQty, BigDecimal rawRate,
    BigDecimal shareQty, BigDecimal adjQty, BigDecimal adjRate, BigDecimal tenantRate,
    BigDecimal formulaRate, BigDecimal manualRate, BigDecimal denomQty, List<GPart> gParts
) {
    public record GPart(String name, BigDecimal qty) {}
}
