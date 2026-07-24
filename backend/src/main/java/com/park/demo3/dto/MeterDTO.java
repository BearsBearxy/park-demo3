package com.park.demo3.dto;
import java.math.BigDecimal;
public record MeterDTO(
    Integer id, String kind, String zone, String name,
    String area, String spot, String tenantName,
    Integer tenantId, Integer buildingId, String ownership,   // v2 结构化档案(§6.1)
    String meterType,
    String subName, String code, BigDecimal factor, Integer sortNo,
    long readingCount   // 读数条数(档案列表列 + 删除守卫提示)
) {}
