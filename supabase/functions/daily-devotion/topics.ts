// The daily-devotion topic engine and curated source library.
//
// Governs what John Paul studies on any given day. The selection rule that
// matters is "random + spiritually intentional": today's topic is drawn at
// random, but topics covered in the last week are excluded and topics that
// have been covered fewer times carry more weight, so the list is walked
// evenly instead of clustering on a favourite.
//
// The source library is deliberately NOT a scraped corpus and NOT a set of
// verbatim quotations. Each note is a one-to-two-sentence summary of a
// teacher's known emphasis on that topic, written to be paraphrased by the
// model. Attribution is required and exact quotation is forbidden — the same
// rule the Bible section applies to the model. If a teacher has no notes for
// a topic, GENERAL_EMPHASES still grounds a fair summary of their overall
// teaching.

export type TeacherId = 'warren' | 'savchuk' | 'ballano'

export interface Topic {
  /** Stable id stored in daily_devotions.topic. */
  id: string
  /** Display label ('Waiting on God'). */
  label: string
  /** One-line framing the model uses to anchor the devotion. */
  blurb: string
  /** Anchor Scripture references, tried in order when fetching verse text. */
  anchors: string[]
  /** Curated teaching summaries, per teacher. Missing teachers are simply left out. */
  notes: Partial<Record<TeacherId, string>>
}

export const TEACHER_LABELS: Record<TeacherId, string> = {
  warren: 'Rick Warren',
  savchuk: 'Vlad Savchuk',
  ballano: 'Oriel Ballano',
}

export const GENERAL_EMPHASES: Record<TeacherId, string> = {
  warren:
    'Pastor of Saddleback Church and author of The Purpose Driven Life. His teaching centers on living out your God-given purpose, God\'s unconditional love and grace, daily habits and personal growth, and practical obedience in everyday life rather than religious performance.',
  savchuk:
    'Pastor of Hungry Generation Church and a teacher on prayer, fasting and the Holy Spirit. His teaching centers on deep intimacy with God, spiritual warfare, supernatural living, and radical whole-hearted discipleship that costs something.',
  ballano:
    'A Philippine pastor whose teaching centers on discipleship and multiplication, a grace-centered and personal walk with God, and faithful serving in the local church and family. His notes prefer to be drawn from the local, everyday reality of Filipino believers.',
}

export const TOPICS: Topic[] = [
  {
    id: 'faith',
    label: 'Faith',
    blurb: 'Trusting God\'s character and promises enough to act on them.',
    anchors: ['Hebrews 11:1', 'Mark 9:23'],
    notes: {
      warren:
        'Faith is doing what you can right now while trusting God for what you cannot do. Steady, obedient faith beats a spectacular one-off.',
      savchuk:
        'Faith grows in the place of decision: you act on God\'s Word before you see the outcome, and God honors the step taken in the dark.',
      ballano:
        'Faithfulness in the small, unspectacular daily things is what builds a life God can use.',
    },
  },
  {
    id: 'waiting',
    label: 'Waiting on God',
    blurb: 'Enduring a delay without doubting God\'s goodness or timing.',
    anchors: ['Isaiah 40:28-31', 'Psalm 27:13-14'],
    notes: {
      warren:
        'Waiting on God is not wasted time. While the plan unfolds slowly, He is at work in your character and your trust.',
      savchuk:
        'God is never late. The season of delay is where your confidence in His timing and His character is tested and built up.',
      ballano:
        'When the answer does not come quickly, keep doing the last thing God told you to do and let the waiting itself be a form of obedience.',
    },
  },
  {
    id: 'prayer',
    label: 'Prayer',
    blurb: 'The ongoing conversation with God that shapes the heart.',
    anchors: ['Philippians 4:6-7', 'Matthew 6:9-13'],
    notes: {
      warren:
        'Prayer is not about changing God\'s mind; it is about aligning your heart with His. Talk to Him honestly, not religiously.',
      savchuk:
        'A prayer-less life is a powerless life. Intimacy with God is built in the secret place, not on the platform or in public.',
      ballano:
        'Prayer is the daily conversation of a relationship, not a ritual to perform. Learn to talk to God the way a child talks to a father.',
    },
  },
  {
    id: 'holy-spirit',
    label: 'The Holy Spirit',
    blurb: 'Living each day in step with the Spirit who lives in you.',
    anchors: ['Galatians 5:22-23', 'John 14:16-17'],
    notes: {
      warren:
        'The Spirit works in the ordinary: He gives you power to do the right thing in the middle of an average Tuesday.',
      savchuk:
        'The Holy Spirit is not a doctrine to study but a Person to know — and He makes the things of Jesus real and present to you.',
      ballano:
        'Be filled fresh every day. You cannot lead others anywhere you have not first been led yourself.',
    },
  },
  {
    id: 'identity',
    label: 'Identity in Christ',
    blurb: 'Who God says you are, apart from your performance.',
    anchors: ['2 Corinthians 5:17', 'Ephesians 2:10'],
    notes: {
      warren:
        'You are made in God\'s image. Your identity rests on His love and calling, not on your latest success or failure.',
      savchuk:
        'Who you are in Christ decides how you fight, how you forgive and how you live. Identity determines victory.',
      ballano:
        'Know whose you are before you spend your energy on who you are. Sonship comes before job title.',
    },
  },
  {
    id: 'repentance',
    label: 'Sin & Repentance',
    blurb: 'Turning from a pattern of sin and back toward God.',
    anchors: ['1 John 1:8-9', 'Acts 3:19'],
    notes: {
      warren:
        'God\'s kindness leads to repentance. Genuine change grows out of knowing you are loved, not out of a pile of guilt.',
      savchuk:
        'Repentance is a turning, not just a feeling. You turn from the sin and toward God — today, not "later when I am ready."',
      ballano:
        'Real repentance shows up in a changed direction. It always begins with being honest with God about where you are.',
    },
  },
  {
    id: 'wisdom',
    label: 'Wisdom',
    blurb: 'Seeing life from God\'s point of view and living accordingly.',
    anchors: ['James 1:5', 'Proverbs 3:5-6'],
    notes: {
      warren:
        'Godly wisdom is seeing life from God\'s point of view. He gives it freely whenever you ask for it honestly.',
      savchuk:
        'Listening is the beginning of wisdom. A disciple who will not be taught will keep falling into the same holes.',
      ballano:
        'God\'s wisdom is practical — it shows up in the choices you make at home and at work, not only inside the church building.',
    },
  },
  {
    id: 'relationships',
    label: 'Relationships',
    blurb: 'Honouring God in the way you treat the people around you.',
    anchors: ['Colossians 3:12-14', 'Ephesians 4:32'],
    notes: {
      warren:
        'Healthy relationships are built on humility and grace. Being quick to listen and slow to speak is the first skill of love.',
      savchuk:
        'Iron sharpens iron. The people closest to you shape your spiritual temperature, so choose them carefully and invest in them.',
      ballano:
        'Faith grows in community. Do not try to live the Christian life alone — connection is how God keeps you strong.',
    },
  },
  {
    id: 'leadership',
    label: 'Leadership',
    blurb: 'Influence earned through serving, not through position.',
    anchors: ['Mark 10:42-45', '1 Timothy 3:1-7'],
    notes: {
      warren:
        'Influence is built on service, not position. The most powerful leaders are the ones who serve first and lead second.',
      savchuk:
        'Leadership flows out of the place you pray. What you are in private will show up in how you lead in public.',
      ballano:
        'A leader multiplies. The job is not finished until someone you raised up can raise up others.',
    },
  },
  {
    id: 'purpose',
    label: 'Purpose & Calling',
    blurb: 'Living the life God shaped you to live.',
    anchors: ['Ephesians 2:10', 'Jeremiah 29:11'],
    notes: {
      warren:
        'You were made for a purpose. God shaped you for a contribution only you can make, and it is about serving, not impressing.',
      savchuk:
        'Your calling is lived out in obedience today. Purpose meets reality in the daily, faithful acts nobody applauds.',
      ballano:
        'Purpose is not a mystery you find once and keep. It is a path you walk in faithful steps, one day at a time.',
    },
  },
  {
    id: 'discipline',
    label: 'Spiritual Discipline',
    blurb: 'The daily habits that quietly shape the person you become.',
    anchors: ['1 Timothy 4:7-8', 'Hebrews 12:11'],
    notes: {
      warren:
        'Habits decide your direction. The small daily disciplines are what actually shape the person you become over a lifetime.',
      savchuk:
        'Fasting and prayer recalibrate your soul. As your appetite for the world shrinks, your appetite for God grows.',
      ballano:
        'Grace does not make discipline unnecessary — it makes discipline possible. Do the next right thing, on repeat.',
    },
  },
  {
    id: 'forgiveness',
    label: 'Forgiveness',
    blurb: 'Letting go of a debt, for your own freedom and God\'s glory.',
    anchors: ['Ephesians 4:31-32', 'Matthew 6:14-15'],
    notes: {
      warren:
        'You forgive for your own sake. Holding a grudge is letting someone live rent-free in your head.',
      savchuk:
        'Forgiveness is an act of obedience before it is ever a feeling. Unforgiveness is a root that poisons your own walk with God.',
      ballano:
        'To be forgiven is to become a forgiver. The grace you have received is the pattern for the grace you extend.',
    },
  },
  {
    id: 'love',
    label: 'Love',
    blurb: 'Choosing the good of another, the way Christ first loved you.',
    anchors: ['1 John 4:19', '1 Corinthians 13:4-7'],
    notes: {
      warren:
        'Love is a choice and a skill, not just a warm feeling. It wants the very best for the other person and acts on it.',
      savchuk:
        'Love for God is the fountainhead. When the feeling of love runs dry, love is still something you can choose to do.',
      ballano:
        'In the local church, love becomes visible when families and small groups serve one another in the everyday — not only in the service.',
    },
  },
  {
    id: 'spiritual-warfare',
    label: 'Spiritual Warfare',
    blurb: 'Standing firm against the enemy through prayer and the Word.',
    anchors: ['Ephesians 6:10-12', '2 Corinthians 10:4-5'],
    notes: {
      warren:
        'The fight is largely in the mind. You win it by filling your thoughts with God\'s truth instead of the enemy\'s accusations.',
      savchuk:
        'The warfare is real, and it is won the same way Jesus fought it — the Word, prayer, and praise in the middle of the battle.',
      ballano:
        'Guard your heart and your witness. Much of the warfare is over what you keep believing about God when pressure comes.',
    },
  },
  {
    id: 'hearing-god',
    label: 'Hearing God',
    blurb: 'Discerning God\'s voice and direction in daily life.',
    anchors: ['John 10:27', 'Psalm 32:8'],
    notes: {
      warren:
        'God most often leads through His Word, wise counsel and godly wisdom. Start with an open Bible, not with impressions.',
      savchuk:
        'You learn God\'s voice by spending time with Him. His sheep know His voice because they stay near the Shepherd.',
      ballano:
        'Obedience sharpens hearing. You hear God clearly when you are already doing the last thing He told you.',
    },
  },
  {
    id: 'generosity',
    label: 'Giving & Generosity',
    blurb: 'Open-handed stewardship as worship and a heart-cure.',
    anchors: ['2 Corinthians 9:6-8', 'Acts 20:35'],
    notes: {
      warren:
        'You cannot serve God and money. Generosity does more to break money\'s grip on your heart than almost anything else.',
      savchuk:
        'Everything you have is God\'s on loan. Giving is the steward\'s response, and God loves a cheerful, deliberate giver.',
      ballano:
        'Blessing flows through an open hand. A church that gives freely becomes a church that multiplies.',
    },
  },
  {
    id: 'servanthood',
    label: 'Servanthood',
    blurb: 'Greatness measured by how many you serve.',
    anchors: ['Mark 10:45', 'Galatians 5:13'],
    notes: {
      warren:
        'The way up in God\'s kingdom is down. Real greatness is measured by how many people you serve, not how many serve you.',
      savchuk:
        'Serve in the secret place where nobody claps. That is where character is built and where the reward is stored.',
      ballano:
        'What the church needs is servant-hearted disciples who pick up the towel — not leaders who are chasing titles.',
    },
  },
  {
    id: 'suffering',
    label: 'Suffering & Hardship',
    blurb: 'What God is doing in the painful season.',
    anchors: ['Romans 8:28', 'James 1:2-4'],
    notes: {
      warren:
        'God is never closer than the valley, and no pain is wasted when it is handed over to Him. He brings good out of it.',
      savchuk:
        'God is with you inside the trial, not just on the other side of it. Deep intimacy with Him is often forged in the hard season.',
      ballano:
        'Hardship is not a sign that God left. It is a place where trust stops being a word and becomes real.',
    },
  },
  {
    id: 'rest',
    label: 'Rest & Sabbath',
    blurb: 'Stopping in trust, the way God built rest into the rhythm.',
    anchors: ['Matthew 11:28-30', 'Psalm 46:10'],
    notes: {
      warren:
        'Sabbath is a gift of margin that God built into your week. Resting is an act of trust in His provision, not laziness.',
      savchuk:
        'You cannot pour out what you have not first received. Stillness before God is where your strength comes back.',
      ballano:
        'A rested disciple is a faithful disciple. Do not let busyness crowd out being with Jesus.',
    },
  },
  {
    id: 'discipleship',
    label: 'Discipleship',
    blurb: 'Following Jesus, and helping others do the same.',
    anchors: ['Matthew 28:19-20', 'Luke 9:23'],
    notes: {
      warren:
        '"Follow me, and I will make you." Discipleship is a long walk with Jesus, becoming more like Him step by step.',
      savchuk:
        'Discipleship costs something. The cross comes before the crown, and Jesus still asks for everything.',
      ballano:
        'Discipleship is multiplication. You were made a disciple in order to make disciples.',
    },
  },
  {
    id: 'character',
    label: 'Character',
    blurb: 'The person you are when nobody is watching.',
    anchors: ['Proverbs 4:23', 'Galatians 6:7-9'],
    notes: {
      warren:
        'What you do when nobody is watching is who you actually are. Character is built one unobserved choice at a time.',
      savchuk:
        'Hard seasons are God\'s classroom for character. He cares more about what He is forming in you than the platform He could give you.',
      ballano:
        'Integrity is the currency of influence. The church grows when leaders are the same people in private as they are in public.',
    },
  },
]

export interface PickedTopic {
  topic: Topic
  /** The first anchor with available verse text, or null if scripture fetch failed. */
  anchorReference: string | null
  /** Real verse text for the anchor, quoted verbatim to the model. */
  anchorText: string | null
}

/**
 * Random + intentional selection.
 *
 * Excludes any topic that appears in `recentTopics` (last ~week), then weights
 * remaining topics inversely to how often they appear in `history`, so
 * under-covered topics trend upward while still leaving the outcome random.
 * The jitter factor keeps the pick genuinely varied instead of deterministic.
 */
export function pickTopic(
  history: string[],
  recentTopics: string[] = [],
  rand: () => number = Math.random
): Topic {
  const seenRecently = new Set(recentTopics)
  const coverage = new Map<string, number>()
  for (const id of history) coverage.set(id, (coverage.get(id) ?? 0) + 1)

  let pool = TOPICS.filter((t) => !seenRecently.has(t.id))
  if (pool.length === 0) pool = TOPICS

  const weighted = pool.map((topic) => {
    const count = coverage.get(topic.id) ?? 0
    const base = 1 / (1 + count)
    const jitter = 0.75 + rand() * 0.5
    return { topic, weight: base * jitter }
  })

  const total = weighted.reduce((sum, w) => sum + w.weight, 0)
  let roll = rand() * total
  for (const { topic, weight } of weighted) {
    roll -= weight
    if (roll <= 0) return topic
  }
  return weighted[weighted.length - 1].topic
}

/** Just the off-the-shelf note fields, for prompt assembly. */
export function notesFor(topic: Topic): Array<{ teacher: string; note: string }> {
  return (Object.keys(topic.notes) as TeacherId[])
    .filter((id) => topic.notes[id])
    .map((id) => ({ teacher: TEACHER_LABELS[id], note: topic.notes[id]! }))
}

/**
 * All topic labels, used by the client for things like showing what's coming
 * next. Kept separate from TOPICS so a client can't be sent the notes.
 */
export function topicLabels(): string[] {
  return TOPICS.map((t) => t.label)
}