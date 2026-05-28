import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function getBusinessDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

async function upsertUserByPhone({ name, phone, role, pin }) {
  return prisma.user.upsert({
    where: { phone },
    update: { name, role, pin },
    create: { name, phone, role, pin }
  });
}

async function upsertUserByEmail({ name, email, role, passwordHash }) {
  return prisma.user.upsert({
    where: { email },
    update: { name, role, passwordHash },
    create: { name, email, role, passwordHash }
  });
}

async function upsertTable({ name, qrCode, seats }) {
  return prisma.diningTable.upsert({
    where: { qrCode },
    update: { name, seats, active: true },
    create: { name, qrCode, seats, active: true }
  });
}

async function upsertCategory({ id, name, sortOrder }) {
  return prisma.category.upsert({
    where: { id },
    update: { name, sortOrder },
    create: { id, name, sortOrder }
  });
}

async function upsertIngredient({ id, name, unit, stock, minStock, unitCost }) {
  return prisma.ingredient.upsert({
    where: { id },
    update: { name, unit, stock, minStock, unitCost, active: true },
    create: { id, name, unit, stock, minStock, unitCost, active: true }
  });
}

async function upsertMenuItem({ id, name, description, price, categoryId, imageUrl, active = true, hidden = false }) {
  return prisma.menuItem.upsert({
    where: { id },
    update: { name, description, price, categoryId, imageUrl, active, hidden },
    create: { id, name, description, price, categoryId, imageUrl, active, hidden }
  });
}

async function upsertRecipeItem({ menuItemId, ingredientId, quantity }) {
  return prisma.recipeItem.upsert({
    where: { menuItemId_ingredientId: { menuItemId, ingredientId } },
    update: { quantity },
    create: { menuItemId, ingredientId, quantity }
  });
}

async function upsertCustomer({ phone, name }) {
  return prisma.customer.upsert({
    where: { phone },
    update: { name },
    create: { phone, name }
  });
}

async function upsertOrder({
  businessDate,
  dailySequence,
  tableId,
  customerId,
  paymentMethod,
  paymentStatus,
  status,
  subtotal,
  costTotal,
  note,
  items
}) {
  return prisma.order.upsert({
    where: { businessDate_dailySequence: { businessDate, dailySequence } },
    update: {},
    create: {
      businessDate,
      dailySequence,
      tableId,
      customerId,
      paymentMethod,
      paymentStatus,
      status,
      subtotal,
      costTotal,
      note,
      items: {
        create: items
      }
    }
  });
}

async function main() {
  const adminPinHash = await bcrypt.hash('000000', 10);
  const legacyAdminPasswordHash = await bcrypt.hash('admin123', 10);
  const legacyOwnerPasswordHash = await bcrypt.hash('123456', 10);

  const adminUser = await upsertUserByPhone({
    name: 'Admin',
    phone: '0862215231',
    role: 'ADMIN',
    pin: adminPinHash
  });

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

  await upsertUserByEmail({
    name: 'Admin (Legacy)',
    email: 'admin@vanmerchant.local',
    role: 'ADMIN',
    passwordHash: legacyAdminPasswordHash
  });

  await upsertUserByEmail({
    name: 'Owner (Legacy)',
    email: 'owner@vanmerchant.local',
    role: 'OWNER',
    passwordHash: legacyOwnerPasswordHash
  });

  await upsertUserByEmail({
    name: 'Staff (Legacy)',
    email: 'staff@vanmerchant.local',
    role: 'STAFF',
    passwordHash: legacyOwnerPasswordHash
  });

  const drinksCategory = await upsertCategory({ id: 'cat-drinks', name: 'Do uong', sortOrder: 1 });
  const coffeeCategory = await upsertCategory({ id: 'cat-coffee', name: 'Cafe', sortOrder: 2 });
  const foodCategory = await upsertCategory({ id: 'cat-food', name: 'Mon an', sortOrder: 3 });
  const comboCategory = await upsertCategory({ id: 'cat-combo', name: 'Combo', sortOrder: 4 });

  const tables = await Promise.all([
    upsertTable({ name: 'Ban 01', qrCode: 'BAN-01', seats: 4 }),
    upsertTable({ name: 'Ban 02', qrCode: 'BAN-02', seats: 4 }),
    upsertTable({ name: 'Ban 03', qrCode: 'BAN-03', seats: 2 }),
    upsertTable({ name: 'Ban 04', qrCode: 'BAN-04', seats: 6 }),
    upsertTable({ name: 'Ban 05', qrCode: 'BAN-05', seats: 4 }),
    upsertTable({ name: 'Ban 06', qrCode: 'BAN-06', seats: 8 })
  ]);

  const coffeeBean = await upsertIngredient({
    id: 'ing-coffee',
    name: 'Ca phe',
    unit: 'g',
    stock: 2000,
    minStock: 300,
    unitCost: 2
  });

  const milk = await upsertIngredient({
    id: 'ing-milk',
    name: 'Sua',
    unit: 'ml',
    stock: 5000,
    minStock: 1000,
    unitCost: 1
  });

  const tea = await upsertIngredient({
    id: 'ing-tea',
    name: 'Tra',
    unit: 'g',
    stock: 1800,
    minStock: 250,
    unitCost: 1
  });

  const sugar = await upsertIngredient({
    id: 'ing-sugar',
    name: 'Duong',
    unit: 'g',
    stock: 3000,
    minStock: 500,
    unitCost: 1
  });

  const egg = await upsertIngredient({
    id: 'ing-egg',
    name: 'Trung ga',
    unit: 'qua',
    stock: 100,
    minStock: 20,
    unitCost: 4000
  });

  const bread = await upsertIngredient({
    id: 'ing-bread',
    name: 'Banh mi',
    unit: 'cai',
    stock: 80,
    minStock: 15,
    unitCost: 5000
  });

  const chicken = await upsertIngredient({
    id: 'ing-chicken',
    name: 'Thit ga',
    unit: 'g',
    stock: 5000,
    minStock: 800,
    unitCost: 3
  });

  const coffeeMilk = await upsertMenuItem({
    id: 'menu-ca-phe-sua',
    name: 'Ca phe sua',
    description: 'Ca phe phin voi sua dac',
    price: 30000,
    categoryId: coffeeCategory.id,
    imageUrl: 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?auto=format&fit=crop&w=600&q=80'
  });

  const blackCoffee = await upsertMenuItem({
    id: 'menu-ca-phe-den',
    name: 'Ca phe den',
    description: 'Ca phe phin dam vi',
    price: 25000,
    categoryId: coffeeCategory.id,
    imageUrl: 'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?auto=format&fit=crop&w=600&q=80'
  });

  const milkTea = await upsertMenuItem({
    id: 'menu-tra-sua',
    name: 'Tra sua',
    description: 'Tra sua truyen thong',
    price: 32000,
    categoryId: drinksCategory.id,
    imageUrl: 'https://images.unsplash.com/photo-1558857563-c8d6f5c6a37a?auto=format&fit=crop&w=600&q=80'
  });

  const peachTea = await upsertMenuItem({
    id: 'menu-tra-dao',
    name: 'Tra dao',
    description: 'Tra dao mat lanh',
    price: 28000,
    categoryId: drinksCategory.id,
    imageUrl: 'https://images.unsplash.com/photo-1509042239860-f550ce710b93?auto=format&fit=crop&w=600&q=80'
  });

  const friedEggBread = await upsertMenuItem({
    id: 'menu-banh-mi-trung',
    name: 'Banh mi trung',
    description: 'Banh mi trung op la',
    price: 35000,
    categoryId: foodCategory.id,
    imageUrl: 'https://images.unsplash.com/photo-1608039829572-78524f79c4c7?auto=format&fit=crop&w=600&q=80'
  });

  const chickenRice = await upsertMenuItem({
    id: 'menu-com-ga',
    name: 'Com ga',
    description: 'Com ga xoi mo',
    price: 45000,
    categoryId: foodCategory.id,
    imageUrl: 'https://images.unsplash.com/photo-1512058564366-18510be2db19?auto=format&fit=crop&w=600&q=80'
  });

  const comboBreakfast = await upsertMenuItem({
    id: 'menu-combo-sang',
    name: 'Combo sang',
    description: 'Banh mi trung + ca phe sua',
    price: 60000,
    categoryId: comboCategory.id,
    imageUrl: 'https://images.unsplash.com/photo-1482049016688-2d3e1b311543?auto=format&fit=crop&w=600&q=80'
  });

  await upsertRecipeItem({ menuItemId: coffeeMilk.id, ingredientId: coffeeBean.id, quantity: 18 });
  await upsertRecipeItem({ menuItemId: coffeeMilk.id, ingredientId: milk.id, quantity: 40 });
  await upsertRecipeItem({ menuItemId: blackCoffee.id, ingredientId: coffeeBean.id, quantity: 20 });
  await upsertRecipeItem({ menuItemId: milkTea.id, ingredientId: tea.id, quantity: 12 });
  await upsertRecipeItem({ menuItemId: milkTea.id, ingredientId: milk.id, quantity: 35 });
  await upsertRecipeItem({ menuItemId: milkTea.id, ingredientId: sugar.id, quantity: 10 });
  await upsertRecipeItem({ menuItemId: peachTea.id, ingredientId: tea.id, quantity: 10 });
  await upsertRecipeItem({ menuItemId: peachTea.id, ingredientId: sugar.id, quantity: 8 });
  await upsertRecipeItem({ menuItemId: friedEggBread.id, ingredientId: bread.id, quantity: 1 });
  await upsertRecipeItem({ menuItemId: friedEggBread.id, ingredientId: egg.id, quantity: 2 });
  await upsertRecipeItem({ menuItemId: chickenRice.id, ingredientId: chicken.id, quantity: 120 });
  await upsertRecipeItem({ menuItemId: comboBreakfast.id, ingredientId: bread.id, quantity: 1 });
  await upsertRecipeItem({ menuItemId: comboBreakfast.id, ingredientId: egg.id, quantity: 2 });
  await upsertRecipeItem({ menuItemId: comboBreakfast.id, ingredientId: coffeeBean.id, quantity: 18 });
  await upsertRecipeItem({ menuItemId: comboBreakfast.id, ingredientId: milk.id, quantity: 40 });

  const customerAn = await upsertCustomer({ phone: '0901111111', name: 'Anh An' });
  const customerBinh = await upsertCustomer({ phone: '0902222222', name: 'Chi Binh' });

  const businessDate = getBusinessDate();

  await upsertOrder({
    businessDate,
    dailySequence: 1,
    tableId: tables[0].id,
    customerId: customerAn.id,
    paymentMethod: 'CASH',
    paymentStatus: 'PAID',
    status: 'DELIVERED',
    subtotal: 95000,
    costTotal: 26000,
    note: 'Order mau cho dashboard',
    items: [
      {
        menuItemId: coffeeMilk.id,
        name: coffeeMilk.name,
        quantity: 2,
        price: coffeeMilk.price,
        cost: 9000
      },
      {
        menuItemId: friedEggBread.id,
        name: friedEggBread.name,
        quantity: 1,
        price: friedEggBread.price,
        cost: 17000
      }
    ]
  });

  await upsertOrder({
    businessDate,
    dailySequence: 2,
    tableId: tables[1].id,
    customerId: customerBinh.id,
    paymentMethod: 'BANK_TRANSFER',
    paymentStatus: 'PENDING_PAYMENT',
    status: 'NEW',
    subtotal: 60000,
    costTotal: 18000,
    note: 'Don chua thanh toan mau',
    items: [
      {
        menuItemId: comboBreakfast.id,
        name: comboBreakfast.name,
        quantity: 1,
        price: comboBreakfast.price,
        cost: 18000
      }
    ]
  });

  console.log('Seed completed with sample users, tables, menu items, customers, and orders.');
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
