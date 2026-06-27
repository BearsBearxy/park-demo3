package com.park.demo3.dto;
import java.math.BigDecimal;
public record BuildingSummaryDTO(int buildingCount, int stoppedCount,
                                 BigDecimal rentableArea, double occRate, int vacantCount) {}
