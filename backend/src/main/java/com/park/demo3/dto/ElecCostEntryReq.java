package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
// 费项月度值 upsert:键=(meterId, acctMonth, feeKey, subKey空串归一化),命中则改、无则插,source 统一置 manual。
public record ElecCostEntryReq(
    @NotNull Integer meterId,
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])", message = "格式应为 YYYY-MM") String acctMonth,
    @NotBlank String feeKey,
    String subKey,
    @NotNull @DecimalMin(value = "0", message = "不能为负") BigDecimal amount,
    @DecimalMin(value = "0", message = "不能为负") BigDecimal qty,
    String note
) {}
