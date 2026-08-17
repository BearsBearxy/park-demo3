package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
// upsert 单行;acctMonth 空=默认行;value=null 删行回退默认(同 elec_price_cfg 语义)
// mode(S21 可选):from=自 acctMonth 起长期 / month=仅该月;缺省 acctMonth 非空⇒month(旧「仅当月」语义)、空⇒from
public record AllocCfgReq(
    @NotBlank String scope,        // p1/p2 或 building:{id}
    @NotBlank String cfgKey,
    @Pattern(regexp = "(\\d{4}-(0[1-9]|1[0-2]))?") String acctMonth,
    BigDecimal value,
    String note,
    @Pattern(regexp = "(from|month)?") String mode
) {}
