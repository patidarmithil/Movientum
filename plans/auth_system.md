# Authentication System — Movientum

## Overview

Movientum auth uses **JWT (JSON Web Tokens)** for stateless authentication. Users register with email + password, login to receive token, include token in every subsequent request. Backend validates token without hitting DB on each request.

---

## User Registration Flow

```
User fills register form (name, email, password, confirm password)
  │
  ├── Frontend validation (instant, client-side):
  │     ├── Email format valid?
  │     ├── Password length ≥ 8 characters?
  │     ├── Password == confirm password?
  │     └── Required fields not empty?
  │
  ├── POST /api/auth/register with {name, email, password}
  │
  ├── Backend validation:
  │     ├── Email format (regex)
  │     ├── Password strength (min 8 chars, 1 number, 1 special char)
  │     └── Check email not already in users table
  │           └── IF exists → return 409 Conflict: "Email already registered"
  │
  ├── Hash password:
  │     → bcrypt(password, salt_rounds=12)
  │     → Store hash ONLY — plaintext never stored
  │
  ├── Create user record in DB:
  │     {id: UUID, email, username, password_hash, created_at, role: 'user'}
  │
  ├── Generate JWT token (see Token Generation below)
  │
  └── Return 201 Created:
        {token, user: {id, email, username, role}}
        Frontend stores token, redirects to Home
```

---

## Login Flow

```
User fills login form (email, password)
  │
  ├── POST /api/auth/login with {email, password}
  │
  ├── Backend:
  │     ├── Fetch user by email from DB
  │     │     └── No user found → return 401 (generic message: "Invalid credentials")
  │     │
  │     ├── Verify password:
  │     │     → bcrypt.verify(submitted_password, stored_hash)
  │     │     → Match? Continue. No match? → return 401 "Invalid credentials"
  │     │     ⚠️ Same error message for both "user not found" and "wrong password"
  │     │         (prevents user enumeration attacks)
  │     │
  │     ├── Check account active:
  │     │     → is_active == False → return 403 "Account disabled"
  │     │
  │     ├── Generate JWT token
  │     │
  │     └── Return 200 OK:
  │           {token, refresh_token, user: {id, email, username, role}}
  │
  └── Frontend:
        → Store token in localStorage (or httpOnly cookie)
        → Store refresh_token separately
        → Redirect to Home (or redirect param if set)
```

---

## JWT Token Architecture

### Token Structure

JWT has 3 parts: Header . Payload . Signature

**Header:**
```
{
  "alg": "HS256",
  "typ": "JWT"
}
```

**Payload (Claims):**
```
{
  "sub": "user-uuid-here",       → Subject (user ID)
  "email": "user@email.com",
  "role": "user",
  "iat": 1700000000,             → Issued at (Unix timestamp)
  "exp": 1700003600,             → Expires at (iat + 1 hour)
  "jti": "unique-token-id"       → JWT ID (for blacklisting)
}
```

**Signature:**
`HMACSHA256(base64(header) + "." + base64(payload), JWT_SECRET_KEY)`

Only backend knows `JWT_SECRET_KEY`. Signature proves token wasn't tampered.

### Token Lifecycle

| Token Type | TTL | Purpose |
|------------|-----|---------|
| Access Token | 1 hour | Authenticate API requests |
| Refresh Token | 30 days | Get new access token without re-login |

When access token expires → client uses refresh token → gets new access token → continues seamlessly.

---

## Token Validation Flow (Every Protected Request)

```
Request arrives with Authorization: Bearer <token>
  │
  ├── Auth Middleware extracts token
  │
  ├── Validate token:
  │     ├── Signature valid? (HMACSHA256 verify with secret)
  │     │     └── Invalid → 401 "Invalid token"
  │     │
  │     ├── Token expired? (check exp claim)
  │     │     └── Expired → 401 "Token expired" (client should refresh)
  │     │
  │     ├── Token in blacklist? (Redis check)
  │     │     └── In blacklist → 401 "Token revoked"
  │     │
  │     └── All valid → extract user from payload
  │
  ├── Attach user to request state: request.state.user = {id, email, role}
  │
  └── Pass to router handler (no more auth needed)
```

Token blacklist in Redis: on logout, add `jti` to Redis set with TTL = token's remaining lifetime. Lightweight check. No DB query.

---

## Token Refresh Flow

```
Client detects access token expired (401 response or proactive check)
  │
  ├── POST /api/auth/refresh with {refresh_token}
  │
  ├── Backend:
  │     ├── Validate refresh token (same as access token validation)
  │     ├── Check refresh token not in blacklist
  │     ├── Generate new access token (same user, new exp)
  │     └── Return {access_token, expires_in}
  │
  └── Client stores new access token, retries original request
```

Refresh tokens are rotated on use (old refresh token invalidated, new one issued) to prevent theft reuse.

---

## Logout Flow

```
User clicks Logout
  │
  ├── POST /api/auth/logout (with current access token)
  │
  ├── Backend:
  │     ├── Extract jti from token
  │     ├── Add jti to Redis blacklist (TTL = remaining token lifetime)
  │     └── Add refresh token to blacklist too
  │
  └── Frontend:
        → Clear token from localStorage
        → Clear auth state (Context/Redux)
        → Redirect to Login page
```

---

## Password Security

### Storage
- Never store plaintext passwords
- Use **bcrypt** with cost factor 12 (computationally expensive → slows brute force)
- Each password has unique salt (bcrypt includes salt in hash)

### Strength Requirements
- Minimum 8 characters
- At least 1 uppercase letter
- At least 1 number
- At least 1 special character (!@#$%^&*)
- Checked on frontend (instant) AND backend (authoritative)

### Password Reset Flow (Future)
1. User clicks "Forgot Password"
2. Enter email → backend generates time-limited reset token (24h)
3. Email sent with link: `/reset-password?token=abc123`
4. User clicks link → enters new password
5. Backend validates token, updates hash, invalidates token
6. Token stored in DB with expiry, deleted after use

---

## Session Handling

### Where Tokens Live (Frontend)

**Option A: localStorage**
- Pros: Simple, persists across tabs and browser restarts
- Cons: Vulnerable to XSS (JavaScript can read it)
- Mitigation: Strict Content Security Policy headers, sanitize all user inputs

**Option B: httpOnly Cookie**
- Pros: JavaScript CANNOT read it → XSS safe
- Cons: Requires same-domain setup, CSRF protection needed
- CSRF mitigation: `SameSite=Strict` cookie attribute + CSRF token header

**Movientum choice**: Start with localStorage (simpler). Migrate to httpOnly cookies when security hardening phase begins.

### Session Duration Logic
- Access token: 1 hour active
- Refresh token: 30 days
- "Remember me" checkbox: extends refresh token to 90 days
- Forced logout: admin can invalidate all tokens for a user (mass blacklist by user_id)

---

## Security Practices

### Rate Limiting on Auth Endpoints
- Login: max 5 attempts per 15 minutes per IP
- Register: max 10 accounts per hour per IP
- Refresh: max 30 refreshes per hour per user
- Exceeded → 429 Too Many Requests

### CORS Configuration
- Only allow requests from Movientum frontend domain
- Block all other origins
- In development: allow localhost

### HTTPS Enforcement
- All traffic over HTTPS in production
- HTTP requests redirected to HTTPS
- HSTS header set (browser won't allow HTTP future visits)

### Sensitive Data Masking
- Password never returned in any API response
- Full email only returned to the account owner (not to other users)
- JWT payload does not contain sensitive data (no SSN, no payment info)

### Input Sanitization
- All inputs stripped of HTML tags before processing
- SQL injection prevented by parameterized queries (SQLAlchemy ORM handles this)
- Email validated via regex before any DB lookup

---

## Role-Based Access Control (RBAC)

Two roles at launch:

| Role | Permissions |
|------|------------|
| `user` | Register, login, browse, rate, watch, manage own data |
| `admin` | All user permissions + manage movies, manage users, view analytics |

Admin-only routes:
- `DELETE /api/movies/{id}` — remove movie
- `GET /api/admin/users` — list all users
- `PUT /api/admin/users/{id}/disable` — disable account
- `GET /api/admin/analytics` — platform statistics

Route decorator checks `request.state.user.role == 'admin'` before processing.
