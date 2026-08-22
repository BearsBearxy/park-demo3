package com.park.demo3.service;

import com.park.demo3.service.ParamRegistry.Def;
import com.park.demo3.service.ParamRegistry.Group;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 计费参数的权限分档必须与界面分区严格对齐。
 *
 * 后端 {@code ParamService.requireWritePerm} 按 {@code monthlyCheck} 判 月度录入 / 计费口径;
 * 前端计费参数页按 {@code group} 分 ① 区 / ②③④ 区。**两个判据必须是同一件事** ——
 * 不对齐会产生两种都很难发现的错:
 *
 *   界面有 [修改] 按钮 → 点下去 403      （用户以为系统坏了）
 *   界面藏了按钮       → API 却放行      （权限形同虚设,前端一改就漏）
 *
 * 后者 2026-08-22 真的发生过:PUT /api/params 在 URL 层收「policy 或 monthly 任一」,
 * 而按 cfg_key 的细分只写在注释里没实现 —— 只有 param-monthly:edit 的财务专员
 * 直接调 API 就能改任何一个计费口径键。
 */
class ParamPermissionSplitTest {

    @Test
    void monthlyGroupAndMonthlyCheckAreTheSameSet() {
        List<String> byGroup = ParamRegistry.all().stream()
            .filter(d -> d.group() == Group.MONTHLY).map(Def::key).sorted().toList();
        List<String> byFlag = ParamRegistry.all().stream()
            .filter(Def::monthlyCheck).map(Def::key).sorted().toList();

        assertThat(byFlag)
            .as("前端按 group 分区、后端按 monthlyCheck 判权限 —— 两者必须一字不差")
            .isEqualTo(byGroup);
        assertThat(byGroup).as("① 区键集非空,否则这条断言是空跑").isNotEmpty();
    }

    @Test
    void everyKeyFallsOnExactlyOneSideOfTheLine() {
        // 没有第三档:不是月度录入就是计费口径。新增 Group 时这条会红,提醒去补权限判定。
        assertThat(ParamRegistry.all()).allSatisfy(d ->
            assertThat(d.monthlyCheck() ? Group.MONTHLY : d.group())
                .as("键 %s", d.key())
                .isIn(Group.MONTHLY, Group.CONSTANT, Group.RULE, Group.TENANT));
    }
}
