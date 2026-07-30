package com.park.demo3.dto;
import java.math.BigDecimal;
// GET /api/meters/usage-summary 行:户×月×kind 聚合(S3 输入面,S2-BIND-SPEC §3)。
// usage* = 各表派生用量求和(漏抄表跳过不硬算,全漏=null);missingReadings=该户该类漏抄表数。
public record MeterUsageSummaryDTO(
    Integer tenantId, String tenantName, String kind,
    int meterCount, int missingReadings,
    BigDecimal usageTotal, BigDecimal usageSharp, BigDecimal usagePeak,
    BigDecimal usageFlat, BigDecimal usageValley
) {}
