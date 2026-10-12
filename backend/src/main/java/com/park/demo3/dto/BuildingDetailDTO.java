/* Copyright (c) 2026 Junyang. All rights reserved. */
package com.park.demo3.dto;
import java.util.List;

public record BuildingDetailDTO(
    BuildingDTO building,
    List<UnitDTO> units
) {}
