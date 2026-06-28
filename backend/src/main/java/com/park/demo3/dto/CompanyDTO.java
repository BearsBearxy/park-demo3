package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
public record CompanyDTO(
    Integer id,
    String  name,
    @JsonProperty("short") String shortName,
    Integer sortNo
) {}
