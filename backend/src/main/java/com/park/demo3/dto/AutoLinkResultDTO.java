package com.park.demo3.dto;
// POST /api/meters/auto-link-by-name 结果:linked=本次挂上,skipped=仍待核(无精确唯一匹配)
public record AutoLinkResultDTO(int linked, int skipped) {}
