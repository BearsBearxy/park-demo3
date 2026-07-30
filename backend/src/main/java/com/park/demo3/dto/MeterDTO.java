package com.park.demo3.dto;
import java.math.BigDecimal;
public record MeterDTO(
    Integer id, String kind, String zone, String name,
    String area, String spot, String tenantName,
    Integer tenantId, Integer buildingId, String ownership,   // v2 结构化档案(§6.1)
    String meterType,
    String deviceType, Integer contractId,   // S2:表类型+人工绑定覆盖(S2-BIND-SPEC;contractId 只经 /bind 写)
    String subName, String code, BigDecimal factor,
    String retiredYm,   // V68:自该账期起停用(含当月不计);NULL=在用
    Integer sortNo,
    long readingCount   // 读数条数(档案列表列 + 删除守卫提示)
) {}
