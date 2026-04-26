// routes/comments.js —— 评论系统
const express = require('express');
const supabase = require('../lib/supabase');
const { requireAuth, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// 简单内容过滤（可扩展）
const BAD_WORDS = ['spam', '广告', '微信', 'QQ号'];
function filterContent(text) {
  return BAD_WORDS.some(w => text.includes(w));
}

// ── GET /api/comments/:animeId —— 获取评论 ──
router.get('/:animeId', async (req, res) => {
  const { page = 1, limit = 20 } = req.query;
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const { data, count, error } = await supabase
    .from('comments')
    .select(`
      id, content, created_at, likes,
      users ( id, username, avatar_url )
    `, { count: 'exact' })
    .eq('anime_id', req.params.animeId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .range(offset, offset + parseInt(limit) - 1);

  if (error) return res.status(500).json({ error: '获取评论失败' });

  res.json({
    data,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total: count,
      totalPages: Math.ceil(count / parseInt(limit)),
    },
  });
});

// ── POST /api/comments/:animeId —— 发布评论 ─
router.post('/:animeId', requireAuth, async (req, res) => {
  const { content } = req.body;
  if (!content || !content.trim()) {
    return res.status(400).json({ error: '评论内容不能为空' });
  }
  if (content.trim().length > 500) {
    return res.status(400).json({ error: '评论最多500字' });
  }
  if (filterContent(content)) {
    return res.status(400).json({ error: '评论包含违禁内容' });
  }

  // 防刷：同一用户同一动漫1分钟内只能发1条
  const { data: recent } = await supabase
    .from('comments')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('anime_id', req.params.animeId)
    .gte('created_at', new Date(Date.now() - 60000).toISOString())
    .maybeSingle();

  if (recent) {
    return res.status(429).json({ error: '发评论太频繁，请稍后再试' });
  }

  const { data, error } = await supabase
    .from('comments')
    .insert({
      content: content.trim(),
      anime_id: req.params.animeId,
      user_id: req.user.id,
      deleted: false,
      likes: 0,
    })
    .select(`id, content, created_at, likes, users ( id, username, avatar_url )`)
    .single();

  if (error) return res.status(500).json({ error: '发布失败' });
  res.status(201).json(data);
});

// ── DELETE /api/comments/:id —— 删除评论 ────
// 本人或管理员可删
router.delete('/:id', requireAuth, async (req, res) => {
  const { data: comment } = await supabase
    .from('comments')
    .select('user_id')
    .eq('id', req.params.id)
    .single();

  if (!comment) return res.status(404).json({ error: '评论不存在' });

  const canDelete = req.user.role === 'admin' || comment.user_id === req.user.id;
  if (!canDelete) return res.status(403).json({ error: '无权删除此评论' });

  await supabase
    .from('comments')
    .update({ deleted: true })
    .eq('id', req.params.id);

  if (req.user.role === 'admin') {
    await supabase.from('logs').insert({
      type: 'warn',
      message: `管理员删除评论 #${req.params.id}`,
      user_id: req.user.id,
    });
  }

  res.json({ message: '已删除' });
});

// ── POST /api/comments/:id/like —— 点赞 ─────
router.post('/:id/like', requireAuth, async (req, res) => {
  const { data: comment } = await supabase
    .from('comments')
    .select('likes')
    .eq('id', req.params.id)
    .single();

  if (!comment) return res.status(404).json({ error: '评论不存在' });

  await supabase
    .from('comments')
    .update({ likes: comment.likes + 1 })
    .eq('id', req.params.id);

  res.json({ likes: comment.likes + 1 });
});

module.exports = router;
