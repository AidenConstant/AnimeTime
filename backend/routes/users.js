// routes/users.js —— 用户个人中心
const express = require('express');
const supabase = require('../lib/supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── GET /api/users/me/favorites —— 我的收藏 ─
router.get('/me/favorites', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('favorites')
    .select(`anime ( * )`)
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(500).json({ error: '获取收藏失败' });
  res.json(data.map(f => f.anime));
});

// ── GET /api/users/me/history —— 观看历史 ────
router.get('/me/history', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('watch_history')
    .select(`
      episode_number, watched_at, progress_seconds,
      anime ( id, title, cover_url, score, badge )
    `)
    .eq('user_id', req.user.id)
    .order('watched_at', { ascending: false })
    .limit(50);

  if (error) return res.status(500).json({ error: '获取历史失败' });
  res.json(data);
});

// ── POST /api/users/me/history —— 记录观看 ──
router.post('/me/history', requireAuth, async (req, res) => {
  const { anime_id, episode_number, progress_seconds = 0 } = req.body;
  if (!anime_id || !episode_number) {
    return res.status(400).json({ error: '参数缺失' });
  }

  await supabase.from('watch_history').upsert({
    user_id: req.user.id,
    anime_id,
    episode_number: parseInt(episode_number),
    progress_seconds: parseInt(progress_seconds),
    watched_at: new Date().toISOString(),
  }, { onConflict: 'user_id,anime_id,episode_number' });

  res.json({ message: '已记录' });
});

// ── PUT /api/users/me —— 修改个人资料 ────────
router.put('/me', requireAuth, async (req, res) => {
  const { username, avatar_url } = req.body;
  const updates = {};
  if (username) {
    if (username.trim().length < 2) {
      return res.status(400).json({ error: '用户名至少2个字符' });
    }
    updates.username = username.trim();
  }
  if (avatar_url) updates.avatar_url = avatar_url;
  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: '没有可更新的字段' });
  }

  const { data, error } = await supabase
    .from('users')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select('id, username, email, avatar_url, role')
    .single();

  if (error) return res.status(500).json({ error: '更新失败' });
  res.json(data);
});

module.exports = router;
