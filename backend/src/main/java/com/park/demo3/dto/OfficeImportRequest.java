package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 办公水电导入(附表13/14)。scheduleNo/year 走 path/query(OfficeController 校验);body 仅 rows。
// 行身份=月份字符串(tenantName,如 "1月"/"01"/"2025-01"),Service 解析取月号。电费/水费/合计派生不导。
public record OfficeImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String tenantName,   // 月份字符串
        BigDecimal elecQty,
        BigDecimal elecPrice,
        BigDecimal waterQty,
        BigDecimal waterPrice
    ) {}
}
