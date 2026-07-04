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

// Attach token from localStorage if present
http.interceptors.request.use((config) => {
  const token = localStorage.getItem('token')
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
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token')
      localStorage.removeItem('displayName')
      // 整页跳转让 Pinia auth store 从（已清空的）localStorage 重新初始化为 null；
      // 带 redirect 以便登录后回到原页，且避免在登录页自身重复跳转
      if (!location.pathname.startsWith('/login')) {
        location.href = '/login?redirect=' + encodeURIComponent(location.pathname + location.search)
      }
    }
    return Promise.reject(error)
  },
)

export default http
