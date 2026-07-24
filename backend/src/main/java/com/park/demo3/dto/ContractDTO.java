package com.park.demo3.dto;
import java.math.BigDecimal;
public record ContractDTO(
    Integer id,
    String  contractNo,
    Integer tenantId,
    String  tenantName,
    Integer buildingId,
    String  buildingName,
    Integer unitId,
    String  floorInfo,
    BigDecimal buildingArea,   // 建筑面积㎡(可空;清空保存自动=租赁面积×0.8 重算,裁定①)
    BigDecimal rentArea,       // 租赁面积(计租面积)
    BigDecimal unitPrice,      // 租金单价 元/㎡/月(五费项之一,V51 方案A 起宽表即唯一事实源)
    // V51 五费项固定字段+电费签约要素(空=待录)
    BigDecimal mgmtFeePrice,
    BigDecimal infraFeePrice,
    Integer elevatorCount,
    Integer elevatorFloors,
    BigDecimal elevatorFee,
    BigDecimal transformerFee,
    String  powerType,         // industrial|commercial|resident
    BigDecimal kva,
    BigDecimal monthlyRent,
    BigDecimal deposit,
    String  startDate,
    String  endDate,
    String  signDate,
    String  status,            // 展示态派生桶 draft|active|expiring|expired|terminated|renewed(§5.1)
    Integer parentContractId,  // 续签链上一期 id(read-only,V54)
    int     termMonths,
    Integer daysToEnd,
    String  remark,
    String  rentFree,          // 免租期 JSON 数组(V33,可空;写入口已校验,读侧前端 try-parse)
    // V55 期限原文三件套(合同导入必现):原文原样回显,不因解析失败而丢失
    String  termText,          // 期限原文,如「2023年7月14日起至2026年7月13日」
    String  termType,          // explicit|multiple|relative|none
    String  tierPriceNote      // 分年阶梯价说明(AH 列原文)
) {}
