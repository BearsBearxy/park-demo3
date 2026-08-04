package com.park.demo3.dto;

// generate 结果摘要:generated=本批新插单数;lines=行数;warned=带 warn 单数+因 issued 跳过的租户数;batch=派生批次
public record BillNoticeGenResultDTO(int generated, int lines, int warned, String batch) {}
