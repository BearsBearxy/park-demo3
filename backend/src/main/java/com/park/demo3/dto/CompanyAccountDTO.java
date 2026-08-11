package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;

// 公司收款账户(S20 §1.2)。isDefault 显式钉 JSON 名:record 的 isXxx 组件会被 Jackson
// 按 bean 命名剥成 "default",前端读的是 isDefault。
public record CompanyAccountDTO(
    Integer id,
    Integer companyId,
    String  kind,
    String  accountName,
    String  accountNo,
    String  bankName,
    @JsonProperty("isDefault") Boolean isDefault,
    Integer sortNo,
    String  remark
) {}
