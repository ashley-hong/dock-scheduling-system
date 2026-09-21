-- CreateTable
CREATE TABLE "Berth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "lengthFt" INTEGER,
    "capacity" INTEGER DEFAULT 1,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Reservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "berthId" TEXT NOT NULL,
    "occupantName" TEXT NOT NULL,
    "occupantType" TEXT NOT NULL,
    "vesselLengthFt" INTEGER,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Reservation_berthId_fkey" FOREIGN KEY ("berthId") REFERENCES "Berth" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Berth_name_key" ON "Berth"("name");

-- CreateIndex
CREATE INDEX "Reservation_berthId_startDate_endDate_idx" ON "Reservation"("berthId", "startDate", "endDate");
