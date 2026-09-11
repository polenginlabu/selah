import { Link } from 'react-router-dom'
import { Logo } from '../components/Logo'

// Kept in one place so the two documents can't drift apart on the facts.
const CONTACT_EMAIL = 'johnpaul.dj21@gmail.com'
const LAST_UPDATED = '11 September 2026'

function Section({ title, children }) {
  return (
    <section className="mt-7">
      <h2 className="text-base">{title}</h2>
      <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted [&_strong]:text-ink">
        {children}
      </div>
    </section>
  )
}

function Shell({ title, children }) {
  return (
    <div className="mx-auto min-h-screen max-w-xl px-5 pb-16 pt-8">
      <Link to="/" className="inline-block">
        <Logo size={24} />
      </Link>
      <h1 className="mt-8 text-2xl">{title}</h1>
      <p className="mt-1 text-xs text-muted">Last updated {LAST_UPDATED}</p>
      {children}
      <p className="mt-10 border-t border-line pt-5 text-xs text-muted">
        Questions? Email{' '}
        <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-brand-strong dark:text-brand">
          {CONTACT_EMAIL}
        </a>
        .
      </p>
      <div className="mt-4 flex gap-4 text-xs">
        <Link to="/privacy" className="text-muted underline-offset-2 hover:underline">
          Privacy Policy
        </Link>
        <Link to="/terms" className="text-muted underline-offset-2 hover:underline">
          Terms of Service
        </Link>
      </div>
    </div>
  )
}

export function PrivacyPolicy() {
  return (
    <Shell title="Privacy Policy">
      <p className="mt-4 text-sm leading-relaxed text-muted">
        Selah is a discipleship app for reading Scripture, journalling devotions and tracking
        discipleship within a local church. This policy describes what it stores and who can see it.
      </p>

      <Section title="What we collect">
        <p>
          <strong>Your Google account details.</strong> When you sign in with Google we receive your
          name, email address and profile picture. We do not receive your Google password, and we
          request no access to Gmail, Drive, Contacts or Calendar.
        </p>
        <p>
          <strong>What you write.</strong> Devotions and journal entries, Bible highlights, notes,
          prayer requests and community posts.
        </p>
        <p>
          <strong>Discipleship records you enter.</strong> Names, and optionally birthdays, mobile
          numbers, email addresses and notes for the people in your disciple tree, along with
          attendance you record for them.
        </p>
        <p>
          <strong>Activity in the app.</strong> Goals and pledges, weekly Conquest tasks,
          achievements, experience points and levels.
        </p>
        <p>
          <strong>Notification tokens.</strong> If you enable reminders, an identifier for your
          device so we can send them.
        </p>
      </Section>

      <Section title="Information about other people">
        <p>
          When you add someone to your disciple tree you are entering information about another
          person. Please only record what you genuinely need for pastoral care, tell them you are
          doing so, and remove it when it is no longer needed. You can delete any disciple record at
          any time.
        </p>
      </Section>

      <Section title="Who can see your information">
        <p>
          <strong>Your devotions and journal entries are private to you.</strong> Nobody else in the
          app can read them, including church leaders and administrators.
        </p>
        <p>
          Some things are shared by design, and only where you choose: community posts and prayer
          requests are visible to other members; a goal is visible to the people you add to it; and
          your name, level and experience points appear on the leaderboard.
        </p>
        <p>
          A disciple tree is visible to the leader who owns it. Where trees connect across leaders,
          a leader may see people in branches under their care.
        </p>
        <p>
          An app administrator can see the list of accounts, experience totals and disciple counts,
          and can reset progress or delete an account. Administrators <strong>cannot</strong> read
          your devotions.
        </p>
      </Section>

      <Section title="Services we rely on">
        <p>
          <strong>Supabase</strong> hosts the database and handles sign-in.{' '}
          <strong>Google</strong> provides sign-in. <strong>Firebase Cloud Messaging</strong>{' '}
          delivers push notifications. <strong>ESV</strong> and <strong>NLT</strong> provide Bible
          text. A third-party chat assistant is embedded in the app; messages you type into it are
          processed by that provider.
        </p>
        <p>We do not sell your information, and we do not use it for advertising.</p>
      </Section>

      <Section title="Keeping and deleting your information">
        <p>
          Your data is kept while your account is active. You can delete individual devotions,
          disciples, goals and posts yourself at any time.
        </p>
        <p>
          To delete your whole account and everything in it, email {CONTACT_EMAIL}. Deletion removes
          your devotions, disciple records, attendance, goals, posts and prayer requests, and cannot
          be undone.
        </p>
      </Section>

      <Section title="Children">
        <p>
          Selah is intended for use by members of a local church. If a minor uses the app, it should
          be with the knowledge and consent of a parent or guardian.
        </p>
      </Section>

      <Section title="Changes">
        <p>
          If this policy changes materially we will update the date at the top and, where the change
          is significant, tell you in the app.
        </p>
      </Section>
    </Shell>
  )
}

/**
 * Standalone data-deletion instructions.
 *
 * Meta requires a dedicated "Data deletion instructions URL" for Facebook
 * Login, and pointing it at a section buried in the privacy policy tends to
 * get rejected. Public, like the other two — the whole point is that someone
 * who can no longer sign in can still find out how to have their data removed.
 */
export function DataDeletion() {
  return (
    <Shell title="Deleting your data">
      <p className="mt-4 text-sm leading-relaxed text-muted">
        You can remove your information from Selah at any time. There are two options.
      </p>

      <Section title="Delete individual items yourself">
        <p>
          Signed in, you can delete any devotion, disciple, goal, community post or prayer request
          directly in the app. Deleting an item removes it permanently.
        </p>
      </Section>

      <Section title="Delete your whole account">
        <p>
          Email <strong>{CONTACT_EMAIL}</strong> from the address you signed in with, asking for
          your account to be deleted. We will confirm and remove it within 30 days.
        </p>
        <p>
          If you signed in with Facebook, say so in the email so we can match the right account.
        </p>
      </Section>

      <Section title="What gets deleted">
        <p>
          Your sign-in record and profile, every devotion and journal entry, your disciple tree and
          the attendance recorded against it, your goals and pledges, your community posts and
          prayer requests, your achievements and experience, and any notification tokens for your
          devices.
        </p>
        <p>
          Deletion is permanent and cannot be undone. Posts already replied to by others may leave
          a record that a deleted user participated, without your name attached.
        </p>
      </Section>
    </Shell>
  )
}

export function TermsOfService() {
  return (
    <Shell title="Terms of Service">
      <p className="mt-4 text-sm leading-relaxed text-muted">
        By using Selah you agree to these terms. If you do not agree, please do not use the app.
      </p>

      <Section title="Your account">
        <p>
          You sign in with a Google account and are responsible for what happens under it. Tell us
          promptly if you believe someone else has access to it.
        </p>
      </Section>

      <Section title="How you may use Selah">
        <p>
          Selah is provided for personal devotional use and for discipleship within a local church.
          Please do not use it to harass anyone, to post unlawful or abusive content, to impersonate
          another person, or to attempt to access data belonging to others.
        </p>
        <p>
          Treat information about other people — disciples, attendance, prayer requests — as
          confidential pastoral information.
        </p>
      </Section>

      <Section title="Your content">
        <p>
          What you write remains yours. You grant us only the permission needed to store and display
          it back to you and to the people you have chosen to share it with.
        </p>
        <p>
          We may remove content that breaks these terms or that is reported as harmful.
        </p>
      </Section>

      <Section title="Scripture text">
        <p>
          Bible text is supplied by third-party providers and remains subject to their own copyright
          and terms. It is provided for personal study within the app.
        </p>
      </Section>

      <Section title="Availability">
        <p>
          Selah is provided as it is, without warranty. We cannot promise it will always be
          available or free of errors, and features may change. Please do not rely on it as the only
          copy of anything important to you.
        </p>
        <p>
          Guidance and reflection offered by any AI feature in the app is not pastoral counsel,
          medical advice or crisis support. If you are in distress, please speak to your pastor or
          leader, or contact emergency services.
        </p>
      </Section>

      <Section title="Ending your use">
        <p>
          You may stop using Selah and request deletion of your account at any time by emailing{' '}
          {CONTACT_EMAIL}. We may suspend an account that breaks these terms.
        </p>
      </Section>
    </Shell>
  )
}
