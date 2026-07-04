package com.park.demo3.common;
import jakarta.validation.ConstraintViolationException;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import java.util.NoSuchElementException;

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

    // 唯一键冲突（重复导入/重复录入）→ 409，避免落到 fallback 变成 500
    @ExceptionHandler(DuplicateKeyException.class)
    @ResponseStatus(HttpStatus.OK)
    public Result<Void> duplicate(DuplicateKeyException e) {
        log.warn("duplicate key: {}", e.getMessage());
        return Result.error(ResultCode.CONFLICT.code, "记录已存在（同期同项不可重复）");
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
