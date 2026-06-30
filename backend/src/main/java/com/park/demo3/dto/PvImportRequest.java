package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 光伏导入(附表6)。body 仅 rows;每行自带 phaseId(p1/p2/p3)+acctMonth(必填 YYYY-MM)+occurMonth(选填,缺省=acct)。
// 前端 importPvSections 按段切期、parseYearMonth 解析后填。发电总量/总额派生不导。
public record PvImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String phaseId,      // p1 / p2 / p3
        String acctMonth,    // YYYY-MM 记账月(必填)
        String occurMonth,   // YYYY-MM 发生月(选填,缺省=acctMonth)
        BigDecimal selfKwh,
        BigDecimal selfAmt,
        BigDecimal gridKwh,
        BigDecimal gridAmt,
        String note
    ) {}
}
