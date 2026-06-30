package com.park.demo3.dto;
import java.util.List;
public record ImportResultDTO(int imported, int skipped, List<ImportError> errors) {}
