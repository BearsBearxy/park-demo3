package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
// 电站新增/编辑共用(名称/期数/容量/单价;容量单价可空后补)
public record PvStationReq(
    @NotBlank String name,
    @NotNull @Min(1) @Max(3) Integer phase,
    @DecimalMin(value = "0", message = "不能为负") BigDecimal capacityKwp,
    @DecimalMin(value = "0", message = "不能为负") BigDecimal priceYuan
) {}
