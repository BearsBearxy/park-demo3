/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import java.math.BigDecimal;
// occRate 透传自 BuildingSummaryDTO,同样可空(METRIC-SOURCE-SPEC §3)
public record TenantSummaryDTO(int tenantActive, Double occRate, BigDecimal monthlyRent, int expiringTenants) {}
