package com.park.demo3.dto;
import jakarta.validation.constraints.*;
/** PUT /api/tenants/{id} 入参 = CreateReq 全量字段 + status(1在租/2已退租/0黑名单) */
public record TenantUpdateReq(
    @NotBlank @Size(max = 128) String companyName,
    @NotBlank @Size(max = 32) String businessType,
    @Size(max = 32) String contactName,
    @Size(max = 32) String contactPhone,
    Integer categoryId,
    Integer parentId,
    @Min(1) @Max(9) Integer phase,
    @Pattern(regexp = "\\d{4}-\\d{2}") String since,
    @Size(max = 255) String remark,
    @NotNull @Min(0) @Max(2) Integer status,
    @Size(max = 255) String aliases) {}   // 别名,逗号分隔(V86)
