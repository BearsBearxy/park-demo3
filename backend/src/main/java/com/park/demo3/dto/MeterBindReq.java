package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
// PUT /api/meters/{id}/bind:写 override;contractId=null 解绑(S2-BIND-SPEC §3)。
// 合同钉在归属行上,只对那一段有效(METER-TIMELINE-SPEC §3.6):mode 同 PUT /assign ——
// correct = 钉到 ym 所在的那一段,from = 自 ym 起写一行(之后的段不动)。
public record MeterBindReq(
    Integer contractId,
    @NotBlank @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String ym,
    @NotBlank @Pattern(regexp = "correct|from") String mode
) {}
