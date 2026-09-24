package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.List;
import java.util.Map;
// PUT /api/meters/assign(METER-TIMELINE-SPEC §3.3):站在 ym 改归属。
//   mode=correct:更正 ym 所在的那一段(起始月 F ≤ ym);mode=from:自 ym 起变更(在 ym 写一行)。F = ym 时两者相同。
//   meterIds:同房间的表一起写,各自按自己的链定目标行。
//   patch:只写出现的键(tenantId tenantName buildingId ownership area spot floorLabel side roomNo subName);
//          值 null / "" = 清空(ownership 不能空)。没出现的键原样。
//   alsoMigrateCopies:目标行之后紧挨着的、上线时复制的同一份档案(src=migrate 且与改前相同)一并更正。
public record MeterAssignReq(
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym,
    @NotBlank @Pattern(regexp = "correct|from") String mode,
    @NotEmpty List<@NotNull Integer> meterIds,
    @NotEmpty Map<String, Object> patch,
    boolean alsoMigrateCopies
) {}
