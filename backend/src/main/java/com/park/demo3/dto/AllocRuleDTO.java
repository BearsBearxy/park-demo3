package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// 分摊规则(PB-ALLOCATION-SPEC §1):rule 携带 meterIds+members 整体读写
public record AllocRuleDTO(
    Integer id, String zone, String name, Integer buildingId,
    String method,                 // direct / area / floor / loss
    BigDecimal coefficient,        // area=受益面积Σ㎡;floor=层数(可小数)
    BigDecimal extraQty,           // 人工加度
    String feeKey, String note, Integer sortNo,
    List<Integer> meterIds,
    List<AllocMemberDTO> members
) {}
