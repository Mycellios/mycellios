import { expect, it } from "vitest";
import { assertSidebarFolderParent, sidebarFolderTree } from "./sidebar-folders.js";
const tree = [{id:"a",name:"Finanzas"},{id:"b",name:"Contabilidad",parentId:"a"},{id:"c",name:"2026",parentId:"b"},{id:"d",name:"Marketing"}];
it("reads old flat folders and orders nested paths without losing empty folders", () => {
  expect(sidebarFolderTree([tree[2]!,tree[0]!,tree[3]!,tree[1]!]).map(f=>[f.id,f.path,f.ancestorIds]))
    .toEqual([["a","Finanzas",[]],["b","Finanzas / Contabilidad",["a"]],["c","Finanzas / Contabilidad / 2026",["a","b"]],["d","Marketing",[]]]);
});
it("permits three levels and rejects a fourth", () => {
  expect(()=>assertSidebarFolderParent(tree,null,"b")).not.toThrow();
  expect(()=>assertSidebarFolderParent(tree,null,"c")).toThrow("three levels");
});
it("rejects cycles, self moves, unknown parents and moves that overflow the subtree", () => {
  for (const target of ["a","b","c","unknown"]) expect(()=>assertSidebarFolderParent(tree,"a",target)).toThrow();
  expect(()=>assertSidebarFolderParent(tree,"a","d")).toThrow("three levels");
  expect(()=>assertSidebarFolderParent(tree,"b","d")).not.toThrow();
  expect(()=>assertSidebarFolderParent(tree,"c",null)).not.toThrow();
});
it("recovers corrupt parents and cycles at the top level", () => {
  const folders=[{id:"a",name:"A",parentId:"b"},{id:"b",name:"B",parentId:"a"},{id:"c",name:"C",parentId:"gone"}];
  expect(sidebarFolderTree(folders).map(f=>[f.id,f.parentId])).toEqual([["a",null],["b",null],["c",null]]);
});
