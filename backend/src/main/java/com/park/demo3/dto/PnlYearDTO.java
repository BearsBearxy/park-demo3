package com.park.demo3.dto;
import java.util.List;
public record PnlYearDTO(int year, List<PnlRowDTO> rows) {}
