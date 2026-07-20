package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 电费成本导入(长表:电表|费项|拆分|月份|金额|电量|备注)。meter/fee/split 收中文名(费项名↔fee_key 映射
// 在 ElecCostService 为单一事实源,同时兼容直传 key);(表,月,费项,拆分) upsert 幂等;行级错误跳过不整批拦。
public record ElecCostImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String meter,        // 电表名
        String fee,          // 费项(中文名或 fee_key)
        String split,        // 拆分(中文名或 sub_key,可空=合计行)
        String month,        // YYYY-MM
        BigDecimal amount,   // 金额 元
        BigDecimal qty,      // 电量 kWh(可空)
        String note
    ) {}
}
