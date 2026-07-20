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
    BigDecimal buildingArea,   // 建筑面积㎡(V33,可空)
    BigDecimal rentArea,       // 租赁面积(计租面积)
    BigDecimal unitPrice,      // 租金单价 元/㎡/月(V33,可空)
    BigDecimal monthlyRent,
    BigDecimal deposit,
    String  startDate,
    String  endDate,
    String  signDate,
    String  status,
    int     termMonths,
    Integer daysToEnd,
    String  remark,
    String  rentFree           // 免租期 JSON 数组(V33,可空;写入口已校验,读侧前端 try-parse)
) {}
