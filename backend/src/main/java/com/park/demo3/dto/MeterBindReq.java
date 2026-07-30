package com.park.demo3.dto;
// PUT /api/meters/{id}/bind:写 override;contractId=null 解绑(S2-BIND-SPEC §3)
public record MeterBindReq(Integer contractId) {}
