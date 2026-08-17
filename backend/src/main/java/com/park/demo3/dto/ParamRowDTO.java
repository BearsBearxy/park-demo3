package com.park.demo3.dto;
import java.math.BigDecimal;
import java.util.List;
// 计费参数页一行(S21-PARAM-CENTER-SPEC §5/§6,GET /api/params):站在 ym 看的一个 (键,作用域) 的生效值 + 人话解析。
// 字段与前端 api/params.ts ParamRowDTO 逐字对齐(改名两边同改)。
//   group=键主场分区 monthly|constant|rule|tenant;scope=写回 PUT 用的原始作用域;scopeLabel=人话(全园/一期/A座/…（池）/…（表）/…（户）);
//   value/mode/acctMonth/rowId=命中行(级联首中;rowId 仅当命中行就在本作用域,「改错」用);valueText=带单位/枚举字典/表名/状态句;
//   rangeText=仅 X 月 / X 起长期 / X ~ Y / 长期（初始版本）(spec §5.2);sourceChain=命中链每级 `scopeLabel:值`(首项=生效来源);
//   hasMonthRow=本作用域在 ym 有专属 month 行;editable=false 的行只披露(基数键池的分母行 / 2023 冻结价)。
public record ParamRowDTO(String key, String label, String unit, String group, String scope, String scopeLabel,
    BigDecimal value, String valueText, String mode, String acctMonth, String rangeText,
    List<String> sourceChain, String formula, String hint, boolean editable, boolean monthlyCheck,
    boolean hasMonthRow, Integer rowId, String note) {}
