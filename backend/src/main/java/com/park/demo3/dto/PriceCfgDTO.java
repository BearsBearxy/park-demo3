package com.park.demo3.dto;
import java.math.BigDecimal;
import java.time.LocalDateTime;
// 价目版本行(acctMonth=版本生效起点,''=初始版本;mode from=前滚/month=仅该月,S21);版本链解析归读侧(前端 resolvePrice/后端 resolve)。
// updatedAt=该版本变更时间戳;tenantName 仅 tenant: scope 非空,租户已删显"已删租户#id"。
public record PriceCfgDTO(Integer id, String scope, String cfgKey, String acctMonth, String mode,
                          BigDecimal value, String note, LocalDateTime updatedAt, String tenantName) {}
