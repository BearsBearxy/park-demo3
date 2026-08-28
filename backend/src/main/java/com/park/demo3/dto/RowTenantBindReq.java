package com.park.demo3.dto;
/** 行级绑定/换绑/解绑(台账行 / 附表10 行共用):tenantId=null 即解绑。
 *  addAlias:把本行账面名记进该租户的别名,今后导入自动认(2026-08-27 拍板)。
 *  **默认不记** —— 自动记会把源册里的错别字固化成系统认可的写法,从此没人发现它错了;
 *  要记必须由人显式勾一下,那一下就是在分辨「老板名/曾用名」与「打错了」。 */
public record RowTenantBindReq(Integer tenantId, Boolean addAlias) {}
