package com.park.demo3.dto;
import java.util.List;
public record ImportLogOverviewDTO(List<ImportLogDTO> latestByType, List<ImportLogDTO> history) {}
