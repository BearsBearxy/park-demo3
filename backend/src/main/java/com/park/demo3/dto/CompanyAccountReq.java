package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// 收款账户增改(S20 §1.2)。kind 必填且限值域;其余全部选填。
// PUT 语义:null=保持不变(MyBatis-Plus updateById 跳过 null),清空传空串。
public record CompanyAccountReq(
    @NotBlank @Size(max = 12) String kind,
    @Size(max = 64)  String accountName,
    @Size(max = 64)  String accountNo,
    @Size(max = 128) String bankName,
    @JsonProperty("isDefault") Boolean isDefault,
    Integer sortNo,
    @Size(max = 255) String remark
) {}
