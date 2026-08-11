package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

// 公司新建/编辑(S20 §1.1)。short 空则按 name 派生(旧 {name} 单字段调用仍成立);
// PUT 的 fullName/status 传 null=保持不变(清空 fullName 传空串),避免只带 name 的旧调用把新字段冲掉。
public record CompanyReq(
    @NotBlank @Size(max = 64) String name,
    @JsonProperty("short") @Size(max = 8) String shortName,
    @Size(max = 128) String fullName,
    Integer status
) {}
