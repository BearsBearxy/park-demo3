package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

// 年聚合:phase(1–4) → colId → 12 长度月Σ(该月无行=null;全零列不输出)
public record S10YearSummaryDTO(int year, Map<Integer, Map<String, List<BigDecimal>>> phases) {}
