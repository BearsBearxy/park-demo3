package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// 派生指标卡(ELEC-COST-SPEC §1 说明 1-7)。missing 非空 → value=null,前端显示缺哪个源。
public record ElecMetricDTO(String key, String label, BigDecimal value, String formulaText, List<String> missing) {}
