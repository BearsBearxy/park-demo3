package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// 分摊规则(PB-ALLOCATION-SPEC §1):rule 携带 meterIds+members 整体读写;
// V64 扩 roundScale/stdKind/baseKey/meters(携sign)/links(入向折入链)
public record AllocRuleDTO(
    Integer id, String zone, String name, Integer buildingId,
    String method,                 // direct / area / floor / loss / none / ref
    BigDecimal coefficient,        // area=受益面积Σ㎡;floor=层数(可小数)
    BigDecimal extraQty,           // 人工加度(默认值,rule:{id} 月行优先)
    String feeKey, String note, Integer sortNo,
    List<Integer> meterIds,
    List<AllocMemberDTO> members,
    Integer roundScale, String stdKind, String baseKey,
    List<AllocPoolDTOs.MeterBind> meters,
    List<AllocPoolDTOs.Link> links,
    String floorLabel, String side, String feeName   // V69 四级定位(name 由此自动生成)
) {}
