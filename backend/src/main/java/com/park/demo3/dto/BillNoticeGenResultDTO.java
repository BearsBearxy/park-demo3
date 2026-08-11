package com.park.demo3.dto;

// generate 结果摘要:generated=本批新插单数;lines=行数;warned=带 warn 单数+因锁定跳过的租户数;
// skippedConfirmed=因已确认/已导出被整户跳过的租户数(S20 §1.3 重新生成保护);batch=派生批次
public record BillNoticeGenResultDTO(int generated, int lines, int warned,
                                     int skippedConfirmed, String batch) {}
