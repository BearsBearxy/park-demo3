package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 充电桩明细导入。行自带 station(桩名精确匹配)+readDate(YYYY-MM-DD,前端已把 Excel 日期序列转好);
// (桩,日)幂等 upsert;未知桩名/非法日期/负金额=行级错误跳过,不整批拦截。运营商列仅前端校验参考,不上传。
public record CpMeterImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String station,      // 桩名
        String readDate,     // YYYY-MM-DD
        BigDecimal chargeKwh,
        BigDecimal fee,
        BigDecimal revenue,
        String note
    ) {}
}
