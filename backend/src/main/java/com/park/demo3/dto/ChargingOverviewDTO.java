package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record ChargingOverviewDTO(
    int currentYear,
    List<YearMeta> years
) {
    public record YearMeta(
        int year,
        boolean hasData,
        BigDecimal totalProfit,   // 全年利润 = Σ(fee - cost)
        int count
    ) {}
}
