package com.park.demo3.dto;
import java.math.BigDecimal;
// weight 语义随 method:floor=层份额(1/0.5/NULL=层内按面积二拆);area/direct=忽略
public record AllocMemberDTO(Integer tenantId, BigDecimal weight) {}
