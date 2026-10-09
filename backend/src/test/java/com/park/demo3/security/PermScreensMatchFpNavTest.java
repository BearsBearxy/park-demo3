package com.park.demo3.security;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 后端的屏清单与前端导航表逐条一致(RBAC-SPEC §15.10,K8):权限点按屏命名,前端按 fpNav 的层 / 分组 / 屏挂树,
 * 两边多一屏少一屏、改了名、换了层,角色屏上就有一行挂不上去(落「其他」)或一屏没有权限可勾。
 * 读 ../frontend/src/nav/fpNav.ts 的源码,抽出每个 { value, label } 和它所在的层,与 Perm.SCREENS 逐条比(个数、顺序、value、label、层)。
 * 破坏验证:Perm.SCREENS 删掉一屏或把「月度台账」改个字 → 红;fpNav 加一屏 → 红。
 */
class PermScreensMatchFpNavTest {

    private static final Path FP_NAV = Path.of("../frontend/src/nav/fpNav.ts");
    private static final Pattern LAYER = Pattern.compile("\\{\\s*id:\\s*'([a-z-]+)',\\s*label:");
    private static final Pattern ITEM = Pattern.compile("\\{\\s*value:\\s*'([^']+)',\\s*label:\\s*'([^']+)'");

    @Test
    void screensMatchFrontendNav() throws IOException {
        String src = Files.readString(FP_NAV, StandardCharsets.UTF_8);
        int navStart = src.indexOf("FP_NAV");
        assertThat(navStart).as("fpNav.ts 里找不到 FP_NAV").isPositive();
        src = src.substring(navStart);

        List<Perm.Screen> fromNav = new ArrayList<>();
        Matcher layer = LAYER.matcher(src), item = ITEM.matcher(src);
        List<int[]> layerAt = new ArrayList<>();
        List<String> layerIds = new ArrayList<>();
        while (layer.find()) { layerAt.add(new int[]{layer.start()}); layerIds.add(layer.group(1)); }
        while (item.find()) {
            String id = null;
            for (int i = 0; i < layerAt.size(); i++) if (layerAt.get(i)[0] < item.start()) id = layerIds.get(i);
            fromNav.add(new Perm.Screen(item.group(1), item.group(2), id));
        }
        assertThat(layerIds).as("四层").containsExactly("data", "reports", "analysis", "system");
        assertThat(fromNav).as("fpNav 解析出的屏太少 —— 正则失效了,这条等于没跑").hasSizeGreaterThan(40);
        assertThat(Perm.SCREENS).containsExactlyElementsOf(fromNav);
    }
}
