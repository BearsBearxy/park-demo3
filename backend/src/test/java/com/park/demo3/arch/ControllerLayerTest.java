package com.park.demo3.arch;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;

import static org.junit.jupiter.api.Assertions.assertTrue;

// 分层门禁:controller 不许碰 mapper(不起 Spring,只静态扫 controller 包源码)。
//
// 分层是 controller → service → mapper(docs/design/SCAFFOLD.md §2.1)。controller 直接拿 mapper
// 查库,查询就绕开了 service 层的审核守卫(ReviewGuard)与事务,也绕开了 ReviewGuardCoverageTest ——
// 那条覆盖率门只扫 service。2026-09-17 实测 40 个 controller 零命中,在这里锁死在 0。
//
// 连全限定名一起拦:本仓 controller 有写全限定名的习惯(SystemController 的 DateTimeFormat),
// 只查 import 会留一条 `com.park.demo3.mapper.XxxMapper m` 字段写法的缝。
class ControllerLayerTest {

    static final String CONTROLLER_DIR = "src/main/java/com/park/demo3/controller";
    static final String NEEDLE = "com.park.demo3.mapper.";

    @Test
    void controllerDoesNotTouchMapper() throws IOException {
        List<Path> files;
        try (Stream<Path> s = Files.walk(Path.of(CONTROLLER_DIR))) {
            files = s.filter(p -> p.toString().endsWith(".java")).toList();
        }
        // 扫描面不为空:包改名/测试工作目录变了会让本门禁静默失效
        assertTrue(files.size() >= 30, "只扫到 " + files.size() + " 个文件," + CONTROLLER_DIR + " 路径还对吗?本门禁已失效");

        List<String> hits = new ArrayList<>();
        for (Path p : files) {
            List<String> lines = Files.readAllLines(p);
            for (int i = 0; i < lines.size(); i++) {
                String t = lines.get(i).strip();
                if (t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")) continue;
                if (t.replace(" ", "").contains(NEEDLE)) hits.add(p.getFileName() + ":" + (i + 1) + "  " + t);
            }
        }
        assertTrue(hits.isEmpty(), "controller 直接引用了 mapper:\n  " + String.join("\n  ", hits)
            + "\n把查询挪进 service,controller 只调 service(docs/design/SCAFFOLD.md §2.1)。");
    }
}
