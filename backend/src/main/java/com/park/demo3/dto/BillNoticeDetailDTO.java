package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;

// 催缴单明细(单头+行;行序=line_no=场地段→表序→段序)
public record BillNoticeDetailDTO(
    Integer id, String ym, Integer tenantId, String tenantName,
    Integer payCompanyId, String payCompanyName,
    String noticeKind, String premiseText,
    BigDecimal totalAmount, BigDecimal prevDue,
    String status, String warn,
    List<Line> lines) {

    public record Line(
        Integer lineNo, String feeKey, String premise, Integer meterId, String meterLabel,
        Integer contractId, String seg, BigDecimal prevRead, BigDecimal currRead,
        BigDecimal factorSnap, BigDecimal qty, BigDecimal priceSnap,
        String priceKey, String priceScope, String priceMonth, String ruleBranch,
        Integer poolRuleId, String shareSrc, BigDecimal baseSnap,
        BigDecimal amount, String note, String feeGroup,   // feeGroup(V90):rent/elec/water 板块分组
        String poolName) {}                                 // 公摊行来源池名(S5 §3.2 行名=「费项·池名」);非公摊行 null
}
