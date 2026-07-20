package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 光伏抄表导入。行自带 station(楼栋名精确匹配)+readDate(YYYY-MM-DD,前端已把 Excel 日期序列转好);
// (站,日)幂等 upsert;未知站名/非法日期/负电量=行级错误跳过,不整批拦截。期数列仅前端校验参考,不上传。
public record PvMeterImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String station,      // 电站名(楼栋)
        String readDate,     // YYYY-MM-DD
        BigDecimal genTotal,
        BigDecimal selfUse,
        BigDecimal gridFeed,
        String note
    ) {}
}
