package com.park.demo3.dto;
import java.math.BigDecimal;
// 费项月度值行。subKey ''=合计行;合计与拆分并存时两者都返回,黄警由前端判(拆分口径 ELEC-COST-SPEC §3)。
public record ElecCostEntryDTO(
    Integer id, Integer meterId, String meterName,
    String acctMonth, String feeKey, String subKey,
    BigDecimal amount, BigDecimal qty, String note, String source
) {}
