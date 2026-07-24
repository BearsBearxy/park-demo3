package com.park.demo3.dto;
import java.math.BigDecimal;
// 计费行读 DTO(BILL-FORWARD 刀1 §1.7);按 location, seq 排序带出。
public record BillingLineDTO(
    Integer id, Integer contractId,
    String propertyType,                    // 段类型 factory|office|dorm|shop|land(V54)
    String location,
    String feeKey, String feeName,          // feeName=LABEL[propertyType][feeKey] 上下文回显(§7.2)
    BigDecimal area, BigDecimal unitPrice, BigDecimal coeff,
    Integer roomCount, String billMode,
    BigDecimal amountOverride, Integer seq, String source  // import|manual
) {}
