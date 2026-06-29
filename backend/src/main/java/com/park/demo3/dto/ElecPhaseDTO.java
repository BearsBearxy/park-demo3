package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
public record ElecPhaseDTO(
    String id,
    String name,
    @JsonProperty("short") String shortName
) {}
