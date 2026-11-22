import { rankLocalMemories, localMemorySnippet } from "@mycellios/core";
import type {
  AdapterContext,
  MemoryCommitRequest,
  MemoryExportRequest,
  MemoryReadRequest,
  MemoryRemoveRequest,
  MemoryRevision,
  MemorySearchRequest,
  MemorySearchResult,
  MemorySnapshot,
  MemoryStore,
  PortableFile,
} from "@mycellios/adapter-kit";
import { MEMORY_REVISION_CONFLICT_ERROR } from "@mycellios/adapter-kit";
import type { PrismaClient } from "@mycellios/db";
import { Prisma, withTransactionRetry } from "@mycellios/db";

export class MarkdownMemoryStore implements MemoryStore {
  constructor(private readonly prisma: PrismaClient) {}

  describe() {
    return {
      id: "markdown",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: { search: true, revisions: true, markdownPortable: true },
    };
  }

  async read(request: MemoryReadRequest, context: AdapterContext): Promise<MemorySnapshot> {
    const documents = await this.prisma.memoryDocument.findMany({
      where: memoryWhere(request, context),
      orderBy: [{ updatedAt: "desc" }, { path: "asc" }],
    });
    return {
      documents: documents.map((doc) => ({
        id: doc.id,
        path: doc.path,
        content: doc.content,
        revision: doc.revision,
        updatedAt: doc.updatedAt.toISOString(),
        ...(doc.inclusion ? {inclusion:doc.inclusion as "essential"|"searchable",userControlled:doc.userControlled,taskThreadId:doc.taskThreadId}:{}),
      })),
    };
  }

  async search(
    request: MemorySearchRequest,
    context: AdapterContext,
  ): Promise<MemorySearchResult[]> {
    const documents = await this.prisma.memoryDocument.findMany({where:memoryWhere(request,context)});
    return rankLocalMemories(documents,request.query).slice(0,Math.min(10,request.limit??5)).map(({document,score})=>({
      id:document.id,path:document.path,snippet:localMemorySnippet(document.content,request.query),score,
      scope:document.scope as "bot"|"user",taskThreadId:document.taskThreadId,
    }));
  }

  async commit(request: MemoryCommitRequest, context: AdapterContext): Promise<MemoryRevision> {
    // A save replaces the current content and appends its history atomically.
    // Conflicts retry the whole transaction so revision numbers use fresh state.
    return withTransactionRetry(() =>
      this.prisma.$transaction(
        async (tx) => {
          if(context.botId && request.botId && context.botId!==request.botId) throw new Error("A Mico cannot access another Mico's memory");
          if (request.sourceContext) {
            const { sourceThreadId, sourceContext } = request;
            if (!sourceThreadId || !context.botId) throw new Error("Memory review source unavailable");
            // Take the same row lock as deletion and context changes before locking any note.
            const source = await tx.thread.updateMany({
              where: {
                id: sourceThreadId,
                spaceId: context.spaceId,
                userId: context.userId,
                OR: [{ botId: context.botId }, { taskBotId: context.botId }],
                deleteAfter: null,
                historyCompactionGeneration: sourceContext.generation,
                contextStartSeq: sourceContext.startSeq,
                nextMessageSeq: sourceContext.nextSeq,
              },
              data: { nextMessageSeq: { increment: 0 } },
            });
            if (!source.count) throw new Error("Memory review source changed");
          }
          if (request.scope === "bot") {
            if (!request.botId || !await tx.bot.findFirst({where:{id:request.botId,spaceId:context.spaceId,userId:context.userId},select:{id:true}})) throw new Error("Memory Mico unavailable");
          }
          if (request.taskThreadId) {
            if(request.scope!=="bot" || !await tx.thread.findFirst({where:{id:request.taskThreadId,OR:[{botId:request.botId},{taskBotId:request.botId}],spaceId:context.spaceId,userId:context.userId},select:{id:true}})) throw new Error("Memory task unavailable");
            if(!request.path.startsWith(`tasks/${request.taskThreadId}/`)) throw new Error("Task memory path must be namespaced");
          } else if(request.path.startsWith("tasks/")) throw new Error("Task memory needs its conversation");
          const existing = await tx.memoryDocument.findFirst({
            where: {
              spaceId: context.spaceId,
              userId: context.userId,
              scope: request.scope,
              botId: request.botId ?? null,
              path: request.path,
            },
          });
          if (request.expectedRevision !== undefined) {
            const live = existing?.revision ?? 0;
            if (live !== request.expectedRevision) throw new Error(MEMORY_REVISION_CONFLICT_ERROR);
          }
          if(existing?.taskThreadId && existing.taskThreadId!==request.taskThreadId) throw new Error("Memory task mismatch");
          if(existing?.userControlled && request.sourceRunId && !request.selectionByUser && request.inclusion!==undefined && request.inclusion!==existing.inclusion) throw new Error("Memory selection is user controlled");
          const inclusion=request.inclusion??existing?.inclusion??"searchable";
          if(inclusion==="essential") {
            const others=await tx.memoryDocument.findMany({where:{spaceId:context.spaceId,userId:context.userId,scope:request.scope,botId:request.botId??null,taskThreadId:request.taskThreadId??null,inclusion:"essential",...(existing?{id:{not:existing.id}}:{})},select:{content:true,path:true}});
            const bytes=others.reduce((n,d)=>n+Buffer.byteLength(d.path+"\n"+d.content,"utf8")+100,0)+Buffer.byteLength(request.path+"\n"+request.content,"utf8")+100;
            if(bytes>8192)throw new Error("Essential memory limit: 8 KB per scope. Keep the rest searchable.");
          }
          const metadata={inclusion,taskThreadId:request.taskThreadId??null,...(request.selectionByUser?{userControlled:true}:{})};
          const doc = existing
            ? await tx.memoryDocument.update({
                where: { id: existing.id },
                data: { content: request.content, revision: existing.revision + 1, ...metadata },
              })
            : await tx.memoryDocument.create({
                data: {
                  spaceId: context.spaceId,
                  userId: context.userId,
                  botId: request.botId,
                  scope: request.scope,
                  ...metadata,
                  path: request.path,
                  content: request.content,
                },
              });
          await tx.memoryRevision.create({
            data: {
              documentId: doc.id,
              revision: doc.revision,
              content: request.content,
              sourceRunId: request.sourceRunId,
              sourceThreadId: request.sourceThreadId,
            },
          });
          return { id: doc.id, path: doc.path, revision: doc.revision, content: doc.content };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  async remove(
    request: MemoryRemoveRequest,
    context: AdapterContext,
  ): Promise<{ removed: boolean }> {
    // Revisions cascade with the document row.
    const { count } = await this.prisma.memoryDocument.deleteMany({
      where: {
        ...(request.id ? { id: request.id } : {}),
        spaceId: context.spaceId,
        userId: context.userId,
        scope: request.scope,
        botId: request.botId ?? null,
        path: request.path,
      },
    });
    return { removed: count > 0 };
  }

  async *exportMarkdown(
    request: MemoryExportRequest,
    context: AdapterContext,
  ): AsyncIterable<PortableFile> {
    const snapshot = await this.read(
      { scope: request.scope === "all" ? "user" : request.scope, botId: request.botId },
      context,
    );
    for (const doc of snapshot.documents) {
      yield { path: doc.path, content: new TextEncoder().encode(doc.content) };
    }
  }

  async importMarkdown(
    files: AsyncIterable<PortableFile>,
    context: AdapterContext,
  ): Promise<MemoryRevision> {
    let last: MemoryRevision | undefined;
    for await (const file of files) {
      last = await this.commit(
        {
          scope: "user",
          path: file.path,
          content: new TextDecoder().decode(file.content),
        },
        context,
      );
    }
    if (!last) throw new Error("No memory files to import");
    return last;
  }
}

function snippet(content: string, q: string): string {
  const idx = content.toLowerCase().indexOf(q);
  if (idx < 0) return content.slice(0, 140);
  return content.slice(Math.max(0, idx - 40), idx + q.length + 80);
}

function memoryWhere(request:MemoryReadRequest|MemorySearchRequest,context:AdapterContext) {
 const scope=request.scope;
 if(context.botId && request.botId && context.botId!==request.botId)throw new Error("A Mico cannot access another Mico's memory");
 if(scope!=="user"&&!request.botId)throw new Error("A Mico is required to read individual memory");
 const general=request.includeGeneral!==false;
 return {spaceId:context.spaceId,userId:context.userId,
  ...(scope==="all"?{OR:[{scope:"bot",botId:request.botId},...(general?[{scope:"user",botId:null}]:[])]}:scope==="user"?{scope,botId:null}:{scope,botId:request.botId}),
  AND:[{OR:[{taskThreadId:null},...(request.taskThreadId?[{taskThreadId:request.taskThreadId}]:[])]}],
  ...("path" in request && request.path?{path:request.path}:{}),
 };
}
