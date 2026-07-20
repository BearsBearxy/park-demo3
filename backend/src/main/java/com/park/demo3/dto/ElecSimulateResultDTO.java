package com.park.demo3.dto;
import java.util.Map;
// 模拟填充摘要:filled=新写/修正的 simulated 行(含电价参数行),skipped=manual/import 占位或值未变的 simulated,
// byRule=各推导规则的 filled 计数(键见 ElecCostService.simulate)。
public record ElecSimulateResultDTO(int filled, int skipped, Map<String, Integer> byRule) {}
