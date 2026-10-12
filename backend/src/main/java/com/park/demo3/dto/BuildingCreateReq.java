/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
public record BuildingCreateReq(
    @NotBlank @Size(max = 64) String name,
    @NotNull @Min(1) @Max(9) Integer phase,
    @NotNull @Min(1) @Max(99) Integer floorCount,
    @NotNull @DecimalMin("0") BigDecimal totalArea,
    @NotNull @DecimalMin("0") BigDecimal rentableArea,
    @Min(0) Integer perFloor,
    String remark,
    @Pattern(regexp = "p\\d+|dorm") String zone) {}
