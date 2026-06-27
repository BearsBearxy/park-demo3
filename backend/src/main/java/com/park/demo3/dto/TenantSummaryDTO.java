package com.park.demo3.dto;
import java.math.BigDecimal;
public record TenantSummaryDTO(int tenantActive, double occRate, BigDecimal monthlyRent, int expiringTenants) {}
