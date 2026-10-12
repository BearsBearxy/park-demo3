/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import jakarta.validation.constraints.*;
public record ImportLogReq(
    @NotBlank String dataType,
    @NotBlank String typeLabel,
    @NotBlank String fileName,
    String target,
    @Min(0) int rows,
    @Min(0) int ok,
    @Min(0) int warn,
    @Pattern(regexp = "complete|partial|rejected", message = "status 非法") String status,
    // 导到哪(V141,都可空):月 2026-09 / 日 2026-10-01 / 年 2026
    @Pattern(regexp = "\\d{4}(-\\d{2}(-\\d{2})?)?", message = "periodFrom 非法") String periodFrom,
    @Pattern(regexp = "\\d{4}(-\\d{2}(-\\d{2})?)?", message = "periodTo 非法") String periodTo,
    Integer companyId,
    @Size(max = 16) String zone,
    String note) {}   // 被拒原因;超 200 字服务端截断,不因它丢掉整条记录
