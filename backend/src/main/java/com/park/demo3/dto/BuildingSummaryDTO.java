package com.park.demo3.dto;
import java.math.BigDecimal;
public record BuildingSummaryDTO(int buildingCount, int stoppedCount,
                                 BigDecimal rentableArea, Double occRate, int vacantCount, int unitCount) {}
// occRate 可空(METRIC-SOURCE-SPEC §3):分母≤0 或分子>分母 → null,前端渲染「—」;vacantCount/unitCount 供副标出「按单元」口径
