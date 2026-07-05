package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
public record UnitUpdateReq(
    @NotNull @Min(1) @Max(99) Integer floor,
    @NotBlank @Size(max = 16) String unitNo,
    @NotNull @DecimalMin("0") BigDecimal area) {}
