import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('缺少 DATABASE_URL，請先由 .env.example 建立 .env。');
}
const adapter = new PrismaPg({ connectionString });

export const prisma = new PrismaClient({ adapter });
