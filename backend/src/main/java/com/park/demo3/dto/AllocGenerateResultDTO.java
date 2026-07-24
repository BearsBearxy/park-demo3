package com.park.demo3.dto;
import java.util.List;
// 生成摘要:rows=写入 gen 行数,tenants=涉及户数,manualKept=保留的 manual 行数,warnings=缺抄/缺参清单
public record AllocGenerateResultDTO(int rows, int tenants, int manualKept, List<String> warnings) {}
