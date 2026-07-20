package com.park.demo3.dto;
import jakarta.validation.constraints.*;
// 充电桩新增/编辑共用(名称/运营商/类型;新增默认当前屏类型由前端带上)
public record CpStationReq(
    @NotBlank String name,
    @NotBlank String operator,
    @NotBlank @Pattern(regexp = "car|ebike", message = "类型应为 car/ebike") String vehicleType
) {}
