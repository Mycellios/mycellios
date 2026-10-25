import { useEffect, useRef, useState } from "react";

export type NetworkArtwork = "fabric" | "fruiting";
const artworkSources: Record<NetworkArtwork, string> = {
  fabric: "/assets/landing/network-fabric.webp",
  fruiting: "/assets/landing/network-fruiting.webp",
};
const vertex = `#version 300 es
in vec2 position;
out vec2 uv;
void main(){ uv=position*.5+.5; gl_Position=vec4(position,0.,1.); }`;
const fragment = `#version 300 es
precision highp float;
uniform sampler2D picture;
uniform vec2 resolution;
uniform vec2 pointer;
uniform float imageRatio;
uniform float hover;
in vec2 uv;
out vec4 pixel;
float screen(vec2 p){
  ivec2 c=ivec2(mod(floor(p),4.));
  int b[16]=int[](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return (float(b[c.y*4+c.x])+.5)/16.;
}
void main(){
  float ratio=resolution.x/resolution.y;
  vec2 fit=ratio>imageRatio?vec2(imageRatio/ratio,1.):vec2(1.,ratio/imageRatio);
  vec2 at=(uv-.5)/fit+.5;
  if(any(lessThan(at,vec2(0.)))||any(greaterThan(at,vec2(1.)))){pixel=vec4(0.);return;}
  vec4 sampleColor=texture(picture,at);
  float luminance=dot(sampleColor.rgb,vec3(.299,.587,.114));
  float bit=step(screen(gl_FragCoord.xy/1.25),luminance);
  vec3 printColor=mix(vec3(.09,.13,.10),vec3(.96,.95,.92),bit);
  float reveal=hover*step(distance(gl_FragCoord.xy/resolution,pointer),.10);
  pixel=vec4(mix(mix(sampleColor.rgb,printColor,.46),sampleColor.rgb,reveal),sampleColor.a);
}`;

/** The fallback stays visible until a local texture and a complete GPU frame exist. */
export function NetworkPrint({ artwork = "fabric" }: { artwork?: NetworkArtwork } = {}) {
  const art = artworkSources[artwork];
  const ref = useRef<HTMLCanvasElement>(null);
  const [renderedArt, setRenderedArt] = useState<string | null>(null);
  const ready = renderedArt === art;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: false, antialias: false });
    if (!gl) return;
    function shader(kind: number, source: string) {
      const result = gl!.createShader(kind);
      if (!result) return null;
      gl!.shaderSource(result, source); gl!.compileShader(result);
      if (!gl!.getShaderParameter(result, gl!.COMPILE_STATUS)) { gl!.deleteShader(result); return null; }
      return result;
    }
    const vs = shader(gl.VERTEX_SHADER, vertex), fs = shader(gl.FRAGMENT_SHADER, fragment);
    const program = gl.createProgram();
    if (!vs || !fs || !program) { if (vs) gl.deleteShader(vs); if (fs) gl.deleteShader(fs); if (program) gl.deleteProgram(program); return; }
    gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(program); return; }
    gl.useProgram(program);
    const buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buffer); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, "position"); gl.enableVertexAttribArray(position); gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    const locations = { resolution: gl.getUniformLocation(program,"resolution"), pointer: gl.getUniformLocation(program,"pointer"), imageRatio: gl.getUniformLocation(program,"imageRatio"), hover: gl.getUniformLocation(program,"hover") };
    let disposed = false, loaded = false, frame = 0, over = false, x = .5, y = .5;
    const image = new Image();
    const draw = () => {
      frame = 0; if (disposed || !loaded || document.hidden || !canvas.isConnected) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(canvas.clientWidth*dpr)), height = Math.max(1, Math.round(canvas.clientHeight*dpr));
      if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
      gl.viewport(0,0,width,height); gl.useProgram(program); gl.uniform2f(locations.resolution,width,height); gl.uniform2f(locations.pointer,x,y); gl.uniform1f(locations.hover,over?1:0); gl.uniform1f(locations.imageRatio,image.naturalWidth/image.naturalHeight); gl.drawArrays(gl.TRIANGLE_STRIP,0,4); setRenderedArt(art);
    };
    const requestDraw = () => { if (!frame) frame = requestAnimationFrame(draw); };
    image.onload = () => { if (disposed) return; gl.bindTexture(gl.TEXTURE_2D,texture); gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image); loaded = true; requestDraw(); };
    image.src = art;
    const move = (event: PointerEvent) => { const box=canvas.getBoundingClientRect(); x=(event.clientX-box.left)/box.width; y=1-(event.clientY-box.top)/box.height; over=true; requestDraw(); };
    const leave = () => { over=false; requestDraw(); };
    const lost = (event: Event) => { event.preventDefault(); setRenderedArt(null); };
    const resize = new ResizeObserver(requestDraw); resize.observe(canvas);
    canvas.addEventListener("pointermove",move); canvas.addEventListener("pointerleave",leave); canvas.addEventListener("webglcontextlost",lost); document.addEventListener("visibilitychange",requestDraw);
    return () => { disposed=true; cancelAnimationFrame(frame); resize.disconnect(); canvas.removeEventListener("pointermove",move); canvas.removeEventListener("pointerleave",leave); canvas.removeEventListener("webglcontextlost",lost); document.removeEventListener("visibilitychange",requestDraw); gl.deleteTexture(texture); gl.deleteBuffer(buffer); gl.deleteShader(vs); gl.deleteShader(fs); gl.deleteProgram(program); };
  }, [art]);
  return <div className="reference-network-print" data-renderer={ready ? "webgl" : "image"} data-artwork={artwork}><img src={art} width="1774" height="877" alt="" fetchPriority="high" /><canvas ref={ref} aria-hidden="true" /></div>;
}
