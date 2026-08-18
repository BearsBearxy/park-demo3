package com.park.demo3.dto;
import java.math.BigDecimal;
// occRate 透传自 BuildingSummaryDTO,同样可空(METRIC-SOURCE-SPEC §3)
public record TenantSummaryDTO(int tenantActive, Double occRate, BigDecimal monthlyRent, int expiringTenants) {}
