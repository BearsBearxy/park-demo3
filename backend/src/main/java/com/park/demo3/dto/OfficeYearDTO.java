package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
public record OfficeYearDTO(
    int year,
    int scheduleNo,
    List<OfficeRecordDTO> rows,
    OfficeTotal total
) {
    public record OfficeTotal(
        BigDecimal elecQty,
        BigDecimal elecAmt,
        BigDecimal waterQty,
        BigDecimal waterAmt,
        BigDecimal total
    ) {}
}
