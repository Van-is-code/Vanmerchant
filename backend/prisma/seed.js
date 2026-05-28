import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Tạo Admin user (mặc định phone)
  const adminPin = await bcrypt.hash('000000', 10);
  const adminUser = await prisma.user.upsert({
    where: { phone: '0862215231' },
    update: { role: 'ADMIN' },
    create: {
      name: 'Admin',
      phone: '0862215231',
      role: 'ADMIN',
      pin: adminPin // Test PIN: 000000
    }
  });

  // Tạo test device cho admin để không cần PIN
  const testDeviceId = 'dev_test_browser_12345678';
  await prisma.userDevice.upsert({
    where: { userId_deviceId: { userId: adminUser.id, deviceId: testDeviceId } },
    update: { lastUsedAt: new Date() },
    create: {
      userId: adminUser.id,
      deviceId: testDeviceId,
      deviceName: 'Test Browser'
    }
  });

  // Keep legacy email-based login for backward compatibility
  const legacyAdminPasswordHash = await bcrypt.hash('admin123', 10);
  await prisma.user.upsert({
    where: { email: 'admin@vanmerchant.local' },
    update: { role: 'ADMIN', passwordHash: legacyAdminPasswordHash },
    create: {
      name: 'Admin (Legacy)',
      email: 'admin@vanmerchant.local',
      passwordHash: legacyAdminPasswordHash,
      role: 'ADMIN'
    }
  });

  const legacyOwnerPasswordHash = await bcrypt.hash('123456', 10);
  await prisma.user.upsert({
    where: { email: 'owner@vanmerchant.local' },
    update: { role: 'OWNER' },
    create: {
      name: 'Owner (Legacy)',
      email: 'owner@vanmerchant.local',
      passwordHash: legacyOwnerPasswordHash,
      role: 'OWNER'
    }
  });

  await prisma.user.upsert({
    where: { email: 'staff@vanmerchant.local' },
    update: { role: 'STAFF' },
    create: {
      name: 'Staff (Legacy)',
      email: 'staff@vanmerchant.local',
      passwordHash: legacyOwnerPasswordHash,
      role: 'STAFF'
    }
  });

  const drinks = await prisma.category.upsert({
    where: { id: 'cat-drinks' },
    update: {},
    create: { id: 'cat-drinks', name: 'Do uong', sortOrder: 1 }
  });

  const food = await prisma.category.upsert({
    where: { id: 'cat-food' },
    update: {},
    create: { id: 'cat-food', name: 'Mon an', sortOrder: 2 }
  });

  await prisma.diningTable.upsert({
    where: { qrCode: 'BAN-01' },
    update: {},
    create: { name: 'Ban 01', qrCode: 'BAN-01', seats: 4 }
  });

  await prisma.diningTable.upsert({
    where: { qrCode: 'BAN-02' },
    update: {},
    create: { name: 'Ban 02', qrCode: 'BAN-02', seats: 4 }
  });

  const coffee = await prisma.ingredient.upsert({
    where: { id: 'ing-coffee' },
    update: {},
    create: { id: 'ing-coffee', name: 'Ca phe', unit: 'g', stock: 2000, minStock: 300, unitCost: 2 }
  });

  const milk = await prisma.ingredient.upsert({
    where: { id: 'ing-milk' },
    update: {},
    create: { id: 'ing-milk', name: 'Sua', unit: 'ml', stock: 5000, minStock: 1000, unitCost: 1 }
  });

  const caPheSua = await prisma.menuItem.upsert({
    where: { id: 'menu-ca-phe-sua' },
    update: {},
    create: {
      id: 'menu-ca-phe-sua',
      name: 'Ca phe sua',
      description: 'Ca phe phin voi sua dac',
      price: 30000,
      categoryId: drinks.id,
      imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=600&q=80'
    }
  });

  await prisma.menuItem.upsert({
    where: { id: 'menu-banh-mi' },
    update: {},
    create: {
      id: 'menu-banh-mi',
      name: 'Banh mi trung',
      description: 'Banh mi trung op la',
      price: 35000,
      categoryId: food.id,
      imageUrl: 'https://images.unsplash.com/photo-1608039829572-78524f79c4c7?auto=format&fit=crop&w=600&q=80'
    }
  });

  await prisma.recipeItem.upsert({
    where: { menuItemId_ingredientId: { menuItemId: caPheSua.id, ingredientId: coffee.id } },
    update: {},
    create: { menuItemId: caPheSua.id, ingredientId: coffee.id, quantity: 18 }
  });

  await prisma.recipeItem.upsert({
    where: { menuItemId_ingredientId: { menuItemId: caPheSua.id, ingredientId: milk.id } },
    update: {},
    create: { menuItemId: caPheSua.id, ingredientId: milk.id, quantity: 40 }
  });
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
