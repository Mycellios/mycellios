import { myceliumPixelRatio, type MyceliumGeometry, type MyceliumLayout, type MyceliumRect } from "./golden-mycelium-model";

const vertex = `#version 300 es
precision highp float;
in vec2 aPosition;
in vec2 aLocal;
in vec4 aLife;
uniform vec2 uResolution;
uniform float uTime;
out vec2 vLocal;
out vec4 vLife;
out vec2 vPosition;
void main() {
  vec2 p = aPosition;
  if (aLife.w > .5) {
    float life = fract(max(0., uTime - aLife.x) * .105 + aLife.y);
    p += vec2(sin(life * 5. + aLife.y * 20.) * 13., -life * life * 68.);
  }
  vLocal = aLocal; vLife = aLife; vPosition = p;
  gl_Position = vec4(p.x / uResolution.x * 2. - 1., 1. - p.y / uResolution.y * 2., 0., 1.);
}`;

const fragment = `#version 300 es
precision highp float;
in vec2 vLocal;
in vec4 vLife;
in vec2 vPosition;
uniform float uTime;
uniform vec4 uProtected[5];
out vec4 outColor;
void main() {
  for (int i = 0; i < 5; i++) {
    vec4 r = uProtected[i];
    if (vPosition.x > r.x && vPosition.y > r.y && vPosition.x < r.z && vPosition.y < r.w) discard;
  }
  float age = uTime - vLife.x;
  if (age < 0.) discard;
  float alpha;
  vec3 gold;
  if (vLife.w > .5) {
    float life = fract(age * .105 + vLife.y);
    float dist = length(vLocal);
    float body = exp(-dist * dist * 12.);
    float glow = exp(-dist * dist * 2.5) * .16;
    alpha = (body + glow) * sin(life * 3.14159) * smoothstep(0., .8, age) * .8;
    gold = mix(vec3(.84, .52, .13), vec3(1., .87, .48), body);
  } else {
    float born = smoothstep(0., .18, age);
    float head = exp(-age * age * 3.5);
    float pulse = pow(max(0., sin(uTime * 1.05 - vLife.x * 1.65 + vLife.y * 4.)), 12.);
    float d = abs(vLocal.y + sin(vLife.x * 43. + vLife.y * 21.) * .007);
    float core = exp(-d * d * (160. / max(.3, vLife.z)));
    float inner = exp(-d * d * 30.);
    float halo = exp(-d * d * 3.8);
    alpha = born * (core * (.82 + pulse * .16) + inner * (.10 + head * .25) + halo * (.045 + head * .28 + pulse * .10)) * min(1., .82 + vLife.z * .18);
    gold = mix(vec3(.83, .57, .20), vec3(1., .91, .62), clamp(pulse * .7 + head * .8, 0., 1.));
  }
  float coverage = min(.88, alpha);
  outColor = vec4(gold * coverage, coverage);
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Shader unavailable");
  gl.shaderSource(shader, source); gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { gl.deleteShader(shader); throw new Error("Shader compilation unavailable"); }
  return shader;
}

/** Native WebGL2 ribbons: bounded geometry and resolution, no animation library or network calls. */
export function createGoldenRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: "low-power", failIfMajorPerformanceCaveat: true });
  if (!gl) return null;
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null, buffer: WebGLBuffer | null = null, vao: WebGLVertexArrayObject | null = null;
  try {
    shaders.push(compile(gl, gl.VERTEX_SHADER, vertex));
    shaders.push(compile(gl, gl.FRAGMENT_SHADER, fragment));
    program = gl.createProgram(); if (!program) throw new Error("Program unavailable");
    shaders.forEach(shader => gl.attachShader(program!, shader)); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error("Shader link unavailable");
    buffer = gl.createBuffer(); vao = gl.createVertexArray();
    if (!buffer || !vao) throw new Error("Graphics resources unavailable");
  } catch {
    shaders.forEach(shader => gl.deleteShader(shader));
    if (buffer) gl.deleteBuffer(buffer); if (vao) gl.deleteVertexArray(vao); if (program) gl.deleteProgram(program);
    return null;
  }
  shaders.forEach(shader => gl.deleteShader(shader));
  gl.useProgram(program); gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [name, size, offset] of [["aPosition", 2, 0], ["aLocal", 2, 8], ["aLife", 4, 16]] as const) {
    const attribute = gl.getAttribLocation(program, name); gl.enableVertexAttribArray(attribute); gl.vertexAttribPointer(attribute, size, gl.FLOAT, false, 32, offset);
  }
  const resolution = gl.getUniformLocation(program, "uResolution"), time = gl.getUniformLocation(program, "uTime"), protectedAreas = gl.getUniformLocation(program, "uProtected[0]");
  gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  let count = 0, frame = 0, active = false, destroyed = false, elapsed = 0, previous = 0, frames = 0;
  const draw = () => {
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(program); gl.bindVertexArray(vao); gl.uniform1f(time, elapsed); gl.drawArrays(gl.TRIANGLES, 0, count);
    frames++; if (frames % 20 === 0) canvas.dataset.myceliumFrame = String(frames);
  };
  const tick = (now: number) => {
    frame = 0; if (!active || destroyed) return;
    elapsed += previous ? Math.min(.05, (now - previous) / 1000) : 0; previous = now;
    draw(); frame = requestAnimationFrame(tick);
  };
  return {
    resize(layout: MyceliumLayout, geometry: MyceliumGeometry, excluded: MyceliumRect[]) {
      if (destroyed) return;
      const data: number[] = [];
      const vertexAt = (x: number, y: number, lx: number, ly: number, birth: number, seed: number, weight: number, kind: number) => data.push(x,y,lx,ly,birth,seed,weight,kind);
      const radius = layout.compact ? 16 : 28;
      for (const strand of geometry.strands) for (let i = 0; i < strand.points.length - 1; i++) {
        const a = strand.points[i]!, b = strand.points[i + 1]!, dx = b.x-a.x, dy = b.y-a.y, length = Math.hypot(dx,dy);
        if (length < .01) continue;
        const nx = -dy/length*radius, ny = dx/length*radius;
        const start = strand.birth + i/(strand.points.length-1)*strand.duration, end = strand.birth+(i+1)/(strand.points.length-1)*strand.duration;
        for (const [p, sign, along, birth] of [[a,-1,-1,start],[b,-1,1,end],[a,1,-1,start],[a,1,-1,start],[b,-1,1,end],[b,1,1,end]] as const) vertexAt(p.x+nx*sign,p.y+ny*sign,along,sign,birth,strand.seed,strand.weight,0);
      }
      for (const spore of geometry.spores) {
        const r = spore.radius * 3.4;
        for (const [x,y] of [[-1,-1],[1,-1],[-1,1],[-1,1],[1,-1],[1,1]]) vertexAt(spore.origin.x+x!*r,spore.origin.y+y!*r,x!,y!,spore.birth,spore.seed,spore.radius,1);
      }
      const ratio = myceliumPixelRatio(layout.width, layout.height, window.devicePixelRatio || 1);
      canvas.width = Math.max(1,Math.round(layout.width*ratio)); canvas.height = Math.max(1,Math.round(layout.height*ratio));
      gl.viewport(0,0,canvas.width,canvas.height); gl.useProgram(program); gl.uniform2f(resolution,layout.width,layout.height);
      const boxes = new Float32Array(20);
      excluded.slice(0,5).forEach((r,i)=>boxes.set([r.x,r.y,r.x+r.width,r.y+r.height],i*4));
      gl.uniform4fv(protectedAreas,boxes); gl.bindBuffer(gl.ARRAY_BUFFER,buffer); gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(data),gl.STATIC_DRAW);
      count=data.length/8; draw();
      canvas.dataset.myceliumVertices=String(count);
    },
    setActive(value: boolean) {
      if (destroyed || active === value) return;
      active=value; previous=0;
      if (active && !frame) frame=requestAnimationFrame(tick);
      else if (!active) { cancelAnimationFrame(frame); frame=0; }
      canvas.dataset.myceliumMotion=active ? "running" : "paused";
    },
    destroy() {
      if (destroyed) return;
      destroyed=true; active=false; cancelAnimationFrame(frame);
      gl.deleteBuffer(buffer); gl.deleteVertexArray(vao); gl.deleteProgram(program);
      delete canvas.dataset.myceliumFrame; delete canvas.dataset.myceliumVertices; delete canvas.dataset.myceliumMotion;
    },
  };
}
