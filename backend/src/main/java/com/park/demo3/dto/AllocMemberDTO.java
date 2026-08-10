package com.park.demo3.dto;
import java.math.BigDecimal;
// weight 语义随 method:floor=层份额(1/0.5/NULL=层内按面积二拆);area/direct=忽略
// acctMonth 读侧回带原值(''=默认长期行,'YYYY-MM'=版本组行,S14 消除双行平铺歧义);
// 写侧忽略(写入月统一由 AllocRuleReq.memberMonth 指定)
public record AllocMemberDTO(Integer tenantId, BigDecimal weight, String acctMonth) {}
