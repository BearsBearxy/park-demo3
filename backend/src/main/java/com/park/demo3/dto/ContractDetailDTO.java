package com.park.demo3.dto;
public record ContractDetailDTO(
    ContractDTO contract,
    TenantSnap  tenant
) {
    public record TenantSnap(
        String companyName,
        String contactName,
        String contactPhone,
        String businessType,
        int    status
    ) {}
}
