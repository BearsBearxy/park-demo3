package com.park.demo3.dto;
import java.math.BigDecimal;
// 「电表与损耗」行:运营商×类型×月。meterKwh null=该月未录电表;lossKwh 读时派生(meter−Σ充电量),未录电表则 null。
public record CpPowerUsageDTO(
    Integer id,               // 未录电表时 null
    String operator,
    String vehicleType,       // car / ebike
    BigDecimal meterKwh,      // 电表用电量 kWh(可 null=未录)
    BigDecimal sumChargeKwh,  // Σ该运营商该类型桩当月充电量
    BigDecimal lossKwh,       // 派生损耗=meter−Σ充电量;为负前端黄警示不阻断
    String note,
    Integer month             // 行所属月(年视角=各月并集时区分月份用,ENERGY-ANALYSIS §4)
) {}
