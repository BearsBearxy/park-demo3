package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
public record ChargingCatDTO(
    String catId,
    String name,
    @JsonProperty("short") String shortName,
    String tint
) {}
