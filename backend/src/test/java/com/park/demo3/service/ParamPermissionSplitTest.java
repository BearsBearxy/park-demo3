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

    /**
     * 系数簿白名单(RBAC-SPEC §15.6):只有「催缴单 · 系数簿」的人 PUT /api/params 只能写这 12 个键的户级作用域。
     * 恰好 12 个、都能设到户、都不是月度键;按栋的损耗基数形态与引用型的园区损耗表不在里面(前端系数簿特意排除了它们)。
     * 破坏验证:COEF_BOOK 加上 loss_base_park_meter → 第一条红。
     */
    @Test
    void coefBookWhitelistIsTheTwelveTenantPriceKeys() {
        List<String> coef = ParamRegistry.all().stream().filter(Def::coefBook).map(Def::key).sorted().toList();
        assertThat(coef).containsExactlyInAnyOrder("mgmt_fee", "capacity_fee", "water", "elec_package",
            "share_elec_fixed", "share_water_fixed", "green_rate", "lamp_rate", "fire_amount_fixed", "loss_base_form",
            "mgmt_fee_commercial", "water_pipe");
        assertThat(ParamRegistry.all().stream().filter(Def::coefBook)).allSatisfy(d -> {
            assertThat(d.scopes()).as(d.key()).contains(ParamRegistry.ScopeKind.TENANT);
            assertThat(d.monthlyCheck()).as(d.key()).isFalse();
        });
        assertThat(ParamRegistry.get("loss_base_form_b3").coefBook()).as("按栋的损耗基数形态").isFalse();
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
