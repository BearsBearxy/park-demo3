package com.park.demo3.dto;
import java.time.LocalDateTime;
public record ImportLogDTO(Long id, String dataType, String typeLabel, String fileName, String target,
                           int rows, int ok, int warn, String status, String operator, LocalDateTime createdAt) {}
