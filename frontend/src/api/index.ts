import axios, { type AxiosRequestConfig } from 'axios'

// 下方响应拦截器已把 Result 信封解包为业务数据,方法返回类型同步声明为 Promise<T>(而非 AxiosResponse<T>)
declare module 'axios' {
  export interface AxiosInstance {
    get<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>
    delete<T = any>(url: string, config?: AxiosRequestConfig): Promise<T>
    post<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
    put<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
    patch<T = any>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T>
  }
}

const http = axios.create({ baseURL: '/api' })

// Attach token if present:localStorage(记住登录)优先,sessionStorage(不记住)兜底,口径同 stores/auth.ts
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token') ?? sessionStorage.getItem('token')
  if (token) config.headers['Authorization'] = `Bearer ${token}`
  return config
})

// Unwrap Result envelope; reject on non-zero code; stub 401 handler
http.interceptors.response.use(
  (response) => {
    const data = response.data
    if (data && typeof data === 'object' && 'code' in data) {
      if (data.code === 0) return data.data
      return Promise.reject(data)
    }
    return response.data
  },
  async (error) => {
    if (error.response?.status === 401) {
      for (const k of ['token', 'displayName', 'role']) {
        localStorage.removeItem(k)
        sessionStorage.removeItem(k)
      }
      // 整页跳转让 Pinia auth store 从（已清空的）localStorage 重新初始化为 null；
      // 带 redirect 以便登录后回到原页，且避免在登录页自身重复跳转
      if (!location.pathname.startsWith('/login')) {
        location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search)
      }
      return Promise.reject(error)
    }
    // 非 2xx 也解包 Result 信封：校验错误(HTTP 400)/只读角色写拦截(HTTP 403)的后端中文 message
    // 直达视图 alert，不再退化成英文 AxiosError 文案（HTTP 状态口径见后端 GlobalExceptionHandler 头注释）
    const body = error.response?.data
    const enveloped = body && typeof body === 'object' && 'code' in body
    // 5xx / 断网：读路径普遍无 catch，全局 toast 兜底提示（动态 import 避免 pinia 未装载时的循环依赖）
    if (!error.response || error.response.status >= 500) {
      try {
        const { useUiStore } = await import('@/stores/ui')
        useUiStore().reportNetError(enveloped ? (body as { message?: string }).message ?? '服务异常' : '网络异常或服务不可用，请稍后重试')
      } catch { /* pinia 未就绪(极早期请求)时静默 */ }
    }
    return Promise.reject(enveloped ? body : error)
  },
)

export default http
