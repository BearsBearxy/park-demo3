package com.park.demo3.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.park.demo3.dto.MeterImportRequest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfSystemProperty;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 公共电对账工具的引擎一端(scripts/pool-recon/recon.py 调用),**不是测试**:
 * 类名不以 Test/IT 结尾 → surefire 默认不跑;没有 -Drecon.ym 也不跑。
 *
 * 连的是临时库 park_demo3_recon(recon.py mkdb 从开发库 mysqldump 灌出),Flyway 关闭,不改开发库。
 * 步骤:①按 -Drecon.import 列出的 JSON({rows,fileName},前端 parseMeterWorkbook 的产物)逐个走
 * MeterService.importRows(与导入弹窗同一个后端入口),结果原样存档;②AllocService.generate(ym);
 * ③导出 pools(ym) / loss(ym) / poolContributions(ym) 到 {recon.out}/engine.json。
 * 放在 service 包:Contribution 是包级可见的 record。
 *
 * 运行(PowerShell,带点的参数要加引号):
 *   & backend\mvnw.cmd -f backend\pom.xml test "-Dtest=PoolReconRunner" "-Drecon.ym=2024-02" "-Drecon.out=C:\...\out\2024-02"
 */
@SpringBootTest(properties = {
    "spring.datasource.url=jdbc:mysql://127.0.0.1:13306/${recon.db:park_demo3_recon}?useUnicode=true&characterEncoding=utf8&serverTimezone=Asia/Shanghai&allowPublicKeyRetrieval=true&useSSL=false&rewriteBatchedStatements=true",
    "spring.datasource.username=root",
    "spring.datasource.password=root",
    "spring.flyway.enabled=false",
})
@EnabledIfSystemProperty(named = "recon.ym", matches = "\\d{4}-\\d{2}")
class PoolReconRunner {

    @Autowired AllocService alloc;
    @Autowired MeterService meters;
    @Autowired JdbcTemplate jdbc;
    @Autowired ObjectMapper json;

    @Test
    void run() throws Exception {
        String db = jdbc.queryForObject("SELECT DATABASE()", String.class);
        // 硬闸:只许写临时库。开发库 park_demo3 只读(导入与 generate 都会写库)。
        if (db == null || db.equals("park_demo3") || !db.contains("recon"))
            throw new IllegalStateException("拒绝在非临时库上运行: " + db);
        String ym = System.getProperty("recon.ym");
        Path out = Path.of(System.getProperty("recon.out"));
        Files.createDirectories(out);

        String imports = System.getProperty("recon.import", "").trim();
        List<Map<String, Object>> importLog = new ArrayList<>();
        if (!imports.isEmpty()) {
            for (String f : imports.split(";")) {
                if (f.isBlank()) continue;
                Path p = Path.of(f.trim());
                JsonNode root = json.readTree(p.toFile());
                MeterImportRequest req = json.treeToValue(root, MeterImportRequest.class);
                Object res = meters.importRows(req);
                Map<String, Object> e = new LinkedHashMap<>();
                e.put("file", p.getFileName().toString());
                e.put("rows", req.rows().size());
                e.put("result", res);
                importLog.add(e);
            }
            json.writerWithDefaultPrettyPrinter().writeValue(out.resolve("import-result.json").toFile(), importLog);
        }

        Map<String, Object> doc = new LinkedHashMap<>();
        doc.put("ym", ym);
        doc.put("db", db);
        doc.put("generate", alloc.generate(ym));
        doc.put("pools", alloc.pools(ym));
        doc.put("loss", alloc.loss(ym));
        List<Map<String, Object>> contribs = new ArrayList<>();
        for (AllocService.Contribution c : alloc.poolContributions(ym)) {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("tenantId", c.tenantId());
            m.put("feeKey", c.feeKey());
            m.put("ruleId", c.ruleId());
            m.put("ruleName", c.ruleName());
            m.put("qty", c.qty());
            m.put("amount", c.amount());
            m.put("rate", c.rate());
            m.put("price", c.price());
            m.put("base", c.base());
            m.put("lossBuildings", c.lossBuildings());
            m.put("note", c.note());
            contribs.add(m);
        }
        doc.put("contributions", contribs);
        json.writeValue(out.resolve("engine.json").toFile(), doc);
    }
}
