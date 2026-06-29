package com.park.demo3.dto;
import java.math.BigDecimal;
public record PvRecordDTO(
    Integer id,
    String  phase,
    String  phaseName,
    String  acctMonth,
    String  occurMonth,
    BigDecimal selfKwh,
    BigDecimal selfAmt,
    BigDecimal gridKwh,
    BigDecimal gridAmt,
    BigDecimal gen,    // 派生 = selfKwh + gridKwh
    BigDecimal fee,    // 派生 = selfAmt + gridAmt
    String  note,
    String  source
) {}
