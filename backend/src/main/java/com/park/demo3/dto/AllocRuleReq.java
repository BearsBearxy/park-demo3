package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
import java.util.List;
// 规则整体保存(meterIds+members 随行覆盖);loss 规则无 member(受益人生成时动态取)
public record AllocRuleReq(
    @NotBlank @Pattern(regexp = "p1|p2") String zone,
    @NotBlank String name,
    Integer buildingId,
    @NotBlank @Pattern(regexp = "direct|area|floor|loss") String method,
    BigDecimal coefficient,
    BigDecimal extraQty,           // 空=0
    @NotBlank @Pattern(regexp = "share_elec_fire|share_elec_elevator|share_elec_light|share_elec_floor|share_elec_loss|share_water") String feeKey,
    String note,
    List<Integer> meterIds,
    List<AllocMemberDTO> members
) {}
