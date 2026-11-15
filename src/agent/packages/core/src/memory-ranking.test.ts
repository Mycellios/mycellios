import {expect,it} from "vitest";
import {rankLocalMemories,localMemorySnippet} from "./memory-ranking.js";
it("finds an old relevant decision ahead of recent unrelated notes",()=>{
 const old={path:"railway.md",content:"Migrar Uptime Kuma conservando los datos de Railway",updatedAt:"2020-01-01"};
 const fresh={path:"comida.md",content:"Comprar pan hoy",updatedAt:"2030-01-01"};
 expect(rankLocalMemories([fresh,old],"¿Cómo migramos Kuma de Railway?").map(x=>x.document)).toEqual([old]);
});
it("matches accented Spanish and content far beyond the first paragraph",()=>{
 const content="texto irrelevante ".repeat(300)+"\n\nDecisión: migración de Railway";
 expect(rankLocalMemories([{path:"notas.md",content}],"decision migracion")).toHaveLength(1);
 expect(localMemorySnippet(content,"migración")).toContain("Railway");
 expect(localMemorySnippet(content,"migración").length).toBeLessThan(1700);
});
it("never dumps unrelated notes on an empty or stop-word-only query",()=>{
 expect(rankLocalMemories([{path:"a",content:"Railway"}],"de la y")).toEqual([]);
});
