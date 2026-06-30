package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.util.List;
// 工资导入(附表12)。year/month 走 query param(SalaryController 校验范围);body 仅 rows。
// 行身份=姓名(tenantName);应发/实发/全勤派生不导。字段顺序对齐 SalaryRecord set 口径。
public record SalaryImportRequest(@NotNull List<Row> rows) {
    public record Row(
        String tenantName,   // 姓名
        String role,
        BigDecimal base,
        BigDecimal post,
        BigDecimal perf,
        BigDecimal attend,
        BigDecimal skill,
        BigDecimal edu,
        BigDecimal other,
        BigDecimal lunch,
        BigDecimal heat,
        BigDecimal commission,
        BigDecimal shouldDays,   // 真实「应出勤（天）」;导入四舍五入取整(实体为 int)
        BigDecimal leaveDays,    // 真实「请假（天）」含小数(2.125/0.5);导入四舍五入取整
        BigDecimal social,
        BigDecimal tax,
        BigDecimal otherDeduct
    ) {}
}
