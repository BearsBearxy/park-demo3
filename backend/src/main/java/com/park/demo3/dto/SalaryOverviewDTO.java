package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record SalaryOverviewDTO(
    int currentYear,
    List<YearMeta> years
) {
    public record YearMeta(
        int year,
        boolean hasData,
        int count,               // 人次
        BigDecimal netTotal,     // 全年实发合计
        List<Integer> months     // 该年有数据的月份(给月份胶囊),升序
    ) {}
}
