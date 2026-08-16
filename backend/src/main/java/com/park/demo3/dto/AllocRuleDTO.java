package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// 分摊规则(PB-ALLOCATION-SPEC §1):rule 携带 meterIds+members 整体读写;
// V64 扩 roundScale/stdKind/baseKey/meters(携sign)/links(入向折入链)
public record AllocRuleDTO(
    Integer id, String zone, String name, Integer buildingId,
    String method,                 // direct / area / floor / loss / none / ref
    BigDecimal coefficient,        // area=受益面积Σ㎡;floor=层数(可小数)。S21:=alloc_cfg rule:{id}.coefficient 站在 ym 的生效值(ym 空=初始版本)
    BigDecimal extraQty,           // 人工加度。S21:=alloc_cfg rule:{id}.extra_qty 生效值(两列已退出 alloc_rule)
    String feeKey, String note, Integer sortNo,
    List<Integer> meterIds,
    List<AllocMemberDTO> members,
    Integer roundScale, String stdKind, String baseKey,
    List<AllocPoolDTOs.MeterBind> meters,
    List<AllocPoolDTOs.Link> links,
    String floorLabel, String side, String feeName   // V69 四级定位(name 由此自动生成)
) {}
