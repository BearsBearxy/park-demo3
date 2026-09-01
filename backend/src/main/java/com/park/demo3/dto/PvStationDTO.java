package com.park.demo3.dto;
import java.math.BigDecimal;
public record PvStationDTO(
    Integer id,
    String name,
    Integer phase,            // 1/2/3
    Integer metered,          // 1=已装表 0=未安装(未安装的站不入任何分析,护栏分母也排除)
    BigDecimal capacityKwp,   // 装机容量 kWp(可空)
    Integer panelCount,       // 光伏板数量(块,可空)
    BigDecimal panelWatt,     // 单块标称功率 W(可空;理论装机 = panelCount × panelWatt ÷ 1000)
    BigDecimal priceYuan,     // 消纳综合单价 元/kWh(可空)
    Integer sortNo
) {}
