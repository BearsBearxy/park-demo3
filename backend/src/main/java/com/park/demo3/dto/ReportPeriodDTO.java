package com.park.demo3.dto;
import java.util.List;
import java.util.Map;
// 本期读:amounts 只含 normal 叶子行(含自定义行,小计不落库);customRows 各自定义行元数据
public record ReportPeriodDTO(Map<String, ReportMonthCellDTO> amounts, List<ReportCustomRowDTO> customRows) {}
