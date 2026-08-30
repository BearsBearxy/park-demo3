package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
// 档案新增/编辑共用;PUT 带全量。kind/zone 白名单校验,factor 空=1。
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
    @Pattern(regexp = "single|three|multi|demand|bidir") String deviceType,   // 表类型(S2);contractId 不走档案 PUT,走 /bind
    String subName, String code, BigDecimal factor,
    @Pattern(regexp = "|\\d{4}-\\d{2}") String retiredYm,   // V68 停用账期;空串/null=在用(撤销停用)
    @Pattern(regexp = "|\\d{4}-\\d{2}") String activeFromYm,   // V87 启用账期;空串/null=一直在册
    @Pattern(regexp = "|\\d{4}-\\d{2}") String removedYm,   // V88 退场账期;空串/null=未退场
    // §G5 存疑标(V75 suspect)的人工入口,三态同 floorLabel:不传(null)=保留原标;
    // ""=人工解除(抽屉「认领为独立表」,重新计入分表Σ 与池分母);'shadow'/'incomplete'=人工打标。
    // 必须是三态:二态(null=解除)会让任何一个不带该字段的 PUT 顺手把标清掉,等于护栏形同虚设。
    @Pattern(regexp = "|shadow|incomplete") String suspect
) {}
