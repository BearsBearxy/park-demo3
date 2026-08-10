package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
import java.util.List;
// 规则整体保存(meterIds+members 随行覆盖);loss 规则无 member(受益人生成时动态取)。
// V64 扩:meters(携 sign,优先于 meterIds)/roundScale/stdKind/baseKey/links(入向折入链整体覆盖)
public record AllocRuleReq(
    @NotBlank @Pattern(regexp = "p1|p2|dorm") String zone,
    String name,                   // V69 忽略:后端按定位自动生成并覆盖(前端只读展示)
    Integer buildingId,
    @NotBlank @Pattern(regexp = "direct|area|floor|loss|none|ref") String method,
    BigDecimal coefficient,
    BigDecimal extraQty,           // 空=0
    // share_green_water=绿化水公摊(dorm 宿舍绿化水 / p2 园区绿化水泵,V65 起在库);share_water 是占位键不生成
    @NotBlank @Pattern(regexp = "share_elec_fire|share_elec_elevator|share_elec_light|share_elec_floor|share_elec_loss|share_green_water|share_water|park_loss_pool") String feeKey,
    String note,
    List<Integer> meterIds,        // 旧式绑定(sign 全=1);meters 非空时忽略
    List<AllocMemberDTO> members,
    Integer roundScale,            // 空=2
    @Pattern(regexp = "amount_over_base|qty_price_over_base|qty_over_base") String stdKind,   // 空=按zone默认
    String baseKey,
    List<AllocPoolDTOs.MeterBind> meters,   // 携 sign 的绑定(name 忽略)
    List<AllocPoolDTOs.Link> links,         // 入向折入链 {ruleId=src, type}(name 忽略)
    // V69 四级定位(池名由此自动生成)+ 受益人写入月份:null=写默认长期行,'YYYY-MM'=写该月版本组
    // (写只覆盖目标月的行;读侧版本组前滚 S14——自该月起生效直到更晚版本覆盖)
    String floorLabel,
    String side,
    String feeName,
    @Pattern(regexp = "\\d{4}-(0[1-9]|1[0-2])") String memberMonth
) {}
