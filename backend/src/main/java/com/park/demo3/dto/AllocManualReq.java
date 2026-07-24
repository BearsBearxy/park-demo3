package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
// 手工行(孵化协议固定收取等):同键既有行被覆盖为 manual;生成时保留不覆盖
public record AllocManualReq(
    @NotNull Integer tenantId,
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym,
    @NotBlank String feeKey,
    BigDecimal qty,
    @NotNull BigDecimal amount,
    String note
) {}
