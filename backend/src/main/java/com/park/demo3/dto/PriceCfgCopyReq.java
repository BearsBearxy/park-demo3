package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
// 复制月行 fromYm→toYm(PRICE-CFG-SPEC §4);目标已有 (scope,cfg_key) 跳过=幂等
public record PriceCfgCopyReq(
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String fromYm,
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String toYm
) {}
