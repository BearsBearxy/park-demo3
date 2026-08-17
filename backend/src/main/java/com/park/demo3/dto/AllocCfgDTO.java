package com.park.demo3.dto;
import java.math.BigDecimal;
// 参数原值行(acctMonth ''=默认行;mode from=自该月起长期/month=仅该月,S21);解析规则「月行优先回退默认」由读侧完成
public record AllocCfgDTO(Integer id, String scope, String cfgKey, BigDecimal value, String acctMonth, String mode, String note) {}
