package com.park.demo3.dto;
import java.math.BigDecimal;
public record S10RecordDTO(
    Long    id,
    Integer tenantId,      // 可空软引用
    String  tenantName,
    int     phase,
    String  profile,
    String  note,          // 可空
    String  source,
    // ── 25 费用列(顺序即列展示顺序) ──
    BigDecimal officeRent,
    BigDecimal officeMgmtFee,
    BigDecimal factoryRent,
    BigDecimal factoryMgmtFee,
    BigDecimal landRent,
    BigDecimal shopRent,
    BigDecimal shopMgmtFee,
    BigDecimal dormRent,
    BigDecimal dormFacilityFee,
    BigDecimal infraOffice,
    BigDecimal infraFactory,
    BigDecimal infraShop,
    BigDecimal infraDorm,
    BigDecimal elevatorMaint,
    BigDecimal transformerMaint,
    BigDecimal landUseTax,
    BigDecimal networkFee,
    BigDecimal accessMaint,
    BigDecimal otherFee,
    BigDecimal elecBasic,
    BigDecimal elecStd,
    BigDecimal elecMaint,
    BigDecimal waterStd,
    BigDecimal waterMaint,
    BigDecimal guaranteeRent,
    BigDecimal total,      // 派生 = 25 列 + 自定义列之和
    java.util.Map<String, BigDecimal> extraFees   // 自定义列(键=列固定id,方案A)
) {}
