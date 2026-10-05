package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.math.BigDecimal;
public record PvPhaseDTO(
    String id,
    String name,
    @JsonProperty("short") String shortName,
    String online,
    // 一次性工程成本(元)。2026-10-04 用户拍板产品卖给别的园区:光伏投资回收的投资额默认取各期合计,
    // 不再在前端写死我园的 1478.7 万
    BigDecimal cost
) {}
