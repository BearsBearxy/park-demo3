package com.park.demo3.dto;
import java.math.BigDecimal;

public record UnitDTO(
    Integer id,
    Integer floor,
    String  unitNo,
    BigDecimal area,
    BigDecimal derivedArea,   // S15 合同派生面积:绑定行Σ(÷绑定单元数),无绑定回退非宿舍行面积均摊(unit.area 全库为 0)
    String  status,       // "occupied" | "expiring" | "reserved" | "vacant"
    Integer tenantId,
    String  tenantName,
    String  companyName,
    String  businessType,
    String  contractNo,
    BigDecimal monthlyRent,
    Boolean crossBuilding,       // S15-b 跨栋占用:占用合同主楼栋非本栋(经附加单元挂入)
    String  homeBuildingName     // 跨栋占用合同的主楼栋名(展示用;非跨栋为 null)
) {}
