package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// 损耗与对账段(纯读派生):allocSum=本月分摊合计,elecCostAllocated=电费成本模型 allocated 费项Σ
// (互认提示行,单向读不强拦;勾稽归对账刀,ELEC-COST-SPEC §7 裁定)
public record AllocReconDTO(
    List<AllocLossRowDTO> lossRows,
    List<AllocReconRowDTO> rows,
    BigDecimal allocSum, BigDecimal elecCostAllocated
) {}
