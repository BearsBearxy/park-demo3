package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record ElecOverviewDTO(
    int currentYear,
    List<YearMeta> years
) {
    public record YearMeta(
        int year,
        boolean hasData,
        BigDecimal totalFee,   // 全年价税合计(energy+basic 合)
        int count
    ) {}
}
