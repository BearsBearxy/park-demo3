package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
// 计费行写 Req(内嵌 ContractCreateReq,单一编辑随合同整体 PUT);feeKey 白名单/coeff/billMode 缺省在 ContractService。
public record BillingLineReq(
    Integer id,                 // null=新增
    String propertyType,        // 段类型 factory|office|dorm|shop|land(V54);非空则服务层钉死校验 feeKey∈该类型允许集
    String location,
    @NotBlank String feeKey,    // ∈ FeeKey 13 枚举(服务层白名单校验)
    @DecimalMin("0") BigDecimal area,
    @DecimalMin("0") BigDecimal areaShared, // 公摊面积(V90,选填):填了=area为建筑面积
    @DecimalMin("0") BigDecimal unitPrice,
    @DecimalMin("0") BigDecimal coeff,       // null→1
    @Min(0) Integer roomCount,
    String billMode,            // null→按 feeKey 默认
    @DecimalMin("0") BigDecimal amountOverride,
    Integer seq,
    // 行级单元绑定(2026-08-14):null=不显式指定,沿用 replaceLinesFromReq 的按键回挂快照(老客户端/导入路径不受影响);
    // 非 null(含空列表)=以本次为准整组替换该行绑定。按层取面积的公摊池靠它把户面积落到楼层。
    java.util.List<Integer> unitIds
) {}
