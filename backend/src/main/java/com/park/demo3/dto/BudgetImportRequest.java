package com.park.demo3.dto;
import java.util.List;
public record BudgetImportRequest(List<BudgetRowDTO> rows) {}
