package com.park.demo3.common;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import java.util.NoSuchElementException;

// HTTP 状态口径(项目约定,勿混用):
//   业务错误(BizException/重复/查无) → HTTP 200 + body.code(404/409/…),前端按 code 分支展示中文;
//   入参校验失败(@Valid/@Validated)  → HTTP 400 + body.code=400,保留 4xx 供监控统计;
//   未认证 → 401(SecurityConfig);无权限(viewer 触发非 GET 写) → 403(SecurityConfig accessDeniedHandler)+ body.code=403;
//   未捕获异常 → 500。
// 前端拦截器对非 2xx 也解包 Result 信封,故两轨的用户提示一致(api/index.ts)。
@Slf4j
@RestControllerAdvice(basePackages = "com.park.demo3.controller")
public class GlobalExceptionHandler {
    @ExceptionHandler(BizException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> biz(BizException e) {
        log.warn("biz error: {}", e.getMessage());
        return Result.error(e.getCode(), e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<Void> invalid(MethodArgumentNotValidException e) {
        FieldError fe = e.getBindingResult().getFieldError();
        String msg = fe == null ? ResultCode.BAD_REQUEST.message : fe.getField() + " " + fe.getDefaultMessage();
        return Result.error(ResultCode.BAD_REQUEST.code, msg);
    }

    // @Validated 作用于 @PathVariable/@RequestParam 的校验异常（Spring 6.1 起为 HandlerMethodValidationException，
    // 旧式为 ConstraintViolationException）；不显式处理会落到下方 fallback 误报 500
    @ExceptionHandler({ConstraintViolationException.class, HandlerMethodValidationException.class})
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<Void> paramInvalid(Exception e) {
        log.warn("param validation failed: {}", e.getMessage());
        return Result.error(ResultCode.BAD_REQUEST.code, ResultCode.BAD_REQUEST.message);
    }

    // path/query 参数类型转换失败（如 id 传 "undefined" → int 转换失败）→ 400，
    // 避免落到 fallback 误报 500；e.getName() 为出错参数名
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<Void> typeMismatch(MethodArgumentTypeMismatchException e) {
        log.warn("param type mismatch: {}", e.getMessage());
        String name = e.getName();   // 理论上非空,防御性兜底避免拼出 "null"
        return Result.error(ResultCode.BAD_REQUEST.code, "请求参数格式错误" + (name != null ? "：" + name : ""));
    }

    // 唯一键冲突（重复导入/重复录入）→ 409，避免落到 fallback 变成 500
    // 注意：DuplicateKeyException 是 DataIntegrityViolationException 子类，Spring 选最具体的
    // handler，故重复键仍走此 409，其余完整性/超长（如 SMALLINT 溢出）走下方 400
    @ExceptionHandler(DuplicateKeyException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> duplicate(DuplicateKeyException e) {
        log.warn("duplicate key: {}", e.getMessage());
        return Result.error(ResultCode.CONFLICT.code, "记录已存在（同期同项不可重复）");
    }

    // 数据超出字段范围/违反完整性约束（如 leave_days SMALLINT 溢出，被包装为 MysqlDataTruncation）
    // → 400，避免落到 fallback 误报 500；重复键更具体走上方 duplicate()
    @ExceptionHandler(DataIntegrityViolationException.class)
    @ResponseStatus(HttpStatus.BAD_REQUEST)
    public Result<Void> dataIntegrity(DataIntegrityViolationException e) {
        log.warn("data integrity violation: {}", e.getMessage());
        return Result.error(ResultCode.BAD_REQUEST.code, "数据超出字段允许范围或违反完整性约束");
    }

    // 单资源查无（TenantService/ContractService.detail 抛 NoSuchElementException）→ 404，
    // 与其余 service 的 BizException(NOT_FOUND) 对齐，避免落到 fallback 误报 500
    @ExceptionHandler(NoSuchElementException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> notFound(NoSuchElementException e) {
        log.warn("not found: {}", e.getMessage());
        return Result.error(ResultCode.NOT_FOUND.code, ResultCode.NOT_FOUND.message);
    }

    @ExceptionHandler(Exception.class)
    @ResponseStatus(HttpStatus.INTERNAL_SERVER_ERROR)
    public Result<Void> fallback(Exception e) {
        log.error("unhandled error", e);
        return Result.error(ResultCode.INTERNAL.code, ResultCode.INTERNAL.message);
    }
}
