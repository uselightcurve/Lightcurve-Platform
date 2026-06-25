import 'dotenv/config';
import { db } from './src/db';
import { users } from './src/db/schema';
import { generateApiKey } from './src/lib/sdkAuth';
import { apiKeys } from './src/db/schema';
import { desc } from 'drizzle-orm';

async function main() {
  const allUsers = await db.select().from(users).limit(1);
  if (allUsers.length === 0) {
    console.log("No users found");
    process.exit(1);
  }
  const user = allUsers[0];
  
  const generated = generateApiKey();
  await db.insert(apiKeys).values({
    ownerUserId: user.id,
    name: 'Auto Test Key',
    keyPrefix: generated.prefix,
    keyHash: generated.hash,
  });
  
  console.log("GENERATED_KEY=" + generated.value);
  process.exit(0);
}

main().catch(console.error);
