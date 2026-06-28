package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record LedgerOverviewDTO(
    String  companyName,
    int     year,
    int     monthsWithData,
    BigDecimal ytdRecv,
    BigDecimal avgRecv,
    int     activeTenants,
    List<MonthMeta> months
) {
    public record MonthMeta(
        int month,
        BigDecimal recv,
        BigDecimal coll,
        int     tenants,
        String  status   // done | current | empty
    ) {}
}
