/* Copyright (c) 2026 Junyang. All rights reserved. */
package com.park.demo3.dto;
import com.fasterxml.jackson.annotation.JsonProperty;
public record ElecPhaseDTO(
    String id,
    String name,
    @JsonProperty("short") String shortName
) {}
