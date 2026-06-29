package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;
public record PvRecordReq(
    @NotBlank String phase,
    @NotBlank String acctMonth,
    @NotBlank String occurMonth,
    BigDecimal selfKwh,
    BigDecimal selfAmt,
    BigDecimal gridKwh,
    BigDecimal gridAmt,
    String note
) {}
