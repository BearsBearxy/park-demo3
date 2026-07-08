package com.park.demo3.dto;
import java.math.BigDecimal;
// budget/actual 可只有其一(NULL=该年无此值);字段名=前后端契约(spec 预算对比)
public record BudgetRowDTO(
    int year,
    String label,
    boolean sub,
    BigDecimal budget,
    BigDecimal actual,
    String note,
    int sortOrder
) {}
