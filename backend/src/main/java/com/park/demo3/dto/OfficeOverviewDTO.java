package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record OfficeOverviewDTO(
    int currentYear,
    List<YearMeta> years
) {
    public record YearMeta(
        int year,
        boolean hasData,
        BigDecimal totalFee,   // 全年水电费合计 = 该年 13+14 两子表 Σ(电费金额+水费金额)
        int count              // 该年 13+14 两子表行数合计
    ) {}
}
