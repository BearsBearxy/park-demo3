package com.park.demo3.dto;
import java.math.BigDecimal;
public record CpReadingDTO(
    Integer id,
    Integer stationId,
    String stationName,
    String readDate,          // YYYY-MM-DD
    BigDecimal chargeKwh,     // 充电量 kWh
    BigDecimal fee,           // 手续费 元
    BigDecimal revenue,       // 收益 元(全手填,非派生)
    String note,
    String source             // manual / import
) {}
