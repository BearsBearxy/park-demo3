package com.park.demo3.dto;
import jakarta.validation.constraints.NotNull;
import java.util.List;
public record S10BatchDeleteReq(@NotNull List<Long> ids) {}
