package com.park.demo3.dto;
import java.math.BigDecimal;
// 参数原值行(acctMonth ''=默认行);解析规则「月行优先回退默认」由读侧完成
public record AllocCfgDTO(Integer id, String scope, String cfgKey, BigDecimal value, String acctMonth, String note) {}
