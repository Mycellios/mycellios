import { useEffect, useRef, useState } from "react";

const vertex = `#version 300 es
in vec2 position;
void main(){ gl_Position=vec4(position,0.,1.); }`;

/**
 * Two-tone ordered-dither print of the artwork. A lens shows the original
 * colors; its edge is dithered too, so every pixel stays a flat fill.
 */
const fragment = `#version 300 es
precision highp float;
uniform sampler2D picture;
uniform vec2 resolution;
uniform vec2 lens;
uniform float radius;
uniform float cell;
out vec4 pixel;
float bayer(vec2 p){
  ivec2 c=ivec2(mod(floor(p),4.));
  int b[16]=int[](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return (float(b[c.y*4+c.x])+.5)/16.;
}
void main(){
  vec2 uv=vec2(gl_FragCoord.x/resolution.x,1.-gl_FragCoord.y/resolution.y);
  vec4 source=texture(picture,uv);
  if(source.a<.02){pixel=vec4(0.);return;}
  float threshold=bayer(gl_FragCoord.xy/cell);
  float luminance=dot(source.rgb,vec3(.299,.587,.114));
  vec3 ink=vec3(.09,.188,.137), paper=vec3(.988,.984,.976);
  vec3 print=luminance>threshold?paper:ink;
  vec2 at=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y);
  float inside=step(distance(at,lens),radius+(threshold-.5)*radius*.35);
  pixel=vec4(mix(print,source.rgb,inside),step(threshold*.85,source.a));
}`;

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
  return shader;
}

/**
 * Conceptual brand artwork, never telemetry. The lens follows the pointer and
 * otherwise drifts slowly; it pauses offscreen, in hidden tabs and for reduced
 * motion. Without WebGL2 the plain image stays visible.
 */
export function HomeArtwork({ src, width, height, label, lensSize = .17 }: { src: string; width: number; height: number; label: string; lensSize?: number }) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const element = canvas.current, container = host.current;
    if (!element || !container) return;
    const gl = element.getContext("webgl2", { premultipliedAlpha: false, antialias: false });
    if (!gl) return;
    let disposed = false, frame = 0, visible = false, pointer: [number, number] | null = null, last = 0;
    const lens: [number, number] = [0, 0], reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let program: WebGLProgram, texture: WebGLTexture, buffer: WebGLBuffer;
    try {
      program = gl.createProgram()!;
      gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
      gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;
    } catch { return; }
    gl.useProgram(program);
    buffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const u = (name: string) => gl.getUniformLocation(program, name);
    texture = gl.createTexture()!;
    const dpr = Math.min(devicePixelRatio || 1, 1.5);

    function size() {
      const rect = container!.getBoundingClientRect();
      element!.width = Math.max(1, Math.round(rect.width * dpr));
      element!.height = Math.max(1, Math.round(rect.height * dpr));
      gl!.viewport(0, 0, element!.width, element!.height);
    }
    function draw(time: number) {
      frame = 0;
      if (disposed) return;
      const w = element!.width, h = element!.height;
      const target: [number, number] = pointer ?? (reduced ? [w * .62, h * .45] : [w * (.5 + .3 * Math.sin(time / 5200)), h * (.48 + .18 * Math.sin(time / 3700))]);
      const ease = reduced || !last ? 1 : .12;
      lens[0] += (target[0] - lens[0]) * ease;
      lens[1] += (target[1] - lens[1]) * ease;
      last = time;
      gl!.uniform2f(u("resolution"), w, h);
      gl!.uniform2f(u("lens"), lens[0], lens[1]);
      gl!.uniform1f(u("radius"), Math.min(w, h * 2) * lensSize);
      gl!.uniform1f(u("cell"), 2 * dpr);
      gl!.clearColor(0, 0, 0, 0);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      const moving = Math.abs(target[0] - lens[0]) + Math.abs(target[1] - lens[1]) > .5;
      if (visible && !document.hidden && (!reduced || moving)) request();
    }
    function request() { if (!frame) frame = requestAnimationFrame(draw); }

    const image = new Image();
    image.decoding = "async";
    image.src = src;
    image.onload = () => {
      if (disposed) return;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      size();
      draw(performance.now());
      setReady(true);
      request();
    };

    const resize = new ResizeObserver(() => { size(); request(); });
    resize.observe(container);
    const observer = new IntersectionObserver(entries => { visible = entries.some(entry => entry.isIntersecting); if (visible) request(); });
    observer.observe(container);
    const move = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      pointer = [(event.clientX - rect.left) * dpr, (event.clientY - rect.top) * dpr];
      request();
    };
    const leave = () => { pointer = null; request(); };
    const visibility = () => { if (!document.hidden) request(); };
    container.addEventListener("pointermove", move);
    container.addEventListener("pointerleave", leave);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      observer.disconnect();
      container.removeEventListener("pointermove", move);
      container.removeEventListener("pointerleave", leave);
      document.removeEventListener("visibilitychange", visibility);
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
    };
  }, [src, lensSize]);
  return <div ref={host} className="home-artwork" data-ready={ready} role="img" aria-label={label} style={{ aspectRatio: `${width} / ${height}` }}>
    <img src={src} width={width} height={height} alt="" loading="eager" decoding="async" />
    <canvas ref={canvas} aria-hidden="true" />
  </div>;
}
