/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
/** 行级改账面名(台账行 / 附表10 行共用):抽屉内即时提交,未绑定行改对名字自动配档。 */
public record RowTenantRenameReq(@NotBlank String tenantName) {}
