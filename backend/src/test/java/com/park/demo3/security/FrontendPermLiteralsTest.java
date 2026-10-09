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
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 前端源码里写死的权限点字面量,每个都得是 Perm 认得的新键(RBAC-SPEC §15.10)。
 * 前端按屏改键分给了好几个人各改各的,键名打错一个字(`bill-notice:issue`)前端不会报错,
 * 只会让那个按钮永远置灰、或者以为有权、点下去 403 —— 由这条当场拦。
 * 扫 frontend/src 的非测试文件,只认这几种写法里的字面量:can('…')、hasOwn('…')、perm="…"、useEditMode([…])、
 * lackText([…])、openEditor(…, […])、module: […]、asking.value = […];模板字符串(`${scr}:edit`)不管。
 */
class FrontendPermLiteralsTest {

    private static final Path SRC = Path.of("../frontend/src");
    private static final List<Pattern> SINGLE = List.of(
        Pattern.compile("\\bcan\\(\\s*['\"]([^'\"$]+)['\"]\\s*\\)"),
        Pattern.compile("\\bhasOwn\\(\\s*['\"]([^'\"$]+)['\"]"),
        Pattern.compile("(?<![:\\w-])perm=\"([^\"$]+)\""));
    private static final List<Pattern> LISTS = List.of(
        Pattern.compile("\\buseEditMode\\(\\s*\\[([^\\]]*)\\]"),
        Pattern.compile("\\blackText\\(\\s*\\[([^\\]]*)\\]"),
        Pattern.compile("\\bopenEditor\\([^,\\[\\)]*,\\s*\\[([^\\]]*)\\]"),
        Pattern.compile("\\bmodule:\\s*\\[([^\\]]*)\\]"),
        Pattern.compile("\\basking\\.value\\s*=\\s*\\[([^\\]]*)\\]"));
    private static final Pattern QUOTED = Pattern.compile("['\"]([^'\"`$]+)['\"]");
    private static final Pattern KEY_SHAPE = Pattern.compile("[a-z][a-z0-9-]*:[a-z-]+");

    private static boolean isTestFile(Path p) {
        String s = p.toString().replace('\\', '/');
        return s.contains("/__tests__/") || s.contains("/__fixtures__/") || s.contains("/test-utils/")
            || s.contains(".spec.") || s.contains(".test.");
    }

    @Test
    void everyHardCodedPermKeyExists() throws IOException {
        List<Path> files;
        try (Stream<Path> s = Files.walk(SRC)) {
            files = s.filter(p -> p.toString().endsWith(".ts") || p.toString().endsWith(".vue"))
                .filter(p -> !isTestFile(p)).sorted().toList();
        }
        assertThat(files).as("frontend/src 没扫到文件 —— 路径不对,这条等于没跑").hasSizeGreaterThan(100);
        List<String> bad = new ArrayList<>();
        int seen = 0;
        for (Path f : files) {
            String src = Files.readString(f, StandardCharsets.UTF_8);
            List<String> found = new ArrayList<>();
            for (Pattern p : SINGLE) for (Matcher m = p.matcher(src); m.find(); ) found.add(m.group(1));
            for (Pattern p : LISTS)
                for (Matcher m = p.matcher(src); m.find(); )
                    for (Matcher q = QUOTED.matcher(m.group(1)); q.find(); ) found.add(q.group(1));
            for (String k : found) {
                if (!KEY_SHAPE.matcher(k).matches()) continue;   // 注释里的「can('<屏>:version')」之类不是键
                seen++;
                if (!Perm.exists(k)) bad.add(SRC.relativize(f).toString().replace('\\', '/') + " → " + k);
            }
        }
        assertThat(seen).as("一个权限字面量都没抽到 —— 正则失效了").isGreaterThan(50);
        assertThat(bad).as("前端写死了 Perm 不认得的权限点(旧键或拼错)").isEmpty();
    }
}
