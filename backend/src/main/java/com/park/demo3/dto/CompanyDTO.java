package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

// status: 1=启用 0=停用(S20 §1.1);fullName 空则展示回落 name;accounts 为该公司收款账户(按 sort_no,id)
public record CompanyDTO(
    Integer id,
    String  name,
    @JsonProperty("short") String shortName,
    Integer sortNo,
    String  fullName,
    Integer status,
    List<CompanyAccountDTO> accounts
) {}
