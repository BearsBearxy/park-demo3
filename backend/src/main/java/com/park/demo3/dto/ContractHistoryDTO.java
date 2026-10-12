/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import java.math.BigDecimal; import java.time.LocalDate;
public record ContractHistoryDTO(
    String contractNo, String buildingName, String floorInfo,
    LocalDate startDate, LocalDate endDate, LocalDate signDate,
    BigDecimal monthlyRent, BigDecimal rentArea, String status) {}
