-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "meta" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "preferences" JSONB;

-- AlterTable
ALTER TABLE "Visitor" DROP COLUMN "createdAt",
ADD COLUMN     "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "landingPage" TEXT,
ADD COLUMN     "lastPage" TEXT,
ADD COLUMN     "lastPageTitle" TEXT,
ADD COLUMN     "pageViews" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "referrer" TEXT,
ADD COLUMN     "visitCount" INTEGER NOT NULL DEFAULT 1;

