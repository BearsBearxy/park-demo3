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
