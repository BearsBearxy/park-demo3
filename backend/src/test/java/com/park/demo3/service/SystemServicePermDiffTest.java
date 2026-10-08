package com.park.demo3.service;

import com.park.demo3.security.Perm;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 角色权限改动记成「加了哪几屏的哪几项、去了哪几项」(用户 2026-10-05 拍板;v4 按屏合并,RBAC-SPEC §15.6)。
 * 破坏验证:byScreen 不合并、逐项写人话名 → 第一条红;截断循环去掉 → 最后一条红。
 * 没增没减时不说「权限没变」:日志那一行的动作是「改角色」,新建一个没勾权限的角色也谈不上「没变」。
 */
class SystemServicePermDiffTest {

    @Test
    void groupsByScreenInTreeOrder() {
        assertThat(SystemService.permDiff(Set.of("bill-notices:view"),
                List.of("ledger:view", "ledger:edit", "bill-notices:view", "bill-notices:issue", Perm.REVIEW_APPROVE)))
            .isEqualTo("加：催缴单（签发）、月度台账（查看、编辑）、审核；现共 5 项");
        assertThat(SystemService.permDiff(Set.of("ledger:view", "ledger:edit", "salary:view"), List.of("ledger:view")))
            .isEqualTo("去：月度台账（编辑）、附表12 工资明细（查看）；现共 1 项");
        assertThat(SystemService.permDiff(Set.of("ledger:view"), List.of("cockpit:view")))
            .isEqualTo("加：经营驾驶舱（查看）；去：月度台账（查看）；现共 1 项");
    }

    @Test
    void unchangedSaysSo() {
        assertThat(SystemService.permDiff(Set.of("ledger:view"), List.of("ledger:view")))
            .isEqualTo("没动权限，共 1 项");
        assertThat(SystemService.permDiff(Set.of(), List.of())).isEqualTo("没勾任何权限");
    }

    /** auth_audit_log.detail 是 varchar(255),AuditLogService 超长就截 —— 截了「去了哪几项」就丢了。最坏情况是一次全加、全去。 */
    @Test
    void worstCaseFitsTheDetailColumn() {
        String all = SystemService.permDiff(Set.of(), Perm.ALL);
        assertThat(all).startsWith("加：本月出账（查看）、楼栋管理（查看、编辑）").contains("等 54 屏")
            .endsWith("现共 " + Perm.ALL.size() + " 项");
        assertThat(all.length()).as("全加时 %d 字", all.length()).isLessThanOrEqualTo(255);
        String swap = SystemService.permDiff(Perm.ALL.subList(0, 54), Perm.ALL.subList(54, Perm.ALL.size()));
        assertThat(swap).contains("加：").contains("；去：").endsWith("现共 " + (Perm.ALL.size() - 54) + " 项");
        assertThat(swap.length()).as("一半换一半时 %d 字", swap.length()).isLessThanOrEqualTo(255);
    }
}
