package com.park.demo3.dto;
public record S10YearDTO(
    int year,
    int recordedMonths,    // 该年有数据的去重月数
    int tenantCount        // 该年去重租户数
) {}
