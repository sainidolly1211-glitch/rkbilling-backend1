/**
 * One-time Admin bootstrap.
 *
 * Creates a Supabase Auth user AND the linked `profiles` row (role = admin),
 * attached to the seeded shop. Run this once so you can log in and see/edit
 * everything from the Admin panel.
 *
 * USAGE (from the backend folder, with .env filled in):
 *   node scripts/createAdmin.js "admin@rkgarments.com" "YourStrongPass123" "Shop Owner"
 *
 * Re-running with the same email will just (re)link / promote the profile.
 */
import { supabaseAdmin } from '../src/config/supabase.js';

const SHOP_ID = '11111111-1111-1111-1111-111111111111';
const BRANCH_ID = '22222222-2222-2222-2222-222222222222';

const [, , emailArg, passwordArg, nameArg, roleArg] = process.argv;
const email = emailArg || 'admin@rkgarments.com';
const password = passwordArg || 'Admin@12345';
const fullName = nameArg || 'Shop Owner';
const role = ['admin', 'manager', 'staff', 'partner'].includes(roleArg) ? roleArg : 'admin';

async function run() {
  console.log(`Creating admin: ${email}`);

  // 1) Ensure the shop exists (in case 04_seed.sql was not run)
  await supabaseAdmin.from('shops').upsert(
    { id: SHOP_ID, name: 'RK Garments', currency: 'INR' },
    { onConflict: 'id' },
  );
  await supabaseAdmin.from('branches').upsert(
    { id: BRANCH_ID, shop_id: SHOP_ID, name: 'Main Store', code: 'MAIN' },
    { onConflict: 'id' },
  );

  // 2) Create (or find) the auth user
  let userId;
  const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr) {
    // Likely already exists -> look it up
    console.log('User may already exist, looking it up...');
    const { data: list } = await supabaseAdmin.auth.admin.listUsers();
    const existing = list?.users?.find((u) => u.email === email);
    if (!existing) throw createErr;
    userId = existing.id;
    // reset password to the provided one
    await supabaseAdmin.auth.admin.updateUserById(userId, { password });
  } else {
    userId = created.user.id;
  }

  // 3) Upsert the profile with the requested role
  const { error: profErr } = await supabaseAdmin.from('profiles').upsert(
    {
      id: userId,
      shop_id: SHOP_ID,
      branch_id: BRANCH_ID,
      full_name: fullName,
      email,
      role,
      is_active: true,
    },
    { onConflict: 'id' },
  );
  if (profErr) throw profErr;

  console.log('\n✅ User ready!');
  console.log('   Email   :', email);
  console.log('   Password:', password);
  console.log('   Role    :', role);
  console.log('\nNow log in from the frontend with these credentials.');
  process.exit(0);
}

run().catch((e) => {
  console.error('\n❌ Failed:', e.message);
  process.exit(1);
});
