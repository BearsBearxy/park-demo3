package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
// POST /api/meters 建表:资产 + 自 fromYm 起的归属行与「在用」状态行。kind/zone 白名单校验,factor 空=1。
// 编辑不走这里:资产列 PUT /{id}(MeterAssetReq),归属 PUT /assign,状态 /{id}/status,合同 /{id}/bind。
public record MeterReq(
    @NotBlank @Pattern(regexp = "elec|water") String kind,
    @NotBlank @Pattern(regexp = "p\\d+|dorm") String zone,
    @NotBlank String name,
    String area, String spot, String tenantName,
    // V74/§E8 三态:不传(null)=按 spot 自动解析;""=显式清除(跨层/不分侧,不再被 spot 解析回来);有值=人工覆盖
    String floorLabel, String side, String roomNo,
    Integer tenantId, Integer buildingId,
    // 空=share(§6.1;park=园区自担 V68;register=非计费计度寄存器,不进任何Σ 刀H §H2 V79)
    @Pattern(regexp = "tenant|share|ops|infra|park|register") String ownership,
    String meterType,
    @Pattern(regexp = "single|three|multi|demand|bidir") String deviceType,   // 表类型(S2);contractId 不走档案,走 /bind
    String subName, String code, BigDecimal factor,
    // §G5 存疑标(V75 suspect)的人工入口:不传(null)=不打标;'shadow'/'incomplete'=人工打标
    @Pattern(regexp = "|shadow|incomplete") String suspect,
    // 归属行与在用状态自这个月起(METER-TIMELINE-SPEC §3.4「新增表从当前查看月起在册」);不传 = 1900-01(一直在册)
    @Pattern(regexp = "|\\d{4}-(0[1-9]|1[0-2])") String fromYm
) {}
