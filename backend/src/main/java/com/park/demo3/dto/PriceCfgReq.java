package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
// 单行 upsert(PRICE-CFG-SPEC §4);acctMonth 空=默认行;value=null 删行回退(有行删、无行零操作)
public record PriceCfgReq(
    @Pattern(regexp = "^(|p1|p2|dorm|tenant:\\d+)$") String scope,   // null 视同 ''=全园
    @NotBlank String cfgKey,                                          // 白名单校验在 service(业务错 body.code=400)
    @Pattern(regexp = "(\\d{4}-(0[1-9]|1[0-2]))?") String acctMonth,
    BigDecimal value,
    String note
) {}
