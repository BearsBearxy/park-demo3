package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;
public record ElecRecordReq(
    @NotBlank String type,        // energy / basic
    @NotBlank String phase,
    @NotBlank String acctMonth,
    String invDate,
    String period,      // 仅 energy
    String cat,         // 仅 energy
    String unit,        // 仅 energy
    BigDecimal qty,     // 仅 energy
    BigDecimal demand,  // 仅 basic
    BigDecimal price,
    BigDecimal rate,
    String note
) {}
