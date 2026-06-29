package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
public record ChargingRecordReq(
    @NotNull Integer scheduleNo,
    @NotBlank String cat,
    @NotBlank String acctMonth,
    BigDecimal kwh,
    BigDecimal fee,
    BigDecimal cost,
    String note
) {}
