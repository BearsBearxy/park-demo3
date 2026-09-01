package com.park.demo3.dto;

import java.math.BigDecimal;
import java.util.List;

/** 逐小时天气导入请求(PV-ANALYSIS-SPEC §03.3)。行级错误逐行报告,不整批拦。 */
public record WeatherImportRequest(List<Row> rows) {
    public record Row(String obsTime, BigDecimal ghi, BigDecimal dni, BigDecimal dhi,
                      BigDecimal tempC, BigDecimal precipMm, Integer humidity, String weatherTxt) {}
}
