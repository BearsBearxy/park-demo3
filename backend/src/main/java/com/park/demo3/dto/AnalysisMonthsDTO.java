package com.park.demo3.dto;
import java.util.List;
import java.util.Map;

// 分析层期间地基:各数据源 distinct 月份(YYYY-MM)+ 并集(升序)。
// 前端 usePeriod 可用月份由此派生,不硬编码年份;sources 键:pnl/s10/ledger/pv/elec/charging/office/report。
public record AnalysisMonthsDTO(List<String> months, Map<String, List<String>> sources) {}
