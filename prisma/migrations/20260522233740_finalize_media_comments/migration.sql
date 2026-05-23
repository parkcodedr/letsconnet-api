/*
  Warnings:

  - Made the column `updatedAt` on table `MediaComment` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "MediaComment" ALTER COLUMN "updatedAt" SET NOT NULL;
