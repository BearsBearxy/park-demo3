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
    @Pattern(regexp = "tenant|share|ops|infra|park") String ownership,   // 空=share(§6.1;park=园区自担 V68)
    String meterType,
    @Pattern(regexp = "single|three|multi|demand|bidir") String deviceType,   // 表类型(S2);contractId 不走档案 PUT,走 /bind
    String subName, String code, BigDecimal factor,
    @Pattern(regexp = "|\\d{4}-\\d{2}") String retiredYm   // V68 停用账期;空串/null=在用(撤销停用)
) {}
