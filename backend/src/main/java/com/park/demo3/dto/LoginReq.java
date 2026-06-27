package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
public record LoginReq(@NotBlank String username, @NotBlank String password) {}
