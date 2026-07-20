package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
// 电表用电量 upsert:uk(运营商,类型,月)。属月度业务数据,浏览态 admin 即可录入/修改(EDIT-MODE-SPEC)。
public record CpPowerUsageReq(
    @NotBlank String operator,
    @NotBlank @Pattern(regexp = "car|ebike", message = "类型应为 car/ebike") String vehicleType,
    @NotNull @Min(2000) @Max(2100) Integer year,
    @NotNull @Min(1) @Max(12) Integer month,
    @NotNull @DecimalMin(value = "0", message = "不能为负") BigDecimal meterKwh,
    String note
) {}
