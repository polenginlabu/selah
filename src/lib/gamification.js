export const XP_PER_LEVEL = 500

export const XP_REWARDS = {
  devotion: 200,
  verseBonus: 200,
  conquest: 200,
  evangelism: 200,
}

export const TRIBES = [
  {
    name: 'Deer',
    icon: 'deer',
    subtitle: 'Seeker',
    color: '#80BF4A',
    shape: 'circle',
    minLevel: 1,
    maxLevel: 10,
    verse: {
      text: 'As the deer pants for streams of water, so my soul pants for you, my God.',
      reference: 'Psalm 42:1',
    },
  },
  {
    name: 'Sheep',
    icon: 'sheep',
    subtitle: 'Faithful',
    color: '#ED5934',
    shape: 'circle',
    minLevel: 11,
    maxLevel: 20,
    verse: { text: 'The Lord is my shepherd, I lack nothing.', reference: 'Psalm 23:1' },
  },
  {
    name: 'Eagle',
    icon: 'eagle',
    subtitle: 'Soaring',
    color: '#E9CE38',
    shape: 'circle',
    minLevel: 21,
    maxLevel: 30,
    verse: {
      text: 'They will soar on wings like eagles; they will run and not grow weary.',
      reference: 'Isaiah 40:31',
    },
  },
  {
    name: 'Lion',
    icon: 'lion',
    subtitle: 'Courageous',
    color: '#59C7EA',
    shape: 'circle',
    minLevel: 31,
    maxLevel: 40,
    verse: { text: 'The righteous are as bold as a lion.', reference: 'Proverbs 28:1' },
  },
  {
    name: 'Ox',
    icon: 'ox',
    subtitle: 'Steadfast',
    color: '#8B5CF6',
    shape: 'circle',
    minLevel: 41,
    maxLevel: 50,
    verse: {
      text: 'From the strength of an ox come abundant harvests.',
      reference: 'Proverbs 14:4',
    },
  },
]

export function getTribeForLevel(level) {
  let tribe = TRIBES[0]
  for (const t of TRIBES) {
    if (level >= t.minLevel) tribe = t
  }
  return tribe
}

export function getLevel(xp) {
  return Math.floor(xp / XP_PER_LEVEL) + 1
}

export function getLevelProgress(xp) {
  return { level: getLevel(xp), into: xp % XP_PER_LEVEL, needed: XP_PER_LEVEL }
}

export function withOpacity(color, alpha = 0.14) {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`
}

export function isEvangelismCategory(text) {
  return /evangel|gospel/i.test(text)
}

export const ACHIEVEMENT_CATEGORIES = [
  { id: 'community', label: 'Community', color: '#80BF4A', xp: 200 },
  { id: 'leadership', label: 'Leadership', color: '#ED5934', xp: 200 },
  { id: 'spiritual', label: 'Spiritual', color: '#E9CE38', xp: 200 },
  { id: 'outreach', label: 'Outreach', color: '#59C7EA', xp: 200 },
  { id: 'service', label: 'Service', color: '#8B5CF6', xp: 200 },
]

export const ACHIEVEMENT_CATEGORIES_BY_ID = Object.fromEntries(
  ACHIEVEMENT_CATEGORIES.map((c) => [c.id, c])
)

export const ACHIEVEMENTS = [
  { id: 'invite-friends', title: 'Invite Friends', icon: 'user-plus', category: 'community', repeat: null, bonusXp: 200, tier: 'deer' },
  { id: 'invite-family', title: 'Invite Family', icon: 'users', category: 'community', repeat: null, bonusXp: 200, tier: 'sheep' },
  { id: 'open-cell-group', title: 'Open a Cell Group', icon: 'home', category: 'leadership', repeat: null, bonusXp: 200, tier: 'lion' },
  { id: 'evangelize', title: 'Evangelize a Person', icon: 'chat', category: 'outreach', repeat: null, bonusXp: 200, tier: 'eagle' },
  { id: 'campus-ministry', title: 'Campus Ministry', icon: 'graduation-cap', category: 'outreach', repeat: null, bonusXp: 200, tier: 'ox' },
  { id: 'marketplace-ministry', title: 'Marketplace Ministry', icon: 'briefcase', category: 'outreach', repeat: null, bonusXp: 200, tier: 'ox' },
  { id: 'conduct-cell-group', title: 'Conduct Cell Group', icon: 'book-open', category: 'leadership', repeat: 'weekly', bonusXp: 200 },
  { id: 'memorize-verse', title: 'Memorize a Verse', icon: 'book', category: 'spiritual', repeat: 'weekly', bonusXp: 200 },
  { id: 'wildsons', title: 'Attend wildSons', icon: 'zap', category: 'service', repeat: 'weekly', bonusXp: 200 },
  { id: 'sunday-service', title: 'Attend Sunday Service', icon: 'sun', category: 'service', repeat: 'weekly', bonusXp: 200 },
  { id: 'couples-service', title: 'Attend Couples Service', icon: 'heart', category: 'service', repeat: 'weekly', bonusXp: 200 },
  { id: 'crossover', title: 'CrossOver / Marketplace Service', icon: 'refresh', category: 'service', repeat: 'weekly', bonusXp: 200 },
  { id: 'attend-cellgroup', title: 'Attend a Cell Group', icon: 'map-pin', category: 'community', repeat: 'weekly', bonusXp: 200 },
  { id: 'training', title: 'Attend Training', icon: 'ribbon', category: 'leadership', repeat: 'weekly', bonusXp: 200 },
  { id: 'devotion', title: 'Do Devotion', icon: 'flame', category: 'spiritual', repeat: 'daily', bonusXp: 200 },
  { id: 'morning-prayer', title: 'Morning Prayer', icon: 'sunrise', category: 'spiritual', repeat: 'daily', bonusXp: 200 },
  { id: 'bible-gospels', title: 'Read the Gospels', icon: 'book', category: 'spiritual', repeat: null, bonusXp: 250, tier: 'deer' },
  { id: 'attend-encounter', title: 'Attend a Weekend Encounter', icon: 'sunrise', category: 'spiritual', repeat: null, bonusXp: 250, tier: 'deer' },
  { id: 'devotion-30days', title: '30 Days of Consistent Devotion', icon: 'flame', category: 'spiritual', repeat: null, bonusXp: 250, tier: 'deer' },
  { id: 'trophy-deer', title: 'Deer Trophy', icon: 'ribbon', category: 'community', repeat: null, bonusXp: 500 },
  { id: 'bible-new-testament', title: 'Finish the New Testament', icon: 'book-open', category: 'spiritual', repeat: null, bonusXp: 300, tier: 'sheep' },
  { id: 'faithful-tithing', title: 'Faithful Tithing', icon: 'heart', category: 'service', repeat: null, bonusXp: 300, tier: 'sheep' },
  { id: 'memorize-10-verses', title: 'Memorize 10 Verses', icon: 'book', category: 'spiritual', repeat: null, bonusXp: 300, tier: 'sheep' },
  { id: 'trophy-sheep', title: 'Sheep Trophy', icon: 'ribbon', category: 'leadership', repeat: null, bonusXp: 600 },
  { id: 'bible-old-testament', title: 'Finish the Old Testament', icon: 'book-open', category: 'spiritual', repeat: null, bonusXp: 350, tier: 'eagle' },
  { id: 'training-complete', title: 'Complete Leadership Training', icon: 'graduation-cap', category: 'leadership', repeat: null, bonusXp: 350, tier: 'eagle' },
  { id: 'support-ministry', title: 'Join a Support Ministry', icon: 'briefcase', category: 'service', repeat: null, bonusXp: 350, tier: 'eagle' },
  { id: 'trophy-eagle', title: 'Eagle Trophy', icon: 'ribbon', category: 'spiritual', repeat: null, bonusXp: 700 },
  { id: 'bible-whole', title: 'Read Through the Whole Bible', icon: 'book-open', category: 'spiritual', repeat: null, bonusXp: 400, tier: 'lion' },
  { id: 'g12-books', title: 'Read the Leadership Books', icon: 'graduation-cap', category: 'leadership', repeat: null, bonusXp: 400, tier: 'lion' },
  { id: 'lead-10-cellgroups', title: 'Lead 10 Cell Group Meetings', icon: 'home', category: 'leadership', repeat: null, bonusXp: 400, tier: 'lion' },
  { id: 'trophy-lion', title: 'Lion Trophy', icon: 'ribbon', category: 'outreach', repeat: null, bonusXp: 800 },
  { id: 'disciple-a-leader', title: 'Raise Up a New Leader', icon: 'users', category: 'leadership', repeat: null, bonusXp: 450, tier: 'ox' },
  { id: 'multiply-cell', title: 'Help a Disciple Start Their Own Cell', icon: 'sunrise', category: 'leadership', repeat: null, bonusXp: 450, tier: 'ox' },
  { id: 'trophy-ox', title: 'Ox Trophy', icon: 'ribbon', category: 'service', repeat: null, bonusXp: 900 },
]

export const ACHIEVEMENTS_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]))

// The repeatable (non-trophy, non-tribe-tier) achievements, shaped as a simple quest checklist.
export const CONQUEST_TASKS = ACHIEVEMENTS.filter((a) => !a.id.startsWith('trophy-') && !a.tier).map(
  (a) => ({
    id: a.id,
    label: a.title,
    category: a.category,
    icon: a.icon,
    xp: a.bonusXp,
    repeat: a.repeat,
  })
)
