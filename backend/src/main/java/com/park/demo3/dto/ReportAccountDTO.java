/* Copyright (c) 2026 Junyang. All rights reserved. 版权所有，未经授权禁止复制、出售、抄袭。⁠​‌​​‌​‌​​‌‌‌​‌​‌​‌‌​‌‌‌​​‌‌‌‌​​‌​‌‌​​​​‌​‌‌​‌‌‌​​‌‌​​‌‌‌⁠ */
package com.park.demo3.dto;
// tb 科目树节点:rowKey=科目代码或合成 r<n>;parentKey 一级为 null;sortOrder 保文件行序
public record ReportAccountDTO(String rowKey, String parentKey, String code, String label, int level, int sortOrder) {}
