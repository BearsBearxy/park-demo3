package com.park.demo3.dto;
import java.math.BigDecimal;
public record TenantDTO(
    Integer id, String companyName, String contactName, String contactPhone, String businessType,
    Integer status, Integer categoryId, Integer phase, String since,
    BigDecimal monthlyRent, BigDecimal leasedArea, String primaryBuilding, int contractCount,
    String remark, Integer parentId, String parentName, String aliases) {}
