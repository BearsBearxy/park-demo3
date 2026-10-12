/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record PvYearDTO(
    int year,
    List<PvPhaseDTO>  phases,
    List<PvRecordDTO> rows,
    PvTotal total
) {
    public record PvTotal(
        BigDecimal gen,
        BigDecimal fee,
        BigDecimal selfKwh,
        BigDecimal selfAmt,
        BigDecimal gridKwh,
        BigDecimal gridAmt
    ) {}
}
