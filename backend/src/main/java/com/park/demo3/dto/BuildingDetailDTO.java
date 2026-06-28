package com.park.demo3.dto;
import java.util.List;

public record BuildingDetailDTO(
    BuildingDTO building,
    List<UnitDTO> units
) {}
