package com.park.demo3.dto;
import java.time.LocalDate;
import java.util.List;
/** 终止入参:解约日期,空=今天(Asia/Shanghai)。终止日会收进 contract.end_date —— 出账侧判「这个月算不算数」
 *  只看起止日期重叠、不看 status,不收就等于终止没发生(ContractService.terminate 的注释写了来历)。
 *  vacateMeterIds:终止框里勾的表,自解约次月起写空置行(METER-TIMELINE-SPEC §3.6);空 = 不动表档案。 */
public record ContractTerminateReq(LocalDate terminatedOn, List<Integer> vacateMeterIds) {}
