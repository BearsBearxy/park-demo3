package com.park.demo3.dto;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import java.math.BigDecimal;
// PUT /api/params 一行(spec §6):scope ''=全园(故不能 @NotBlank);acctMonth ''=初始版本;mode 缺省=注册表默认方式;
// value=null 删该版本行(被已生成月取用过的行 400);correction=true 改错:acctMonth 此时是「站在哪个月看」(页面账期),
// 站在该月解析命中行并原地覆盖、不新建版本(命中行不在本作用域 → 400「该值来自上级作用域，请新建版本」)。
// 返回行站在 ?ym=(缺省 acctMonth)。
public record ParamPutReq(
    @NotBlank String key,
    @Pattern(regexp = "^(|p\\d+|dorm|(building|meter|rule|tenant):\\d+)$") String scope,
    @Pattern(regexp = "(\\d{4}-(0[1-9]|1[0-2]))?") String acctMonth,
    @Pattern(regexp = "(from|month)?") String mode,
    BigDecimal value,
    String note,
    Boolean correction
) {}
