package com.park.demo3.dto;
import jakarta.validation.constraints.*;
// 电表新增/编辑共用。kind 改动在服务层守卫(有费项数据不可改类,防费项值域失配)。
public record ElecMeterReq(
    @NotBlank String name,
    @NotBlank @Pattern(regexp = "master|dorm|ops", message = "应为 master/dorm/ops") String kind
) {}
