package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
// POST /api/meters/assign/clear-manual(SPEC §3.3「改回按册子」):清掉 ym 所在那一段的三组人工标记。
public record MeterClearManualReq(
    @NotNull Integer meterId,
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym
) {}
