/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
public record UnitCreateReq(
    @NotNull @Min(1) @Max(99) Integer floor,
    @Size(max = 16) String unitNo,
    @DecimalMin("0") BigDecimal area) {}
