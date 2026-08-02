package com.park.demo3.dto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
public record ContractCreateReq(
    @NotBlank @Size(max = 32) String contractNo,
    @NotNull Integer tenantId,
    @NotNull Integer buildingId,
    Integer unitId,
    List<Integer> extraUnitIds,  // 附加单元(V58 contract_unit,主单元在 unitId):null=不动;空列表=清空;整组替换同 billingLines
    @DecimalMin("0") BigDecimal buildingArea,   // 建筑面积㎡(可空;清空=租赁面积×0.8 重算,裁定①)
    @DecimalMin("0") BigDecimal rentArea,
    @DecimalMin("0") BigDecimal unitPrice,      // 租金单价 元/㎡/月(五费项之一)
    @DecimalMin("0") BigDecimal monthlyRent,
    @DecimalMin("0") BigDecimal deposit,
    // V51 五费项固定字段+电费签约要素(裁定③④;皆可空=待录)
    @DecimalMin("0") BigDecimal mgmtFeePrice,   // 管理费单价 元/㎡/月
    @DecimalMin("0") BigDecimal infraFeePrice,  // 基础维护单价 元/㎡/月
    @Min(1) Integer elevatorCount,              // 货梯数N
    @Min(1) Integer elevatorFloors,             // 计费层数L(已扣首层)
    @DecimalMin("0") BigDecimal elevatorFee,    // 电梯覆盖月额
    @DecimalMin("0") BigDecimal transformerFee, // 变压器覆盖月额
    @Pattern(regexp = "industrial|commercial|resident") String powerType,
    @DecimalMin("0") BigDecimal kva,            // 仅大工业可填(服务层联动校验)
    LocalDate startDate,
    LocalDate endDate,
    LocalDate signDate,
    @NotBlank @Pattern(regexp = "draft|active|terminated|renewed") String status,  // V54:存储态 4 值;expiring/expired 由 endDate 派生不入库(§5.1)
    @Size(max = 255) String remark,
    String rentFree,  // 免租期 JSON 数组,ContractService.validateRentFree 校验(合法数组/{start,end,note?}/ISO 日期/start≤end/≤24 段)
    @Valid List<BillingLineReq> billingLines,  // 计费行:单一编辑随合同整体 PUT,整组替换(null=不动;空列表=清空)
    // V55 期限原文三件套(可空;PUT 全字段语义,置空即清空)
    @Size(max = 255) String termText,
    @Pattern(regexp = "explicit|multiple|relative|none") String termType,
    @Size(max = 500) String tierPriceNote
) {}
