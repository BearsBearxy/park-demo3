package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
public record OfficeRecordReq(
    @NotNull Integer scheduleNo,
    @NotBlank String acctMonth,
    @NotBlank String belongMonth,
    BigDecimal elecQty,
    BigDecimal elecPrice,
    BigDecimal waterQty,
    BigDecimal waterPrice,
    String note
) {}
