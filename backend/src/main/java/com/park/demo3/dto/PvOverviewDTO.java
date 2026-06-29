package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record PvOverviewDTO(
    int currentYear,
    List<YearMeta> years
) {
    public record YearMeta(
        int year,
        boolean hasData,
        BigDecimal totalFee,
        int count
    ) {}
}
