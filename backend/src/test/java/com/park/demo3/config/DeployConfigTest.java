package com.park.demo3.config;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 部署开关三环要接上(2026-10-05 用户拍板「按你建议修改」):gen-env.sh 写进 .env → docker-compose 转给后端 → application.yml 读。
 * 任一环断了都不报错:客户园区照样起得来,只是看得到我园的模拟填充和全部历史更新;默认值改了则是我园生产变样。
 * CI 不跑 compose,只能钉文本(同 MigrationLayoutTest 钉 FLYWAY_LOCATIONS 的做法)。
 * 破坏验证:compose 删掉 PARK_TOOLS_ENABLED 那行 → 红;gen-env.sh 的 PARK_TOOLS_ENABLED=false 改成 true → 红。
 */
class DeployConfigTest {

    private static String read(String p) throws IOException { return Files.readString(Path.of(p), StandardCharsets.UTF_8); }

    @Test
    void customerSwitchesReachTheBackend_andOurDefaultsStay() throws IOException {
        assertThat(read("src/main/resources/application.yml"))
                .contains("enabled: ${PARK_TOOLS_ENABLED:true}")
                .contains("release-baseline: ${RELEASE_BASELINE:0.0.0}");
        assertThat(read("../docker-compose.yml"))
                .contains("PARK_TOOLS_ENABLED: ${PARK_TOOLS_ENABLED:-true}")
                .contains("RELEASE_BASELINE: ${RELEASE_BASELINE:-0.0.0}");
        // 按行首钉:脚本头注释里也写着 PARK_TOOLS_ENABLED=false,只比子串的话改坏那一行照样绿
        assertThat(read("../deploy/gen-env.sh"))
                .containsPattern("(?m)^PARK_TOOLS_ENABLED=false\\r?$")
                .containsPattern("(?m)^RELEASE_BASELINE=\\$\\{VER}\\r?$")
                .contains("frontend/package.json");
    }

    private static final String LEGACY = "classpath:db/migration,classpath:db/common";
    private static final String BASELINE = "classpath:db/baseline,classpath:db/common";

    // 起点链 = 新园区:.env 漏了两个开关就拒绝启动(默认值是我园的样子)。我园老链 + 默认值照常起。
    @Test
    void baselineChainRefusesOurDefaults() {
        assertThat(new DeployConfig(true, "0.0.0", LEGACY).parkTools()).isTrue();
        assertThat(new DeployConfig(false, "0.29.0", BASELINE).releaseBaseline()).isEqualTo("0.29.0");
        assertThatThrownBy(() -> new DeployConfig(true, "0.29.0", BASELINE))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("PARK_TOOLS_ENABLED=false");
        assertThatThrownBy(() -> new DeployConfig(false, "0.0.0", BASELINE))
                .isInstanceOf(IllegalStateException.class).hasMessageContaining("RELEASE_BASELINE=");
    }

    // 版本号写错格式:前端比出 NaN,更新记录永远一条不出且没有任何提示 —— 启动时就拦
    @Test
    void releaseBaselineMustBeAVersion() {
        assertThat(new DeployConfig(false, "0.10.0-beta.1", BASELINE).releaseBaseline()).isEqualTo("0.10.0-beta.1");
        for (String bad : new String[] {"v0.29.0", "0.29.0-", "0.29", ""}) {
            assertThatThrownBy(() -> new DeployConfig(false, bad, BASELINE)).as(bad)
                    .isInstanceOf(IllegalStateException.class).hasMessageContaining("RELEASE_BASELINE 要写成");
        }
    }
}
