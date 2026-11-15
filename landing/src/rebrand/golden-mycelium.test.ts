import { afterEach, describe, expect, it, vi } from "vitest";
import { createMyceliumGeometry, myceliumPixelRatio, type MyceliumLayout } from "./golden-mycelium-model";
import { createGoldenRenderer } from "./golden-mycelium-renderer";

const wide: MyceliumLayout = { width:1440,height:1130,source:{x:470,y:390},stage:{x:230,y:550,width:980,height:520},compact:false };
const narrow: MyceliumLayout = { width:390,height:1100,source:{x:45,y:310},stage:{x:16,y:500,width:358,height:570},compact:true };
afterEach(() => vi.unstubAllGlobals());

describe("golden mycelium", () => {
  it.each([wide,narrow])("keeps the botanical frame deterministic and inside its measured surface", layout => {
    const geometry = createMyceliumGeometry(layout);
    expect(geometry).toEqual(createMyceliumGeometry(layout));
    for (const strand of geometry.strands) for (const point of strand.points) {
      expect(point.x).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThanOrEqual(layout.width);
      expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThanOrEqual(layout.height);
    }
    expect(geometry.strands.length).toBeLessThan(100);
    expect(geometry.spores.length).toBeLessThan(40);
    expect(geometry.strands[1]!.points[0]).toEqual(geometry.strands[0]!.points.at(-1));
  });
  it("reduces geometry on phones and bounds GPU resolution on high density or tall screens", () => {
    expect(createMyceliumGeometry(narrow).strands.length).toBeLessThan(createMyceliumGeometry(wide).strands.length);
    expect(myceliumPixelRatio(390,1100,4)).toBe(1.65);
    expect(myceliumPixelRatio(1440,3000,4)*3000).toBeLessThanOrEqual(1900);
  });

  function fixture(failFragment = false) {
    let id=0, shaderCount=0;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { frames.set(++id, callback); return id; });
    vi.stubGlobal("cancelAnimationFrame", (key: number) => frames.delete(key));
    vi.stubGlobal("window", { devicePixelRatio:3 });
    const noop = () => {};
    const gl = {
      VERTEX_SHADER:1,FRAGMENT_SHADER:2,COMPILE_STATUS:3,LINK_STATUS:4,ARRAY_BUFFER:5,FLOAT:6,BLEND:7,SRC_ALPHA:8,ONE_MINUS_SRC_ALPHA:9,STATIC_DRAW:10,COLOR_BUFFER_BIT:11,TRIANGLES:12,ONE:13,
      createShader:()=>({type:++shaderCount}),shaderSource:noop,compileShader:noop,
      getShaderParameter:(shader:{type:number})=>!(failFragment&&shader.type===2),deleteShader:vi.fn(),
      createProgram:()=>({}),attachShader:noop,linkProgram:noop,getProgramParameter:()=>true,
      createBuffer:()=>({}),createVertexArray:()=>({}),useProgram:noop,bindVertexArray:noop,bindBuffer:noop,getAttribLocation:()=>0,enableVertexAttribArray:noop,vertexAttribPointer:noop,
      getUniformLocation:(_program:unknown,name:string)=>name,enable:noop,blendFunc:noop,clearColor:noop,clear:noop,
      uniform1f:vi.fn(),drawArrays:vi.fn(),viewport:noop,uniform2f:noop,uniform4fv:vi.fn(),bufferData:noop,
      deleteBuffer:vi.fn(),deleteVertexArray:vi.fn(),deleteProgram:vi.fn(),
    };
    const canvas = {getContext:()=>gl,dataset:{} as Record<string,string>,width:0,height:0};
    const next = (now:number) => { const pending=[...frames.values()];frames.clear(); pending.forEach(callback=>callback(now)); };
    return { gl, canvas, frames, next, renderer:()=>createGoldenRenderer(canvas as unknown as HTMLCanvasElement) };
  }
  it("stops its real frame clock on pause, resumes without catch-up and releases GPU resources", () => {
    const {gl,canvas,frames,next,renderer}=fixture(), effect=renderer()!;
    effect.resize(wide,createMyceliumGeometry(wide),[{x:230,y:555,width:980,height:510}]);
    effect.setActive(true); next(100);next(116);
    const time=gl.uniform1f.mock.calls.at(-1)![1];
    expect(time).toBeCloseTo(.016);expect(frames.size).toBe(1);
    effect.setActive(false);expect(frames.size).toBe(0);expect(canvas.dataset.myceliumMotion).toBe("paused");
    effect.setActive(true);next(60116);expect(gl.uniform1f.mock.calls.at(-1)![1]).toBe(time);
    effect.destroy();expect(frames.size).toBe(0);expect(gl.deleteProgram).toHaveBeenCalledOnce();expect(gl.deleteBuffer).toHaveBeenCalledOnce();
  });
  it("fails safely with no WebGL and frees already compiled shaders when compilation fails", () => {
    expect(createGoldenRenderer({getContext:()=>null} as unknown as HTMLCanvasElement)).toBeNull();
    const {gl,renderer}=fixture(true);
    expect(renderer()).toBeNull();expect(gl.deleteShader).toHaveBeenCalledTimes(2);
  });
});
