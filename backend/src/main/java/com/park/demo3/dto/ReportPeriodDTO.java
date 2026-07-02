package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
// 本期读:amounts 只含 normal 叶子行(含自定义行,小计不落库),格 = field->金额(is=cur/ytd,bs=end,tb=8字段);
// customRows 各自定义行元数据;accounts 仅 tb 附科目树(is/bs 为空 List)
public record ReportPeriodDTO(Map<String, Map<String, BigDecimal>> amounts, List<ReportCustomRowDTO> customRows,
                              List<ReportAccountDTO> accounts) {}
