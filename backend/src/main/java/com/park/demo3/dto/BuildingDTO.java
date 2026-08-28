package com.park.demo3.dto;
import java.math.BigDecimal; import java.util.List;
public record BuildingDTO(
    Integer id, String name, Integer phase, String phaseName, String zone, String kind,
    Integer floorCount, BigDecimal totalArea, BigDecimal rentableArea, Integer status,
    int unitCount, int occupiedCount, int vacantCount, int expiringCount, int reservedCount,
    BigDecimal leasedArea, Double occRate, BigDecimal monthlyRent, List<Integer> tenantIds,   // occRate 可空(§3):null=算不出来
    BigDecimal tenantBuildingArea) {}   // 栋内在租合同建筑面积汇总(只读展示,BILL-FORWARD 刀1 返工)
