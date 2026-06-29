package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record ChargingYearDTO(
    int year,
    List<ChargingCatDTO>    cats,
    List<ChargingRecordDTO> rows,
    ChargingTotal total
) {
    public record ChargingTotal(
        BigDecimal kwh,
        BigDecimal fee,
        BigDecimal cost,
        BigDecimal profit
    ) {}
}
