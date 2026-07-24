package com.park.demo3.dto;
import java.math.BigDecimal;
import java.time.LocalDateTime;
// 分摊结果行(租户×月×费项,快照语义);tenantName/buildingName 读时联出供列表直用
public record AllocResultDTO(
    Integer id, Integer tenantId, String tenantName, Integer buildingId, String buildingName,
    String ym, String feeKey, Integer ruleId,
    BigDecimal qty, BigDecimal amount, BigDecimal rateSnap, BigDecimal priceSnap,
    String source, String note, LocalDateTime generatedAt
) {}
