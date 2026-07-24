package com.park.demo3.dto;
import java.math.BigDecimal;
// 损耗率表一行(读时派生,§2.4):headQty=总表量C,subQty=分表ΣD,lossQty=E=D−C(负=有损耗),
// rawRate=E/C,shareQty=G,adjQty/adjRate=人工项(alloc_cfg),tenantRate=收取租户损耗率I
public record AllocLossRowDTO(
    String zone, Integer buildingId, String buildingName,
    BigDecimal headQty, BigDecimal subQty, BigDecimal lossQty, BigDecimal rawRate,
    BigDecimal shareQty, BigDecimal adjQty, BigDecimal adjRate, BigDecimal tenantRate
) {}
