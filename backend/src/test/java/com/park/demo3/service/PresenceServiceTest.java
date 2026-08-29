package com.park.demo3.service;

import com.park.demo3.dto.PresenceDtos.PingReq;
import org.junit.jupiter.api.Test;

import java.util.Arrays;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

/** 垫层与清洗(2026-08-30 复查):旧页签的锁不许静默停续,坏输入不许放倒整拍。 */
class PresenceServiceTest {

    private static PingReq req(List<String> editScopes, String mode, String scope) {
        return new PingReq("sid", scope, "label", null, editScopes, mode);
    }

    @Test
    void oldTabsStillSendingModeGetTheirLockRenewed() {
        // 发布前已打开的 SPA 还在发 {mode:'edit', scope},不发 editScopes ——
        // 不认的话它们的锁 3 分钟后被人直接拿走,双方零提示。
        assertThat(PresenceService.resolveEditScopes(req(null, "edit", "ledger:3:2025-06")))
            .containsExactly("ledger:3:2025-06");
    }

    @Test
    void newClientsAreNotAffectedByTheShim() {
        assertThat(PresenceService.resolveEditScopes(req(List.of("a:1"), "edit", "b:2")))
            .as("带了 editScopes 就只认它,mode/scope 不再有发言权")
            .containsExactly("a:1");
        assertThat(PresenceService.resolveEditScopes(req(List.of(), "view", "b:2"))).isEmpty();
        assertThat(PresenceService.resolveEditScopes(req(null, null, null))).isEmpty();
    }

    @Test
    void nullElementsAreFilteredNot500() {
        // List.copyOf 对 [null] 抛 NPE → 整拍 500:在场没登记、别的锁也全没续。
        assertThat(PresenceService.resolveEditScopes(req(Arrays.asList("a:1", null), "view", null)))
            .containsExactly("a:1");
    }

    @Test
    void aHostileClientIsCappedAt16Scopes() {
        List<String> many = java.util.stream.IntStream.range(0, 40)
            .mapToObj(i -> "s:" + i).toList();
        assertThat(PresenceService.resolveEditScopes(req(many, null, null))).hasSize(16);
    }
}
