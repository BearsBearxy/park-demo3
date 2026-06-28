package com.park.demo3.dto;
import java.math.BigDecimal; import java.time.LocalDate;
public record ContractHistoryDTO(
    String contractNo, String buildingName, String floorInfo,
    LocalDate startDate, LocalDate endDate, LocalDate signDate,
    BigDecimal monthlyRent, BigDecimal rentArea, String status) {}
