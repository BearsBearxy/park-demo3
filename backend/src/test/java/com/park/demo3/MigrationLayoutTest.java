package com.park.demo3;

import org.junit.jupiter.api.Test;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.CRC32;

import static com.park.demo3.BaselineSqlGenerator.CUT;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 迁移目录的摆法(2026-10-04 用户拍板:我园生产照旧跑老链,新园区从起点脚本空库起步,以后的迁移两条链共用)。
 * 钉三件事:老链冻结在 CUT、起点目录只有切版那一份、新迁移只能进 db/common 且版本号 > CUT;
 * 外加生产默认值仍是老链 —— 默认值一旦被改成起点链,我园生产启动就会因 V137 校验和对不上而起不来;
 * 已发出去的脚本内容一个字节都不许变(钉 Flyway 校验和);新服务器生成的 .env 走起点链。
 */
class MigrationLayoutTest {
    private static final Pattern VERSIONED = Pattern.compile("^V(\\d+)__.+\\.(sql|java)$");
    private static final String LEGACY_DEFAULT = "classpath:db/migration,classpath:db/common";

    /**
     * 目录下(含子目录)除 README.md 外的文件,相对路径;目录不存在 = 空。
     * 要递归:Flyway 的 classpath 位置连子目录、子包一起扫,放进 db/migration/fixes/ 的脚本老链照样会跑。
     */
    private static List<String> files(String dir) throws IOException {
        Path p = Path.of(dir);
        if (!Files.isDirectory(p)) return List.of();
        try (Stream<Path> s = Files.walk(p)) {
            return s.filter(Files::isRegularFile).map(f -> p.relativize(f).toString().replace('\\', '/'))
                    .filter(n -> !n.equals("README.md")).sorted().toList();
        }
    }

    /** 不是 V{n}__ 版本化迁移的文件(R__ 可重复迁移、拼错的名字)记成 -1,一律不放过。 */
    private static int version(String file) {
        Matcher m = VERSIONED.matcher(file.substring(file.lastIndexOf('/') + 1));
        return m.matches() ? Integer.parseInt(m.group(1)) : -1;
    }

    @Test
    void legacyChainFrozenAtCut() throws IOException {
        List<String> bad = new ArrayList<>();
        int max = 0;
        for (String dir : List.of("src/main/resources/db/migration", "src/main/java/db/migration")) {
            for (String f : files(dir)) {
                int v = version(f);
                if (v < 0 || v > CUT) bad.add(dir + "/" + f);
                max = Math.max(max, v);
            }
        }
        assertThat(bad).as("老链已冻结在 V" + CUT + ",新迁移写进 db/common").isEmpty();
        assertThat(max).isEqualTo(CUT);
    }

    @Test
    void baselineFolderHoldsOnlyTheCutScript() throws IOException {
        assertThat(files("src/main/resources/db/baseline")).containsExactly("V" + CUT + "__baseline.sql");
        assertThat(files("src/main/java/db/baseline")).isEmpty();
    }

    @Test
    void commonMigrationsComeAfterCut() throws IOException {
        List<String> bad = new ArrayList<>();
        for (String dir : List.of("src/main/resources/db/common", "src/main/java/db/common")) {
            for (String f : files(dir)) {
                if (version(f) <= CUT) bad.add(dir + "/" + f);
            }
        }
        assertThat(bad).as("db/common 两条链共用,版本号必须 > " + CUT).isEmpty();
    }

    @Test
    void productionDefaultStaysOnLegacyChain() throws IOException {
        assertThat(Files.readString(Path.of("src/main/resources/application.yml"), StandardCharsets.UTF_8))
                .contains("locations: ${FLYWAY_LOCATIONS:" + LEGACY_DEFAULT + "}");
        assertThat(Files.readString(Path.of("../docker-compose.yml"), StandardCharsets.UTF_8))
                .contains("FLYWAY_LOCATIONS: ${FLYWAY_LOCATIONS:-" + LEGACY_DEFAULT + "}");
        assertThat(BaselineSqlGenerator.LEGACY_CHAIN).containsExactly(LEGACY_DEFAULT.split(","));
    }

    /**
     * 新服务器的 .env 由 gen-env.sh 生成,生成出来就走起点链:默认值是老链(我园生产零操作),
     * 新园区漏写 FLYWAY_LOCATIONS 第一次 up 就会灌进我园数据(2026-10-04 复查 LEAK-L1)。
     * 只读账号也不再生成 —— 建在客户库里就是一个客户不知道、口令在我们手里的账号。
     */
    @Test
    void newServerEnvStartsOnBaselineChain() throws IOException {
        String genEnv = Files.readString(Path.of("../deploy/gen-env.sh"), StandardCharsets.UTF_8);
        assertThat(genEnv).contains("FLYWAY_LOCATIONS=" + String.join(",", BaselineSqlGenerator.BASELINE_CHAIN))
                .doesNotContain("VIEWER_PASSWORD=");
    }

    /**
     * 已发出去的脚本一个字节都不许变:老链 V1–V137 已跑在我园生产,起点脚本将跑在各园区库上,db/common 两边都跑。
     * CI 每次都是新库,改了也照样绿 —— 等合并部署后各库启动时报 checksum mismatch 才知道,所以在这里钉住。
     * 算法与 Flyway 相同(逐行 CRC32,去换行,首行去 BOM),不受 CRLF/LF 影响;清单与 flyway_schema_history 对过(133 条全等)。
     * 新加 db/common 迁移要在 baseline/migration-checksums.txt 补一行;已有的行不许改。
     */
    @Test
    void shippedScriptsKeepTheirChecksums() throws IOException {
        Map<String, Integer> actual = new TreeMap<>();
        for (String dir : List.of("db/migration", "db/baseline", "db/common")) {
            for (String f : files("src/main/resources/" + dir)) {
                if (f.endsWith(".sql")) actual.put(dir + "/" + f, flywayChecksum(Path.of("src/main/resources", dir, f)));
            }
        }
        Map<String, Integer> pinned = new TreeMap<>();
        try (InputStream in = MigrationLayoutTest.class.getResourceAsStream("/baseline/migration-checksums.txt")) {
            new String(in.readAllBytes(), StandardCharsets.UTF_8).lines().filter(l -> !l.isBlank() && !l.startsWith("#"))
                    .forEach(l -> pinned.put(l.split(" ")[0], Integer.parseInt(l.split(" ")[1])));
        }
        assertThat(actual).as("已发出去的迁移脚本被改了,或新脚本没在 migration-checksums.txt 补一行").isEqualTo(pinned);
    }

    /** Flyway 的 SQL 校验和(ChecksumCalculator 同法):逐行 CRC32,行尾换行不算,首行去 BOM。 */
    static int flywayChecksum(Path f) throws IOException {
        CRC32 crc = new CRC32();
        try (BufferedReader r = Files.newBufferedReader(f, StandardCharsets.UTF_8)) {
            String line = r.readLine();
            if (line != null && line.startsWith("\uFEFF")) line = line.substring(1);
            for (; line != null; line = r.readLine()) crc.update(line.getBytes(StandardCharsets.UTF_8));
        }
        return (int) crc.getValue();
    }
}
