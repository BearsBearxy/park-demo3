package com.park.demo3.dto;
import jakarta.validation.constraints.*;
public record ImportLogReq(
    @NotBlank String dataType,
    @NotBlank String typeLabel,
    @NotBlank String fileName,
    String target,
    @Min(0) int rows,
    @Min(0) int ok,
    @Min(0) int warn,
    @Pattern(regexp = "complete|partial|rejected", message = "status 非法") String status) {}
