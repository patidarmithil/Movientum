# Movientum — Frontend System Design Document

**Stack**: React SPA · FastAPI Backend · React Router v6 · Context API → Redux Toolkit  
**Design Language**: Neo-Brutalist Dark Mode · Inter + Outfit fonts · Electric Purple `#B048FF` accent  
**Scope**: UI structure, design system, interactions, state, API patterns, user flows

---

## 1. Design System Foundation

### 1.1 Color Tokens

| Token | Value | Usage |
|---|---|---|
| `--bg-void` | `#080808` | Page background |
| `--surface-card` | `#1B1B1B` | Cards, panels, headers |
| `--surface-input` | `#2A2A2A` | Inputs, active tabs, inner layers |
| `--border` | `#252833` | All element borders |
| `--text-primary` | `#FFFFFF` | Headlines, labels |
| `--text-muted` | `#9CA3AF` | Subtext, timestamps, metadata |
| `--accent` | `#B048FF` | Brand, active states, focus rings |
| `--accent-glow` | `rgba(176, 72, 255, 0.25)` | Glow on hover, shadows |
| `--rating-skip` | `#FF4D6D` | Skip category |
| `--rating-timepass` | `#FFC300` | Timepass category |
| `--rating-goforit` | `#00E5A0` | Go for it category |
| `--rating-perfection` | `#9B59FF` | Perfection category |
| `--success` | `#22C55E` | Watched checkmarks, confirmations |
| `--error` | `#EF4444` | Inline errors, form validation |

### 1.2 Typography

```css
--font-primary: 'Inter', sans-serif;       /* Body, UI, labels */
--font-display: 'Outfit', sans-serif;      /* Headings, logo, hero text */

/* Scale */
--text-xs:   11px;
--text-sm:   13px;
--text-base: 15px;
--text-lg:   18px;
--text-xl:   22px;
--text-2xl:  28px;
--text-3xl:  36px;
--text-hero: 52px;   /* Landing page hero headline */
```

### 1.3 Spacing & Layout

- **Base unit**: 4px  
- **Card border-radius**: 12px (inner cards), 16px (primary panels)  
- **Card border**: `1px solid var(--border)` — stark, not shadow-based  
- **Section padding**: `80px 0` on desktop, `40px 0` on mobile  
- **Content max-width**: `1280px`, centered  
- **Grid gaps**: 16px (dense), 24px (standard), 32px (section)  

### 1.4 Motion & Animation Principles

- **Hover transitions**: `150ms ease` — snap, not sluggish  
- **Page transitions**: `200ms fade + 20px translateY` slide-up  
- **Skeleton shimmer**: 1.5s linear infinite gradient sweep  
- **Modal entrance**: `250ms scale(0.95 → 1.0) + fade`  
- **Toast notification**: `300ms slide-in-right`  
- **Card hover lift**: `transform: translateY(-4px)` + accent border glow  

---

## 2. Landing / Intro Page (Public — `/intro` or default for unauthenticated)

### 2.1 Layout Structure

```
┌─────────────────────────────────────────────┐
│  NAVBAR (logo + "Login" + "Sign Up" CTA)    │
├─────────────────────────────────────────────┤
│  HERO SECTION                               │
│  - Full-width, 100vh                        │
│  - Background: blurred movie poster mosaic  │
│    + dark overlay gradient                  │
│  - Center-aligned text block                │
│  - Headline + tagline + CTA buttons         │
├─────────────────────────────────────────────┤
│  FEATURES SECTION (4-column grid)           │
├─────────────────────────────────────────────┤
│  HOW IT WORKS SECTION (3-step visual)       │
├─────────────────────────────────────────────┤
│  TRENDING PREVIEW (horizontal movie strip)  │
├─────────────────────────────────────────────┤
│  FINAL CTA SECTION                          │
├─────────────────────────────────────────────┤
│  FOOTER                                     │
└─────────────────────────────────────────────┘
```

### 2.2 Hero Section

**Background**: Full-bleed mosaic of ~12 movie posters arranged in a parallax grid. Overlaid with `linear-gradient(to bottom, rgba(8,8,8,0.6) 0%, rgba(8,8,8,0.95) 100%)`.

**Content (centered, max-width 700px):**

```
[display font, 52px, white, bold]
Discover. Rate. Watch.
Your Movies, Your Way.

[body font, 18px, muted gray]
Movientum learns your taste through privacy-preserving 
federated AI — no data leaves your device.

[CTA buttons row]
[ Try Demo → ]   [ Login ]   [ Sign Up Free ]
```

**CTA Buttons:**
- **Try Demo** → `variant: primary` — filled accent purple `#B048FF`, white text, `border-radius: 8px`, `padding: 12px 28px`
- **Login** → `variant: ghost` — transparent, `border: 1px solid #B048FF`, accent text
- **Sign Up Free** → `variant: secondary` — dark surface background, white text, subtle border

**Animations:**
- Hero text fades in with `translateY(20px → 0)` on page load, staggered 150ms per element
- Poster mosaic background has subtle parallax on scroll (3–5% movement)
- CTA buttons glow pulse on `::after` pseudo-element when idle for 3s

### 2.3 Features Section

**Header:** `Why Movientum?` — centered, `--font-display`, `28px`

**4-column card grid (collapses to 2-col on tablet, 1-col on mobile):**

| Card | Icon | Headline | Description |
|---|---|---|---|
| 1 | 🎯 | Personalized For You | ML recommendations that improve with every rating |
| 2 | 🔒 | Your Privacy, Protected | Federated learning — your data never leaves your device |
| 3 | ⭐ | 4-Category Rating System | Skip · Timepass · Go for it · Perfection |
| 4 | 📰 | Movie News Integrated | Latest news articles tied to movies you love |

**Card design:**  
- Background: `--surface-card` (`#1B1B1B`)  
- Border: `1px solid var(--border)`  
- Top: colored icon block (accent color per feature)  
- Hover: `border-color: var(--accent)` + `box-shadow: 0 0 20px var(--accent-glow)`  
- Transition: `150ms ease`

### 2.4 How It Works Section

3-step horizontal flow with arrows between steps:

```
[ 1. Sign Up ] ──▶ [ 2. Rate & Watch ] ──▶ [ 3. Get Personalized Picks ]
```

Each step: numbered circle (accent color), bold title, short description.

### 2.5 Trending Preview Strip

Heading: `What's Trending` — left-aligned  
Content: Horizontal scroll row of 8 `MovieCard` components (read-only, poster only, no actions)  
CTA below: `Explore All Movies →` button links to `/movies`

### 2.6 Final CTA Section

Full-width dark gradient panel:

```
Ready to find your next favorite film?

[ Create Free Account ]   [ Explore Demo ]
```

Background: `linear-gradient(135deg, #0F0015 0%, #080808 100%)` — deep purple-black

### 2.7 Landing Navbar (Unauthenticated)

```
[Movientum logo] ────────────────── [Login] [Sign Up]
```

- Logo: `Outfit` font, `#B048FF` accent color, bold
- Sticky on scroll with `backdrop-filter: blur(12px)` + `background: rgba(8,8,8,0.85)`

---

## 3. Demo Mode (`/demo`)

### 3.1 Purpose

Allow unauthenticated users to explore platform feel without creating an account.

### 3.2 What Is Visible in Demo

| Feature | Available | Notes |
|---|---|---|
| Trending movies list | ✅ | Full browsing |
| Movie detail page | ✅ | Read-only |
| Sample recommendations | ✅ | Labeled "Sample — based on global trends" |
| Rating meter (view) | ✅ | Read-only, no submit |
| Rating buttons | ❌ | Greyed out, tooltip: "Login to rate" |
| Mark as Watched | ❌ | Disabled |
| Add to Watchlist | ❌ | Disabled |
| Search | ✅ | Full search works |
| Dashboard | ❌ | Redirects to login |

### 3.3 Demo Mode Banner

Sticky banner at bottom of viewport:

```
🎬  You're in Demo Mode — ratings and watchlist are disabled.
[ Login to unlock full experience ]   [ Sign Up Free ]
```

Background: `#1B1B1B` with `border-top: 1px solid var(--border)`  
Dismiss button: hides banner for session (stored in `sessionStorage`)

### 3.4 Demo Data Source

- `GET /api/movies/trending` — real data, no auth required
- `GET /api/recommendations/sample` — pre-computed global top picks, not personalized
- Recommendations labeled with badge: `📊 Global Trending` instead of `For You`

---

## 4. Authentication Pages

### 4.1 Login Page (`/login`)

**Layout:** Full-screen centered card on `--bg-void` background.

```
┌────────────────────────────────────┐
│  [Movientum logo]                  │
│  Welcome back                      │
│  ─────────────────────────────     │
│  Email Address                     │
│  [________________________]        │
│  Password                          │
│  [________________________] [👁]   │
│                                    │
│  Forgot password?           ←link  │
│                                    │
│  [       Log In       ]            │
│                                    │
│  Don't have an account? Sign up →  │
└────────────────────────────────────┘
```

**UX Details:**
- Password field has show/hide toggle icon (`👁`)
- "Forgot password?" aligned right, `--text-muted` color, underline on hover
- Login button: full-width, `--accent` background, `Outfit` font, `15px`
- On submit: button shows spinner icon + `"Logging in..."` text, disabled state
- On error (401): red inline message below password field — `"Invalid email or password"`
- No separate error for "email not found" vs "wrong password" (security: no enumeration)
- On success: redirect to `?redirect` param or `/` (home)
- Form inputs: `--surface-input` background, `--border` border, `--text-primary` text, `--accent` focus outline

### 4.2 Signup Page (`/register`)

**Two-step flow:**

**Step 1 — Details:**
```
┌────────────────────────────────────┐
│  [Movientum logo]                  │
│  Create your account               │
│  ─────────────────────────────     │
│  Name                              │
│  [________________________]        │
│  Email Address                     │
│  [________________________]        │
│  Password                          │
│  [________________________] [👁]   │
│  Confirm Password                  │
│  [________________________] [👁]   │
│                                    │
│  Password strength: ████░░ Medium  │
│                                    │
│  [     Create Account    ]         │
│                                    │
│  Already have an account? Log in → │
└────────────────────────────────────┘
```

**Password Strength Indicator:** 5-segment horizontal bar below password field.
- Red (1-2 segments): Weak — length < 8 or no complexity
- Yellow (3 segments): Medium — 8+ chars, some complexity
- Green (4-5 segments): Strong — 8+ chars, uppercase + number + special char

**Step 2 — Email Verification (OTP):**

```
┌────────────────────────────────────┐
│  Check your inbox                  │
│  We sent a 6-digit code to         │
│  user@example.com                  │
│  ─────────────────────────────     │
│  [ _ ][ _ ][ _ ][ _ ][ _ ][ _ ]   │
│                                    │
│  Code expires in: 09:47            │
│                                    │
│  [      Verify Email     ]         │
│                                    │
│  Didn't receive it?                │
│  Resend code (wait 60s)            │
└────────────────────────────────────┘
```

**OTP Input UX:**
- 6 individual single-character input boxes
- Auto-advance focus on digit entry
- Backspace moves focus to previous box
- Paste support: pastes all 6 digits at once
- Countdown timer shown (`MM:SS` format), turns red at 60s
- Resend button disabled until cooldown expires

**Validation feedback (inline, not alert dialogs):**
- Email already registered: `"This email is already in use. Log in instead?"`
- Invalid OTP: `"Incorrect code. X attempts remaining."`
- Expired OTP: `"Code expired. Request a new one."`

---

## 5. Main Application — Home Dashboard (After Login, `/`)

### 5.1 Page Layout

```
┌──────────────────────────────────────────────────────┐
│  NAVBAR (full — with search + profile)               │
├──────────────────────────────────────────────────────┤
│  HERO BANNER (featured movie, full-width, 420px tall)│
├──────────────────────────────────────────────────────┤
│  For You (personalized row)          [see all →]     │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐              │
│  │Card│ │Card│ │Card│ │Card│ │Card│  →→→          │
│  └────┘ └────┘ └────┘ └────┘ └────┘              │
├──────────────────────────────────────────────────────┤
│  Trending Now                         [see all →]    │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐              │
│  │Card│ │Card│ │Card│ │Card│ │Card│  →→→          │
├──────────────────────────────────────────────────────┤
│  Continue Watching                    [see all →]    │
│  ┌────┐ ┌────┐ ┌────┐                             │
│  │Card│ │Card│ │Card│                             │
├──────────────────────────────────────────────────────┤
│  Top in Action                        [see all →]    │
│  Top in Drama                         [see all →]    │
│  Top in Sci-Fi                        [see all →]    │
├──────────────────────────────────────────────────────┤
│  Hidden Gems (high rated, low popularity)            │
└──────────────────────────────────────────────────────┘
```

### 5.2 Hero Banner

- **Size**: Full viewport width, `420px` height
- **Background**: Featured movie backdrop image (TMDB backdrop_path, high resolution)
- **Overlay**: `linear-gradient(to right, rgba(8,8,8,0.95) 30%, transparent 100%)`
- **Content** (left-aligned, 40% width):
  - Genre tags (colored badge chips)
  - Movie title — `Outfit`, `42px`, white, bold
  - Short synopsis — 2-3 lines, muted text
  - Action row: `[ + Watchlist ]` `[ Mark Watched ]` `[ Rate ]`
- **Dots pagination** at bottom for rotating featured movies (auto-rotate every 8s)

### 5.3 Data Loading Strategy

```
On mount (authenticated user):
  Parallel fetch:
    → GET /api/recommendations           → "For You" row
    → GET /api/movies/trending           → "Trending" row
    → GET /api/watch/history?limit=5     → "Continue Watching" row
    → GET /api/movies/genre/action?sort=rating → "Top in Action"
    → GET /api/movies/genre/drama?sort=rating  → "Top in Drama"

  Sequential:
    → First: featured movie (hero) loaded from recommendations[0]
    → Then: remaining rows fill in as data arrives

On mount (guest / demo user):
  → GET /api/movies/trending             → All rows show popular content
  → "For You" row hidden (replaced with onboarding prompt)
  → "Continue Watching" row hidden
```

**Skeleton loading:** Each row renders `MovieCardSkeleton` components (gray shimmer rectangles at card dimensions) while data is in-flight. Rows appear one by one as data resolves.

### 5.4 Conditional Rendering Rules

| Section | Logged In | Guest/Demo |
|---|---|---|
| Hero Banner | Featured movie | Trending #1 movie |
| For You row | ✅ Personalized | ❌ Hidden (show sign-up prompt) |
| Trending row | ✅ | ✅ |
| Continue Watching | ✅ If history exists | ❌ Hidden |
| Genre rows | ✅ Based on preferences | ✅ Default genres |
| Rating buttons | ✅ Active | ❌ Greyed |
| Watchlist button | ✅ Active | ❌ Greyed |

---

## 6. Navigation System

### 6.1 Navbar Component

```
┌──────────────────────────────────────────────────────────────┐
│  [M] Movientum  │  [🔍 Search movies...        ]  │ [⚙] [👤] │
└──────────────────────────────────────────────────────────────┘
```

**Layout:** `position: sticky; top: 0; z-index: 1000`  
**Background:** `rgba(8,8,8,0.88)` + `backdrop-filter: blur(16px)`  
**Height:** `64px`  
**Border-bottom:** `1px solid var(--border)`

**Left — Logo:**
- `[M]` lettermark in accent purple
- `Movientum` in `Outfit` font, `18px`, bold, white
- Click → navigates to `/`

**Center — SearchBar:**
- Width: `400px` on desktop, collapses on mobile
- Placeholder: `"Search movies, actors, directors..."`
- Background: `--surface-input`, border: `--border`
- On focus: border turns `--accent`, subtle glow
- Autocomplete dropdown (see Section 7.2)
- On Enter: navigate to `/search?q=...`

**Right — Controls:**
- **Unauthenticated:** `[ Login ]` ghost button + `[ Sign Up ]` primary button
- **Authenticated:**
  - Bell icon (future notifications)
  - Avatar circle (user initials or profile photo) → opens dropdown

**Avatar Dropdown:**
```
┌──────────────────────┐
│  👤 John Doe         │
│  john@example.com    │
│  ──────────────────  │
│  Dashboard           │
│  My Watchlist        │
│  My Ratings          │
│  Preferences         │
│  ──────────────────  │
│  Log Out             │
└──────────────────────┘
```

Dropdown: `--surface-card` background, `--border` border, `border-radius: 12px`, shadow.  
Closes on click outside or Escape key.

---

## 7. Application Pages

### 7.1 Movie List Page (`/movies`)

**Layout:** Two-column: filter sidebar left (280px) + main grid right.

**Filter Sidebar:**
```
Filters                    [Clear All]
──────────────────────────
Genre
☐ Action   ☐ Drama
☐ Comedy   ☐ Sci-Fi
☐ Horror   ☐ Romance
☐ Thriller ☐ Animation

Year Range
[────○──────────] 1990–2024

Minimum Rating
[○──────────────] 0 – 10.0

Sort By
○ Popularity (default)
○ Release Date (newest)
○ Highest Rated
○ Most Rated
```

**Main Grid:** `repeat(auto-fill, minmax(180px, 1fr))` — responsive card grid  
**Pagination:** Infinite scroll — `IntersectionObserver` on last card triggers `GET /api/movies?page=N`  
Each filter change → debounced 200ms → new API call with all active filters as query params.

**Empty State:** If no movies match filters:
```
🎬  No movies found for these filters.
[Clear Filters]
```

### 7.2 Movie Detail Page (`/movies/:id`)

**Layout:** Top section (poster + info) + bottom section (tabs + strips)

```
┌──────────────────────────────────────────────────────┐
│  ┌──────────┐  TITLE (Outfit, 36px)                  │
│  │  POSTER  │  Year · Runtime · Genres (badge chips) │
│  │  (W300)  │  Director: ___  Cast: ___, ___, ...    │
│  │          │  ───────────────────────────────        │
│  │          │  Synopsis paragraph                     │
│  │          │  ───────────────────────────────        │
│  │          │  [ + Watchlist ]  [ ✓ Watched ]        │
│  └──────────┘                                         │
│                                                       │
│  RATING METER (semicircular)                         │
│  ● Skip X%  ● Timepass X%  ● Go for it X%  ● Perf X%│
│  [Skip 🔴] [Timepass 🟡] [Go for it 🟢] [Perfection🟣]│
│                                                       │
│  Related News                                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐             │
│  │News Card │ │News Card │ │News Card │             │
│  └──────────┘ └──────────┘ └──────────┘             │
│                                                       │
│  Movies Like This                                     │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌────┐               │
│  │Card│ │Card│ │Card│ │Card│ │Card│ →→→           │
│  └────┘ └────┘ └────┘ └────┘ └────┘               │
└──────────────────────────────────────────────────────┘
```

**Parallel data fetching on mount:**
```javascript
Promise.all([
  movieService.getMovieById(id),           // movie details
  ratingService.getDistribution(id),       // rating meter data
  ratingService.getUserRating(id),         // user's existing rating (if logged in)
  movieService.getSimilar(id),             // "Movies Like This" strip
  newsService.getMovieNews(id),            // related news articles
  watchService.getStatus(id),              // watched/watchlist status (if logged in)
])
```

**Rating Meter Component** (semicircular SVG):
- 180° arc split by category percentages
- Colors: Skip `#FF4D6D` → Timepass `#FFC300` → Go for it `#00E5A0` → Perfection `#9B59FF`
- Center text: dominant category percentage + total votes
- Empty state: full gray arc, "No ratings yet"
- Interactive: clicking a category button below meter triggers optimistic UI update + API call

**Action Buttons:**
- `+ Watchlist` → `POST /api/watch/watchlist` → button becomes `✓ In Watchlist` (green)
- `✓ Watched` → `POST /api/watch` → button becomes green checkmark, stays green
- Rating buttons (4 colored pills) → open `RatingModal` OR inline submit

### 7.3 Search Results Page (`/search?q=...`)

**Layout:** Search bar (pre-filled) at top + filter row + results grid

```
┌──────────────────────────────────────────┐
│  [🔍  dark knight              ] [Search] │
│                                          │
│  Genre: [All ▾]  Year: [All ▾]  Rating: [All ▾] │
│                                          │
│  32 results for "dark knight"            │
│                                          │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐           │
│  │Card│ │Card│ │Card│ │Card│           │
│  ┌────┐ ┌────┐ ┌────┐ ┌────┐           │
│  │Card│ │Card│ │Card│ │Card│           │
└──────────────────────────────────────────┘
```

**Autocomplete dropdown** (in search bar, appears while typing):
```
┌─────────────────────────────────────────┐
│  🎬 The Dark Knight (2008)              │
│  🎬 The Dark Knight Rises (2012)        │
│  🎬 Batman: The Dark Knight Returns...  │
│  🔍 Search all results for "dark kni..." │
└─────────────────────────────────────────┘
```
- Debounce: 300ms after last keystroke
- Min query length: 2 characters
- Max suggestions: 8
- Each item: poster thumbnail + title + year
- Click item → navigate to `/movies/:id` (skip results page)
- Click "Search all results" → navigate to `/search?q=...`

**No results state:**
```
🔍  No results for "zzxqwerty"
Try: "inception", "dark knight", or browse by genre
```

### 7.4 User Dashboard (`/dashboard`)

**Access:** Protected route — requires authentication. Unauthenticated redirect to `/login?redirect=/dashboard`.

**Layout:** Full-width page, sidebar tabs left on desktop, tabs collapse to horizontal scrolling pills on mobile.

```
┌──────────────────────────────────────────────────────┐
│  My Dashboard           [John Doe] [✏ Edit Profile] │
├──────────────┬───────────────────────────────────────┤
│  📋 History  │                                       │
│  📌 Watchlist│         [TAB CONTENT AREA]           │
│  ⭐ Ratings  │                                       │
│  🎛 Prefs   │                                       │
└──────────────┴───────────────────────────────────────┘
```

**Tab: Watch History**
- Timeline view: grouped by date (Today, Yesterday, Last Week, Month)
- Each entry: `MovieCard` (compact) + watched date + rating badge (if rated)
- Infinite scroll — loads 20 at a time
- Empty state: `"No watch history yet. Start watching!"` + link to browse

**Tab: Watchlist**
- Grid of `MovieCard` components
- Each card has `[ Remove ]` button (appears on hover)
- `DELETE /api/watch/watchlist/:id` → item fades out with transition
- Empty state: `"Your watchlist is empty."` + `"Browse Movies"`

**Tab: My Ratings**
- Grid of rated movies with rating badge per card
- Rating badge color matches category: Skip=red, Timepass=yellow, etc.
- Click card → Movie Detail Page
- Summary row at top: total ratings count per category with mini meter

**Tab: Preferences**
```
Genre Preferences
[Action ✓] [Drama ✓] [Sci-Fi ✓] [Comedy] [Horror] ...

Recommendation Style
○ Conservative (similar to what I like)
● Balanced (default)
○ Adventurous (discover new genres)

Account
Email: john@example.com  [Change Email]
Password:  ••••••••       [Change Password]
```

---

## 8. Component Design System

### 8.1 MovieCard

**Variants:** Standard (160×240px poster) · Compact (for lists) · Featured (hero)

**Standard Card:**
```
┌────────────────┐
│                │
│   POSTER IMG   │
│   (2:3 ratio)  │
│                │
│                │
│ ████████ 8.5  │  ← rating badge (top-right corner)
│                │
├────────────────┤
│ Movie Title    │
│ 2010 · Action  │
└────────────────┘
```

**Props:**
```typescript
interface MovieCardProps {
  movie: {
    id: number;
    title: string;
    poster_path: string;
    release_year: number;
    genres: string[];
    vote_average: number;
  };
  variant?: 'standard' | 'compact' | 'featured';
  showActions?: boolean;       // watchlist/watched buttons on hover
  userRating?: RatingCategory; // highlight if user rated
  onWatchlist?: boolean;       // show ✓ indicator
}
```

**Interactions:**
- Hover: `translateY(-4px)` + `border-color: var(--accent)` + glow shadow, `150ms`
- Hover (with `showActions=true`): overlay appears with `[ + Watchlist ]` `[ Watched ✓ ]` buttons
- Click anywhere → navigate to `/movies/:id`

**Rating badge** (top-right, overlaid on poster):
- `--surface-card` background + `--accent` text
- `border-radius: 6px`, `padding: 2px 8px`

### 8.2 SearchBar Component

```typescript
interface SearchBarProps {
  placeholder?: string;
  onSearch: (query: string) => void;    // Enter key handler
  showAutocomplete?: boolean;            // default true
  autoFocus?: boolean;
}
```

- Internal state: `query` string, `suggestions` array, `isOpen` dropdown boolean
- `useEffect` with 300ms debounce on `query` → calls `movieService.autocomplete(query)`
- Keyboard: `↑/↓` navigates suggestions, `Enter` selects or searches, `Escape` closes dropdown
- Accessibility: `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`

### 8.3 RatingMeter Component (Semicircular SVG)

```typescript
interface RatingMeterProps {
  distribution: {
    skip: number;
    timepass: number;
    go_for_it: number;
    perfection: number;
  };
  userRating?: 'skip' | 'timepass' | 'go_for_it' | 'perfection' | null;
  onRate?: (category: RatingCategory) => void; // null → buttons hidden (guest)
  size?: 'sm' | 'md' | 'lg';
}
```

**SVG Arc Spec:**
```
Path: M 20 100 A 80 80 0 0 1 180 100    (180° semicircle)
Arc length L ≈ 251.327px  (π × R, R=80)

Segment rendering (stroke-dasharray):
  skip:        dasharray = `${skip_len} ${L}`
  timepass:    dasharray = `${timepass_len} ${L}`, offset = skip_len
  go_for_it:   dasharray = `${goforit_len} ${L}`, offset = skip_len + timepass_len
  perfection:  dasharray = `${perf_len} ${L}`,    offset = skip_len + timepass_len + goforit_len
```

**Below meter:** 4 colored pill buttons (or greyed if not logged in):
```
[ Skip 🔴 ]  [ Timepass 🟡 ]  [ Go for it 🟢 ]  [ Perfection 🟣 ]
```

**Selected state:** filled background + `box-shadow: 0 0 12px <category-color>` glow + bold border.

**Optimistic update:** on button click → immediately update local distribution state before API confirms.

### 8.4 Button Component

```typescript
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';

interface ButtonProps {
  variant: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;       // shows spinner, disables click
  icon?: ReactNode;        // left icon slot
  fullWidth?: boolean;
  onClick?: () => void;
  children: ReactNode;
}
```

| Variant | Background | Text | Border |
|---|---|---|---|
| primary | `#B048FF` | white | none |
| secondary | `#1B1B1B` | white | `#252833` |
| ghost | transparent | `#B048FF` | `#B048FF` |
| danger | `#EF4444` | white | none |
| success | `#22C55E` | white | none |

Loading state: spinner SVG replaces left icon, `opacity: 0.7`, pointer-events disabled.

### 8.5 Input Component

```typescript
interface InputProps {
  label: string;
  type?: 'text' | 'email' | 'password' | 'search';
  error?: string;          // shows red text below, red border
  hint?: string;           // shows muted text below
  rightElement?: ReactNode; // for show/hide password toggle
  value: string;
  onChange: (val: string) => void;
}
```

States: default → focus (accent border + glow) → error (red border + error text) → disabled (opacity 0.5).

---

## 9. State Management

### 9.1 AuthContext

```typescript
interface AuthContextValue {
  user: User | null;
  token: string | null;
  isLoggedIn: boolean;
  isLoading: boolean;       // true during initial auth check on app mount
  login: (email: string, password: string) => Promise<void>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<string>;
}
```

**Initialization (on app mount):**
1. Read `token` from `localStorage`
2. If token exists → `GET /api/auth/me` to validate + get user object
3. If valid → set `user`, `isLoggedIn = true`
4. If invalid/expired → attempt silent refresh → if fail → clear storage, `isLoggedIn = false`
5. Set `isLoading = false`

**Persistence:**
- `access_token` → `localStorage['mov_access_token']`
- `refresh_token` → `localStorage['mov_refresh_token']`
- Never store password

### 9.2 API Service Layer

**File structure:**
```
src/services/
  api.js              → axios instance, interceptors
  authService.js      → register, login, logout, refreshToken, me
  movieService.js     → getMovies, getMovieById, getSimilar, autocomplete
  ratingService.js    → submitRating, getDistribution, getUserRating
  watchService.js     → markWatched, getHistory, addWatchlist, removeWatchlist
  recommendService.js → getRecommendations, getSampleRecommendations
  newsService.js      → getMovieNews
```

**Central axios instance (`api.js`):**
```javascript
const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL,
  timeout: 10000,
  headers: { 'Content-Type': 'application/json' }
});

// Request interceptor: inject JWT
api.interceptors.request.use(config => {
  const token = localStorage.getItem('mov_access_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Response interceptor: handle 401 → refresh
api.interceptors.response.use(
  res => res,
  async err => {
    if (err.response?.status === 401 && !err.config._retry) {
      err.config._retry = true;
      const newToken = await authService.refreshToken();
      err.config.headers.Authorization = `Bearer ${newToken}`;
      return api(err.config);   // retry original request
    }
    if (err.response?.status === 401) {
      // Refresh failed → force logout
      authContext.logout();
    }
    return Promise.reject(err);
  }
);
```

### 9.3 UI State vs Server State

| State Type | Where Stored | Examples |
|---|---|---|
| Auth state | `AuthContext` | `user`, `isLoggedIn`, `token` |
| Global nav state | `NavContext` | search query, dropdown open |
| Page-local state | `useState` | current movie, loading, error |
| Server data | API calls + `useState` | movies list, recommendations |
| User preferences | `AuthContext` / `localStorage` | genre prefs, serendipity setting |
| Demo mode flag | `sessionStorage` | `isDemo` boolean |

**No global server state caching at MVP** — data fetched per-page. Add React Query or SWR when caching + background refetch needed at scale.

---

## 10. API Interaction Pattern

### 10.1 Request Pattern (Per Service Function)

```javascript
// movieService.js
export const getMovieById = async (id) => {
  try {
    const { data } = await api.get(`/api/v1/movies/${id}`);
    return data;
  } catch (err) {
    throw parseApiError(err);  // normalize error shape
  }
};

// parseApiError normalizes to: { message: string, code: number }
const parseApiError = (err) => ({
  message: err.response?.data?.detail || 'Something went wrong',
  code: err.response?.status || 0
});
```

### 10.2 Error Handling in Components

```javascript
// In component useEffect:
useEffect(() => {
  const load = async () => {
    setLoading(true);
    try {
      const movie = await movieService.getMovieById(id);
      setMovie(movie);
    } catch (err) {
      if (err.code === 404) setNotFound(true);
      else toast.error(err.message);   // toast notification
    } finally {
      setLoading(false);
    }
  };
  load();
}, [id]);
```

### 10.3 JWT Refresh Flow

```
Request → 401 response
  → interceptor catches
  → POST /api/auth/refresh {refresh_token}
      → success: store new access_token, retry original request
      → failure (refresh also expired): force logout → /login
  → User sees no interruption (seamless)
```

---

## 11. User Flow Integration

### 11.1 Signup → Onboarding → Home

```
/register (Step 1: fill form)
  → POST /api/auth/register
  → /register/verify (Step 2: OTP input)
    → POST /api/auth/verify
    → JWT issued, stored in localStorage
    → Auth context updated
    → /onboarding (genre preference selection)
      → User selects 3+ genres from pill grid
      → POST /api/users/preferences {genres: [...]}
      → / (Home — now shows genre-seeded recommendations)
```

**Onboarding Page (`/onboarding`):**
```
Welcome, John! 🎬
Pick 3 or more genres you enjoy.
We'll use these to kickstart your recommendations.

[Action] [Comedy] [Drama] [Sci-Fi] [Horror]
[Romance] [Thriller] [Animation] [Documentary]
[Fantasy] [Mystery] [Crime]

Selected: Action ✓  Sci-Fi ✓  Drama ✓          3/3 min

[   Continue to Movientum →   ]
```

Selected genres: filled background + accent border. Minimum 3 required for Continue button to activate.

### 11.2 Browse → Watch → Rate → Recommendations Update

```
Home page
  → MovieCard click → /movies/:id
  → Read movie details (parallel data load)
  → Click "Mark as Watched"
      → POST /api/watch
      → Button → green ✓ "Watched"
      → Background: triggers recommendation refresh (TTL on Redis cache invalidated)
  → Click rating pill ("Go for it")
      → Optimistic: meter updates instantly
      → POST /api/ratings {movie_id, category: "go_for_it"}
          → Success: confirm UI state
          → Failure: revert optimistic update + toast error
      → Background: FedPCL local training signal recorded
  → Next Home visit: "For You" row includes updated picks
```

### 11.3 Search Flow

```
Navbar searchbar
  → Type "dark knight" (300ms debounce)
  → Autocomplete dropdown appears
  → User clicks "The Dark Knight (2008)"
      → Navigate to /movies/155 (direct to detail, skip results page)
  
  OR user presses Enter
      → Navigate to /search?q=dark+knight
      → GET /api/search?q=dark+knight
      → Results page renders with MovieGrid
      → User can apply filters (genre, year, rating)
      → Each filter → new API call with updated params
```

---

## 12. Responsive Design

### 12.1 Breakpoints

```css
/* Mobile */   @media (max-width: 767px)
/* Tablet */   @media (min-width: 768px) and (max-width: 1023px)
/* Desktop */  @media (min-width: 1024px)
/* Wide */     @media (min-width: 1280px)
```

### 12.2 Layout Changes Per Breakpoint

| Component | Desktop | Tablet | Mobile |
|---|---|---|---|
| Home rows | 5-6 cards visible | 3-4 cards | 2-3 cards, swipe |
| Movie Grid | 5 cols | 3-4 cols | 2 cols |
| Movie Detail | 2-col (poster+info) | 2-col | 1-col stacked |
| Dashboard | sidebar + content | sidebar + content | top tabs (horizontal scroll) |
| Filter sidebar | visible left panel | collapsible drawer | bottom sheet |
| Navbar SearchBar | 400px center | 280px | hidden (icon opens full-screen search) |
| Navbar | full | full | hamburger menu |

### 12.3 Mobile Navbar

```
┌────────────────────────────────┐
│ [M] Movientum        [🔍] [👤] │
└────────────────────────────────┘
```
- Tapping `🔍` expands full-screen search overlay with keyboard auto-open
- Tapping `👤` opens profile bottom sheet
- No hamburger menu — navigation via bottom nav bar (future)

### 12.4 Touch Interactions

- Horizontal movie rows: native touch scroll (`overflow-x: scroll`, `-webkit-overflow-scrolling: touch`)
- Cards: `touchstart` feedback (subtle scale `0.97` on press)
- Modals: swipe down to dismiss on mobile (touch gesture)

---

## 13. UI/UX Principles

### 13.1 Core Philosophy

- **Dark-first**: All UI designed in dark mode. No light mode at launch.
- **Fast-first**: Skeleton screens always. No blank white flashes. Loading is designed.
- **Neo-brutalist**: Sharp borders, flat cards, high contrast — not soft shadows everywhere.
- **Minimal chrome**: UI gets out of the way of content. Poster images are the hero.

### 13.2 Loading States

| Context | Loading Pattern |
|---|---|
| Page initial load | Full-page skeleton (card outlines, shimmer) |
| Row data loading | Row of `MovieCardSkeleton` (5-6 shimmer cards) |
| API action (button) | Button spinner + disabled state |
| Search autocomplete | Subtle inline spinner in search bar |
| Image loading | Blurred low-res placeholder → full res swap |

### 13.3 Toast Notifications

- Position: top-right, `position: fixed`
- Auto-dismiss: 4 seconds
- Variants: success (green left border), error (red), info (accent)
- Max 3 stacked toasts visible simultaneously
- Examples:
  - `✓ Added to Watchlist`
  - `✓ Rating saved — "Go for it!"`
  - `✗ Failed to load recommendations. Try again.`

### 13.4 Empty States

Every empty state has:
1. Icon or illustration
2. Short explanatory headline
3. Action button or link

Examples:
- No watch history: `🎬 Nothing here yet.` + `[Browse Movies]`
- No search results: `🔍 No matches found.` + search tips
- Watchlist empty: `📌 Your watchlist is empty.` + `[Discover Movies]`

---

## 14. Future Enhancements

| Enhancement | Description |
|---|---|
| **Page transitions** | Shared element transitions between MovieCard → Movie Detail (poster morphing) |
| **PWA support** | Service worker, `manifest.json`, install prompt → works offline for cached content |
| **Offline caching** | Cache trending movies + recently viewed in IndexedDB via service worker |
| **Advanced personalization UI** | User-facing serendipity slider, genre block list, "too much of this" feedback |
| **Notification system** | In-app notification bell — new recommendations, FedPCL training round complete |
| **Social features** | Share watchlist, see friends' ratings (privacy-controlled) |
| **Keyboard navigation** | Full site navigable by keyboard, WCAG 2.1 AA compliance |
| **Reduced motion** | Respect `prefers-reduced-motion` media query — disable animations |
| **Light mode** | Optional light theme toggle (stored in `localStorage`) |
| **Mobile app** | React Native port sharing business logic and service layer |
| **Video trailers** | Embed YouTube trailer in Movie Detail via `react-youtube` |
| **Review system** | Text reviews with spoiler tags, community voting |
