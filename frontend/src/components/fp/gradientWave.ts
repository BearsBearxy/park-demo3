// 流动渐变背景的 WebGL 引擎 —— 移植自 React 组件 gradient-wave.tsx(Stripe 式 MiniGl 渐变),
// 算法、着色器、默认参数照搬;与原版的差别:
//   · 原版 resize() 按窗宽把 u_shadow_power 改成 5/6,会盖掉传进来的 shadowPower —— 去掉;
//     着色器里没被调用的两参数 blendNormal 也去掉;
//   · 画布尺寸跟容器走(原版读 window.innerWidth/Height),resize 监听在 dispose() 里摘掉(原版漏摘);
//   · dispose() 顺带释放 WebGL 上下文(登录后这页就卸载了,显存不该一直占着);
//   · 去掉 u_active_colors(原版恒为全 1,且 6 色时下标越过 vec4 的 4 位);
//   · 原版 join 的换行符在粘贴时断成了真换行(语法错误),这里写回 "\n"。
// 只被 GradientWave.vue 动态 import:登录页在首屏包里,这 12KB(大头是着色器源码)不进首屏。

/* eslint-disable @typescript-eslint/no-explicit-any */

function normalizeColor(hex: string): number[] {
  const n = parseInt(hex.replace('#', ''), 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

class MiniGl {
  gl: WebGLRenderingContext
  meshes: any[] = []
  commonUniforms: any
  width = 1
  height = 1
  Uniform: any
  Attribute: any
  Material: any
  PlaneGeometry: any
  Mesh: any

  constructor(public canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { antialias: true })
    if (!gl) throw new Error('WebGL not supported')
    this.gl = gl
    const context = gl
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const miniGl = this

    this.Uniform = class {
      type = 'float'
      value: any
      typeFn: string
      excludeFrom?: string
      transpose?: boolean
      constructor(e: any) {
        Object.assign(this, e)
        const typeMap: Record<string, string> = { float: '1f', int: '1i', vec2: '2fv', vec3: '3fv', vec4: '4fv', mat4: 'Matrix4fv' }
        this.typeFn = typeMap[this.type] || '1f'
      }
      update(location: WebGLUniformLocation | null): void {
        if (this.value === undefined || location === null) return
        const fn = `uniform${this.typeFn}`
        if (this.typeFn.indexOf('Matrix') === 0) (context as any)[fn](location, this.transpose || false, this.value)
        else (context as any)[fn](location, this.value)
      }
      getDeclaration(name: string, type: string, length?: number): string {
        if (this.excludeFrom === type) return ''
        if (this.type === 'array') {
          return this.value[0].getDeclaration(name, type, this.value.length) + `\nconst int ${name}_length = ${this.value.length};`
        }
        if (this.type === 'struct') {
          let nameNoPrefix = name.replace('u_', '')
          nameNoPrefix = nameNoPrefix.charAt(0).toUpperCase() + nameNoPrefix.slice(1)
          const fields = Object.entries(this.value)
            .map(([n, u]: [string, any]) => u.getDeclaration(n, type).replace(/^uniform/, ''))
            .join('')
          return `uniform struct ${nameNoPrefix}\n{\n${fields}\n} ${name}${length ? `[${length}]` : ''};`
        }
        return `uniform ${this.type} ${name}${length ? `[${length}]` : ''};`
      }
    }

    this.Attribute = class {
      type: number = context.FLOAT
      normalized = false
      buffer: WebGLBuffer
      target!: number
      size!: number
      values?: Float32Array | Uint16Array
      constructor(e: any) {
        this.buffer = context.createBuffer()!
        Object.assign(this, e)
      }
      update(): void {
        if (!this.values) return
        context.bindBuffer(this.target, this.buffer)
        context.bufferData(this.target, this.values, context.STATIC_DRAW)
      }
      attach(name: string, program: WebGLProgram): number {
        const loc = context.getAttribLocation(program, name)
        if (this.target === context.ARRAY_BUFFER) {
          context.bindBuffer(this.target, this.buffer)
          context.enableVertexAttribArray(loc)
          context.vertexAttribPointer(loc, this.size, this.type, this.normalized, 0, 0)
        }
        return loc
      }
      use(loc: number): void {
        context.bindBuffer(this.target, this.buffer)
        if (this.target === context.ARRAY_BUFFER) {
          context.enableVertexAttribArray(loc)
          context.vertexAttribPointer(loc, this.size, this.type, this.normalized, 0, 0)
        }
      }
    }

    this.Material = class {
      uniforms: any
      uniformInstances: any[] = []
      program: WebGLProgram
      constructor(vertexShaders: string, fragments: string, uniforms: any = {}) {
        const getShader = (type: number, source: string): WebGLShader => {
          const shader = context.createShader(type)!
          context.shaderSource(shader, source)
          context.compileShader(shader)
          if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
            console.error(context.getShaderInfoLog(shader))
            throw new Error('Shader compilation error')
          }
          return shader
        }
        const decls = (us: any, type: string): string =>
          Object.entries(us).map(([n, u]: [string, any]) => u.getDeclaration(n, type)).join('\n')
        this.uniforms = uniforms
        const prefix = 'precision highp float;'
        const vertexSource = `${prefix}
attribute vec4 position;
attribute vec2 uv;
attribute vec2 uvNorm;
${decls(miniGl.commonUniforms, 'vertex')}
${decls(uniforms, 'vertex')}
${vertexShaders}`
        const fragmentSource = `${prefix}
${decls(miniGl.commonUniforms, 'fragment')}
${decls(uniforms, 'fragment')}
${fragments}`
        this.program = context.createProgram()!
        context.attachShader(this.program, getShader(context.VERTEX_SHADER, vertexSource))
        context.attachShader(this.program, getShader(context.FRAGMENT_SHADER, fragmentSource))
        context.linkProgram(this.program)
        if (!context.getProgramParameter(this.program, context.LINK_STATUS)) {
          console.error(context.getProgramInfoLog(this.program))
          throw new Error('Program linking error')
        }
        context.useProgram(this.program)
        this.attachUniforms(undefined, miniGl.commonUniforms)
        this.attachUniforms(undefined, this.uniforms)
      }
      attachUniforms(name: string | undefined, uniforms: any): void {
        if (name === undefined) {
          Object.entries(uniforms).forEach(([n, u]) => this.attachUniforms(n, u))
        } else if (uniforms.type === 'array') {
          uniforms.value.forEach((u: any, i: number) => this.attachUniforms(`${name}[${i}]`, u))
        } else if (uniforms.type === 'struct') {
          Object.entries(uniforms.value).forEach(([u, v]) => this.attachUniforms(`${name}.${u}`, v))
        } else {
          this.uniformInstances.push({ uniform: uniforms, location: context.getUniformLocation(this.program, name) })
        }
      }
    }

    this.PlaneGeometry = class {
      width = 1
      height = 1
      attributes: any
      vertexCount = 0
      xSegCount = 0
      ySegCount = 0
      constructor() {
        this.attributes = {
          position: new miniGl.Attribute({ target: context.ARRAY_BUFFER, size: 3 }),
          uv: new miniGl.Attribute({ target: context.ARRAY_BUFFER, size: 2 }),
          uvNorm: new miniGl.Attribute({ target: context.ARRAY_BUFFER, size: 2 }),
          index: new miniGl.Attribute({ target: context.ELEMENT_ARRAY_BUFFER, size: 3, type: context.UNSIGNED_SHORT }),
        }
      }
      setTopology(xSegs = 1, ySegs = 1): void {
        this.xSegCount = xSegs
        this.ySegCount = ySegs
        this.vertexCount = (xSegs + 1) * (ySegs + 1)
        const quadCount = xSegs * ySegs * 2
        const a = this.attributes
        a.uv.values = new Float32Array(2 * this.vertexCount)
        a.uvNorm.values = new Float32Array(2 * this.vertexCount)
        a.index.values = new Uint16Array(3 * quadCount)
        for (let y = 0; y <= ySegs; y++) {
          for (let x = 0; x <= xSegs; x++) {
            const i = y * (xSegs + 1) + x
            a.uv.values[2 * i] = x / xSegs
            a.uv.values[2 * i + 1] = 1 - y / ySegs
            a.uvNorm.values[2 * i] = (x / xSegs) * 2 - 1
            a.uvNorm.values[2 * i + 1] = 1 - (y / ySegs) * 2
            if (x < xSegs && y < ySegs) {
              const s = y * xSegs + x
              a.index.values[6 * s] = i
              a.index.values[6 * s + 1] = i + 1 + xSegs
              a.index.values[6 * s + 2] = i + 1
              a.index.values[6 * s + 3] = i + 1
              a.index.values[6 * s + 4] = i + 1 + xSegs
              a.index.values[6 * s + 5] = i + 2 + xSegs
            }
          }
        }
        a.uv.update()
        a.uvNorm.update()
        a.index.update()
      }
      setSize(width = 1, height = 1): void {
        this.width = width
        this.height = height
        const pos = new Float32Array(3 * this.vertexCount)
        const segW = width / this.xSegCount
        const segH = height / this.ySegCount
        for (let y = 0; y <= this.ySegCount; y++) {
          const posY = -height / 2 + y * segH
          for (let x = 0; x <= this.xSegCount; x++) {
            const idx = y * (this.xSegCount + 1) + x
            pos[3 * idx] = -width / 2 + x * segW
            pos[3 * idx + 1] = -posY
            pos[3 * idx + 2] = 0
          }
        }
        this.attributes.position.values = pos
        this.attributes.position.update()
      }
    }

    this.Mesh = class {
      attributeInstances: any[] = []
      constructor(public geometry: any, public material: any) {
        Object.entries(geometry.attributes).forEach(([name, attribute]: [string, any]) => {
          this.attributeInstances.push({ attribute, location: attribute.attach(name, material.program) })
        })
        miniGl.meshes.push(this)
      }
      draw(): void {
        context.useProgram(this.material.program)
        this.material.uniformInstances.forEach(({ uniform, location }: any) => uniform.update(location))
        this.attributeInstances.forEach(({ attribute, location }: any) => attribute.use(location))
        context.drawElements(context.TRIANGLES, this.geometry.attributes.index.values.length, context.UNSIGNED_SHORT, 0)
      }
    }

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    this.commonUniforms = {
      projectionMatrix: new this.Uniform({ type: 'mat4', value: identity }),
      modelViewMatrix: new this.Uniform({ type: 'mat4', value: identity }),
      resolution: new this.Uniform({ type: 'vec2', value: [1, 1] }),
      aspectRatio: new this.Uniform({ type: 'float', value: 1 }),
    }
  }

  setSize(w: number, h: number): void {
    this.width = w
    this.height = h
    this.canvas.width = w
    this.canvas.height = h
    this.gl.viewport(0, 0, w, h)
    this.commonUniforms.resolution.value = [w, h]
    this.commonUniforms.aspectRatio.value = w / h
  }

  setOrthographicCamera(): void {
    this.commonUniforms.projectionMatrix.value = [2 / this.width, 0, 0, 0, 0, 2 / this.height, 0, 0, 0, 0, -0.001, 0, 0, 0, 0, 1]
  }

  render(): void {
    this.gl.clearColor(0, 0, 0, 0)
    this.gl.clearDepth(1)
    this.meshes.forEach((m) => m.draw())
  }
}

const VERTEX_SHADER = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
vec3 blendNormal(vec3 base, vec3 blend, float opacity) { return (blend * opacity + base * (1.0 - opacity)); }
varying vec3 v_color;
void main() {
  float time = u_time * u_global.noiseSpeed;
  vec2 noiseCoord = resolution * uvNorm * u_global.noiseFreq;
  float tilt = resolution.y / 2.0 * uvNorm.y;
  float incline = resolution.x * uvNorm.x / 2.0 * u_vertDeform.incline;
  float offset = resolution.x / 2.0 * u_vertDeform.incline * mix(u_vertDeform.offsetBottom, u_vertDeform.offsetTop, uv.y);
  float noise = snoise(vec3(
    noiseCoord.x * u_vertDeform.noiseFreq.x + time * u_vertDeform.noiseFlow,
    noiseCoord.y * u_vertDeform.noiseFreq.y,
    time * u_vertDeform.noiseSpeed + u_vertDeform.noiseSeed
  )) * u_vertDeform.noiseAmp;
  noise *= 1.0 - pow(abs(uvNorm.y), 2.0);
  noise = max(0.0, noise);
  vec3 pos = vec3(position.x, position.y + tilt + incline + noise - offset, position.z);
  v_color = u_baseColor;
  for (int i = 0; i < u_waveLayers_length; i++) {
    WaveLayers layer = u_waveLayers[i];
    float layerNoise = smoothstep(layer.noiseFloor, layer.noiseCeil, snoise(vec3(
      noiseCoord.x * layer.noiseFreq.x + time * layer.noiseFlow,
      noiseCoord.y * layer.noiseFreq.y,
      time * layer.noiseSpeed + layer.noiseSeed
    )) / 2.0 + 0.5);
    v_color = blendNormal(v_color, layer.color, pow(layerNoise, 4.));
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}`

const FRAGMENT_SHADER = `
varying vec3 v_color;
void main() {
  vec3 color = v_color;
  if (u_darken_top == 1.0) {
    vec2 st = gl_FragCoord.xy / resolution.xy;
    color.g -= pow(st.y + sin(-12.0) * st.x, u_shadow_power) * 0.4;
  }
  gl_FragColor = vec4(color, 1.0);
}`

export interface WaveDeform {
  incline?: number
  offsetTop?: number
  offsetBottom?: number
  noiseFreq?: [number, number]
  noiseAmp?: number
  noiseSpeed?: number
  noiseFlow?: number
  noiseSeed?: number
}

export interface WaveOptions {
  colors: string[]          // 第一个是底色,其余逐层叠上去
  shadowPower: number       // 顶部压暗强度(darkenTop 开时才生效)
  darkenTop: boolean
  noiseSpeed: number        // 整体流动速度
  noiseFrequency: [number, number]
  deform: WaveDeform
}

export class GradientWaveEngine {
  private minigl: MiniGl
  private mesh: any
  private time = 0
  private last = 0
  private raf = 0
  private playing = false
  private ro: ResizeObserver | null = null

  constructor(private canvas: HTMLCanvasElement, opt: WaveOptions) {
    this.minigl = new MiniGl(canvas)
    const U = this.minigl.Uniform
    const cs = opt.colors.map(normalizeColor)
    const uniforms: any = {
      u_time: new U({ value: 0 }),
      u_shadow_power: new U({ value: opt.shadowPower }),
      u_darken_top: new U({ value: opt.darkenTop ? 1 : 0 }),
      u_global: new U({
        type: 'struct',
        value: {
          noiseFreq: new U({ value: opt.noiseFrequency, type: 'vec2' }),
          noiseSpeed: new U({ value: opt.noiseSpeed }),
        },
      }),
      u_vertDeform: new U({
        type: 'struct',
        excludeFrom: 'fragment',
        value: {
          incline: new U({ value: opt.deform.incline ?? 0 }),
          offsetTop: new U({ value: opt.deform.offsetTop ?? -0.5 }),
          offsetBottom: new U({ value: opt.deform.offsetBottom ?? -0.5 }),
          noiseFreq: new U({ value: opt.deform.noiseFreq ?? [3, 4], type: 'vec2' }),
          noiseAmp: new U({ value: opt.deform.noiseAmp ?? 320 }),
          noiseSpeed: new U({ value: opt.deform.noiseSpeed ?? 10 }),
          noiseFlow: new U({ value: opt.deform.noiseFlow ?? 3 }),
          noiseSeed: new U({ value: opt.deform.noiseSeed ?? 5 }),
        },
      }),
      u_baseColor: new U({ value: cs[0], type: 'vec3', excludeFrom: 'fragment' }),
      u_waveLayers: new U({ value: [], excludeFrom: 'fragment', type: 'array' }),
    }
    for (let i = 1; i < cs.length; i++) {
      uniforms.u_waveLayers.value.push(new U({
        type: 'struct',
        value: {
          color: new U({ value: cs[i], type: 'vec3' }),
          noiseFreq: new U({ value: [2 + i / cs.length, 3 + i / cs.length], type: 'vec2' }),
          noiseSpeed: new U({ value: 11 + 0.3 * i }),
          noiseFlow: new U({ value: 6.5 + 0.3 * i }),
          noiseSeed: new U({ value: 5 + 10 * i }),
          noiseFloor: new U({ value: 0.1 }),
          noiseCeil: new U({ value: 0.63 + 0.07 * i }),
        },
      }))
    }
    const material = new this.minigl.Material(VERTEX_SHADER, FRAGMENT_SHADER, uniforms)
    this.mesh = new this.minigl.Mesh(new this.minigl.PlaneGeometry(), material)
    this.resize()
    // 跟容器尺寸走(不是窗口):容器由调用方定位,缩放窗口时它自己会变
    this.ro = new ResizeObserver(() => { this.resize(); if (!this.playing) this.minigl.render() })
    this.ro.observe(canvas.parentElement ?? canvas)
  }

  private resize(): void {
    const box = this.canvas.parentElement ?? this.canvas
    const width = Math.max(1, box.clientWidth)
    const height = Math.max(1, box.clientHeight)
    this.minigl.setSize(width, height)
    this.minigl.setOrthographicCamera()
    this.mesh.geometry.setTopology(Math.ceil(width * 0.02), Math.ceil(height * 0.05))
    this.mesh.geometry.setSize(width, height)
  }

  private animate = (timestamp: number): void => {
    if (!this.playing) return
    this.time += Math.min(timestamp - this.last, 1000 / 15)
    this.last = timestamp
    this.mesh.material.uniforms.u_time.value = this.time
    this.minigl.render()
    this.raf = requestAnimationFrame(this.animate)
  }

  start(): void {
    if (this.playing) return
    this.playing = true
    this.raf = requestAnimationFrame((t) => { this.last = t; this.animate(t) })
  }

  stop(): void {
    this.playing = false
    cancelAnimationFrame(this.raf)
  }

  /** 减动效:只画一帧 */
  renderStill(): void {
    this.minigl.render()
  }

  dispose(): void {
    this.stop()
    this.ro?.disconnect()
    this.ro = null
    this.minigl.gl.getExtension('WEBGL_lose_context')?.loseContext()
  }
}
