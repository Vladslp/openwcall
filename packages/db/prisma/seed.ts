import { prisma } from "../src/client";
import bcrypt from "bcryptjs";

async function main() {
  const email = "demo@openwcall.dev";
  const existing = await prisma.user.findUnique({ where: { email } });
  if (!existing) {
    const passwordHash = await bcrypt.hash("demo1234", 10);
    const user = await prisma.user.create({
      data: {
        email,
        name: "Demo User",
        passwordHash,
        avatarUrl: "https://api.dicebear.com/7.x/shapes/svg?seed=OpenWCall"
      }
    });
    await prisma.room.create({
      data: {
        name: "OpenWCall Lobby",
        isPublic: true,
        hostId: user.id
      }
    });
    return;
  }

  const roomExists = await prisma.room.findFirst({ where: { name: "OpenWCall Lobby" } });
  if (!roomExists) {
    await prisma.room.create({
      data: {
        name: "OpenWCall Lobby",
        isPublic: true,
        hostId: existing.id
      }
    });
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
