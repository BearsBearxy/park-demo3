package com.park.demo3.dto;
import java.util.List;
public record ContractDetailDTO(
    ContractDTO contract,
    TenantSnap  tenant,
    List<BillingLineDTO> billingLines,  // 按 location, seq 排序(刀1 §1.7)
    List<Integer> extraUnitIds          // 附加单元(V58,主单元在 contract.unitId);编辑回带用
) {
    public record TenantSnap(
        String companyName,
        String contactName,
        String contactPhone,
        String businessType,
        int    status
    ) {}
}
