package com.park.demo3.dto;
import java.math.BigDecimal;
public record PvStationDTO(
    Integer id,
    String name,
    Integer phase,            // 1/2/3
    BigDecimal capacityKwp,   // 装机容量 kWp(可空)
    BigDecimal priceYuan,     // 消纳综合单价 元/kWh(可空)
    Integer sortNo
) {}
