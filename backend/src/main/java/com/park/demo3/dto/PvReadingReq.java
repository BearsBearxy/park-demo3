package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
// 抄表记录新增/编辑共用。三量 ≥0 硬校验;自消纳+上网>发电总量 只前端黄警示不阻断(抄表现实有损耗差)。
// PUT 时 stationId 不生效(站不可改),price_snap 保持原快照。
public record PvReadingReq(
    @NotNull Integer stationId,
    @NotBlank @Pattern(regexp = "\\d{4}-\\d{2}-\\d{2}", message = "格式应为 YYYY-MM-DD") String readDate,
    @DecimalMin(value = "0", message = "不能为负") BigDecimal genTotal,
    @DecimalMin(value = "0", message = "不能为负") BigDecimal selfUse,
    @DecimalMin(value = "0", message = "不能为负") BigDecimal gridFeed,
    String note
) {}
