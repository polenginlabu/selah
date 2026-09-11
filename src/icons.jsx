const ICON_PROPS = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
}

export const SproutIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M12 22V11" />
    <path d="M12 11C12 7.5 9.5 5 6 5c0 3.5 2.5 6 6 6z" />
    <path d="M12 13c0-3 2-5.5 5.5-5.5C17.5 10.5 15 13 12 13z" />
  </svg>
)

export const HeartIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M19 14c1.5-1.5 3-3.4 3-5.5A4.5 4.5 0 0 0 12 6 4.5 4.5 0 0 0 2 8.5c0 2.1 1.5 4 3 5.5l7 7 7-7z" />
  </svg>
)

export const SunIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)

export const MoonIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

export const BookIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
  </svg>
)

export const PencilIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
)

export const PlusIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const TrashIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
  </svg>
)

export const ChevronLeftIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

export const ChevronRightIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M9 18l6-6-6-6" />
  </svg>
)

export const ChevronDownIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M6 9l6 6 6-6" />
  </svg>
)

export const MinusIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M5 12h14" />
  </svg>
)

export const SearchIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.35-4.35" />
  </svg>
)

export const XIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M18 6L6 18M6 6l12 12" />
  </svg>
)

export const CheckIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M20 6L9 17l-5-5" />
  </svg>
)

export const FlagIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M5 21V4" />
    <path d="M5 4h13l-3.5 4L18 12H5" />
  </svg>
)

export const TargetIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" />
  </svg>
)

export const TrophyIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M7 4h10v5a5 5 0 0 1-10 0V4z" />
    <path d="M7 5H3.5A1.5 1.5 0 0 0 4.5 8.5M17 5h3.5a1.5 1.5 0 0 1-1 3.5" />
    <path d="M12 14v3M8.5 21h7M9.5 21l.6-3M14.5 21l-.6-3" />
  </svg>
)

export const LogOutIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
)

export const BellIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
    <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
  </svg>
)

export const UserPlusIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <circle cx="9" cy="7" r="4" />
    <path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 3.5 1.1" />
    <path d="M19 8v6M16 11h6" />
  </svg>
)

export const UsersIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <circle cx="8" cy="8" r="3.5" />
    <path d="M2 21v-1a5.5 5.5 0 0 1 5.5-5.5h1A5.5 5.5 0 0 1 14 20v1" />
    <path d="M16 8a3 3 0 1 0 0-6" />
    <path d="M15 14.5a5 5 0 0 1 4 4.9V21" />
  </svg>
)

export const MapPinIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M12 22s7-6.5 7-12a7 7 0 1 0-14 0c0 5.5 7 12 7 12z" />
    <circle cx="12" cy="10" r="2.5" />
  </svg>
)

export const HomeIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M3 11l9-7 9 7" />
    <path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" />
  </svg>
)

export const GraduationCapIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M2 8l10-5 10 5-10 5-10-5z" />
    <path d="M6 10.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-5.5" />
    <path d="M22 8v6" />
  </svg>
)

export const BriefcaseIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <rect x="3" y="7" width="18" height="12" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M3 12h18" />
  </svg>
)

export const RibbonIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <circle cx="12" cy="8" r="5" />
    <path d="M8.5 12.5L7 21l5-3 5 3-1.5-8.5" />
  </svg>
)

export const ChatIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

export const FlameIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M12 2c1 4-4 5-4 9a4 4 0 0 0 8 0c0-1.5-1-2-1-3.5 1.5 1 3 3 3 5.5a6 6 0 0 1-12 0C6 8 9 5 12 2z" />
  </svg>
)

export const SunriseIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M12 17V7" />
    <path d="M8 11l4-4 4 4" />
    <path d="M3 21h18" />
    <path d="M6.5 21a5.5 5.5 0 0 1 11 0" />
  </svg>
)

export const ZapIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z" />
  </svg>
)

export const RefreshIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M21 12a9 9 0 0 1-15.5 6.4L3 16" />
    <path d="M3 12a9 9 0 0 1 15.5-6.4L21 8" />
    <path d="M3 16v4h4M21 8V4h-4" />
  </svg>
)

export const BranchIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M9 21V11c0-2.5 1.3-4.5 3-4.5" />
    <path d="M15 21V11c0-2.5-1.3-4.5-3-4.5" />
    <path d="M12 6.5V3" />
  </svg>
)

export const BookOpenIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M12 6.5C10.5 5 8 4 4 4v14c4 0 6.5 1 8 2.5C13.5 19 16 18 20 18V4c-4 0-6.5 1-8 2.5z" />
    <path d="M12 6.5V21" />
  </svg>
)

export const PhoneIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.362 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
)

export const BarChartIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M3 3v18h18" />
    <path d="M8 17V11M13 17V7M18 17v-4" />
  </svg>
)

export const CalendarIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M16 3v4M8 3v4M3 10h18" />
  </svg>
)

export const LockIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </svg>
)

export const DownloadIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M12 3v12" />
    <path d="M7 10l5 5 5-5" />
    <path d="M4 19h16" />
  </svg>
)

export const ShareIcon = (props) => (
  <svg {...ICON_PROPS} {...props}>
    <path d="M12 15V3" />
    <path d="M8 7l4-4 4 4" />
    <path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" />
  </svg>
)

export const GoogleIcon = (props) => (
  <svg width={18} height={18} viewBox="0 0 24 24" {...props}>
    <path
      fill="#4285F4"
      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1z"
    />
    <path
      fill="#34A853"
      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z"
    />
    <path fill="#FBBC05" d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84z" />
    <path
      fill="#EA4335"
      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
    />
  </svg>
)

export const ACHIEVEMENT_ICONS = {
  'user-plus': UserPlusIcon,
  users: UsersIcon,
  home: HomeIcon,
  chat: ChatIcon,
  'graduation-cap': GraduationCapIcon,
  briefcase: BriefcaseIcon,
  'book-open': BookOpenIcon,
  book: BookIcon,
  zap: ZapIcon,
  sun: SunIcon,
  heart: HeartIcon,
  refresh: RefreshIcon,
  'map-pin': MapPinIcon,
  ribbon: RibbonIcon,
  flame: FlameIcon,
  sunrise: SunriseIcon,
}

// Brand mark, so it is filled rather than stroked like the rest of the set.
export const FacebookIcon = (props) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
    <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5.02 3.66 9.18 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.52 1.5-3.91 3.77-3.91 1.09 0 2.24.2 2.24.2v2.46h-1.26c-1.24 0-1.63.78-1.63 1.57v1.89h2.78l-.45 2.91h-2.33V22c4.78-.76 8.44-4.92 8.44-9.94z" />
  </svg>
)
