package com.park.demo3.dto;
public record CpStationDTO(
    Integer id,
    String name,
    String operator,          // 运营商(自由文本)
    String vehicleType,       // car / ebike
    Integer sortNo
) {}
