package com.park.demo3.dto;
import java.math.BigDecimal;
public record MeterDTO(
    Integer id, String kind, String zone, String name,
    String area, String spot, String tenantName,
    String floorLabel, String side, String roomNo,   // V74 位置结构化(楼层/方位/房号)
    Integer locManual,   // V76 §F6:位置三列 0=自动(导入按 spot 重解析)/1=人工设定(导入不动,只落 warn)
    Integer tenantId, Integer buildingId, String ownership,   // v2 结构化档案(§6.1)
    String buildingZone,   // 所在楼栋的期区(NULL=没挂楼栋)。与上面的 zone 不同就是表自己说的期区
                           // 和它实际所在的楼对不上 —— 只下发测量值,屏上自己比(不在后端下定论)
    Integer ownerManual,   // V77 §G2:归属两列 0=自动(导入回写)/1=人工设定(导入不动,只落 warn)
    String meterType,
    String deviceType, Integer contractId,   // S2:表类型+人工绑定覆盖(S2-BIND-SPEC;contractId 只经 /bind 写)
    String subName, String code, BigDecimal factor,
    String suspect,     // V75 §F1:shadow=疑似重复建档(红徽标+不进分表Σ)/incomplete=档案不全(黄徽标,照常入Σ)/NULL=正常
    Integer sortNo,
    long readingCount,  // 读数条数(档案列表列 + 删除守卫提示)
    // ── METER-TIMELINE-SPEC(V129 起):上面的归属/位置列都是「站在 ym 看」的那一段(assignAt),
    //    旧的 activeFromYm / retiredYm / removedYm 三列已删,由下面的状态段取代。
    //    until = 本段最后一个月(含);null = 链尾,一直到以后。
    String status,      // active 在用 / retired 停用(在册不计)/ removed 已拆 / null = 该月不在册
    String statusFrom, String statusUntil,
    String assignFrom, String assignUntil,
    String assignSrc,   // import / manual / migrate / contract
    boolean changedThisMonth,   // 该表在 ym 有自己的归属行或状态行,且与上一行不同(canonical 判据,MeterTimeline.diff)
    Integer tenantManual,  // 租户人工设定标记(只锁这一段,SPEC §3.2 G2)
    // SPEC §10.3 本月册子已核:站在 ym,这块表在 ym 导入的册子里出现过没有;file/at = 该表该月最近一笔。
    // ym 缺省(站在最新看)恒 false / null。
    boolean bookSeen, String bookFile, java.time.LocalDateTime bookAt
) {}
