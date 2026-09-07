import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { supabase } from '../lib/supabase'
import { BellIcon, BookOpenIcon, BranchIcon, TrashIcon } from '../icons'

async function fetchCommunityPosts() {
  const { data, error } = await supabase
    .from('community_posts')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data ?? []
}

async function createCommunityPost(userId, authorName, content) {
  const { data, error } = await supabase
    .from('community_posts')
    .insert({
      user_id: userId,
      author_name: authorName,
      content,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function deleteCommunityPost(postId) {
  const { error } = await supabase.from('community_posts').delete().eq('id', postId)
  if (error) throw error
}

async function fetchPostReactions(postIds) {
  if (postIds.length === 0) return []
  const { data, error } = await supabase
    .from('community_post_reactions')
    .select('*')
    .in('post_id', postIds)
  if (error) throw error
  return data ?? []
}

async function togglePostReaction(postId, userId, emoji) {
  const { data: existing } = await supabase
    .from('community_post_reactions')
    .select('id')
    .eq('post_id', postId)
    .eq('user_id', userId)
    .eq('emoji', emoji)
    .maybeSingle()
  if (existing) {
    await supabase.from('community_post_reactions').delete().eq('id', existing.id)
    return false
  }
  await supabase.from('community_post_reactions').insert({
    post_id: postId,
    user_id: userId,
    emoji,
  })
  return true
}

async function fetchPrayerRequests() {
  const { data, error } = await supabase
    .from('prayer_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return data ?? []
}

async function createPrayerRequest(userId, content, authorName, isAnonymous) {
  const { data, error } = await supabase
    .from('prayer_requests')
    .insert({
      user_id: userId,
      content,
      author_name: authorName,
      is_anonymous: isAnonymous,
    })
    .select()
    .single()
  if (error) throw error
  return data
}

async function deletePrayerRequest(prayerId) {
  const { error } = await supabase.from('prayer_requests').delete().eq('id', prayerId)
  if (error) throw error
}

async function fetchPrayerSupporters(prayerIds) {
  if (prayerIds.length === 0) return []
  const { data, error } = await supabase
    .from('prayer_supporters')
    .select('*')
    .in('prayer_id', prayerIds)
  if (error) throw error
  return data ?? []
}

async function togglePrayerSupport(prayerId, userId) {
  const { data: existing } = await supabase
    .from('prayer_supporters')
    .select('id')
    .eq('prayer_id', prayerId)
    .eq('user_id', userId)
    .maybeSingle()
  if (existing) {
    await supabase.from('prayer_supporters').delete().eq('id', existing.id)
    return false
  }
  await supabase.from('prayer_supporters').insert({
    prayer_id: prayerId,
    user_id: userId,
  })
  return true
}

const REACTION_EMOJIS = ['🙌', '🔥', '❤️', '🕊️']
const TABS = [
  { key: 'stories', label: 'Stories', icon: BookOpenIcon },
  { key: 'prayers', label: 'Prayers', icon: BranchIcon },
]

function formatRelativeTime(dateString) {
  const diffMs = Date.now() - new Date(dateString).getTime()
  const minutes = Math.floor(diffMs / 6e4)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'Yesterday' : `${days} days ago`
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1][0] : ''
  return (first + last).toUpperCase()
}

export default function Community() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('prayers')
  const [posts, setPosts] = useState([])
  const [reactions, setReactions] = useState({})
  const [postDraft, setPostDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [prayers, setPrayers] = useState([])
  const [prayerSupportCounts, setPrayerSupportCounts] = useState({})
  const [mySupportedPrayers, setMySupportedPrayers] = useState(new Set())
  const [prayerDraft, setPrayerDraft] = useState('')
  const [postAnonymously, setPostAnonymously] = useState(false)
  const [submittingPrayer, setSubmittingPrayer] = useState(false)
  const [expandedPosts, setExpandedPosts] = useState(new Set())
  const [loading, setLoading] = useState(true)

  const authorName = user?.user_metadata?.full_name ?? null
  const myInitials = getInitials(authorName)

  const loadPosts = useCallback(async () => {
    if (!user) return
    const fetchedPosts = await fetchCommunityPosts()
    setPosts(fetchedPosts)
    if (fetchedPosts.length > 0) {
      const reactionRows = await fetchPostReactions(fetchedPosts.map((post) => post.id))
      const reactionMap = {}
      for (const post of fetchedPosts) {
        reactionMap[post.id] = {}
        for (const emoji of REACTION_EMOJIS) reactionMap[post.id][emoji] = { count: 0, mine: false }
      }
      for (const reaction of reactionRows) {
        if (reactionMap[reaction.post_id]?.[reaction.emoji]) {
          reactionMap[reaction.post_id][reaction.emoji].count++
          if (reaction.user_id === user.id) reactionMap[reaction.post_id][reaction.emoji].mine = true
        }
      }
      setReactions(reactionMap)
    }
  }, [user])

  const loadPrayers = useCallback(async () => {
    if (!user) return
    const fetchedPrayers = await fetchPrayerRequests()
    setPrayers(fetchedPrayers)
    if (fetchedPrayers.length > 0) {
      const supporterRows = await fetchPrayerSupporters(fetchedPrayers.map((prayer) => prayer.id))
      const countMap = {}
      const supportedSet = new Set()
      for (const prayer of fetchedPrayers) countMap[prayer.id] = 0
      for (const supporter of supporterRows) {
        countMap[supporter.prayer_id] = (countMap[supporter.prayer_id] ?? 0) + 1
        if (supporter.user_id === user.id) supportedSet.add(supporter.prayer_id)
      }
      setPrayerSupportCounts(countMap)
      setMySupportedPrayers(supportedSet)
    }
  }, [user])

  useEffect(() => {
    if (user) {
      setLoading(true)
      Promise.all([loadPosts(), loadPrayers()]).finally(() => setLoading(false))
    }
  }, [user, loadPosts, loadPrayers])

  async function toggleReaction(postId, emoji) {
    if (!user) return
    const existing = reactions[postId]?.[emoji]
    if (existing) {
      setReactions((prev) => ({
        ...prev,
        [postId]: {
          ...prev[postId],
          [emoji]: {
            count: existing.mine ? existing.count - 1 : existing.count + 1,
            mine: !existing.mine,
          },
        },
      }))
      await togglePostReaction(postId, user.id, emoji)
    }
  }

  async function toggleSupport(prayerId) {
    if (!user) return
    const isSupported = mySupportedPrayers.has(prayerId)
    setMySupportedPrayers((prev) => {
      const next = new Set(prev)
      if (isSupported) next.delete(prayerId)
      else next.add(prayerId)
      return next
    })
    setPrayerSupportCounts((prev) => ({
      ...prev,
      [prayerId]: (prev[prayerId] ?? 0) + (isSupported ? -1 : 1),
    }))
    await togglePrayerSupport(prayerId, user.id)
  }

  async function submitPost() {
    if (!user || !postDraft.trim()) return
    setPosting(true)
    try {
      const newPost = await createCommunityPost(user.id, authorName ?? 'Anonymous', postDraft.trim())
      setPosts((prev) => [newPost, ...prev])
      setReactions((prev) => ({
        ...prev,
        [newPost.id]: Object.fromEntries(REACTION_EMOJIS.map((emoji) => [emoji, { count: 0, mine: false }])),
      }))
      setPostDraft('')
    } catch (err) {
      console.error('Failed to create post', err)
    } finally {
      setPosting(false)
    }
  }

  async function submitPrayer() {
    if (!user || !prayerDraft.trim()) return
    setSubmittingPrayer(true)
    try {
      const newPrayer = await createPrayerRequest(
        user.id,
        prayerDraft.trim(),
        postAnonymously ? null : authorName,
        postAnonymously
      )
      setPrayers((prev) => [newPrayer, ...prev])
      setPrayerSupportCounts((prev) => ({
        ...prev,
        [newPrayer.id]: 0,
      }))
      setPrayerDraft('')
      setPostAnonymously(false)
    } catch (err) {
      console.error('Failed to create prayer request', err)
    } finally {
      setSubmittingPrayer(false)
    }
  }

  async function handleDeletePost(postId) {
    if (confirm('Delete this post?')) {
      try {
        await deleteCommunityPost(postId)
        setPosts((prev) => prev.filter((post) => post.id !== postId))
        setReactions((prev) => {
          const next = { ...prev }
          delete next[postId]
          return next
        })
      } catch (err) {
        console.error('Failed to delete post', err)
      }
    }
  }

  async function handleDeletePrayer(prayerId) {
    if (confirm('Delete this prayer request?')) {
      try {
        await deletePrayerRequest(prayerId)
        setPrayers((prev) => prev.filter((prayer) => prayer.id !== prayerId))
        setPrayerSupportCounts((prev) => {
          const next = { ...prev }
          delete next[prayerId]
          return next
        })
        setMySupportedPrayers((prev) => {
          const next = new Set(prev)
          next.delete(prayerId)
          return next
        })
      } catch (err) {
        console.error('Failed to delete prayer request', err)
      }
    }
  }

  function toggleExpanded(postId) {
    setExpandedPosts((prev) => {
      const next = new Set(prev)
      if (next.has(postId)) next.delete(postId)
      else next.add(postId)
      return next
    })
  }

  if (loading) return <CommunitySkeleton />

  return (
    <div className="relative space-y-5">
      <header className="relative flex items-center justify-between gap-2">
        <div>
          <p className="eyebrow">Church</p>
          <h1 className="mt-1 font-sans text-2xl font-semibold tracking-tight text-balance">Community 🌱</h1>
        </div>
        <button
          type="button"
          aria-label="Notifications"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-muted transition-colors hover:bg-raised"
        >
          <BellIcon width={16} height={16} />
        </button>
      </header>
      <div className="flex gap-1 rounded-xl border border-line bg-surface p-1">
        {TABS.map(({ key: tabKey, label: tabLabel, icon: Icon }) => (
          <button
            onClick={() => setActiveTab(tabKey)}
            aria-pressed={activeTab === tabKey}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-2.5 text-xs font-bold transition-all duration-150 active:scale-[0.98] ${
              activeTab === tabKey ? 'bg-brand-strong text-on-brand' : 'text-muted hover:bg-raised hover:text-ink'
            }`}
            key={tabKey}
          >
            <Icon width={15} height={15} />
            {tabLabel}
          </button>
        ))}
      </div>
      {activeTab === 'stories' && (
        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-[0.65rem] font-bold text-brand-strong">
                {myInitials}
              </span>
              <textarea
                value={postDraft}
                onChange={(e) => setPostDraft(e.target.value)}
                placeholder="Share something with the community..."
                rows={3}
                className="input min-h-[4rem] resize-none text-sm"
              />
            </div>
            <div className="flex justify-end">
              <button
                onClick={submitPost}
                disabled={posting || !postDraft.trim()}
                className="btn-accent rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-50"
              >
                {posting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </div>
          {posts.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">No posts yet. Be the first to share!</p>
          )}
          <div className="stagger space-y-3">
            {posts.map((post) => {
              const isExpanded = expandedPosts.has(post.id)
              const isLong = post.content.length > 150
              const displayContent = isLong && !isExpanded ? post.content.slice(0, 150) + '…' : post.content
              const postReactions = reactions[post.id] ?? {}
              return (
                <div className="card space-y-3 p-4" key={post.id}>
                  <div className="flex items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-[0.65rem] font-bold text-brand-strong">
                      {getInitials(post.author_name)}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-bold text-ink">{post.author_name}</p>
                      <p className="text-[0.65rem] text-muted">{formatRelativeTime(post.created_at)}</p>
                    </div>
                    {user?.id === post.user_id && (
                      <button
                        onClick={() => handleDeletePost(post.id)}
                        aria-label="Delete post"
                        className="rounded-full p-1.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <TrashIcon width={15} height={15} />
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{displayContent}</p>
                  {isLong && (
                    <button onClick={() => toggleExpanded(post.id)} className="text-xs font-bold text-brand">
                      {isExpanded ? 'Show less' : 'Read more'}
                    </button>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    {REACTION_EMOJIS.map((emoji) => {
                      const reactionData = postReactions[emoji]
                      return reactionData ? (
                        <button
                          onClick={() => toggleReaction(post.id, emoji)}
                          aria-pressed={reactionData.mine}
                          className={`flex items-center gap-1 rounded-full border px-2.5 py-1 transition-all duration-150 active:scale-90 ${
                            reactionData.mine
                              ? 'border-accent/40 bg-accent-wash text-accent-ink'
                              : 'border-line bg-surface text-muted hover:border-brand/30 hover:bg-raised'
                          }`}
                          key={emoji}
                        >
                          <span className="text-sm">{emoji}</span>
                          {reactionData.count > 0 && (
                            <span className="text-[0.65rem] font-bold">{reactionData.count}</span>
                          )}
                        </button>
                      ) : null
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {activeTab === 'prayers' && (
        <div className="space-y-4">
          <div className="card space-y-3 p-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-accent-ink">
                <BranchIcon width={16} height={16} />
              </span>
              <textarea
                value={prayerDraft}
                onChange={(e) => setPrayerDraft(e.target.value)}
                placeholder="Share a prayer request..."
                rows={3}
                className="input min-h-[4rem] resize-none text-sm"
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="-m-2 flex cursor-pointer items-center gap-2 p-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={postAnonymously}
                  onChange={(e) => setPostAnonymously(e.target.checked)}
                  className="h-4 w-4 rounded border-line accent-brand"
                />
                Post anonymously
              </label>
              <button
                onClick={submitPrayer}
                disabled={submittingPrayer || !prayerDraft.trim()}
                className="btn-accent rounded-full px-4 py-1.5 text-xs font-bold disabled:opacity-50"
              >
                {submittingPrayer ? 'Posting...' : 'Submit'}
              </button>
            </div>
          </div>
          {prayers.length === 0 && (
            <p className="py-8 text-center text-sm text-muted">No prayer requests yet. Share yours!</p>
          )}
          <div className="stagger space-y-3">
            {prayers.map((prayer) => {
              const isSupporting = mySupportedPrayers.has(prayer.id)
              const supportCount = prayerSupportCounts[prayer.id] ?? 0
              return (
                <div className="card space-y-3 p-4" key={prayer.id}>
                  <div className="flex items-center gap-3">
                    {prayer.is_anonymous ? (
                      <>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-lg">
                          🫥
                        </span>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-muted">Anonymous</p>
                            <span className="rounded-full bg-raised px-2 py-0.5 text-[0.55rem] font-bold text-muted">
                              PRIVATE
                            </span>
                          </div>
                          <p className="text-[0.65rem] text-muted">{formatRelativeTime(prayer.created_at)}</p>
                        </div>
                      </>
                    ) : (
                      <>
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-wash text-[0.65rem] font-bold text-brand-strong">
                          {getInitials(prayer.author_name)}
                        </span>
                        <div className="flex-1">
                          <p className="text-sm font-bold text-ink">{prayer.author_name}</p>
                          <p className="text-[0.65rem] text-muted">{formatRelativeTime(prayer.created_at)}</p>
                        </div>
                      </>
                    )}
                    {user?.id === prayer.user_id && (
                      <button
                        onClick={() => handleDeletePrayer(prayer.id)}
                        aria-label="Delete prayer request"
                        className="rounded-full p-1.5 text-muted transition-colors hover:bg-red-500/10 hover:text-red-500"
                      >
                        <TrashIcon width={15} height={15} />
                      </button>
                    )}
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink/90">{prayer.content}</p>
                  <button
                    onClick={() => toggleSupport(prayer.id)}
                    aria-pressed={isSupporting}
                    className={`flex w-full items-center gap-2 rounded-xl border px-3.5 py-2.5 transition-all duration-150 active:scale-[0.98] ${
                      isSupporting
                        ? 'border-accent/40 bg-accent-wash'
                        : 'border-line bg-surface hover:border-brand/30 hover:bg-raised'
                    }`}
                  >
                    <BranchIcon width={18} height={18} className={isSupporting ? 'text-accent-ink' : 'text-muted'} />
                    <span className={`text-sm font-bold ${isSupporting ? 'text-accent-ink' : 'text-muted'}`}>
                      {isSupporting ? "You're praying for this" : "I'm praying for this"}
                    </span>
                    <span
                      className={`ml-auto flex h-6 min-w-[2.25rem] items-center justify-center rounded-full px-2 text-xs font-bold ${
                        isSupporting ? 'bg-accent text-accent-on' : 'bg-raised text-muted'
                      }`}
                    >
                      {supportCount}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function CommunitySkeleton() {
  return (
    <div className="space-y-5" aria-hidden={true}>
      <div className="h-8 w-48 animate-pulse rounded-lg bg-raised" />
      <div className="h-10 animate-pulse rounded-xl bg-raised" />
      <div className="card animate-pulse space-y-3 p-4">
        <div className="h-9 w-9 rounded-full bg-raised" />
        <div className="h-16 rounded-lg bg-raised" />
      </div>
      {[0, 1, 2].map((i) => (
        <div className="card animate-pulse space-y-3 p-4" key={i}>
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full bg-raised" />
            <div className="h-4 w-32 rounded bg-raised" />
          </div>
          <div className="h-12 rounded bg-raised" />
          <div className="h-8 w-48 rounded-xl bg-raised" />
        </div>
      ))}
    </div>
  )
}
