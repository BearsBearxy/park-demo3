package com.park.demo3.dto;
// tb 科目树节点:rowKey=科目代码或合成 r<n>;parentKey 一级为 null;sortOrder 保文件行序
public record ReportAccountDTO(String rowKey, String parentKey, String code, String label, int level, int sortOrder) {}
