# Movientum — Login & Authentication System Design

**Scope**: Full specification of signup, login, OTP verification, JWT lifecycle, session management, and security for the Movientum platform.  
**Stack**: FastAPI · PostgreSQL · Redis · bcrypt · JWT (HS256) · SMTP/SendGrid

---

## 1. Overview

Movientum uses a stateless JWT-based authentication system with email verification at signup. The system is designed around three principles:

1. **Security by default** — bcrypt password hashing, generic error messages, rate limiting, JWT expiry
2. **Email verification** — users cannot access the platform until their email is verified via OTP
3. **Seamless session management** — short-lived access tokens + long-lived refresh tokens with silent rotation

**Authentication surfaces:**
- Signup (register → OTP verify → onboard)
- Login (email + password → JWT issued)
- Protected API requests (JWT validated per request via middleware)
- Token refresh (access token expired → silent refresh via refresh token)
- Logout (token blacklisted in Redis)
- Password reset (email-based reset link, future)

---

## 2. Signup System (Email + OTP Verification)

### 2.1 Overview Flow

```
User fills signup form
  → Frontend validation (instant)
  → POST /api/auth/register
  → Backend: validate, hash password, create unverified user, generate OTP
  → OTP sent to email via SMTP
  → User enters 6-digit OTP on verify screen
  → POST /api/auth/verify
  → Backend: validate OTP, mark user verified, issue JWT
  → User redirected to onboarding
```

### 2.2 Frontend Validation (Client-Side, Step 1)

Run before API call. Prevents unnecessary requests.

| Field | Rule | Error Message |
|---|---|---|
| Name | Required, 2–50 chars | "Name is required" |
| Email | Valid email format (RFC 5322) | "Enter a valid email address" |
| Password | ≥ 8 chars, 1 uppercase, 1 digit, 1 special char | "Password must be 8+ characters with uppercase, number, and symbol" |
| Confirm Password | Must match Password field | "Passwords do not match" |

Validation fires on `onBlur` per field (not on every keystroke). Full-form validate on submit click.

### 2.3 Backend: POST /api/auth/register

```
Request body:
{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "Secure@123"
}
```

**Backend steps (authoritative validation):**

1. **Validate email format** (regex) → `400 Bad Request` if invalid
2. **Validate password strength** (min 8 chars, complexity rules) → `400` if weak
3. **Check email exists** in `users` table:
   - EXISTS → return `409 Conflict` with body `{"detail": "Email already registered"}`
   - NOT EXISTS → proceed
4. **Hash password**: `bcrypt(password, rounds=12)` → `password_hash`
5. **Create user record** in DB with `is_verified = False`:
   ```sql
   INSERT INTO users (id, name, email, password_hash, is_verified, role, created_at)
   VALUES (gen_random_uuid(), $name, $email, $hash, FALSE, 'user', NOW())
   ```
6. **Generate 6-digit OTP**: `random.randint(100000, 999999)` → convert to string
7. **Hash OTP** before storage: `bcrypt(otp_string, rounds=6)` (low rounds — fast check)
8. **Store in Redis**:
   ```
   Key:   otp:{email}
   Value: {hashed_otp, attempt_count: 0}
   TTL:   600 seconds (10 minutes)
   ```
9. **Send email via SMTP/SendGrid**:
   - Subject: `"Your Movientum verification code: 123456"`
   - Body: plain + HTML version with code prominently displayed
10. **Return** `202 Accepted`:
    ```json
    {
      "message": "Verification code sent to john@example.com",
      "expires_in": 600,
      "resend_available_after": 60
    }
    ```

**Rate limiting on `/register`:**
- Max 10 registration attempts per IP per hour
- Exceeded → `429 Too Many Requests` with `Retry-After` header

### 2.4 OTP Design

**Format:** 6 numeric digits (`100000`–`999999`)  
**TTL:** 10 minutes from generation  
**Max attempts:** 5 incorrect attempts → OTP invalidated  
**Storage:** Redis (not DB) — ephemeral, auto-expiry, fast lookup

**Redis key structure:**
```
otp:{email}  →  {
  "hashed_otp": "$2b$06$...",
  "attempts": 0,
  "created_at": 1716889200
}
```

**Resend logic:**
- Resend button disabled for 60 seconds after last send
- On resend: generate new OTP, overwrite Redis key (old OTP immediately invalid)
- Max 3 resend attempts per registration session (tracked in Redis counter `otp_resend:{email}`)
- Exceeded → block further resends, show: `"Too many resend attempts. Please try again in 30 minutes."`

### 2.5 Backend: POST /api/auth/verify

```
Request body:
{
  "email": "john@example.com",
  "otp": "847291"
}
```

**Backend steps:**

1. **Fetch Redis key** `otp:{email}`:
   - Key missing (expired or never sent) → `410 Gone`: `{"detail": "Code expired. Request a new one."}`
2. **Check attempt count**: if `attempts >= 5` → `429`: `{"detail": "Too many attempts. Request a new code."}`
3. **Verify OTP**: `bcrypt.verify(submitted_otp, stored_hashed_otp)`
   - No match → increment `attempts` in Redis → `401`: `{"detail": "Invalid code. X attempts remaining."}`
   - Match → proceed
4. **Mark user verified** in DB:
   ```sql
   UPDATE users SET is_verified = TRUE, verified_at = NOW()
   WHERE email = $email
   ```
5. **Delete OTP from Redis** (one-time use)
6. **Generate tokens** (see Section 5)
7. **Return** `200 OK`:
   ```json
   {
     "access_token": "eyJ...",
     "refresh_token": "eyJ...",
     "token_type": "bearer",
     "user": {
       "id": "uuid",
       "name": "John Doe",
       "email": "john@example.com",
       "role": "user"
     }
   }
   ```

---

## 3. Login System

### 3.1 Login Flow

**Frontend → Backend:**

```
User submits: {email, password}
  → POST /api/auth/login
  → Backend:
      1. Fetch user by email
      2. If not found → 401 "Invalid credentials" (no hint about email)
      3. If found but not verified → 403 "Please verify your email first"
      4. If found but is_active = False → 403 "Account disabled"
      5. bcrypt.verify(password, user.password_hash)
          → No match → 401 "Invalid credentials" (same message as step 2)
      6. Check failed_login_attempts:
          → If >= 5 in last 15 min → 429 "Account temporarily locked"
      7. Generate access_token + refresh_token
      8. Reset failed_login_attempts counter
      9. Return 200 {access_token, refresh_token, user}
  → Frontend: store tokens, update AuthContext, redirect
```

**Why same error for "email not found" and "wrong password":**  
Different messages let attackers enumerate valid emails. Uniform `"Invalid credentials"` response prevents this — attacker cannot determine if the email exists.

### 3.2 Account Lockout Logic

Track failed attempts in Redis (not DB — fast, auto-expiry):

```
Key: login_fail:{email}
Value: attempt count
TTL: 900 seconds (15 minutes, resets on each failed attempt)
```

**Thresholds:**

| Attempts | Action |
|---|---|
| 1–4 | Normal 401 response |
| 5 | Lock for 15 minutes. Return `429` with `Retry-After: 900` |
| After lock expires | Reset counter, allow attempts again |

On successful login → delete `login_fail:{email}` key immediately.

**Admin override:** Admin can manually unlock account via `POST /api/admin/users/{id}/unlock`.

### 3.3 Login Request/Response

```
POST /api/auth/login
Content-Type: application/json

Body:
{
  "email": "john@example.com",
  "password": "Secure@123"
}

Response 200:
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refresh_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "bearer",
  "expires_in": 3600,
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "name": "John Doe",
    "email": "john@example.com",
    "role": "user"
  }
}

Response 401:
{ "detail": "Invalid credentials" }

Response 429:
{
  "detail": "Account temporarily locked due to multiple failed attempts.",
  "retry_after": 900
}
```

---

## 4. Password Security

### 4.1 Hashing with bcrypt

**Why bcrypt:**
- Adaptive cost factor — can increase difficulty as hardware improves
- Built-in salt — each hash is unique even for identical passwords
- Deliberately slow — brute force computationally expensive

**Implementation:**
```python
import bcrypt

# Hash on registration:
password_hash = bcrypt.hashpw(
    password.encode('utf-8'),
    bcrypt.gensalt(rounds=12)
)
# rounds=12 → ~250ms per hash on modern hardware. Acceptable for login, devastating for brute force.

# Verify on login:
is_valid = bcrypt.checkpw(
    submitted_password.encode('utf-8'),
    stored_hash
)
```

**Storage rule:** `password_hash` stored in `users.password_hash` column. Plaintext password **never** stored, never logged, never returned in any API response.

### 4.2 Password Strength Requirements

| Rule | Requirement |
|---|---|
| Minimum length | 8 characters |
| Uppercase | At least 1 letter (A–Z) |
| Number | At least 1 digit (0–9) |
| Special character | At least 1 (`!@#$%^&*()_+-=[]{}`) |
| Maximum length | 72 characters (bcrypt limit) |
| Disallow | Common passwords (`password123`, `qwerty123`, etc.) — check against top-10k list |

Checked identically on frontend (real-time feedback) and backend (authoritative). Frontend check is UX. Backend check is enforcement.

### 4.3 Password Reset Flow

**Trigger:** User clicks "Forgot Password" on login page.

```
Step 1: User enters email
  → POST /api/auth/forgot-password {email}
  → Backend:
      → If email exists: generate secure reset token (32-byte hex, URL-safe)
      → Store: password_reset_tokens table {token_hash, user_id, expires_at: NOW()+24h, used: false}
      → Send email: "Click to reset: https://movientum.com/reset-password?token=abc123"
      → Response: 200 "If this email is registered, you'll receive a reset link"
      (Same response whether email exists or not — prevents enumeration)

Step 2: User clicks link → /reset-password?token=abc123
  → Frontend: validate token before showing form
      → GET /api/auth/reset-password/validate?token=abc123
      → 200: show new password form
      → 400/410: "Link invalid or expired"

Step 3: User submits new password
  → POST /api/auth/reset-password {token, new_password}
  → Backend:
      → Find token in DB (by hashed value)
      → Check: not used, not expired
      → Update user.password_hash with new bcrypt hash
      → Mark token as used (or delete row)
      → Invalidate all existing sessions (add user_id to mass-blacklist in Redis)
      → Return 200 "Password updated"
  → Frontend: redirect to /login
```

---

## 5. JWT Authentication System

### 5.1 JWT Structure

JWT = `base64url(header)`.`base64url(payload)`.`HMACSHA256_signature`

**Header:**
```json
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload (Access Token):**
```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "email": "john@example.com",
  "name": "John Doe",
  "role": "user",
  "iat": 1716889200,
  "exp": 1716892800,
  "jti": "c4f8a3e1-7b2d-4f9c-a8e5-123456789abc"
}
```

| Claim | Value | Purpose |
|---|---|---|
| `sub` | User UUID | Subject — identifies user |
| `email` | String | Convenience (avoid DB lookup for email) |
| `name` | String | Display name |
| `role` | `"user"` or `"admin"` | RBAC enforcement |
| `iat` | Unix timestamp | Issued at |
| `exp` | `iat + 3600` | Expiry (1 hour for access token) |
| `jti` | UUID | JWT ID — used for blacklisting on logout |

**No sensitive data in payload.** JWT payload is base64-encoded (not encrypted). Anyone with token can decode payload. Never include: password, credit card, SSN, full address.

**Payload (Refresh Token):**
```json
{
  "sub": "550e8400-e29b-41d4-a716-446655440000",
  "type": "refresh",
  "iat": 1716889200,
  "exp": 1719481200,
  "jti": "f1a2b3c4-5d6e-7f8a-9b0c-def012345678"
}
```
Refresh token payload is minimal — only user ID and expiry.

**Signing:**
```python
import jwt

SECRET_KEY = os.environ['JWT_SECRET_KEY']   # 64-byte random hex, from environment
ALGORITHM = "HS256"

def create_access_token(user_id: str, email: str, role: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": datetime.utcnow(),
        "exp": datetime.utcnow() + timedelta(hours=1),
        "jti": str(uuid4())
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)
```

**Token Expiry:**

| Token | TTL | Notes |
|---|---|---|
| Access Token | 1 hour | Short — limits damage if stolen |
| Refresh Token | 30 days | Long — reduces re-login friction |
| Refresh Token ("Remember Me") | 90 days | Optional extended session |
| Password Reset Token | 24 hours | One-time use, stored in DB |
| OTP | 10 minutes | Stored in Redis with TTL |

### 5.2 Token Validation Middleware

Every protected route in FastAPI passes through `get_current_user` dependency:

```python
async def get_current_user(
    authorization: str = Header(None),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis)
) -> User:
    
    # 1. Extract token
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing authentication token")
    token = authorization[7:]
    
    # 2. Decode + verify signature
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    
    # 3. Check blacklist (Redis)
    jti = payload.get("jti")
    if await redis.get(f"blacklist:{jti}"):
        raise HTTPException(401, "Token revoked")
    
    # 4. Load user from DB (validates account still active)
    user = await db.get(User, payload["sub"])
    if not user or not user.is_active:
        raise HTTPException(401, "User not found or disabled")
    
    return user
```

### 5.3 Token Refresh Flow

```
Client → POST /api/auth/refresh
Body: { "refresh_token": "eyJ..." }

Backend:
  1. Decode refresh token (same validation as access token)
  2. Check payload.type == "refresh"
  3. Check not in blacklist
  4. Load user from DB
  5. Blacklist old refresh token jti in Redis (TTL = remaining lifetime)
  6. Generate new access_token
  7. Generate new refresh_token (rotation)
  8. Return { access_token, refresh_token, expires_in: 3600 }

Client:
  → Store new tokens
  → Retry original failed request with new access_token
```

**Refresh token rotation:** On each refresh, old refresh token is invalidated and new one issued. If refresh token is stolen and used, legitimate user's next refresh attempt fails → forced re-login. Security signal.

### 5.4 Logout Flow

```
POST /api/auth/logout
Authorization: Bearer <access_token>
Body: { "refresh_token": "eyJ..." }

Backend:
  1. Decode access token → extract jti, exp
  2. Calculate remaining_ttl = exp - now()
  3. Add to Redis blacklist:
     SET blacklist:{access_jti} "1" EX {remaining_ttl}
  4. Decode refresh token → extract jti, exp
  5. Add refresh token jti to blacklist with its remaining TTL
  6. Return 200 { "message": "Logged out successfully" }

Frontend:
  → Delete localStorage['mov_access_token']
  → Delete localStorage['mov_refresh_token']
  → Reset AuthContext: user=null, isLoggedIn=false
  → Navigate to /login
```

---

## 6. Database Schema

### 6.1 `users` Table

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            VARCHAR(100) NOT NULL,
  email           VARCHAR(255) UNIQUE NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,          -- bcrypt hash
  role            VARCHAR(20) NOT NULL DEFAULT 'user'
                    CHECK (role IN ('user', 'admin')),
  is_verified     BOOLEAN NOT NULL DEFAULT FALSE, -- email verified?
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,  -- account enabled?
  verified_at     TIMESTAMPTZ,                    -- when email was verified
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role  ON users(role);
```

### 6.2 `password_reset_tokens` Table

```sql
CREATE TABLE password_reset_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL UNIQUE,  -- bcrypt hash of reset token
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_prt_user_id   ON password_reset_tokens(user_id);
CREATE INDEX idx_prt_token     ON password_reset_tokens(token_hash);
```

### 6.3 `failed_login_attempts` (Redis — not relational DB)

Not stored in PostgreSQL. Stored in Redis for speed and auto-expiry:

```
Key:   login_fail:{email}
Value: integer (attempt count)
TTL:   900 seconds (15 min, rolling)

Key:   otp:{email}
Value: JSON {hashed_otp, attempts}
TTL:   600 seconds (10 min)

Key:   otp_resend:{email}
Value: integer (resend count)
TTL:   1800 seconds (30 min)

Key:   blacklist:{jti}
Value: "1"
TTL:   remaining token lifetime

Key:   rate_limit:register:{ip}
Value: integer (attempt count)
TTL:   3600 seconds (1 hour)

Key:   rate_limit:login:{ip}
Value: integer (attempt count)
TTL:   900 seconds (15 min)
```

---

## 7. Redis Usage

### 7.1 OTP Storage

- **Why Redis, not DB:** OTPs are ephemeral. Redis TTL handles auto-expiry without cron jobs. Fast read/write for high-volume signup events. Redis atomic increment for attempt counting prevents race conditions.
- **Structure:** OTP is hashed before storage (bcrypt, rounds=6 for speed). Raw OTP only exists in memory during generation and in the email.

### 7.2 Rate Limiting

```python
async def check_rate_limit(redis: Redis, key: str, max_attempts: int, window_sec: int):
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, window_sec)   # Set TTL on first request
    if count > max_attempts:
        ttl = await redis.ttl(key)
        raise HTTPException(429, detail=f"Rate limit exceeded", headers={"Retry-After": str(ttl)})
```

Rate limit keys:
- `rate_limit:register:{ip_address}` — 10/hour per IP
- `rate_limit:login:{ip_address}` — 20/15min per IP
- `rate_limit:otp_send:{email}` — 3 sends per 30min
- `rate_limit:otp_verify:{email}` — 5 attempts per OTP TTL

### 7.3 Token Blacklisting

Redis `SET key "1" EX {ttl}` — minimal storage. Only jti (a UUID string) stored, not full token. Keys auto-expire when token would have expired anyway → no cleanup needed.

### 7.4 Session / Temporary Data

- Login failed attempt counters: `login_fail:{email}`
- Active refresh token registry (optional for forced logout): `refresh_active:{user_id}` set of active jtis

---

## 8. Security Measures

### 8.1 Rate Limiting Summary

| Endpoint | Limit | Window |
|---|---|---|
| POST /auth/register | 10 per IP | 1 hour |
| POST /auth/login | 5 per email, 20 per IP | 15 min |
| POST /auth/verify (OTP) | 5 per email | 10 min (OTP TTL) |
| POST /auth/refresh | 30 per user | 1 hour |
| POST /auth/forgot-password | 3 per email | 30 min |

### 8.2 Brute Force Protection

- **Login lockout**: 5 failed attempts → 15-min IP+email lockout
- **OTP invalidation**: 5 wrong OTP attempts → OTP deleted, must request new
- **Token expiry**: Short access tokens (1hr) limit window of stolen token abuse
- **Refresh rotation**: Stolen refresh token used by attacker → legitimate user's refresh fails → forced re-login

### 8.3 HTTPS Enforcement

- All production traffic over TLS 1.2+
- HTTP → HTTPS redirect at Nginx level (301 permanent)
- HSTS header: `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- TLS certificate via Let's Encrypt (auto-renewing)

### 8.4 CORS Configuration

```python
app.add_middleware(
    CORSMiddleware,
    allow_origins=["https://movientum.com"],   # Production only
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
# Development: allow http://localhost:3000
```

### 8.5 CSRF Protection

- **localStorage tokens** (current): No CSRF risk — browser does not auto-send localStorage data
- **httpOnly cookie tokens** (future): Require `SameSite=Strict` attribute + CSRF token header (`X-CSRF-Token`)
- All state-changing requests require Authorization header — browser CORS policy prevents cross-origin header injection

### 8.6 XSS Protection

- All user input sanitized server-side before storage
- React auto-escapes output in JSX (no `dangerouslySetInnerHTML` without sanitization)
- `Content-Security-Policy` header restricts script sources
- JWT in localStorage mitigated by strict CSP preventing injected script execution

### 8.7 Email Enumeration Prevention

All auth-related responses avoid revealing email existence:
- Forgot password: always returns "If this email is registered, you'll receive a link" (identical response for registered and unregistered emails)
- Login: always returns "Invalid credentials" (never "Email not found" or "Wrong password")
- Register: **exception** — "Email already registered" IS revealed here (by design — helpful UX, low risk compared to login enumeration)

### 8.8 Input Sanitization

```python
# Pydantic model for login:
class LoginRequest(BaseModel):
    email: EmailStr              # Pydantic validates + normalizes email format
    password: str = Field(..., min_length=1, max_length=72)

# All inputs validated via Pydantic before any business logic
# SQLAlchemy ORM uses parameterized queries → SQL injection impossible
```

---

## 9. Full Request Flows

### 9.1 Signup with Email Verification

```
1.  User: Fill name/email/password form
2.  Frontend: Validate all fields (instant)
3.  Frontend: POST /api/auth/register {name, email, password}
4.  Backend: Validate inputs (400 if invalid)
5.  Backend: Check email exists → 409 if yes
6.  Backend: Hash password (bcrypt, rounds=12) → ~250ms
7.  Backend: INSERT into users (is_verified=FALSE)
8.  Backend: Generate OTP (6 digits)
9.  Backend: Hash OTP (bcrypt, rounds=6) → store in Redis with 600s TTL
10. Backend: Send OTP email via SMTP/SendGrid
11. Backend: Return 202 {expires_in: 600, resend_after: 60}
12. Frontend: Show OTP input screen
13. User: Enter 6-digit code from email
14. Frontend: POST /api/auth/verify {email, otp}
15. Backend: Fetch Redis key → check attempts → verify OTP hash
16. Backend: UPDATE users SET is_verified=TRUE
17. Backend: DELETE OTP from Redis
18. Backend: Generate access_token + refresh_token
19. Backend: Return 200 {tokens, user}
20. Frontend: Store tokens → Update AuthContext → Redirect to /onboarding
```

### 9.2 Login

```
1.  User: Fill email/password
2.  Frontend: Basic validation (non-empty, email format)
3.  Frontend: POST /api/auth/login {email, password}
4.  Backend: Rate limit check (IP + email)
5.  Backend: SELECT user WHERE email = $email
6.  Backend: If not found → increment login_fail:{email} → return 401 "Invalid credentials"
7.  Backend: If found, not verified → return 403 "Please verify your email"
8.  Backend: If is_active=FALSE → return 403 "Account disabled"
9.  Backend: bcrypt.verify(password, user.password_hash)
10. Backend: If no match → increment login_fail → return 401 "Invalid credentials"
11. Backend: If login_fail >= 5 → return 429 (account locked)
12. Backend: Generate access_token + refresh_token
13. Backend: Reset login_fail:{email} counter
14. Backend: UPDATE users SET last_login_at = NOW()
15. Backend: Return 200 {access_token, refresh_token, user}
16. Frontend: Store tokens in localStorage
17. Frontend: Update AuthContext → isLoggedIn=true, user={...}
18. Frontend: Navigate to ?redirect param OR /home
```

### 9.3 Token Validation (Protected Request)

```
1.  Frontend: API call with Authorization: Bearer <access_token>
2.  FastAPI Middleware: extract token from header
3.  Middleware: jwt.decode(token, SECRET_KEY)
4.  Middleware: Check exp → if expired → raise 401 "Token expired"
5.  Middleware: Check Redis blacklist:{jti} → if present → raise 401 "Token revoked"
6.  Middleware: Load user from DB → check is_active
7.  Middleware: Attach user to request.state.user
8.  Route handler: executes with verified user context
9.  Route handler: returns data filtered/authorized for this user
```

### 9.4 Token Refresh (Transparent)

```
1.  Frontend API interceptor: catches 401 response
2.  Check: is this a refresh endpoint? No → proceed
3.  Mark original request as _retry=true
4.  POST /api/auth/refresh {refresh_token}
5.  Backend: validate refresh token (not expired, not blacklisted)
6.  Backend: blacklist old refresh token jti
7.  Backend: generate new access_token + new refresh_token
8.  Backend: return 200 {access_token, refresh_token}
9.  Frontend: store new tokens
10. Frontend: retry original request with new access_token
11. User sees no interruption — seamless experience
```

### 9.5 Password Reset

```
1.  User: Click "Forgot Password" on /login
2.  User: Enter email address
3.  Frontend: POST /api/auth/forgot-password {email}
4.  Backend: (silently check email exists — same response either way)
5.  Backend: Generate 32-byte secure random token
6.  Backend: Hash token → store in password_reset_tokens table (24h expiry)
7.  Backend: Send email with reset link
8.  Backend: Return 200 "If registered, check your email"
9.  User: Click link → /reset-password?token=abc...
10. Frontend: GET /api/auth/reset-password/validate?token=abc...
11. Backend: Hash token → look up in DB → check not expired, not used
12. Backend: Return 200 (valid) or 400 (invalid/expired)
13. User: Enter new password
14. Frontend: POST /api/auth/reset-password {token, new_password}
15. Backend: Validate token again → hash new password → update user
16. Backend: Mark token as used → invalidate all user sessions (blacklist all jtis)
17. Backend: Return 200 "Password updated"
18. Frontend: Redirect to /login with success message
```

---

## 10. Error Handling

### 10.1 Structured Error Response Format

All API errors return consistent shape:

```json
{
  "detail": "Human-readable error message",
  "code": "MACHINE_READABLE_CODE",
  "field": "field_name_if_applicable"
}
```

### 10.2 Error Catalog

| Scenario | HTTP Status | `detail` | `code` |
|---|---|---|---|
| Missing auth header | 401 | "Authentication required" | `AUTH_REQUIRED` |
| Invalid JWT signature | 401 | "Invalid token" | `INVALID_TOKEN` |
| Expired access token | 401 | "Token expired" | `TOKEN_EXPIRED` |
| Revoked token (blacklisted) | 401 | "Token revoked" | `TOKEN_REVOKED` |
| Wrong email or password | 401 | "Invalid credentials" | `INVALID_CREDENTIALS` |
| Account not verified | 403 | "Please verify your email first" | `EMAIL_NOT_VERIFIED` |
| Account disabled | 403 | "Account is disabled" | `ACCOUNT_DISABLED` |
| Insufficient permissions | 403 | "You don't have permission" | `FORBIDDEN` |
| Email already registered | 409 | "Email already registered" | `EMAIL_EXISTS` |
| Invalid OTP | 401 | "Invalid code. X attempts remaining" | `OTP_INVALID` |
| Expired OTP | 410 | "Code expired. Request a new one" | `OTP_EXPIRED` |
| Too many OTP attempts | 429 | "Too many attempts. Request a new code" | `OTP_MAX_ATTEMPTS` |
| Account locked | 429 | "Account temporarily locked" | `ACCOUNT_LOCKED` |
| Rate limit exceeded | 429 | "Too many requests" | `RATE_LIMITED` |
| Weak password | 400 | "Password must be 8+ chars with uppercase, number, and symbol" | `WEAK_PASSWORD` |
| Invalid email format | 400 | "Invalid email address" | `INVALID_EMAIL` |
| Refresh token expired | 401 | "Session expired. Please log in again" | `REFRESH_EXPIRED` |
| Reset token invalid | 400 | "Reset link is invalid or expired" | `RESET_TOKEN_INVALID` |

### 10.3 Frontend Error Handling

```javascript
// authService.js
const login = async (email, password) => {
  try {
    const { data } = await api.post('/api/auth/login', { email, password });
    return data;
  } catch (err) {
    const { detail, code } = err.response?.data || {};
    
    switch (code) {
      case 'INVALID_CREDENTIALS':
        throw new AuthError('Invalid email or password.', 'credentials');
      case 'ACCOUNT_LOCKED':
        throw new AuthError('Account locked. Try again in 15 minutes.', 'lock');
      case 'EMAIL_NOT_VERIFIED':
        throw new AuthError('Check your email to verify your account.', 'verify');
      default:
        throw new AuthError(detail || 'Login failed. Try again.', 'generic');
    }
  }
};
```

---

## 11. Future Improvements

### 11.1 OAuth (Google Login)

```
Planned flow:
User clicks "Continue with Google"
  → Frontend: Google OAuth consent screen
  → Google: returns auth code
  → Frontend: POST /api/auth/oauth/google {code}
  → Backend: exchange code for Google user profile
  → Backend: find or create user (no password stored for OAuth users)
  → Backend: generate JWT → return tokens
```

No password stored for OAuth-only accounts. `password_hash` column nullable. `oauth_provider` + `oauth_id` columns added to users table.

### 11.2 Two-Factor Authentication (2FA)

- **Phase 1**: TOTP (Google Authenticator / Authy)
  - User enrolls: generate TOTP secret, show QR code
  - On login: after password → prompt TOTP code
  - Verify: `pyotp.TOTP(secret).verify(submitted_code)`
- **Phase 2**: SMS/Email OTP as 2FA (vs. email verification OTP)
- **Phase 3**: Passkeys / WebAuthn

### 11.3 Device / Session Tracking

```sql
CREATE TABLE user_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  refresh_jti   VARCHAR(36) NOT NULL UNIQUE,   -- tracks which refresh token
  device_info   JSONB,                          -- browser, OS, device type
  ip_address    INET,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  last_used_at  TIMESTAMPTZ DEFAULT NOW(),
  is_active     BOOLEAN DEFAULT TRUE
);
```

Users can view active sessions in Dashboard → Preferences → "Active Sessions" and revoke individual sessions remotely.

### 11.4 Additional Planned Improvements

| Improvement | Description |
|---|---|
| **Anomaly detection** | Flag login from new country/IP → send security email |
| **Account recovery codes** | 10 one-time codes generated at 2FA setup for emergency |
| **Audit log** | Track all auth events: login, logout, password change, token refresh |
| **Admin dashboard** | View login attempts, locked accounts, suspicious activity |
| **JWT RS256** | Switch from shared secret HS256 to RSA keypair RS256 for multi-service token validation |
| **httpOnly cookies** | Migrate from localStorage to httpOnly cookies + SameSite=Strict for stronger XSS protection |
