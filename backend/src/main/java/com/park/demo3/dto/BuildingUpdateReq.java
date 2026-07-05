package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
// 编辑专用:比 CreateReq 多 status、去 perFloor(单元只在创建时生成,编辑绝不增删改 units)
public record BuildingUpdateReq(
    @NotBlank @Size(max = 64) String name,
    @NotNull @Min(1) @Max(9) Integer phase,
    @NotNull @Min(1) @Max(99) Integer floorCount,
    @NotNull @DecimalMin("0") BigDecimal totalArea,
    @NotNull @DecimalMin("0") BigDecimal rentableArea,
    @NotNull @Min(0) @Max(1) Integer status,
    String remark) {}
