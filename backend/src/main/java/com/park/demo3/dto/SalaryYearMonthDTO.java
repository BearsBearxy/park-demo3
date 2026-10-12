/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record SalaryYearMonthDTO(
    int year,
    int month,
    List<SalaryRecordDTO> rows,
    Total total
) {
    public record Total(
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
        BigDecimal wageTotal,
        BigDecimal gross,
        BigDecimal social,
        BigDecimal tax,
        BigDecimal otherDeduct,
        BigDecimal deduct,
        BigDecimal net
    ) {}
}
