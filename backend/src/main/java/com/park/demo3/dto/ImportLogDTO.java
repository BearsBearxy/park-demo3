/* Copyright (c) 2026 Junyang. All rights reserved. */
package com.park.demo3.dto;
import java.time.LocalDateTime;
public record ImportLogDTO(Long id, String dataType, String typeLabel, String fileName, String target,
                           int rows, int ok, int warn, String status, String operator, LocalDateTime createdAt,
                           String periodFrom, String periodTo, Integer companyId, String zone, String note) {}
