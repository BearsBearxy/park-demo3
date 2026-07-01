package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// L2 月历:各月 hasData + 预览(本月营业收入 row1 cur,公式归前端)
public record ReportYearDTO(int year, List<MonthMeta> months) {
    public record MonthMeta(int month, boolean hasData, BigDecimal netPreview) {}
}
