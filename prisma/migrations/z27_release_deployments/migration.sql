CREATE TABLE "ReleaseDeployment" (
    "id" SERIAL NOT NULL,
    "version" TEXT NOT NULL,
    "commit" TEXT NOT NULL,
    "builtAt" TIMESTAMP(3) NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseDeployment_pkey" PRIMARY KEY ("id")
);
