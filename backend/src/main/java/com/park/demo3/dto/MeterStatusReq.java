package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
// POST /api/meters/{id}/status(SPEC §3.4):自 fromYm 起 在用 / 停用 / 已拆。
// replaceFromYm = 把自这个月起的那一行挪到 fromYm(「改月」;第一行不能删,只能这样改)。不传 = 新写或覆盖 fromYm 那一行。
public record MeterStatusReq(
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String fromYm,
    @NotBlank @Pattern(regexp = "active|retired|removed") String status,
    @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String replaceFromYm
) {}
