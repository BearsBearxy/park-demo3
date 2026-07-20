package com.park.demo3.dto;
import java.math.BigDecimal;
/** 账单工资条明细行 = 附表10 应收口径逐行平铺。25 费用列名与 S10Record 完全一致(前端按 layout leaves 取列)。 */
public record BillS10RowDTO(
    Integer tenantId,      // 软引用真实租户(可空);前端成员匹配 tenantId 优先、tenantName 兜底
    String  tenantName,
    Integer phase,
    // 25 费用列(顺序同 S10Record 实体)
    BigDecimal officeRent, BigDecimal officeMgmtFee,
    BigDecimal factoryRent, BigDecimal factoryMgmtFee,
    BigDecimal landRent,
    BigDecimal shopRent, BigDecimal shopMgmtFee,
    BigDecimal dormRent, BigDecimal dormFacilityFee,
    BigDecimal infraOffice, BigDecimal infraFactory,
    BigDecimal infraShop, BigDecimal infraDorm,
    BigDecimal elevatorMaint, BigDecimal transformerMaint,
    BigDecimal landUseTax, BigDecimal networkFee,
    BigDecimal accessMaint, BigDecimal otherFee,
    BigDecimal elecBasic, BigDecimal elecStd, BigDecimal elecMaint,
    BigDecimal waterStd, BigDecimal waterMaint,
    BigDecimal guaranteeRent
) {}
