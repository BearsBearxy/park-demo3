package com.park.demo3.dto;

import java.math.BigDecimal;

/**
 * 外部天气日聚合(PV-ANALYSIS-SPEC §03.3)。
 * 剔日的判据是 hourMask 的**连续性**,不是 hours 的个数 —— 真实天气源常常只给白天那几个小时,
 * 而且日照长度按季节变,「有几个小时」分不清「当天日照短」和「漏了几行」。
 */
public record WeatherDayDTO(
    String date,          // YYYY-MM-DD
    BigDecimal ghiKwh,    // 日累计 kWh/m2
    BigDecimal rainMm,
    BigDecimal tMax,
    BigDecimal tMin,
    boolean isRain,
    int hours,            // 当日有几个小时的数据
    int hourMask          // 24 位:第 h 位 = 该整点有记录。前端靠它判连续性(见 Mapper 注释)
) {}
