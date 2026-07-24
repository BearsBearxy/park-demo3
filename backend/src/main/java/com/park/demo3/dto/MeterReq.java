package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
// 档案新增/编辑共用;PUT 带全量。kind/zone 白名单校验,factor 空=1。
public record MeterReq(
    @NotBlank @Pattern(regexp = "elec|water") String kind,
    @NotBlank @Pattern(regexp = "p1|p2|dorm") String zone,
    @NotBlank String name,
    String area, String spot, String tenantName,
    Integer tenantId, Integer buildingId,
    @Pattern(regexp = "tenant|share|ops|infra") String ownership,   // 空=share(§6.1)
    String meterType,
    String subName, String code, BigDecimal factor
) {}
