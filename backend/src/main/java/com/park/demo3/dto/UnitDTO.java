package com.park.demo3.dto;
import java.math.BigDecimal;

public record UnitDTO(
    Integer id,
    Integer floor,
    String  unitNo,
    BigDecimal area,
    String  status,       // "occupied" | "expiring" | "reserved" | "vacant"
    Integer tenantId,
    String  tenantName,
    String  companyName,
    String  businessType,
    String  contractNo,
    BigDecimal monthlyRent
) {}
