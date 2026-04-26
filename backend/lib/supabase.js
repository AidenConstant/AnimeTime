// lib/supabase.js —— Supabase 客户端单例
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY, // 服务端用 service_role key，拥有完整权限
  {
    auth: { persistSession: false },
  }
);

module.exports = supabase;
