package com.park.demo3.dto;
// 充电桩模拟填充摘要:filled=新写/修正的 simulated 充电记录+新插电表行,
// skipped=manual/import 占位、值未变的 simulated、已有电表行与缺桩(被改名/删除)。
public record CpSimulateResultDTO(int filled, int skipped) {}
