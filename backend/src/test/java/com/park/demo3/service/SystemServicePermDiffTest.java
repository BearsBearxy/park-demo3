package com.park.demo3.service;

import com.park.demo3.security.Perm;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 角色权限改动记成「加了哪几项、去了哪几项」(用户 2026-10-05 拍板;原来只记「权限 N 项」)。
 * 破坏验证:permDiff 改回只给数目 → 前两条红;把「、」换成很长的分隔符 → 最后一条红。
 * 没增没减时不说「权限没变」:日志那一行的动作是「改角色」(只改名 / 备注也走这里),新建一个没勾权限的角色也谈不上「没变」。
 */
class SystemServicePermDiffTest {

    @Test
    void namesTheAddedAndRemovedPermissionsInPlainWords_inMatrixOrder() {
        assertThat(SystemService.permDiff(Set.of(Perm.ENTRY_VIEW), List.of(Perm.REPORT_VIEW, Perm.SALARY_VIEW)))
            .isEqualTo("加 2 项：工资 · 查看、报表 · 查看；去 1 项：台账与附表 · 查看；现共 2 项");
        assertThat(SystemService.permDiff(Set.of(), List.of(Perm.ENTRY_VIEW)))
            .isEqualTo("加 1 项：台账与附表 · 查看；现共 1 项");
        assertThat(SystemService.permDiff(Set.of(Perm.ENTRY_VIEW, Perm.ENTRY_EDIT), List.of(Perm.ENTRY_VIEW)))
            .isEqualTo("去 1 项：事后录入；现共 1 项");
    }

    @Test
    void unchangedSaysSo() {
        assertThat(SystemService.permDiff(Set.of(Perm.ENTRY_VIEW), List.of(Perm.ENTRY_VIEW)))
            .isEqualTo("没动权限，共 1 项");
        assertThat(SystemService.permDiff(Set.of(), List.of())).isEqualTo("没勾任何权限");
    }

    /** auth_audit_log.detail 是 varchar(255),AuditLogService 超长就截 —— 截了「去了哪几项」就丢了。最坏情况是一次全加。 */
    @Test
    void worstCaseFitsTheDetailColumn() {
        String all = SystemService.permDiff(Set.of(), Perm.ALL);
        assertThat(all).startsWith("加 " + Perm.ALL.size() + " 项：").endsWith("现共 " + Perm.ALL.size() + " 项");
        assertThat(all.length()).as("全加时 %d 字", all.length()).isLessThanOrEqualTo(255);
    }
}
