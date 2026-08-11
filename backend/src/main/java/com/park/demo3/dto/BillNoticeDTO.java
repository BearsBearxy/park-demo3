package com.park.demo3.dto;
import java.math.BigDecimal;
import java.time.LocalDateTime;

// 催缴单列表行(S4-2 API 契约 + S20 §1.3 状态留痕两列)
// status: draft 待核对 / confirmed 已确认 / exported 已导出 / void 已作废(+历史 issued)
public record BillNoticeDTO(
    Integer id, String ym, Integer tenantId, String tenantName,
    Integer payCompanyId, String payCompanyName,
    String noticeKind, String premiseText,
    BigDecimal totalAmount, BigDecimal prevDue,
    String status, String warn, int lineCount,
    LocalDateTime confirmedAt, LocalDateTime exportedAt) {}
