import { prisma } from "../src/client";
import bcrypt from "bcryptjs";

function normalizeNickname(nickname: string) {
  return nickname.trim().toLowerCase();
}

async function upsertDemoUser(email: string, name: string, nickname: string) {
  const passwordHash = await bcrypt.hash("demo1234", 10);
  return prisma.user.upsert({
    where: { email },
    update: { name, nickname, nicknameLower: normalizeNickname(nickname), passwordHash },
    create: {
      email,
      name,
      nickname,
      nicknameLower: normalizeNickname(nickname),
      passwordHash,
      avatarUrl: `https://api.dicebear.com/7.x/shapes/svg?seed=${encodeURIComponent(name)}`
    }
  });
}

async function main() {
  const alice = await upsertDemoUser("demo@openwcall.dev", "Demo User", "demo.user");
  const bob = await upsertDemoUser("sam@openwcall.dev", "Sam Wave", "sam.wave");

  const room = await prisma.room.upsert({
    where: { id: "demo-room-id" },
    update: { name: "OpenWCall Lobby", hostId: alice.id },
    create: { id: "demo-room-id", name: "OpenWCall Lobby", isPublic: true, hostId: alice.id }
  });

  const [userAId, userBId] = [alice.id, bob.id].sort();
  await prisma.friendship.upsert({ where: { userAId_userBId: { userAId, userBId } }, update: {}, create: { userAId, userBId } });

  const thread = await prisma.dMThread.upsert({ where: { userAId_userBId: { userAId, userBId } }, update: { lastMessageAt: new Date() }, create: { userAId, userBId, lastMessageAt: new Date() } });

  await prisma.message.create({ data: { threadId: thread.id, senderId: alice.id, body: "Hey @sam.wave, welcome to OpenWCall DM!" } });
  await prisma.message.create({ data: { threadId: thread.id, senderId: bob.id, body: "Thanks! Testing reactions + edits now." } });
  const roomMsg = await prisma.message.create({ data: { roomId: room.id, senderId: bob.id, body: "Room text chat seeded with mention for @demo.user" } });

  await prisma.notification.create({ data: { userId: alice.id, type: "mention", data: { roomId: room.id, messageId: roomMsg.id } } });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
