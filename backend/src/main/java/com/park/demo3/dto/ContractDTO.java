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
    String  linkType,          // V57 相对父期链接类型 new|renew|escalation(ESCALATION-SPLIT-SPEC §1)
    String  kind,              // V59 合同性质 normal|master_lease(整体承租,不计出租率/KPI)
    int     termMonths,
    Integer daysToEnd,
    String  remark,
    String  rentFree,          // 免租期 JSON 数组(V33,可空;写入口已校验,读侧前端 try-parse)
    // V55 期限原文三件套(合同导入必现):原文原样回显,不因解析失败而丢失
    String  termText,          // 期限原文,如「2023年7月14日起至2026年7月13日」
    String  termType,          // explicit|multiple|relative|none
    String  tierPriceNote,     // 分年阶梯价说明(AH 列原文)
    java.util.List<String> warnings, // S15:编辑整组替换时未能回挂的计费行单元绑定告警(仅 PUT 回包,读路径 null)
    // ⭐两个「缺口筛选」的数据源(2026-08-14):公共电核算报「N 份合同无租金计费行」「N 户缺起止日期」时,
    // 用户要能在合同页一键筛出那批来补 —— 只报数不给筛选等于没有修复路径。
    // 缺日期直接用 startDate/endDate 判,不占列;计费行数前端算不出,故随列表下发。
    // 两个计数都只数「建筑类租金行」——与引擎读的那一档同口径,筛出来的合同才和告警报的那批一致
    int     billingLineCount,        // 租金计费行数(0=分摊面积只能回退合同租赁面积)
    int     unboundTermCount         // 没绑单元的租金计费行数(>0=按层取面积会回退整栋口径)
) {}
