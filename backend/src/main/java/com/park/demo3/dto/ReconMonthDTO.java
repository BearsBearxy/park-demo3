package com.park.demo3.dto;
import java.util.List;
// 整月对照(无数据月 entities 空数组,不 404)
public record ReconMonthDTO(int year, int month, List<ReconEntityDTO> entities) {}
