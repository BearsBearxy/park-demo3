package com.park.demo3.dto;
import java.math.BigDecimal;
public record MeterDTO(
    Integer id, String kind, String zone, String name,
    String area, String spot, String tenantName,
    String floorLabel, String side, String roomNo,   // V74 位置结构化(楼层/方位/房号)
    Integer locManual,   // V76 §F6:位置三列 0=自动(导入按 spot 重解析)/1=人工设定(导入不动,只落 warn)
    Integer tenantId, Integer buildingId, String ownership,   // v2 结构化档案(§6.1)
    Integer ownerManual,   // V77 §G2:归属两列 0=自动(导入回写)/1=人工设定(导入不动,只落 warn)
    String meterType,
    String deviceType, Integer contractId,   // S2:表类型+人工绑定覆盖(S2-BIND-SPEC;contractId 只经 /bind 写)
    String subName, String code, BigDecimal factor,
    String retiredYm,   // V68:自该账期起停用(含当月不计);NULL=在用
    String activeFromYm,   // V87:启用账期,该月前不在服务中(导入自愈可放宽);NULL=一直在册
    String suspect,     // V75 §F1:shadow=疑似重复建档(红徽标+不进分表Σ)/incomplete=档案不全(黄徽标,照常入Σ)/NULL=正常
    Integer sortNo,
    long readingCount   // 读数条数(档案列表列 + 删除守卫提示)
) {}
