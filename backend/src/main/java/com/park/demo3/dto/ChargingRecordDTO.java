package com.park.demo3.dto;
import java.math.BigDecimal;
public record ChargingRecordDTO(
    Integer id,
    Integer scheduleNo,
    String  cat,
    String  catName,
    String  acctMonth,
    BigDecimal kwh,
    BigDecimal fee,
    BigDecimal cost,
    BigDecimal profit,   // 派生 = fee - cost
    String  note,
    String  source
) {}
