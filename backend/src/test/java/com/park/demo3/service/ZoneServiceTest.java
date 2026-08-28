package com.park.demo3.service;

import com.park.demo3.dto.ZoneDTO;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

// 期区候选清单 = 库里已标注的 building.zone ∪ 基础清单{p1,p2,p3,dorm}。
// 基础清单必须在:三期一栋楼都还没标之前,下拉里也得有「三期」可选,否则鸡生蛋破不了。
class ZoneServiceTest {

    @Test
    void label_generatesChineseNumeral() {
        assertEquals("一期", ZoneService.label("p1"));
        assertEquals("二期", ZoneService.label("p2"));
        assertEquals("三期", ZoneService.label("p3"));
        assertEquals("十期", ZoneService.label("p10"));
        assertEquals("十一期", ZoneService.label("p11"));
        assertEquals("宿舍", ZoneService.label("dorm"));
    }

    @Test
    void label_unknownFallsBackToCode() {
        // 兜底存在的意义:前端字典下标读没有编译期护栏(tsconfig 没开 noUncheckedIndexedAccess),
        // 后端这里也别返回 null,否则导出文件名会印出 "null"
        assertEquals("px", ZoneService.label("px"));
    }

    @Test
    void candidates_unionsBaseListAndSortsDormLast() {
        var out = ZoneService.candidates(List.of("p2", "dorm"));
        assertEquals(List.of("p1", "p2", "p3", "dorm"), out.stream().map(ZoneDTO::code).toList());
    }

    @Test
    void candidates_keepsStoredZonesBeyondBaseList() {
        // 用户建了四期楼 → p4 必须出现在清单里(这正是「加期不改码」的验收点)
        var codes = ZoneService.candidates(List.of("p4")).stream().map(ZoneDTO::code).toList();
        assertEquals(List.of("p1", "p2", "p3", "p4", "dorm"), codes);
    }

    @Test
    void candidates_dedupesAndIgnoresBlanks() {
        var codes = ZoneService.candidates(java.util.Arrays.asList("p1", "p1", null, "", "  "))
                .stream().map(ZoneDTO::code).toList();
        assertEquals(List.of("p1", "p2", "p3", "dorm"), codes);
    }

    @Test
    void candidates_numericOrderNotLexical() {
        // 字典序会把 p10 排在 p2 前面 —— 必须按数字排
        var codes = ZoneService.candidates(List.of("p10")).stream().map(ZoneDTO::code).toList();
        assertEquals(List.of("p1", "p2", "p3", "p10", "dorm"), codes);
    }
}
