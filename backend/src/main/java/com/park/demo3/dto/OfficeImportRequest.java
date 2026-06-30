package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 办公水电导入(附表13/14)。scheduleNo 走 path(OfficeController 校验);body 仅 rows,跨年全由行驱动。
// 行自带 acctMonth(必填 YYYY-MM)+belongMonth(选填,缺省=acct);前端 parseYearMonth 解析后填。电费/水费/合计派生不导。
public record OfficeImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String acctMonth,    // YYYY-MM 记账月(必填)
        String belongMonth,  // YYYY-MM 所属月(选填,缺省=acctMonth)
        BigDecimal elecQty,
        BigDecimal elecPrice,
        BigDecimal waterQty,
        BigDecimal waterPrice
    ) {}
}
