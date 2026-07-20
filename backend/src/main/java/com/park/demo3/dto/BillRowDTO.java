package com.park.demo3.dto;
import java.math.BigDecimal;
/** 账单行 = 台账行 × 租户(parent) × 公司。派生列复用 LedgerService.recalc,与台账口径同源。 */
public record BillRowDTO(
    Integer companyId,
    String  companyName,
    Integer tenantId,
    String  tenantName,
    Integer parentId,      // 家族聚合:族键=parentName??自身名(前端 familySort 口径)
    String  parentName,
    BigDecimal balancePrev,
    // 21 费用列(顺序同台账 §3.1)
    BigDecimal factoryRent, BigDecimal factoryMgmtFee,
    BigDecimal shopRent, BigDecimal dormRent,
    BigDecimal dormFacilitiesFee, BigDecimal shopMgmtFee,
    BigDecimal factoryInfraMaint, BigDecimal shopInfraMaint,
    BigDecimal dormInfraMaint,
    BigDecimal elevatorMaint, BigDecimal transformerMaint,
    BigDecimal landUseTax, BigDecimal networkFee,
    BigDecimal accessCtrlMaint, BigDecimal officeOtherFee,
    BigDecimal dormOtherFee,
    BigDecimal basicElectricity, BigDecimal standardElectricity,
    BigDecimal electricityMaint,
    BigDecimal standardWater, BigDecimal waterMaint,
    BigDecimal totalCollected,
    BigDecimal totalReceivable,   // 派生
    BigDecimal balanceEnd         // 派生
) {}
