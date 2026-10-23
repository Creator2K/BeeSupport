-- AI 知识库切片（RAG 检索单位），可选携带 embedding 向量
CREATE TABLE "AiKnowledgeChunk" (
    "id" TEXT NOT NULL,
    "knowledgeId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" DOUBLE PRECISION[] DEFAULT ARRAY[]::DOUBLE PRECISION[],
    "embeddingModel" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiKnowledgeChunk_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiKnowledgeChunk_knowledgeId_idx" ON "AiKnowledgeChunk"("knowledgeId");

ALTER TABLE "AiKnowledgeChunk"
    ADD CONSTRAINT "AiKnowledgeChunk_knowledgeId_fkey"
    FOREIGN KEY ("knowledgeId") REFERENCES "AiKnowledge"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
