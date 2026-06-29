package com.park.demo3.dto;
import java.math.BigDecimal;
public record ElecRecordDTO(
    Integer id,
    String  type,        // energy / basic
    String  phase,
    String  phaseName,
    String  acctMonth,
    String  invDate,
    String  period,      // 峰/平/谷(仅 energy)
    String  cat,         // 仅 energy
    String  unit,        // 仅 energy
    BigDecimal qty,      // 仅 energy
    BigDecimal demand,   // 仅 basic
    BigDecimal price,
    BigDecimal rate,
    BigDecimal amount,   // 派生 = energy:qty×price / basic:demand×price(eFee)
    BigDecimal tax,      // 派生 = amount×rate
    BigDecimal total,    // 派生 = amount+tax
    String  note,
    String  source
) {}
