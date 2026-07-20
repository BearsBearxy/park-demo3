package com.park.demo3.dto;
import java.math.BigDecimal;
public record PvReadingDTO(
    Integer id,
    Integer stationId,
    String stationName,
    String readDate,          // YYYY-MM-DD
    BigDecimal genTotal,
    BigDecimal selfUse,
    BigDecimal gridFeed,
    BigDecimal priceSnap,     // 单价快照(可空=录入时站未配价)
    BigDecimal revenue,       // 派生:selfUse × priceSnap(快照价,不随站价漂移;无快照按 0)
    String note,
    String source             // manual / import
) {}
