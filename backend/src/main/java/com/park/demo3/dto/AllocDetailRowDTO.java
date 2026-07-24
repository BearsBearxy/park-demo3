package com.park.demo3.dto;
import java.math.BigDecimal;
// 抽屉逐费项明细(表级明细不落库,现算):stale=现算金额≠快照(读数已变,可重新生成)
public record AllocDetailRowDTO(
    String feeKey, Integer ruleId, String ruleName,
    BigDecimal qty, BigDecimal amount, BigDecimal rateSnap, BigDecimal priceSnap,
    String source, String note,
    BigDecimal liveAmount,        // 现算金额(loss/manual 行=null 不比对)
    boolean stale
) {}
