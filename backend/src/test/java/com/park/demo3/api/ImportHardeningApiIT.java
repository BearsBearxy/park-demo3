package com.park.demo3.api;

import com.park.demo3.AbstractMysqlIT;
import com.jayway.jsonpath.JsonPath;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

// 导入 500 加固:两类畸形导入原落到 fallback 裸 500,现应为可解释的 400。
//   ① path/query 参数类型转换失败(id="abc")→ MethodArgumentTypeMismatchException → 400
//   ② leave_days SMALLINT 溢出(99999)→ MysqlDataTruncation → DataIntegrityViolationException → 400
// ③ DuplicateKey→409 的回归由既有 ApiIT 覆盖(如 UnitApiIT/OfficeImportApiIT 的重复键路径),
//   且 DuplicateKeyException 是 DataIntegrityViolationException 子类,Spring 选最具体 handler 仍走 409,
//   本 IT 不重复构造(salary_record 无唯一键,构造成本高)。
@AutoConfigureMockMvc
class ImportHardeningApiIT extends AbstractMysqlIT {

    @Autowired MockMvc mvc;
    private String token;

    @BeforeEach
    void login() throws Exception {
        String body = mvc.perform(post("/api/auth/login")
                .contentType("application/json")
                .content("{\"username\":\"admin\",\"password\":\"admin123\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        token = JsonPath.read(body, "$.data.token");
    }

    private String auth() { return "Bearer " + token; }

    // ── ① 非数字 path id(前端 undefined 拼进 URL)→ 400 且 body.code=400(修前 500) ──
    @Test
    void ledgerImport_nonNumericPathId_returns400() throws Exception {
        mvc.perform(post("/api/ledger/companies/abc/import")
                .param("year", "2025").param("month", "1")
                .header("Authorization", auth())
                .contentType("application/json").content("{\"rows\":[]}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }

    // ── ② salary 导入一行 leaveDays 超 SMALLINT → 400 且 body.code=400(修前 500) ──
    @Test
    void salaryImport_leaveDaysOverflow_returns400() throws Exception {
        // 合法 minimal 行:仅姓名(非空,过服务空名门)+ leaveDays 超 SMALLINT(32767),其余留空取默认
        String body = "{\"rows\":[{\"tenantName\":\"溢出测试\",\"leaveDays\":99999}]}";
        mvc.perform(post("/api/salary/import")
                .param("year", "2099").param("month", "3")
                .header("Authorization", auth())
                .contentType("application/json").content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value(400));
    }
}
