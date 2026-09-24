import { NavLink, Link, Outlet, Navigate, useLocation } from 'react-router-dom';
import {
  LuUser, LuKeyRound, LuTrash2, LuUpload, LuMessageSquarePlus, LuInbox,
  LuCircleHelp, LuShieldCheck, LuFileText, LuChevronRight, LuChevronLeft,
  LuLayoutDashboard,
} from 'react-icons/lu';
import { useAuth } from '../../context/AuthContext';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import './Settings.css';

// One list drives the desktop sidebar, the phone index and the phone sub-header
// title, so a new page is added here once.
const NAV_GROUPS = [
  {
    label: 'Account',
    items: [
      { to: '/settings/profile', label: 'Edit Profile', hint: 'Name, photo and bio', Icon: LuUser },
      { to: '/settings/password', label: 'Change Password', hint: 'Keep your account secure', Icon: LuKeyRound },
    ],
  },
  {
    label: 'Content',
    items: [
      { to: '/settings/import', label: 'Import List', hint: 'Bring ratings in from a CSV', Icon: LuUpload },
    ],
  },
  {
    label: 'Support',
    items: [
      { to: '/settings/feedback', label: 'Submit Feedback', hint: 'Ideas, bugs, missing titles', Icon: LuMessageSquarePlus },
      { to: '/settings/my-issues', label: 'My Issues', hint: 'Feedback you have sent', Icon: LuInbox },
    ],
  },
  {
    label: 'Legal & Help',
    items: [
      { to: '/settings/help', label: 'Help & Tutorials', Icon: LuCircleHelp },
      { to: '/settings/privacy', label: 'Privacy Policy', Icon: LuShieldCheck },
      { to: '/settings/terms', label: 'Terms of Service', Icon: LuFileText },
    ],
  },
  {
    label: 'Danger zone',
    items: [
      { to: '/settings/delete-account', label: 'Delete Account', hint: 'Permanently remove your data', Icon: LuTrash2, danger: true },
    ],
  },
];

const ALL_ITEMS = NAV_GROUPS.flatMap((g) => g.items);

function ProfileBlock({ user, compact = false }) {
  const initials = (user?.username || user?.email || '?').charAt(0).toUpperCase();
  const avatarUrl = user?.avatar_url
    ? (user.avatar_url.startsWith('http') ? user.avatar_url : `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}${user.avatar_url}`)
    : null;

  return (
    <div className={`settings-profile${compact ? ' settings-profile--compact' : ''}`}>
      <div className="settings-profile__avatar">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : initials}
      </div>
      <div className="settings-profile__info">
        <span className="settings-profile__name">{user?.username || 'User'}</span>
        <span className="settings-profile__email">{user?.email}</span>
      </div>
      <Link to="/dashboard" className="settings-profile__link" aria-label="Open dashboard">
        <LuLayoutDashboard aria-hidden />
        {!compact && <span>Dashboard</span>}
      </Link>
    </div>
  );
}

function NavRow({ item, variant }) {
  const { to, label, hint, Icon, danger } = item;
  return (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `settings-nav__row settings-nav__row--${variant}${danger ? ' is-danger' : ''}${isActive ? ' is-active' : ''}`
      }
    >
      <span className="settings-nav__icon"><Icon aria-hidden /></span>
      <span className="settings-nav__text">
        <span className="settings-nav__label">{label}</span>
        {variant === 'list' && hint && <span className="settings-nav__hint">{hint}</span>}
      </span>
      {variant === 'list' && <LuChevronRight className="settings-nav__chev" aria-hidden />}
    </NavLink>
  );
}

function NavGroups({ variant }) {
  return NAV_GROUPS.map((group) => (
    <section key={group.label} className="settings-nav__group">
      <h2 className="settings-nav__heading">{group.label}</h2>
      <div className="settings-nav__items">
        {group.items.map((item) => <NavRow key={item.to} item={item} variant={variant} />)}
      </div>
    </section>
  ));
}

const Settings = () => {
  const location = useLocation();
  const { user } = useAuth();
  const isMobile = useMediaQuery('(max-width: 768px)');

  const path = location.pathname.replace(/\/+$/, '');
  const isIndex = path === '/settings';

  // Desktop has no index screen: the sidebar is always there, so land on Profile.
  if (isIndex && !isMobile) {
    return <Navigate to="/settings/profile" replace />;
  }

  if (isMobile) {
    if (isIndex) {
      return (
        <div className="settings-layout settings-layout--index">
          <header className="settings-index__head">
            <h1>Settings</h1>
          </header>
          {user && <ProfileBlock user={user} compact />}
          <nav className="settings-nav settings-nav--list" aria-label="Settings">
            <NavGroups variant="list" />
          </nav>
        </div>
      );
    }

    const current = ALL_ITEMS.find((i) => path.startsWith(i.to));
    return (
      <div className="settings-layout settings-layout--sub">
        <header className="settings-subhead">
          <Link to="/settings" className="settings-subhead__back">
            <LuChevronLeft aria-hidden /> Settings
          </Link>
          {current && <span className="settings-subhead__title">{current.label}</span>}
        </header>
        <main className="settings-content">
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <div className="settings-layout">
      <div className="settings-shell">
        <aside className="settings-sidebar">
          {user && <ProfileBlock user={user} />}
          <nav className="settings-nav settings-nav--rail" aria-label="Settings">
            <NavGroups variant="rail" />
          </nav>
        </aside>
        <main className="settings-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default Settings;
