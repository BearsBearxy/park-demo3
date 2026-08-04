package com.park.demo3.dto;
import java.math.BigDecimal;

// 催缴单列表行(S4-2 API 契约)
public record BillNoticeDTO(
    Integer id, String ym, Integer tenantId, String tenantName,
    Integer payCompanyId, String payCompanyName,
    String noticeKind, String premiseText,
    BigDecimal totalAmount, BigDecimal prevDue,
    String status, String warn, int lineCount) {}
