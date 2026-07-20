package com.park.demo3.dto;
import java.math.BigDecimal;
// 电价参数读侧:value=解析值(当月优先回退默认),source='month'/'default'/null(两级都缺);
// monthValue/defaultValue 原样返回供参数区分别展示与编辑。
public record ElecPriceCfgDTO(
    String cfgKey, BigDecimal value, String source,
    BigDecimal monthValue, BigDecimal defaultValue, String note
) {}
