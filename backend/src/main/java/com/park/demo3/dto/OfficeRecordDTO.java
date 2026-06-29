package com.park.demo3.dto;
import java.math.BigDecimal;
public record OfficeRecordDTO(
    Integer id,
    Integer scheduleNo,
    String  acctMonth,
    String  belongMonth,
    BigDecimal elecQty,
    BigDecimal elecPrice,
    BigDecimal elecAmt,    // 派生 = elecQty × elecPrice
    BigDecimal waterQty,
    BigDecimal waterPrice,
    BigDecimal waterAmt,   // 派生 = waterQty × waterPrice
    BigDecimal total,      // 派生 = elecAmt + waterAmt
    String  note,
    String  source
) {}
