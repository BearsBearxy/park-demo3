package com.park.demo3.security;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

// 打码函数本身(RBAC-SPEC §11.4)。挂点与写回守卫由 ReadPermissionIT 端到端钉。
class SensitiveMaskTest {

    /** 破坏验证:phone 改回「≥7 位一律前 3 后 4」→ 7 位、8 位两条红。 */
    @Test
    void phone_shortNumbersKeepOnlyTheLastFour() {
        assertThat(SensitiveMask.phone("13812345678")).isEqualTo("138****5678");
        assertThat(SensitiveMask.phone("0592-1234567")).isEqualTo("059****4567");
        assertThat(SensitiveMask.phone("88886666")).as("8 位座机:前 3 后 4 等于露 7 位").isEqualTo("****6666");
        assertThat(SensitiveMask.phone("1234567")).as("7 位:前 3 后 4 等于全露").isEqualTo("****");
        assertThat(SensitiveMask.phone("12345")).isEqualTo("****");
        assertThat(SensitiveMask.phone("")).isEmpty();
        assertThat(SensitiveMask.phone(null)).isNull();
    }

    @Test
    void aliases_maskEachNameAndKeepTheCount() {
        assertThat(SensitiveMask.aliases("宋测试，冯测")).isEqualTo("宋**,冯*");
        assertThat(SensitiveMask.aliases("宋测试")).isEqualTo("宋**");
        assertThat(SensitiveMask.aliases(null)).isNull();
    }
}
