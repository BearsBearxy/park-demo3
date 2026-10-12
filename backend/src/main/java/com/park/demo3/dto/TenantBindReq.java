/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
/** 按账面名批量绑定档案:台账 / 附表10 共用一个形状(API-CONTRACT §5.1)。 */
public record TenantBindReq(@NotBlank String tenantName, @NotNull Integer tenantId) {}
