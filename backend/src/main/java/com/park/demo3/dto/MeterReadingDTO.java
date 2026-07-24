package com.park.demo3.dto;
import java.math.BigDecimal;
// usage* = (curr−prev)×factor_snap 派生(缺读数=null);漏抄/倒走/时段不符徽标由前端 meterLogic 按本 DTO 派生
public record MeterReadingDTO(
    Integer id, Integer meterId, String ym,
    BigDecimal prevTotal, BigDecimal currTotal,
    BigDecimal prevSharp, BigDecimal prevPeak, BigDecimal prevFlat, BigDecimal prevValley,
    BigDecimal currSharp, BigDecimal currPeak, BigDecimal currFlat, BigDecimal currValley,
    BigDecimal factorSnap,
    BigDecimal usageTotal, BigDecimal usageSharp, BigDecimal usagePeak, BigDecimal usageFlat, BigDecimal usageValley,
    String note, String source
) {}
