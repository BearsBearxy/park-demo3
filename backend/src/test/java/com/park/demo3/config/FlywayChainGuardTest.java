package com.park.demo3.config;

import org.flywaydb.core.api.Location;
import org.junit.jupiter.api.Test;

import java.util.Arrays;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 空库 + 老链 = 不许启动(2026-10-04 用户拍板:新园区的库不能灌进我园数据);我园生产库(有迁移历史)照常。 */
class FlywayChainGuardTest {
    private static Location[] locs(String... s) {
        return Arrays.stream(s).map(Location::new).toArray(Location[]::new);
    }
    private static final Location[] LEGACY = locs("classpath:db/migration", "classpath:db/common");
    private static final Location[] BASELINE = locs("classpath:db/baseline", "classpath:db/common");

    @Test
    void emptyDbOnLegacyChainRefusesToStart() {
        assertThatThrownBy(() -> FlywayChainGuard.check(LEGACY, 0, false))
                .hasMessageContaining("FLYWAY_LOCATIONS=classpath:db/baseline,classpath:db/common");
    }

    @Test
    void ourProductionAndExplicitOverrideStillStart() {
        assertThatCode(() -> FlywayChainGuard.check(LEGACY, 134, false)).doesNotThrowAnyException();  // 我园生产:有历史
        assertThatCode(() -> FlywayChainGuard.check(LEGACY, 0, true)).doesNotThrowAnyException();    // dev/测试、显式重建
    }

    @Test
    void newParkOnBaselineChainStarts() {
        assertThatCode(() -> FlywayChainGuard.check(BASELINE, 0, false)).doesNotThrowAnyException();
    }

    @Test
    void onlyTheTwoChainsAreAccepted() {
        assertThatThrownBy(() -> FlywayChainGuard.check(locs("classpath:db/baseline"), 0, false))
                .hasMessageContaining("只能是");
        assertThatThrownBy(() -> FlywayChainGuard.check(locs("classpath:db/migration"), 134, true))
                .hasMessageContaining("只能是");
    }
}
