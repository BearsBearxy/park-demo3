package com.park.demo3.mapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.park.demo3.entity.BillPayCompany;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;

public interface BillPayCompanyMapper extends BaseMapper<BillPayCompany> {
    // upsert:复合主键(tenant_id,fee_key) 命中即改 company_id(MySQL 原生,免查改两跳)
    @Insert("INSERT INTO bill_pay_company (tenant_id, fee_key, company_id) VALUES (#{tenantId}, #{feeKey}, #{companyId}) "
          + "ON DUPLICATE KEY UPDATE company_id = #{companyId}")
    int upsertPay(@Param("tenantId") Integer tenantId, @Param("feeKey") String feeKey,
                  @Param("companyId") Integer companyId);
}
