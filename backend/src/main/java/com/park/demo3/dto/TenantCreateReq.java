package com.park.demo3.dto;
import jakarta.validation.constraints.*;
public record TenantCreateReq(
    @NotBlank @Size(max = 128) String companyName,
    @NotBlank @Size(max = 32) String businessType,
    @Size(max = 32) String contactName,
    @Size(max = 32) String contactPhone,
    Integer categoryId,
    Integer parentId,
    @Min(1) @Max(9) Integer phase,
    @Pattern(regexp = "\\d{4}-\\d{2}") String since,
    @Size(max = 255) String remark) {}
