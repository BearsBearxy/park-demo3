package com.park.demo3.dto;
import jakarta.validation.constraints.*;
import java.math.BigDecimal;
// 电价参数 upsert:acctMonth 空串/null=默认行;value=null 删除该行(月度行删除即回退默认)。
public record ElecPriceCfgReq(
    @Pattern(regexp = "(\\d{4}-(0[1-9]|1[0-2]))?", message = "格式应为 YYYY-MM") String acctMonth,
    @NotBlank String cfgKey,
    @DecimalMin(value = "0", message = "不能为负") BigDecimal value,
    String note
) {}
