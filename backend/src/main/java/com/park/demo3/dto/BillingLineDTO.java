package com.park.demo3.dto;
import java.math.BigDecimal;
// 计费行读 DTO(BILL-FORWARD 刀1 §1.7);按 location, seq 排序带出。
public record BillingLineDTO(
    Integer id, Integer contractId,
    String propertyType,                    // 段类型 factory|office|dorm|shop|land(V54)
    String location,
    String feeKey, String feeName,          // feeName=LABEL[propertyType][feeKey] 上下文回显(§7.2)
    BigDecimal area, BigDecimal areaShared, BigDecimal unitPrice, BigDecimal coeff,   // areaShared(V90):公摊面积,非空=area为建筑面积
    Integer roomCount, String billMode,
    BigDecimal amountOverride, Integer seq, String source,  // import|manual
    // ⭐行级单元绑定(V91 billing_term_unit)。2026-08-14 之前只有迁移脚本写得进去、界面读都读不到:
    // 公共电核算报「在该栋无计费行↔单元绑定,请补绑定」时用户根本没有可操作的界面。现随行回显、随行可改。
    java.util.List<Integer> unitIds
) {}
