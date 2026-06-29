package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
public record OfficeRecordReq(
    @NotNull Integer scheduleNo,
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])", message = "格式应为 YYYY-MM") String acctMonth,
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])", message = "格式应为 YYYY-MM") String belongMonth,
    BigDecimal elecQty,
    BigDecimal elecPrice,
    BigDecimal waterQty,
    BigDecimal waterPrice,
    String note
) {}
