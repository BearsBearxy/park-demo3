/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/** 收款公司指引 upsert 请求(BILLS-SPEC §5)。 */
public record PayMapReq(
    @NotNull Integer tenantId,
    @NotBlank String feeKey,    // 附表10 colId
    @NotNull Integer companyId
) {}
