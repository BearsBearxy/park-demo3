package com.park.demo3.dto;
/** 行级绑定/换绑/解绑(台账行 / 附表10 行共用):tenantId=null 即解绑。 */
public record RowTenantBindReq(Integer tenantId) {}
