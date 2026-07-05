package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
public record UnitCreateReq(
    @NotNull @Min(1) @Max(99) Integer floor,
    @Size(max = 16) String unitNo,
    @DecimalMin("0") BigDecimal area) {}
