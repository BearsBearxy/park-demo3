package com.park.demo3.entity;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

/**
 * 收款公司指引(BILLS-SPEC §5):租户×附表10费用列 → 应转入公司。与台账记账公司完全不联动。
 * 复合主键(tenant_id,fee_key),写走 mapper 原生 upsert;created/updated 由 DB 默认值维护,实体不映射。
 */
@Data @TableName("bill_pay_company")
public class BillPayCompany {
    private Integer tenantId;
    private String feeKey;      // 附表10 colId(合法集=ReconService.RECON_FEES 的 s10Key)
    private Integer companyId;
}
