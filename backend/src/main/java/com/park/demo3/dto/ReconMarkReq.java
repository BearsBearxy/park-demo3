package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
public record ReconMarkReq(
    @NotBlank String tenantName,    // 实体键(uk 冲突即 upsert note)
    Integer tenantId,               // 可空软引用
    String note                     // 可空
) {}
