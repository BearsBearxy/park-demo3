/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
import java.util.List;
// 年度派生指标序列一元素(ENERGY-ANALYSIS §4):month 1-12 × 7 卡;口径与单月 /metrics 全等(同一计算体)。
public record ElecMetricsMonthDTO(int month, List<ElecMetricDTO> metrics) {}
