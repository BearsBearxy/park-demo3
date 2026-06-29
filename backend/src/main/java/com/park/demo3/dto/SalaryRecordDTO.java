package com.park.demo3.dto;
import java.math.BigDecimal;
public record SalaryRecordDTO(
    Integer id,
    String  acctMonth,
    Integer empIdx,
    String  name,
    String  role,
    BigDecimal base,
    BigDecimal post,
    BigDecimal perf,
    BigDecimal attend,
    BigDecimal skill,
    BigDecimal edu,
    BigDecimal other,
    BigDecimal lunch,
    BigDecimal heat,
    BigDecimal commission,
    Integer shouldDays,
    Integer leaveDays,
    BigDecimal social,
    BigDecimal tax,
    BigDecimal otherDeduct,
    Boolean sign,
    BigDecimal wageTotal,    // 派生 = base+post+perf+attend+skill+edu+other
    BigDecimal gross,        // 派生 = wageTotal+lunch+heat+commission
    BigDecimal deduct,       // 派生 = social+tax+otherDeduct
    BigDecimal net,          // 派生 = gross-deduct
    Integer actualDays,      // 派生 = shouldDays-leaveDays
    boolean fullAttend,      // 派生 = leaveDays==0
    String  note,
    String  source
) {}
