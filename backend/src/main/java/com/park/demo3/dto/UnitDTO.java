package com.park.demo3.dto;
import java.math.BigDecimal;

public record UnitDTO(
    Integer id,
    Integer floor,
    String  unitNo,
    BigDecimal area,
    BigDecimal derivedArea,   // S15 合同派生面积:绑定行Σ(÷绑定单元数),无绑定回退非宿舍行面积均摊(unit.area 全库为 0)
    String  status,       // "occupied" | "expiring" | "reserved" | "vacant"
    Integer tenantId,
    String  tenantName,
    String  companyName,
    String  businessType,
    String  contractNo,
    BigDecimal monthlyRent
) {}
