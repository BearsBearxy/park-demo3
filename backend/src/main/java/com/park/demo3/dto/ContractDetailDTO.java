package com.park.demo3.dto;
import java.util.List;
public record ContractDetailDTO(
    ContractDTO contract,
    TenantSnap  tenant,
    List<BillingLineDTO> billingLines,  // 按 location, seq 排序(刀1 §1.7)
    List<RentTierDTO> rentTiers         // 阶梯期,按 fee_key, seq 排序(V2-SPEC §7)
) {
    public record TenantSnap(
        String companyName,
        String contactName,
        String contactPhone,
        String businessType,
        int    status
    ) {}
}
