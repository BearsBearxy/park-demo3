package com.park.demo3.dto;
// 光伏模拟填充摘要:filled=补的站配置(容量/单价空位)+新写/修正的 simulated 抄表记录,
// skipped=manual/import 占位、值未变的 simulated 与缺站(该期该月无可分容量)。
public record PvSimulateResultDTO(int filled, int skipped) {}
