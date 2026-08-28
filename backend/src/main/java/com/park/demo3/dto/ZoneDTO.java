package com.park.demo3.dto;

/** 期区候选一项:code=p1/p2/p3…/dorm;name=显示名;sortNo=展示序(dorm 恒最后)。 */
public record ZoneDTO(String code, String name, int sortNo) {}
