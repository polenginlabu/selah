import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabase";
import { getLevel, getTribeForLevel, TRIBES, withOpacity } from "../lib/gamification";
import { TRIBE_ICONS } from "../tribeIcons";
import { MinusIcon } from "../icons";

async function fetchLeaderboard() {
  const {
    data,
    error
  } = await supabase.from("user_stats").select("user_id, xp, profiles(full_name)").gt("xp", 0).order("xp", {
    ascending: !1
  }).limit(50);
  if (error) throw error;
  return data ?? [];
}
function buildLeaderboard(rows, currentUserId) {
  return rows.map(row => {
    var profiles;
    const fullName = ((profiles = row.profiles) == null ? void 0 : profiles.full_name) || "Anonymous",
      level = getLevel(row.xp),
      badge = getTribeForLevel(level);
    return {
      id: row.user_id,
      name: fullName,
      initials: getInitials(fullName),
      level,
      xp: row.xp,
      badge,
      isMe: row.user_id === currentUserId
    };
  });
}
function getInitials(name) {
  var last;
  const parts = name.trim().split(/\s+/),
    firstInitial = ((last = parts[0]) == null ? void 0 : last[0]) ?? "",
    lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (firstInitial + lastInitial).toUpperCase() || "?";
}
function TribeIcon({
  id,
  size = 14,
  color
}) {
  const Icon = TRIBE_ICONS[id];
  return Icon ? <Icon width={size} height={size} style={{
    color
  }} /> : null;
}
const MEDALS = ["🥇", "🥈", "🥉"],
  PODIUM_HEIGHTS = ["h-28", "h-20", "h-14"],
  PODIUM_ORDER = [1, 0, 2];
function PodiumSpot({
  player,
  rank
}) {
  const tribe = player.badge,
    isFirst = rank === 0;
  return <div className="flex flex-1 flex-col items-center"><div className={`${isFirst ? "text-[28px]" : "text-[22px]"} mb-1.5 leading-none`}>{MEDALS[rank]}</div><div className={`relative flex items-center justify-center rounded-full font-sans font-black ${isFirst ? "h-[68px] w-[68px] text-lg" : "h-14 w-14 text-[15px]"}`} style={{
      background: withOpacity(tribe.color, 0.1),
      border: `2.5px solid ${tribe.color}`,
      boxShadow: `0 0 ${isFirst ? 24 : 16}px ${withOpacity(tribe.color, 0.35)}`,
      color: tribe.color
    }}>{player.initials}</div><p className="mt-2 max-w-[90px] text-center text-[11px] font-bold leading-tight text-ink">{player.name.split(" ")[0]}</p><p className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold" style={{
      color: tribe.color
    }}><TribeIcon id={tribe.icon} size={12} color={tribe.color} /> Lv {player.level}</p><p className="mt-1 text-[11px] font-extrabold text-amber-400">{player.xp.toLocaleString()} XP</p><div className={`mt-2 w-full rounded-t-xl ${PODIUM_HEIGHTS[rank]} flex items-start justify-center pt-3`} style={{
      background: isFirst ? `linear-gradient(180deg, ${withOpacity(tribe.color, 0.16)}, ${withOpacity(tribe.color, 0.06)})` : "var(--color-raised)",
      border: `1px solid ${isFirst ? withOpacity(tribe.color, 0.25) : "var(--color-line)"}`,
      borderBottom: "none"
    }}><span className="font-sans text-xl font-black" style={{
        color: isFirst ? tribe.color : "var(--color-muted)"
      }}>#{rank + 1}</span></div></div>;
}
function LeaderboardRow({
  player,
  rank,
  myBadge
}) {
  const tribe = player.badge,
    isCurrentUser = !!player.isMe;
  return <div className="flex items-center gap-3 rounded-xl px-3.5 py-3" style={{
    background: isCurrentUser ? withOpacity(myBadge.color, 0.06) : "var(--color-surface)",
    border: `1px solid ${isCurrentUser ? withOpacity(myBadge.color, 0.22) : "var(--color-line)"}`,
    boxShadow: isCurrentUser ? `0 0 20px ${withOpacity(myBadge.color, 0.06)}` : "none"
  }}><span className="w-7 shrink-0 text-center font-sans text-base font-black" style={{
      color: isCurrentUser ? myBadge.color : "var(--color-muted)"
    }}>{rank}</span><MinusIcon width={13} height={13} className="text-muted" /><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-sans text-[13px] font-black" style={{
      background: withOpacity(tribe.color, 0.1),
      border: `2px solid ${withOpacity(tribe.color, isCurrentUser ? 0.8 : 0.35)}`,
      color: tribe.color
    }}>{player.initials}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-[13px] font-bold text-ink">{player.name}</p>{isCurrentUser && <span className="shrink-0 rounded-full px-1.5 py-px text-[9px] font-extrabold tracking-wide" style={{
          background: myBadge.color,
          color: "#0C0D16"
        }}>YOU</span>}</div><div className="flex items-center gap-1.5"><span className="flex items-center gap-1 text-[10px] font-bold" style={{
          color: tribe.color
        }}><TribeIcon id={tribe.icon} size={12} color={tribe.color} /> {tribe.name}</span><span className="text-[10px] text-muted">·</span><span className="text-[10px] font-semibold text-muted">Lv {player.level}</span></div></div><div className="shrink-0 text-right"><p className="text-[13px] font-extrabold" style={{
        color: isCurrentUser ? "#E9CE38" : "var(--color-muted)"
      }}>{player.xp.toLocaleString()}</p><p className="text-[10px] font-semibold text-muted">XP</p></div></div>;
}
export default function Leaderboard() {
  const {
      user
    } = useAuth(),
    [players, setPlayers] = useState([]),
    [loading, setLoading] = useState(!0);
  if (useEffect(() => {
    fetchLeaderboard().then(rows => setPlayers(buildLeaderboard(rows, user == null ? void 0 : user.id))).catch(err => console.error("leaderboard fetch failed", err)).finally(() => setLoading(!1));
  }, [user == null ? void 0 : user.id]), loading) return <LeaderboardSkeleton />;
  if (players.length < 3) return <div className="space-y-4"><div><p className="eyebrow">Leaderboards</p><h1 className="font-sans text-xl font-bold tracking-tight">Who Leads the Pack? 🏆</h1></div><div className="card flex flex-col items-center gap-3 py-12 text-center"><p className="text-sm text-muted">Not enough players yet. Start earning XP to join the board!</p></div>{players.length > 0 && <div className="space-y-2">{players.map((player, index) => <LeaderboardRow player={player} rank={index + 1} myBadge={player.isMe ? player.badge : TRIBES[0]} key={player.id} />)}</div>}</div>;
  const topThree = PODIUM_ORDER.map(i => players[i]),
    rest = players.slice(3),
    currentPlayer = players.find(p => p.isMe),
    currentRank = players.findIndex(p => p.isMe) + 1,
    currentBadge = (currentPlayer == null ? void 0 : currentPlayer.badge) ?? TRIBES[0];
  return <div className={`space-y-4 ${currentRank > 3 ? "pb-24" : "pb-4"}`}><div><p className="eyebrow">Leaderboards</p><h1 className="font-sans text-xl font-bold tracking-tight">Who Leads the Pack? 🏆</h1></div><div className="flex items-end gap-1.5">{topThree.map((player, index) => {
        const rank = PODIUM_ORDER[index];
        return <PodiumSpot player={player} rank={rank} key={player.id} />;
      })}</div><div className="flex items-center justify-between"><p className="text-xs font-bold text-muted">Rank · Member · Total XP</p><p className="text-[11px] font-semibold text-muted/60">{players.length} members</p></div><div className="space-y-2">{rest.map((player, index) => <LeaderboardRow player={player} rank={index + 4} myBadge={currentBadge} key={player.id} />)}</div>{currentPlayer && currentRank > 3 && createPortal(<div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-sticky mx-auto max-w-xl px-4"><div className="flex items-center gap-3 rounded-xl px-4 py-3" style={{
        background: `linear-gradient(135deg, ${withOpacity(currentBadge.color, 0.08)}, var(--color-canvas))`,
        border: `1.5px solid ${withOpacity(currentBadge.color, 0.28)}`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 24px ${withOpacity(currentBadge.color, 0.15)}`,
        backdropFilter: "blur(16px)"
      }}><span className="w-7 text-center font-sans text-lg font-black" style={{
          color: currentBadge.color
        }}>#{currentRank}</span><MinusIcon width={13} height={13} className="text-muted" /><div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-sans text-[13px] font-black" style={{
          background: withOpacity(currentBadge.color, 0.12),
          border: `2px solid ${currentBadge.color}`,
          color: currentBadge.color
        }}>{currentPlayer.initials}</div><div className="min-w-0 flex-1"><p className="text-[13px] font-bold text-ink">{currentPlayer.name}</p><p className="flex items-center gap-1 text-[10px] font-semibold" style={{
            color: currentBadge.color
          }}><TribeIcon id={currentBadge.icon} size={12} color={currentBadge.color} /> {currentBadge.name} · Lv {currentPlayer.level}</p></div><div className="shrink-0 text-right"><p className="text-[13px] font-extrabold text-amber-400">{currentPlayer.xp.toLocaleString()}</p><p className="text-[10px] font-semibold text-muted">XP</p></div></div></div>, document.body)}</div>;
}
function LeaderboardSkeleton() {
  return <div className="space-y-4" aria-hidden={!0}><div><div className="h-3 w-20 rounded bg-raised" /><div className="mt-2 h-6 w-48 rounded bg-raised" /></div><div className="flex items-end gap-1.5">{[0, 1, 2].map(index => <div className="flex flex-1 flex-col items-center gap-2" key={index}><div className={`${index === 1 ? "h-[68px] w-[68px]" : "h-14 w-14"} animate-pulse rounded-full bg-raised`} /><div className={`w-full rounded-t-xl ${PODIUM_HEIGHTS[index]} animate-pulse bg-raised`} /></div>)}</div>{[0, 1, 2, 3, 4].map(index => <div className="h-16 animate-pulse rounded-xl bg-raised" key={index} />)}</div>;
}
