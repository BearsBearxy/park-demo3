package com.park.demo3.dto;
import java.math.BigDecimal; import java.util.List;
public record BuildingDTO(
    Integer id, String name, Integer phase, String phaseName, String kind,
    Integer floorCount, BigDecimal totalArea, BigDecimal rentableArea, Integer status,
    int unitCount, int occupiedCount, int vacantCount, int expiringCount, int reservedCount,
    BigDecimal leasedArea, double occRate, BigDecimal monthlyRent, List<Integer> tenantIds) {}
