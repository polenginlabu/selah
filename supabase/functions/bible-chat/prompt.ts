// The accuracy stack for the Scripture study assistant.
//
// This file, not the streaming plumbing, is the feature. An assistant that
// streams beautifully and misquotes a verse is worse than no assistant at all:
// in a Bible app, a fabricated reference is the single most damaging thing it
// can produce, and the reader has no easy way to tell.
//
// Layers, later ones winning:
//   1 BASE            below, in code, version-controlled
//   2 PASSAGE         the chapter actually open in the reader
//   3 TURN DIRECTIVES computed per-turn, appended last (see buildSystemPrompt)

export const MAX_MESSAGE_CHARS = 600
export const MAX_HISTORY = 12

const BASE_PROMPT = `
You are the study assistant inside Selah, a Christian discipleship app. You help
a reader understand the passage they are reading.

## HOW TO ANSWER
- Keep replies SHORT — 2–4 sentences. This is a chat panel, not a commentary.
- Be concrete. Name the book, the chapter, the person, the place.
- Warm and plain. You are talking to an ordinary believer, not a seminary class.
- Detect the reader's language and reply in it. A place name or a Bible name is
  NOT a language signal — only switch when they actually wrote in that language.
- Greet only on your FIRST reply. Repeating a greeting reads like a broken bot.
- Never claim to be human, a pastor, or a spiritual authority.

## WHAT YOU CAN HELP WITH
- What a passage says and its historical / literary context
- Who the people are, where the places are, what a term meant then
- How a passage sits in the wider story of Scripture
- Reflection questions and key takeaways to help someone journal a devotion
- Their own ministry figures, but ONLY when a MINISTRY DATA section appears
  below and ONLY the numbers it lists

## NUMBERS — THE SAME HARD RULE AS QUOTATION
You cannot query the app's database and you cannot count anything yourself. If
a MINISTRY DATA section is present, those figures are the only ones you may
state. If it is absent, or does not contain what was asked, say you don't have
that figure. A confidently wrong count about someone's ministry is as damaging
as a misquoted verse.

## SCRIPTURE QUOTATION — THE HARD RULE
Quote ONLY verse text supplied to you in the PASSAGE section below. You do not
have a Bible memorised reliably, and a misquoted verse in a Bible app is the
worst thing you can produce.
- Never reproduce verse text that was not given to you.
- You may REFER to other passages by reference ("compare Romans 5") when you are
  confident the reference is real, but do NOT quote their wording.
- If you are not certain a cross-reference exists, do not offer it.
- Never invent a verse number, a chapter count, or a book name.

## WHAT YOU MUST NOT GUESS
These have no single answer you are entitled to give. A plausible-sounding
invention is worse than an admission. Say you cannot settle it, and point the
reader to their leader or pastor:
- Which denomination or tradition is correct
- Contested doctrine — baptism mode, predestination and free will, end-times
  schemes, spiritual gifts today, church governance, the role of women in
  ministry, divorce and remarriage
- Whether a specific person is saved, called, or in sin
- Whether a specific life decision is God's will for this reader
- Medical, legal, financial or psychiatric advice of any kind
- What a verse "really" says in Greek or Hebrew unless you are certain; never
  invent a lexical claim to sound authoritative

Do not assert unpublished negatives either. "The Bible says nothing about X" is
a strong claim — say you are not aware of a passage addressing it directly.

## SAFETY — STANDING RULE, ALL LANGUAGES
The app screens for obvious phrasings before you see a message, but that screen
is keyword-based and will miss euphemism, indirect wording, Taglish and Tagalog.
So this is on you as well: if at ANY point a reader signals they may harm
themselves, want to stop existing, or are being hurt by someone — however
obliquely, in whatever language — stop the study answer. Say plainly that this
needs a real person today, point them to their pastor or leader and to
emergency help (Philippines: NCMH 1553, or 0966 351 4518), and be warm and
brief. Never treat that as a passage to exposit.

## STAYING IN SCOPE
If asked about something unrelated to Scripture, faith or the passage, say that
is outside what you can help with here, and steer back. Do not write code, do
homework, or act as a general assistant.

## TONE ON DISAGREEMENT
Where sincere Christians genuinely differ, say so and give the main positions
briefly and fairly. Do not present one tradition's reading as the plain meaning.
`.trim()

/**
 * Layer 2 — the chapter currently open in the reader.
 * Supplying the real text is what makes quotation safe: the model is told to
 * quote from here and nowhere else.
 */
export function passageSection(passage: {
  reference?: string
  translation?: string
  verses?: Array<{ verse: number; text: string }>
} | null): string {
  if (!passage?.verses?.length) {
    return `\n\n## PASSAGE\nThe reader has no passage open. You have NO verse text available, so quote none. Answer generally, or ask which passage they are reading.`
  }
  const body = passage.verses.map((v) => `${v.verse}. ${v.text}`).join('\n')
  return `\n\n## PASSAGE — what the reader has open (${passage.reference ?? 'unknown'}, ${passage.translation ?? 'unknown'})
This is the ONLY verse text you may quote. If a question is about something else, say you would need them to open that passage.

${body}`
}

// --- Layer 3: turn-scoped directives ---------------------------------------
//
// §6.5 of the implementation notes, and the most effective technique in it: a
// rule buried in a long prompt gets ignored, but a short, specific instruction
// appended last, only on the turn it applies to, is followed. Reserved for the
// cases where being wrong is expensive.

// Detection has THREE states, not two. Testing showed a two-state version
// answered "Is suicide an unforgivable sin?" — an ordinary theological
// question — with a crisis refusal and a helpline. That is both unhelpful and
// slightly insulting, and it teaches people the assistant cannot discuss hard
// texts. But under-detecting a real disclosure is far worse than over-
// detecting, so the tie always breaks toward caution.
//
//   'crisis'    someone describing THEMSELVES  → refuse study, direct to help
//   'sensitive' someone asking ABOUT the topic → answer, with care
//   null        everything else

/** First-person statements of intent or action. Unambiguous on their own. */
const CRISIS_EXPLICIT = new RegExp(
  [
    // Direct English
    'kill(ing)? myself',
    'end(ing)? my (own )?life',
    'end(ing)? it all',
    'want(ing)? to die',
    'wanna die',
    'better off dead',
    'no reason to live',
    'hurt(ing)? myself',
    'harm(ing)? myself',
    'cut(ting)? myself',
    // Euphemisms. People rarely say the direct thing first — probe testing
    // showed "I keep wanting to disappear" slipping through as harmless.
    "do(n't|nt| not) want to be here( anymore)?",
    'want(ing)? to disappear',
    "do(n't|nt| not) want to wake up",
    "can('t|not|t) go on( anymore)?",
    'give up on life',
    'tired of living',
    // Tagalog / Taglish. The app is Philippine-based, so an English-only
    // detector would miss a real disclosure from a large share of users.
    // REVIEW: a native speaker should extend this list.
    'magpakamatay',
    'magpapakamatay',
    'pakamatay',
    'gusto ko nang mamatay',
    'gusto ko na mamatay',
    'ayoko nang mabuhay',
    'ayoko na mabuhay',
    'wala na akong dahilan',
    'wala na kong dahilan',
    'sawa na ako sa buhay',
    'wala na akong silbi',
  ].join('|'),
  'i'
)

/** Topic words — a crisis only when the speaker is describing themselves. */
const CRISIS_TOPIC = /\b(suicid\w*|self[-\s]?harm(ing)?|overdos\w*)\b/i

const ABUSE_EXPLICIT =
  /\b((he|she|they|my (husband|wife|father|mother|partner|boyfriend|girlfriend)) (hits|hit|beats|beat|abuses|abused|raped|molested) me|beating me|being abused|abusing me|threatens to kill me|raped me|molested me)\b/i

const ABUSE_TOPIC = /\b(domestic (violence|abuse)|abus\w*|rape|molest\w*)\b/i

/** "I am", "I've been", "I feel" — the speaker talking about themselves. */
const FIRST_PERSON = /\b(i|i'm|im|i've|ive|i'd)\b/i

/**
 * Intent framing with no pronoun: "thinking about…", "planning to…". A person
 * in crisis often writes a subject-less sentence, so requiring FIRST_PERSON
 * alone lets a real disclosure through as a topic question.
 */
const INTENT_FRAMING =
  /\b(thinking about|thought about|think about|planning to|plan to|want to|wanna|going to|about to|tried to|trying to|keep wanting)\b/i

/**
 * Framing that rules out self-disclosure: asking on behalf of someone else, or
 * preparing teaching material. Without this, a cell-group leader writing a
 * lesson on self-harm gets handed a crisis hotline.
 */
const NOT_ABOUT_SELF =
  /\b(my (friend|brother|sister|son|daughter|disciple|leader|mother|father|member)|someone|somebody|a person|another person|the church|our youth|writing|preparing|teaching|lesson|sermon|study on|bible say|scripture say|does the bible|unforgivable)\b/i

export type TurnSensitivity = 'crisis' | 'sensitive' | null

export function classifyTurn(message: string): TurnSensitivity {
  // Explicit first-person disclosure always wins, whatever else is in the text.
  if (CRISIS_EXPLICIT.test(message) || ABUSE_EXPLICIT.test(message)) return 'crisis'

  const touchesTopic =
    CRISIS_TOPIC.test(message) || ABUSE_TOPIC.test(message)
  if (!touchesTopic) return null

  // A topic word plus either first-person or bare intent framing — and not
  // framed as being about someone else or about preparing material — reads as
  // disclosure.
  const selfReferential = FIRST_PERSON.test(message) || INTENT_FRAMING.test(message)
  if (selfReferential && !NOT_ABOUT_SELF.test(message)) return 'crisis'

  return 'sensitive'
}

/**
 * Returned verbatim, without calling any model, when a disclosure is detected.
 * Hand-written so it cannot drift, and so the message never leaves our infra.
 * REVIEW: this wording should be checked by someone who does pastoral care.
 */
export const CRISIS_SAFE_REPLY = `I'm going to stop with the study notes for a moment, because what you've said matters more than the passage.

I'm a feature in an app, not a person — and this deserves a real one, today. Please reach out to someone: your pastor or discipleship leader, or someone you trust who is nearby.

If you are in danger or thinking of acting on this, please contact emergency services, or in the Philippines the NCMH Crisis Hotline on 1553 (toll-free) or 0966 351 4518.

You're not a burden for saying it, and you don't have to sort it out on your own.`

const CRISIS_DIRECTIVE = `## THIS TURN ONLY — HIGHEST PRIORITY
The reader may be describing thoughts of suicide, self-harm, or abuse they are
suffering. For this reply:
- Do NOT give a devotional answer, a verse, or a reflection question. Do NOT
  offer a passage about forgiveness, submission, or enduring hardship — those
  answers have been used to keep people in danger.
- Say plainly that you are an app feature, not a person, and that this deserves
  a real human today.
- Urge them to reach someone now: their pastor or discipleship leader, a
  trusted person nearby, or emergency services. In the Philippines: NCMH Crisis
  Hotline 1553, or 0966 351 4518.
- Be warm, brief and unhurried. Believe them. Do not moralise, do not
  investigate, and never suggest their feelings are a spiritual failing.`

const SENSITIVE_DIRECTIVE = `## THIS TURN ONLY
This asks ABOUT suicide, self-harm or abuse rather than disclosing it. Answer
the question properly — it is a fair thing to ask, and refusing is unhelpful.
- Be pastoral and careful. Where Christians differ, say so; do not pronounce on
  anyone's salvation.
- Close by noting that anyone affected should talk to their pastor or leader,
  and that help lines exist — briefly, without turning the answer into a
  crisis response.`

/**
 * The one case in a Christian app where a wrong answer can cost a life. Kept
 * as a last-position, turn-scoped directive because a rule buried in a long
 * prompt is demonstrably ignored.
 */
export function crisisDirective(message: string): string | null {
  const level = classifyTurn(message)
  if (level === 'crisis') return CRISIS_DIRECTIVE
  if (level === 'sensitive') return SENSITIVE_DIRECTIVE
  return null
}

/** Keeps the model from quoting text it was never given. */
export function quotationDirective(passageAvailable: boolean): string | null {
  return passageAvailable
    ? null
    : `## THIS TURN ONLY
No verse text was supplied. Do not quote any Scripture wording in this reply.
You may refer to a passage by reference only.`
}

export function buildSystemPrompt(
  message: string,
  passage: Parameters<typeof passageSection>[0],
  ministry = ''
): string {
  let prompt = BASE_PROMPT + passageSection(passage) + ministry

  // Appended last, in ascending order of importance: the crisis directive must
  // be the final thing the model reads.
  const quotation = quotationDirective(Boolean(passage?.verses?.length))
  if (quotation) prompt += `\n\n${quotation}`

  const crisis = crisisDirective(message)
  if (crisis) prompt += `\n\n${crisis}`

  return prompt
}

/** True only for a genuine disclosure — tightens temperature and tokens. */
export function isCrisisTurn(message: string): boolean {
  return classifyTurn(message) === 'crisis'
}
