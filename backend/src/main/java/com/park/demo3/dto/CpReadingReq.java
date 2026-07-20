package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
// 充电记录新增/编辑共用。三金额(充电量/手续费/收益) ≥0 硬校验,全手填(从平台对账单抄,无自动换算)。
// PUT 时 stationId 不生效(桩不可改)。
public record CpReadingReq(
    @NotNull Integer stationId,
    @NotBlank @Pattern(regexp = "\\d{4}-\\d{2}-\\d{2}", message = "格式应为 YYYY-MM-DD") String readDate,
    @DecimalMin(value = "0", message = "不能为负") BigDecimal chargeKwh,
    @DecimalMin(value = "0", message = "不能为负") BigDecimal fee,
    @DecimalMin(value = "0", message = "不能为负") BigDecimal revenue,
    String note
) {}
