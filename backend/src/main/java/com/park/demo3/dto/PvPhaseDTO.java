package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
public record PvPhaseDTO(
    String id,
    String name,
    @JsonProperty("short") String shortName,
    String online
) {}
