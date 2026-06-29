package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
public record ElecRecordReq(
    @NotBlank String type,        // energy / basic
    @NotBlank String phase,
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])", message = "格式应为 YYYY-MM") String acctMonth,
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
