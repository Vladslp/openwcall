ALTER TABLE "User" ADD COLUMN "nickname" TEXT;
ALTER TABLE "User" ADD COLUMN "nicknameLower" TEXT;
ALTER TABLE "User" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'online';

CREATE UNIQUE INDEX "User_nicknameLower_key" ON "User"("nicknameLower");

CREATE TABLE "FriendRequest" (
  "id" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respondedAt" TIMESTAMP(3),
  CONSTRAINT "FriendRequest_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Friendship" (
  "id" TEXT NOT NULL,
  "userAId" TEXT NOT NULL,
  "userBId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Friendship_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DMThread" (
  "id" TEXT NOT NULL,
  "userAId" TEXT NOT NULL,
  "userBId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastMessageAt" TIMESTAMP(3),
  CONSTRAINT "DMThread_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Message" (
  "id" TEXT NOT NULL,
  "threadId" TEXT,
  "roomId" TEXT,
  "senderId" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FriendRequest_toUserId_status_idx" ON "FriendRequest"("toUserId", "status");
CREATE UNIQUE INDEX "Friendship_userAId_userBId_key" ON "Friendship"("userAId", "userBId");
CREATE UNIQUE INDEX "DMThread_userAId_userBId_key" ON "DMThread"("userAId", "userBId");
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");
CREATE INDEX "Message_roomId_createdAt_idx" ON "Message"("roomId", "createdAt");

ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FriendRequest" ADD CONSTRAINT "FriendRequest_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Friendship" ADD CONSTRAINT "Friendship_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DMThread" ADD CONSTRAINT "DMThread_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DMThread" ADD CONSTRAINT "DMThread_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DMThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
