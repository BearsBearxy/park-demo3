/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import java.math.BigDecimal;
public record TenantDTO(
    Integer id, String companyName, String contactName, String contactPhone, String businessType,
    Integer status, Integer categoryId, Integer phase, String since,
    BigDecimal monthlyRent, BigDecimal leasedArea, String primaryBuilding, int contractCount,
    String remark, Integer parentId, String parentName, String aliases) {}
