package com.park.demo3.dto;
/** 批量绑定结果:bound=改绑行数;conflicts=因目标租户在该月已有行而跳过的行数(台账 uk 冲突)。 */
public record BindResultDTO(int bound, int conflicts) {}
