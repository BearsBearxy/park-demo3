package com.park.demo3.dto;
import java.math.BigDecimal;
// 利润表一格:本月(cur) + 本年累计(ytd)
public record ReportMonthCellDTO(BigDecimal cur, BigDecimal ytd) {}
