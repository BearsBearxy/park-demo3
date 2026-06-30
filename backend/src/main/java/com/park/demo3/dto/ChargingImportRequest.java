package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 充电桩导入(附表7/8)。scheduleNo 走 path(ChargingController 校验);body 仅 rows。
// 每行自带 cat(运营商 cat_id)+acctMonth(必填 YYYY-MM)+kwh/fee/cost;fee 已由前端按附表算好
// (电动车 no=8 直取充电收入;汽车 no=7 = 充电收入−手续费)。聚合/年/范围行前端跳过不入此 rows。
public record ChargingImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String cat,          // charging_cat 白名单内 cat_id(否则后端跳过)
        String acctMonth,    // YYYY-MM 记账月(必填)
        BigDecimal kwh,
        BigDecimal fee,      // 已扣手续费的口径
        BigDecimal cost,
        String note
    ) {}
}
