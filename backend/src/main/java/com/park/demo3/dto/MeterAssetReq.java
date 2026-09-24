package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
// PUT /api/meters/{id}:只收资产列(METER-TIMELINE-SPEC §1.1,不分月)。factor 空=1。
// 归属 / 位置走 PUT /api/meters/assign(按月),状态走 POST·DELETE /api/meters/{id}/status,合同钉走 PUT /{id}/bind。
public record MeterAssetReq(
    @NotBlank @Pattern(regexp = "elec|water") String kind,
    @NotBlank @Pattern(regexp = "p\\d+|dorm") String zone,
    @NotBlank String name,
    String meterType,
    @Pattern(regexp = "single|three|multi|demand|bidir") String deviceType,
    String code, BigDecimal factor,
    // §G5 存疑标三态:不传(null)=保留原标;""=人工解除(认领为独立表);'shadow'/'incomplete'=人工打标
    @Pattern(regexp = "|shadow|incomplete") String suspect
) {}
