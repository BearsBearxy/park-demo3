package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
public record CompanyNameReq(@NotBlank String name) {}
