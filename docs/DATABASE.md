# Photobooth Database Schema (V1)

**Version**: 1.0  
**Last Updated**: 2026-08-27

---

## 1. Schema Overview

The V1 database supports temporary, anonymous, two-person collaborative photobooth sessions. The schema is intentionally minimal, storing only what's necessary for room management, participant tracking, and session lifecycle.

### Design Principles

- **Temporary by default**: All room data expires 30 minutes after room creation
- **Anonymous**: No user accounts, names, emails, or personally identifiable information
- **Minimal**: Only room metadata and participant session tracking
- **Security-first**: Room codes are not authorization credentials; capabilities enforce access control
- **Privacy-conscious**: No photo storage, no unnecessary data retention

### Tables

1. **`rooms`**: Core room metadata (state, code, expiration, capacity)
2. **`participants`**: Session tracking for room participants (capability-based authorization)

---

## 2. Rooms Table

The `rooms` table stores temporary collaborative session metadata.

### Purpose

- Track room lifecycle (waiting → active → completed → expired)
- Enforce two-participant capacity limit
- Manage room expiration (30 minutes after creation)
- Provide human-readable room codes for discovery

### Columns

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Internal room identifier, never exposed as public room code |
| `code` | `text` | UNIQUE, NOT NULL | Human-readable room code (e.g., "MOON-47"), used for discovery/sharing, NOT for authorization |
| `state` | `text` | NOT NULL, DEFAULT `'waiting'` | Room lifecycle state: `'waiting'` \| `'active'` \| `'completed'` \| `'expired'` |
| `participant_count` | `integer` | NOT NULL, DEFAULT `0`, CHECK `>= 0 AND <= max_participants` | Current number of participants (0-2) |
| `max_participants` | `integer` | NOT NULL, DEFAULT `2` | Maximum allowed participants (V1 fixed at 2) |
| `created_at` | `timestamptz` | NOT NULL, DEFAULT `NOW()` | Room creation timestamp |
| `last_activity_at` | `timestamptz` | NOT NULL, DEFAULT `NOW()` | Last activity timestamp (tracked for analytics/debugging, not used for V1 expiration) |
| `expires_at` | `timestamptz` | NOT NULL, DEFAULT `NOW() + INTERVAL '30 minutes'` | Absolute expiration timestamp (30 minutes from creation) |

### Indexes

```sql
-- Fast lookup by room code (primary access pattern)
CREATE UNIQUE INDEX idx_rooms_code ON rooms(code);

-- Efficient expiration cleanup queries
CREATE INDEX idx_rooms_expires_at ON rooms(expires_at) WHERE state != 'expired';

-- Efficient active room queries
CREATE INDEX idx_rooms_state ON rooms(state);
```

### Constraints

```sql
-- Enforce valid state values
ALTER TABLE rooms ADD CONSTRAINT valid_state 
  CHECK (state IN ('waiting', 'active', 'completed', 'expired'));

-- Enforce participant count bounds
ALTER TABLE rooms ADD CONSTRAINT valid_participant_count 
  CHECK (participant_count >= 0 AND participant_count <= max_participants);

-- Unique room code (discoverable but not secret)
ALTER TABLE rooms ADD CONSTRAINT unique_code UNIQUE (code);
```

### State Machine

```
waiting → active → completed
   ↓                   ↓
expired             expired
```

**State Definitions:**

- **`waiting`**: Room created, waiting for participants (0-1 participants)
- **`active`**: Both participants joined (2 participants), session in progress
- **`completed`**: Photo strip downloaded, session ended (terminal state)
- **`expired`**: Inactive for 30 minutes OR explicitly closed (terminal state)

**State Transitions:**

- `waiting → active`: When 2nd participant joins
- `active → completed`: When user downloads photo strip
- `* → expired`: When `expires_at` timestamp passes OR explicit close action

### Room Code Generation

**Format**: `WORD-##` (e.g., "MOON-47", "STAR-92")

**Properties:**

- Human-readable and memorable
- 100 word vocabulary × 90 numbers (10-99) = ~9,000 possible codes
- Collision handling: retry with new code if duplicate
- **Security boundary**: Room code is for discovery/sharing, NOT authorization
- Authorization enforced via participant session capabilities (see Participants table)

**Implementation Note**: Room code generation happens in application code, not database constraints.

---

## 3. Participants Table

The `participants` table tracks individual participant sessions within rooms, implementing capability-based authorization.

### Purpose

- Track which participants are in which rooms
- Enforce two-participant capacity limit
- Implement session capability authorization (not room codes)
- Support disconnect/reconnect scenarios

### Columns

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | `uuid` | PRIMARY KEY, DEFAULT `gen_random_uuid()` | Participant session identifier |
| `room_id` | `uuid` | NOT NULL, REFERENCES `rooms(id)` ON DELETE CASCADE | Room this participant belongs to |
| `capability_hash` | `text` | UNIQUE, NOT NULL | Hashed session capability token (SHA-256 hash of high-entropy token) |
| `joined_at` | `timestamptz` | NOT NULL, DEFAULT `NOW()` | When participant joined the room |
| `last_seen_at` | `timestamptz` | NOT NULL, DEFAULT `NOW()` | Last activity timestamp (for presence/disconnect detection) |

### Indexes

```sql
-- Fast lookup by room (primary access pattern)
CREATE INDEX idx_participants_room_id ON participants(room_id);

-- Fast capability validation
CREATE UNIQUE INDEX idx_participants_capability_hash ON participants(capability_hash);

-- Efficient stale session cleanup
CREATE INDEX idx_participants_last_seen_at ON participants(last_seen_at);
```

### Constraints

```sql
-- Cascade delete when room is deleted
ALTER TABLE participants ADD CONSTRAINT fk_room 
  FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;

-- Unique capability hash (one participant per capability)
ALTER TABLE participants ADD CONSTRAINT unique_capability 
  UNIQUE (capability_hash);
```

---

## 4. Authorization Model: Session Capabilities

### Problem

Room codes (~9,000 combinations) have insufficient entropy to serve as authorization credentials. An attacker could enumerate all possible codes and access any room.

### Solution: Three-Level Identity System

1. **Room Code** (discovery mechanism, ~9,000 combinations)
   - Human-friendly, shareable (e.g., "MOON-47")
   - Used to find/join a room
   - **NOT a secret, NOT used for authorization**

2. **Room UUID** (internal database identifier)
   - Cryptographically random, 128-bit entropy
   - Never exposed to clients
   - Authoritative database primary key

3. **Session Capability Token** (authorization mechanism)
   - High-entropy random token (128+ bits)
   - Generated when participant joins room
   - Stored as SHA-256 hash in `participants.capability_hash`
   - Transmitted to client in **HttpOnly, Secure, SameSite=Lax cookie**
   - Required for all room operations (mutations, content access)

### Why Hash the Capability?

**Decision: Store capability as SHA-256 hash, not plaintext**

**Rationale:**

If the database is compromised (SQL injection, backup exposure, insider access), plaintext capabilities would allow an attacker to impersonate any participant. Hashing the capability provides defense-in-depth:

- **Database breach**: Attacker sees hashes, cannot derive original tokens
- **Backup exposure**: Historical database dumps contain only hashes
- **Read-only SQL injection**: Attacker cannot extract usable session tokens

**Trade-offs:**

- **Performance**: Hash validation requires SHA-256 computation per request (negligible overhead)
- **Session revocation**: Cannot list active sessions by value (must track separately if needed)
- **Complexity**: Slightly more complex than plaintext comparison

**Why this is acceptable:**

- V1 sessions are temporary (30-minute lifetime) — limited attack window
- Performance impact is minimal (modern SHA-256 implementations are fast)
- Session listing not required in V1 (no admin dashboard, no user management)
- Security benefit outweighs minimal complexity increase

**Alternative considered and rejected**: Plaintext storage with strict RLS policies. Rejected because RLS does not protect against database-level breaches (backups, exports, compromised credentials).

### Authorization Flow

**Room Creation:**

1. Server generates room code (e.g., "MOON-47")
2. Server creates `rooms` record with UUID and code
3. Server generates high-entropy capability token (cryptographically random, 128+ bits)
4. Server hashes capability with SHA-256 → stores `capability_hash` in `participants` table
5. Server sets HttpOnly, Secure, SameSite=Lax cookie with original capability token
6. Server returns room code to client (for sharing)

**Room Joining:**

1. Client provides room code (e.g., via URL or manual entry)
2. Server validates:
   - Room exists and is not expired
   - Room has capacity (`participant_count < max_participants`)
3. Server atomically increments `participant_count` (prevents race conditions)
4. Server generates new high-entropy capability token for this participant
5. Server hashes and stores capability in `participants` table
6. Server sets HttpOnly, Secure, SameSite=Lax cookie with capability token
7. Server returns success

**Subsequent Requests:**

1. Client sends request with capability cookie
2. Server extracts capability from cookie
3. Server hashes capability with SHA-256
4. Server queries `participants` where `capability_hash = SHA256(capability)`
5. If match found: request authorized
6. If no match: return 401 Unauthorized

**Security Properties:**

- Room code alone cannot authorize operations
- Capability token never exposed to JavaScript (HttpOnly cookie)
- Capability token only transmitted over HTTPS (Secure cookie)
- Capability token scoped to same-site requests (SameSite=Lax)
- Database breach does not expose usable session tokens (hashed)

---

## 5. Lifecycle & Expiration Strategy

### Expiration Policy

Rooms expire **30 minutes after creation** to minimize data retention and enforce ephemeral session model.

### Expiration Implementation

**Timestamp-based expiration** (no background jobs required):

1. Each room has `expires_at` timestamp (default: `created_at + 30 minutes`)
2. On every room access (join, query, mutation), server checks:
   - If `NOW() > expires_at`: mark room as `expired`, return 404
   - If `NOW() <= expires_at`: proceed normally
3. Periodic cleanup job (daily or hourly) deletes expired rooms:
   ```sql
   DELETE FROM rooms WHERE state = 'expired' AND expires_at < NOW() - INTERVAL '1 day';
   ```

**V1 approach**: Absolute expiration (`expires_at = created_at + 30 minutes`). Rooms expire 30 minutes after creation regardless of activity. `last_activity_at` is tracked for future use and debugging but is not used for V1 expiration logic.

### Cascade Deletion

When a room is deleted:

- All associated `participants` records are automatically deleted (ON DELETE CASCADE)
- No orphaned participant records remain

### Cleanup Job

**Purpose**: Delete expired rooms to prevent database bloat

**Schedule**: Daily (low priority) or hourly (if high traffic)

**Query**:
```sql
DELETE FROM rooms 
WHERE state = 'expired' 
  AND expires_at < NOW() - INTERVAL '1 day';
```

**Why +1 day buffer?**: Allow debugging/logging of recently expired rooms. Could be reduced to 1 hour if disk space is constrained.

---

## 6. Participant Capacity Enforcement

### Requirement

Rooms must enforce **exactly 2 participants maximum** to prevent:

- Overcrowding (>2 participants)
- Race conditions (concurrent joins exceeding capacity)

### Server-Side Enforcement

**Atomic increment with constraint check**:

```sql
-- Attempt to join room (increment participant_count)
UPDATE rooms
SET participant_count = participant_count + 1,
    last_activity_at = NOW()
WHERE id = $room_id
  AND state = 'waiting'
  AND participant_count < max_participants
RETURNING id, code, participant_count;
```

**Logic**:

- `WHERE participant_count < max_participants`: Only increment if capacity available
- If no rows updated: room is full, return 403 Forbidden
- If rows updated: join succeeded, create `participants` record

**Race condition protection**:

- Single atomic SQL statement prevents double-joins
- Database-level constraint (`CHECK participant_count <= max_participants`) as safety net

**Critical atomicity requirement**:

The `participant_count` increment and `participants` record creation must be handled as a single logical database operation/transaction. A failed participant insert must not leave `participant_count` incremented. Implementation will ensure both operations succeed or both are rolled back to maintain consistency.

**Security boundary**:

- **NEVER trust client-provided participant count**
- Always query database for authoritative count
- Client-side capacity checks are UX optimization only (not security)

### State Transition on Join

When 2nd participant joins:

```sql
UPDATE rooms
SET state = 'active',
    participant_count = 2,
    last_activity_at = NOW()
WHERE id = $room_id
  AND state = 'waiting'
  AND participant_count = 1;
```

---

## 7. Row-Level Security (RLS) Intent

### RLS Philosophy

V1 uses **server-controlled mutations via service role** rather than permissive anonymous UPDATE policies. The server endpoints perform validated operations using the admin client (`src/lib/supabase/admin.ts`), which bypasses RLS entirely.

### Security Model

**Anonymous clients (browser) should NOT have direct UPDATE/DELETE access to `rooms` or `participants` tables.**

Instead:

- Room creation/joining happens through server-controlled API routes
- Server validates capability tokens before performing mutations
- Server uses admin client (service role) for database operations
- RLS policies enforce read-only access for discovery (if needed)

### RLS Security Intent

**V1 RLS approach:**

- Anonymous clients have **no direct INSERT/UPDATE/DELETE access** to `rooms` or `participants` tables
- Server-controlled API operations validate the HttpOnly session capability before performing mutations
- Authorized mutations are performed server-side using the admin client (service role)
- RLS policies may allow limited read access for room discovery/validation
- Exact RLS policy definitions will be created during migration implementation

### Why This Model?

**Problem**: Permissive anonymous UPDATE policies create attack surface:

- Malicious client could increment `participant_count` directly
- Client could modify `state` or `expires_at` timestamps
- Client could delete other participants' records

**Solution**: Server-controlled mutations with capability validation:

- Client sends capability cookie with request
- Server validates capability hash against `participants` table
- Server performs mutation via admin client after validation
- RLS provides defense-in-depth for read operations only

---

## 8. Privacy Considerations

### Data Minimization

**What V1 stores:**

- Room metadata (code, state, timestamps, participant count)
- Participant session tracking (join timestamp, capability hash, last seen)

**What V1 does NOT store:**

- User accounts, names, emails, phone numbers
- Photos (captured photos remain client-side, never uploaded in V1)
- Editor state (filters, stickers, layouts — client-side only)
- IP addresses (not persisted beyond server logs)
- Browser fingerprints (no tracking)
- Payment information (V1 is fully free)

### Automatic Deletion

- Rooms expire after 30 minutes → marked as `expired`
- Expired rooms deleted by cleanup job (1 hour to 1 day retention for debugging)
- Participants cascade-deleted when room is deleted
- No long-term data retention

### No Personal Data

V1 collects **zero personally identifiable information (PII)**:

- No names, emails, phone numbers
- No authentication (anonymous sessions)
- No photo uploads (photos stay in browser memory)
- Session capabilities are random tokens, not derived from personal data

### Privacy & Legal Obligations

V1's minimal data collection reduces privacy/legal obligations:

- Anonymous, temporary sessions with no PII
- Compliance requirements reviewed before public launch
- V2 (authenticated users, persistent galleries) will require privacy policy, GDPR/CCPA compliance, consent mechanisms

---

## 9. Example Records

### Example 1: Waiting Room

**`rooms` record:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "MOON-47",
  "state": "waiting",
  "participant_count": 1,
  "max_participants": 2,
  "created_at": "2026-08-27T14:30:00Z",
  "last_activity_at": "2026-08-27T14:30:15Z",
  "expires_at": "2026-08-27T15:00:00Z"
}
```

**`participants` record:**

```json
{
  "id": "661e8400-e29b-41d4-a716-446655440001",
  "room_id": "550e8400-e29b-41d4-a716-446655440000",
  "capability_hash": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
  "joined_at": "2026-08-27T14:30:00Z",
  "last_seen_at": "2026-08-27T14:30:15Z"
}
```

**Explanation**: User created room "MOON-47", currently waiting for 2nd participant. Capability hash corresponds to their session token (original token stored in HttpOnly cookie, never in database plaintext).

---

### Example 2: Active Room

**`rooms` record:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "MOON-47",
  "state": "active",
  "participant_count": 2,
  "max_participants": 2,
  "created_at": "2026-08-27T14:30:00Z",
  "last_activity_at": "2026-08-27T14:32:45Z",
  "expires_at": "2026-08-27T15:00:00Z"
}
```

**`participants` records:**

```json
[
  {
    "id": "661e8400-e29b-41d4-a716-446655440001",
    "room_id": "550e8400-e29b-41d4-a716-446655440000",
    "capability_hash": "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
    "joined_at": "2026-08-27T14:30:00Z",
    "last_seen_at": "2026-08-27T14:32:45Z"
  },
  {
    "id": "772e8400-e29b-41d4-a716-446655440002",
    "room_id": "550e8400-e29b-41d4-a716-446655440000",
    "capability_hash": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z6a7b8c9d0e1f2",
    "joined_at": "2026-08-27T14:31:30Z",
    "last_seen_at": "2026-08-27T14:32:45Z"
  }
]
```

**Explanation**: 2nd participant joined at 14:31:30. Room transitioned to `active` state. Both participants have their own capability hashes.

---

### Example 3: Completed Room

**`rooms` record:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "MOON-47",
  "state": "completed",
  "participant_count": 2,
  "max_participants": 2,
  "created_at": "2026-08-27T14:30:00Z",
  "last_activity_at": "2026-08-27T14:45:20Z",
  "expires_at": "2026-08-27T15:00:00Z"
}
```

**Explanation**: Photo strip downloaded at 14:45:20. Room marked as `completed` (terminal state). Room still accessible for re-download until `expires_at` (15:00:00).

---

### Example 4: Expired Room

**`rooms` record:**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "code": "MOON-47",
  "state": "expired",
  "participant_count": 2,
  "max_participants": 2,
  "created_at": "2026-08-27T14:30:00Z",
  "last_activity_at": "2026-08-27T14:45:20Z",
  "expires_at": "2026-08-27T15:00:00Z"
}
```

**Explanation**: Room expired at 15:00:00 (30 minutes after creation). No longer joinable. Cleanup job will delete this record (and cascade-delete participants) after retention period.

---

## 10. V1 Boundaries

### What This Schema Supports

✅ Temporary anonymous two-person rooms  
✅ Human-readable room codes (discovery/sharing)  
✅ Internal UUIDs (authoritative database keys)  
✅ Room lifecycle (waiting → active → completed → expired)  
✅ 30-minute expiration policy  
✅ Two-participant capacity enforcement  
✅ Session capability authorization (hashed tokens)  
✅ Participant join/disconnect tracking  
✅ Cascade deletion (rooms → participants)  

### What This Schema Does NOT Support

❌ User accounts, authentication, login/signup (V2)  
❌ Persistent user galleries or saved sessions (V2)  
❌ Photo storage (V1 photos remain client-side)  
❌ Editor state persistence (filters, stickers, layouts — client-side only)  
❌ Payment tracking or subscriptions (V2)  
❌ Real-time presence (V1.5 — requires Realtime integration, not database schema)  
❌ Session recovery after full disconnect (V1.5 — requires photo storage)  
❌ Multi-device sessions (V2)  
❌ Room ownership or creator privileges (V2)  
❌ Room history or analytics (V2)  

### V1.5 Considerations

**If session recovery is added** (V1.5 optional feature):

- Add `photos` table to store temporary photo blobs (30-minute TTL)
- Add `editor_state` JSONB column to `rooms` for synchronized editing state
- Add Realtime presence tracking (not database schema)

**Schema changes NOT needed for V1.5**:

- Real-time collaboration uses Supabase Realtime (pub/sub channels, not database polling)
- Presence indicators use Realtime presence (ephemeral, not persisted)

---

## 11. Migration Strategy

### Schema Creation Order

1. Create `rooms` table (independent, no foreign keys)
2. Create `participants` table (depends on `rooms`)
3. Create indexes on both tables
4. Enable Row-Level Security on both tables
5. Create RLS policies (server-controlled mutations, limited read access)

### Rollback Strategy

Migrations should be reversible:

- `DOWN` migration drops tables in reverse order (participants → rooms)
- Cascade deletion ensures no orphaned records

### Data Seeding

V1 requires **no seed data**:

- No default users, rooms, or configuration
- Rooms created dynamically by users
- Fresh database can serve traffic immediately

---

## 12. Summary

This database schema defines the minimal foundation for V1:

### Key Decisions

1. **Two tables**: `rooms` and `participants` (no user accounts, no photo storage)
2. **Capability-based authorization**: Hashed session tokens, not room codes
3. **Temporary by default**: 30-minute expiration, automatic cleanup
4. **Server-controlled mutations**: RLS for read access, service role for writes
5. **Privacy-first**: Zero PII, anonymous sessions, minimal data retention
6. **Atomic capacity enforcement**: Database-level constraints prevent race conditions

### Security Properties

- Room codes are discovery mechanisms, not secrets
- Capability tokens provide authorization (high-entropy, hashed, HttpOnly cookies)
- Database breach does not expose usable session tokens
- Participant capacity enforced server-side (atomic operations)
- Anonymous clients cannot directly UPDATE/DELETE database records

### Next Steps

1. Review this schema design with stakeholders
2. Create SQL migrations (CREATE TABLE, indexes, constraints, RLS policies)
3. Implement room creation/joining API routes with capability generation
4. Test capacity enforcement under concurrent load
5. Implement expiration cleanup job

---

## Decisions Requiring Approval

### 1. Capability Storage: Hashed vs. Plaintext

**Proposed**: Store capability as SHA-256 hash in `participants.capability_hash`

**Rationale**: Defense-in-depth against database breaches

**Trade-off**: Slightly more complex validation logic (hash on every request)

**Alternative**: Store plaintext, rely on RLS policies alone (rejected for insufficient breach protection)

**Status**: ✅ Recommended (hashing provides meaningful security benefit with minimal cost)

---

### 2. Expiration Strategy: Absolute vs. Activity-Based

**Proposed**: Absolute expiration (`expires_at = created_at + 30 minutes`)

**Rationale**: Simpler implementation, predictable behavior

**Trade-off**: Room expires even if participants are actively using it at 29-minute mark

**Alternative**: Activity-based (`last_activity_at + 30 minutes`) — requires updating timestamp on every operation

**Status**: ✅ Recommended for V1 (absolute expiration), consider activity-based in V1.5 if user feedback indicates need

---

### 3. Cleanup Job Retention Period

**Proposed**: Keep expired rooms for 1 day before deleting (allows debugging)

**Rationale**: Balance between disk space and operational visibility

**Alternative**: Delete immediately (saves disk space) or keep for 1 hour (minimal retention)

**Status**: 🟡 Flexible — can be configured at deployment, recommend starting with 1-day retention

---

### 4. RLS Policy Approach

**Proposed**: Server-controlled mutations (service role), read-only RLS for discovery

**Rationale**: Prevents anonymous clients from directly modifying database

**Alternative**: Permissive anonymous policies with JWT-based capability validation (more complex)

**Status**: ✅ Recommended (simpler, more secure for V1 anonymous model)

---

### 5. Participant Count Storage

**Proposed**: Denormalized `participant_count` column in `rooms` table

**Rationale**: Fast capacity checks without JOIN or COUNT query

**Trade-off**: Requires atomic increment logic, slight risk of inconsistency

**Alternative**: Always `COUNT(*) FROM participants` — slower, no denormalization risk

**Status**: ✅ Recommended (performance benefit outweighs consistency risk with proper constraints)

---

*This schema design is ready for implementation pending approval of the above decisions.*
