# Photobooth Architecture

**Version**: 1.0  
**Last Updated**: 2026-08-25

---

## 1. Architecture Overview

This document defines the technical architecture for the collaborative web photobooth V1. The architecture prioritizes simplicity, security, privacy, and performance while maintaining clear extensibility boundaries for future features.

### Core Principles

- **Simplicity First**: Avoid microservices, unnecessary dependencies, and premature abstraction
- **Client-Side Processing**: Keep photo editing and preview work in the browser whenever possible
- **Server-Side Security**: Validate all sensitive operations server-side; never trust client input
- **Privacy by Design**: Minimize data retention, avoid permanent photo storage in V1
- **Incremental Development**: Build and ship working features progressively
- **Performance Consciousness**: Optimize for mobile devices and slower network connections

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (Client)                      │
│  ┌────────────┬──────────────┬────────────────────────┐ │
│  │  Next.js   │   Camera     │   Canvas/Image         │ │
│  │  App       │   (Media-    │   Processing           │ │
│  │  Router    │   Devices)   │   (Client-Side)        │ │
│  └────────────┴──────────────┴────────────────────────┘ │
│                         ↕                                │
│                    HTTP / WebSocket*                     │
│                         ↕                                │
│  ┌────────────────────────────────────────────────────┐ │
│  │            Next.js API Routes (Server)             │ │
│  │  - Room management                                 │ │
│  │  - Session state (temporary)                       │ │
│  │  - Server-side validation                          │ │
│  └────────────────────────────────────────────────────┘ │
│                         ↕                                │
│  ┌────────────────────────────────────────────────────┐ │
│  │              Supabase Backend                      │ │
│  │  ┌──────────────┬────────────┬──────────────────┐ │ │
│  │  │  PostgreSQL  │  Realtime* │  Storage (temp)  │ │ │
│  │  └──────────────┴────────────┴──────────────────┘ │ │
│  └────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘

* V1 routes all requests through Next.js server endpoints.
  Realtime (WebSocket) may be accessed directly from browser in V1.5 
  for synchronized editing and presence.
```

---

## 2. Technology Stack

### Frontend

- **Next.js 15+** (App Router): Server and client components, API routes, built-in optimization
- **React 19+**: UI library with React Compiler for automatic optimization
- **TypeScript 5+**: Type safety across the entire codebase
- **Tailwind CSS 4+**: Utility-first styling matching DESIGN.md color system
- **ESLint**: Code quality and consistency

### Backend

- **Supabase**: Backend-as-a-service platform
  - **PostgreSQL**: Relational database for room/session metadata
  - **Realtime**: WebSocket-based pub/sub for room state synchronization
  - **Storage**: Temporary asset storage (optional for V1)
  - **Edge Functions**: Future consideration for serverless compute (not V1)

### Browser APIs

- **MediaDevices API** (`navigator.mediaDevices.getUserMedia`): Camera access
- **Canvas API**: Image manipulation, filter application, composition
- **Blob API**: Image data handling and download
- **Web Storage API**: Non-sensitive temporary client-side preferences/state (sessionStorage/localStorage for UI state only, not authorization credentials)

### Development Tools

- **pnpm**: Fast, disk-efficient package manager
- **Prettier**: Code formatting (coordinated with ESLint)
- **TypeScript Strict Mode**: Maximum type safety

### Why These Choices?

**Next.js App Router**: Provides both server and client rendering, built-in API routes eliminate need for separate backend framework, excellent developer experience, strong ecosystem

**React Compiler**: Automatic memoization eliminates manual `useMemo`/`useCallback`, improves performance without developer overhead

**Tailwind CSS**: Matches design system requirements (precise color control, responsive utilities, dark theme support), no CSS-in-JS runtime cost, excellent mobile performance

**Supabase**: Reduces backend development overhead, provides PostgreSQL + Realtime + Storage in one platform, scales with product growth, simplifies authentication when added in V2

**Browser APIs First**: Native MediaDevices API supports all modern browsers, Canvas API is performant and flexible, avoids unnecessary camera/image libraries

---

## 3. Frontend Architecture

### Application Structure

```
/app
  /(routes)
    /page.tsx                 # Landing page (create/join room)
    /room/[code]/page.tsx     # Room session (camera, editor, preview)
    /view/[id]/page.tsx       # View-only shared photo strip (V1.5)
  /api
    /rooms/route.ts           # Create room (POST)
    /rooms/[code]/join/route.ts # Join room (POST)
  /layout.tsx                 # Root layout
  /error.tsx                  # Error boundary
  /not-found.tsx              # 404 page

/components
  /ui                         # Reusable UI primitives (Button, Input, Modal)
  /room                       # Room-specific components (RoomCode, ParticipantList)
  /camera                     # Camera components (CameraView, CaptureButton, Countdown)
  /editor                     # Editor components (FilterSelector, StickerPalette, etc.)
  /photo-strip                # Photo strip rendering components

/lib
  /camera.ts                  # Camera access, stream management
  /canvas.ts                  # Canvas utilities, image processing
  /filters.ts                 # Filter definitions and application logic
  /room-client.ts             # Client-side room state management
  /supabase-client.ts         # Supabase client initialization
  /types.ts                   # Shared TypeScript types
  /utils.ts                   # General utilities

/hooks
  /use-camera.ts              # Camera access hook
  /use-room.ts                # Room state hook (Realtime subscriptions)
  /use-photo-editor.ts        # Editor state management

/styles
  /globals.css                # Tailwind imports, global styles, CSS variables
```

### Component Patterns

**Server Components by Default**: Use React Server Components for static/data-fetching components

**Client Components When Needed**: Mark with `'use client'` only when:
- Using browser APIs (camera, canvas)
- Managing interactive state (editor, drag-and-drop)
- Using React hooks (`useState`, `useEffect`)

**Composition Over Props Drilling**: Pass complex state via context or composition patterns

**Colocate Related Code**: Keep component, styles, and tests together when complexity warrants

### State Management

**Server State (Temporary Room Data)**:
- Managed via Supabase Realtime
- Room state: `waiting | active | completed | expired`
- Participant presence: online/offline status (V1.5)

**Client State**:
- **Camera State**: Local media stream, camera device list
- **Photos State**: Captured photo blobs (stored in memory, not server in V1)
- **Editor State**: Selected filter, placed stickers, chosen background/theme/layout
- **UI State**: Modals, loading states, error states

**State Management Approach**:
- React `useState`/`useReducer` for local component state
- React Context for cross-component state (editor state, room state)
- Supabase Realtime for synchronized room state
- No global state library needed in V1 (Redux/Zustand unnecessary for this scope)

### Routing Strategy

**Public Routes** (no authentication in V1):
- `/` — Landing page
- `/room/[code]` — Room session
- `/view/[id]` — Shared photo strip view (V1.5)

**Dynamic Segments**:
- `[code]` — Room code (e.g., `MOON-47`)
- `[id]` — Photo strip ID for sharing (V1.5)

**Route Protection**:
- Room routes validate room exists and is joinable (middleware or component-level check)
- Expired rooms redirect to landing with error message

---

## 4. Camera Architecture

### Camera Access Flow

```
User Action (Start Session)
  ↓
Request Camera Permission (getUserMedia)
  ↓
├─ Permission Granted
│    ↓
│  Create MediaStream
│    ↓
│  Attach to <video> element
│    ↓
│  Display live preview
│
└─ Permission Denied
     ↓
   Show error state
   Provide instructions to enable camera
```

### Implementation Strategy

**Use Native Browser APIs**:
```typescript
const stream = await navigator.mediaDevices.getUserMedia({
  video: {
    facingMode: 'user', // Front camera (selfie mode)
    width: { ideal: 1920 },
    height: { ideal: 1080 }
  },
  audio: false
});
```

**Camera Selection**:
- Enumerate available devices: `navigator.mediaDevices.enumerateDevices()`
- Default to front camera on mobile (`facingMode: 'user'`)
- Provide UI toggle to switch between front/back cameras
- Desktop: Default to first available webcam

**Photo Capture Process**:
1. Display live video preview in `<video>` element
2. On capture trigger (countdown complete):
   - Create `<canvas>` element (off-screen)
   - Draw current video frame to canvas: `ctx.drawImage(video, 0, 0)`
   - Extract image data: `canvas.toBlob()` or `canvas.toDataURL()`
   - Store blob in client state
   - Display thumbnail immediately (optimistic UI)

**Resource Management**:
- Stop media tracks when leaving camera view: `stream.getTracks().forEach(track => track.stop())`
- Remove video element references to prevent memory leaks
- Handle page visibility changes (pause/resume stream)

**Why No Camera Library?**

Native MediaDevices API is:
- Well-supported across modern browsers (Chrome, Safari, Firefox, Edge)
- Lightweight (no bundle size impact)
- Flexible (full control over constraints and capture)
- Sufficient for V1 requirements (capture 4 photos, front/back toggle)

If future requirements emerge (advanced filters during capture, RAW processing), evaluate libraries then.

---

## 5. Photo Processing & Editor Architecture

### Client-Side Processing Philosophy

**All editing happens in the browser**:
- Filters applied via Canvas API
- Stickers positioned/rendered client-side
- Preview composition done locally
- Final high-quality render happens on download (client-side)

**Why Client-Side?**

- **Performance**: No server round-trips for every edit
- **Privacy**: Photos remain client-side in V1; no upload to our servers during capture/edit/download flow
- **Scalability**: Offloads compute to client devices
- **Responsiveness**: Instant preview updates

**V1 Photo Privacy**: Photos captured in V1 remain entirely client-side. The capture, edit, and download flow does not upload photos to our servers. Future features like shareable links or session recovery would require an explicit server-storage flow with a different privacy model.

### Photo Editor State Model

```typescript
interface EditorState {
  photos: Blob[];                    // 4 captured photos
  filter: FilterId | null;           // Selected filter
  stickers: PlacedSticker[];         // Positioned stickers
  background: BackgroundId;          // Background color/pattern
  theme: ThemeId | null;             // Applied theme (overrides filter/bg)
  layout: LayoutId;                  // Photo arrangement
  customText?: string;               // Metadata text (V1.5)
}

interface PlacedSticker {
  id: string;
  stickerId: string;                 // Reference to sticker asset
  x: number;                         // Position (% of canvas width)
  y: number;                         // Position (% of canvas height)
  scale: number;                     // Size multiplier
  rotation: number;                  // Rotation in degrees
  zIndex: number;                    // Layering order
}
```

### Filter Application

**Filter Implementation**:
- Filters are color transformation functions applied to canvas image data
- Use Canvas `getImageData()` / `putImageData()` for pixel manipulation
- Alternative: CSS filters for preview (faster), canvas for final render

**Filter Types**:
- **Color Matrix**: Brightness, contrast, saturation adjustments
- **Lookup Tables (LUTs)**: Pre-defined color grading (vintage, cinematic)
- **Blend Modes**: Overlay colors or gradients
- **Texture Overlays**: Film grain, noise

**Performance Optimization**:
- Preview at lower resolution (e.g., 800px width)
- Final render at full resolution (2000px+ height)
- Apply filter only when changed (memoize results)
- Use Web Workers for heavy processing (if needed in V1.5+)

### Sticker System

**Sticker Assets**:
- SVG or PNG images (prefer SVG for scalability)
- Stored in `/public/stickers/` directory
- Categorized by type (hearts, stars, speech-bubbles, etc.)
- Lazy-loaded (only load visible stickers)

**Sticker Interaction**:
- Drag to position: Track pointer/touch events, update x/y
- Pinch to resize (mobile): Track two-finger distance, update scale
- Rotate (mobile): Track two-finger angle, update rotation
- Desktop: Drag handles for resize/rotate

**Rendering**:
- Draw stickers on top of photos in canvas
- Maintain z-index for layering
- Transform matrix for position/scale/rotation

### Layout System

**Layout Definitions**:
```typescript
interface Layout {
  id: LayoutId;
  name: string;
  photoPositions: PhotoPosition[];  // Positions for 4 photos
  canvasAspectRatio: number;        // e.g., 2:5 for vertical strip
}

interface PhotoPosition {
  x: number;      // % of canvas width
  y: number;      // % of canvas height
  width: number;  // % of canvas width
  height: number; // % of canvas height
  rotation?: number;
}
```

**Layout Examples**:
- **Classic Vertical**: 4 photos stacked, equal size, 100% width each
- **Grid 2×2**: 4 photos in square grid, 50% width/height each
- **Collage Offset**: Varied sizes, slight overlaps, tilted angles

### Final Composition & Rendering

**Rendering Pipeline**:
1. Create canvas at target resolution (e.g., 1200×3000 for vertical strip)
2. Draw background (solid color or pattern)
3. For each photo:
   - Apply selected filter
   - Draw to canvas at layout position
4. Draw stickers on top (with transforms)
5. Add metadata strip (date, custom text)
6. Export as Blob: `canvas.toBlob(blob => { ... }, 'image/png', 1.0)`

**Performance Considerations**:
- Use `OffscreenCanvas` if available (better performance, doesn't block UI)
- Progressive rendering (show preview immediately, generate high-res in background)
- Limit canvas size (4000px max dimension to avoid browser limits)

**Why No Image Editor Library?**

Canvas API provides sufficient control for V1 features:
- Filter application via pixel manipulation or CSS filters
- Sticker rendering via `drawImage()`
- Text rendering via `fillText()`
- Export via `toBlob()`

Libraries like Fabric.js or Konva.js add significant bundle size and introduce abstractions unnecessary for our constrained use case. Reconsider if V2 requires advanced features (vector editing, non-destructive editing, layers panel).

---

## 6. Backend Architecture

### API Routes (Next.js)

**V1 Minimal API Surface**:

`POST /api/rooms`
- **Purpose**: Create a new room
- **Request**: None (anonymous)
- **Response**: `{ roomCode: string }`
- **Logic**:
  - Generate unique room code (e.g., `MOON-47`)
  - Generate high-entropy session capability token
  - Insert room record in Supabase (via service role key)
  - Set HttpOnly, Secure, SameSite cookie with session capability
  - Return room code to client

`POST /api/rooms/[code]/join`
- **Purpose**: Join a room
- **Request**: Room code in URL
- **Response**: `{ success: boolean }`
- **Validation**:
  - Room exists and is not expired
  - Room has capacity (<2 participants)
  - Return error if room full or invalid
- **Logic**:
  - Atomically increment participant count (server-side validation only)
  - Generate high-entropy session capability token for this participant
  - Set HttpOnly, Secure, SameSite cookie with session capability
  - Update room state to `active` if 2nd participant joins
  - Return success

**Additional endpoints may be added as actual V1 requirements emerge. Do not create a large CRUD API spec prematurely.**

### Supabase Schema

**Rooms Table** (`rooms`):
```sql
CREATE TABLE rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT UNIQUE NOT NULL,           -- Room code (e.g., 'MOON-47')
  state TEXT NOT NULL DEFAULT 'waiting', -- 'waiting' | 'active' | 'completed' | 'expired'
  participant_count INTEGER DEFAULT 0,
  max_participants INTEGER DEFAULT 2,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes')
);

CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_rooms_expires_at ON rooms(expires_at);
```

**Room Expiration**:
- Rooms expire 30 minutes after last activity
- Cron job (Supabase Edge Function or Next.js API route) marks expired rooms
- Expired rooms return 404 on join attempts

**No Photos Stored in V1**:
- Photos remain in browser memory only
- V1 capture/edit/download flow does not upload photos to our servers
- Download happens entirely client-side

**V1.5 Considerations**:
- Add `photo_strip_id` column for shareable links
- Add `storage_path` if temporary photo storage needed for session recovery
- Add `session_capabilities` table to track participant authorization
- Add Realtime channels for synchronized editor state

### Database Access Patterns

**Connection**:
- Server-side: Supabase service role key (full access, never exposed to client)
- Browser → Next.js server endpoints → Supabase (V1 access model)
- Client-side: Supabase anon key for Realtime (V1.5+, read-only presence/broadcast channels)

**Row-Level Security (RLS)**:

RLS must enforce least privilege. Sensitive room mutations are performed through controlled server-side operations, not by arbitrary anonymous clients.

V1 does not implement permissive anonymous UPDATE policies. The server endpoints use the service role key to perform validated mutations.

**Security Intent** (SQL policies deferred to implementation):
- Room creation: Server-controlled via service role
- Room joining: Server-controlled via service role with atomic capacity checks
- Room reads: May allow limited anonymous reads for room discovery (state, participant count)
- Room updates: Server-controlled only; no direct client UPDATE access

**V2 (Authenticated Users)**:
- Add `user_id` column to rooms
- Restrict updates to room creator
- Add `gallery` table for persistent photo strips

### Realtime (V1.5)

**Room Presence Channel**:
- Channel name: `room:{roomCode}`
- Presence: Track online/offline participants
- Broadcast: Editor state changes (filter, stickers, layout)

**Implementation**:
```typescript
const channel = supabase.channel(`room:${roomCode}`)
  .on('presence', { event: 'sync' }, () => {
    // Update participant presence UI
  })
  .on('broadcast', { event: 'editor-update' }, (payload) => {
    // Sync editor state from other participant
  })
  .subscribe();
```

---

## 7. Room & Session Architecture

### Room Code Generation & Authorization

**Room Code** (Discovery/Share Mechanism):
- Short (6-10 characters)
- Memorable (avoid ambiguous characters like `0`/`O`, `1`/`I`)
- Used for room discovery, not authorization

**Implementation Strategy**:
```typescript
function generateRoomCode(): string {
  const words = ['MOON', 'STAR', 'CLOUD', ...]; // 100+ words
  const randomWord = words[Math.floor(Math.random() * words.length)];
  const randomNumber = Math.floor(Math.random() * 90) + 10; // 10-99
  return `${randomWord}-${randomNumber}`; // e.g., 'MOON-47'
}
```

**Authorization Model**:

The room code space (~9,000 combinations) is insufficient as an authorization mechanism.

**Three-Level Identity System**:
1. **Room Code**: Human-friendly discovery mechanism (e.g., `MOON-47`), shareable, not a secret
2. **Room UUID**: Internal database identifier (`rooms.id`), authoritative
3. **Session Capability**: High-entropy participant authorization token

**Session Capability Token**:
- Generated on room creation and room join
- Cryptographically random (at least 128 bits of entropy)
- Stored in HttpOnly, Secure, SameSite=Lax cookie (not localStorage)
- Scoped to the participant's session
- Required for any room mutations or access to room content
- Server validates capability before allowing operations

**Security Boundaries**:
- Room code is NOT a secret; it's a discovery/share mechanism only
- Authorization is enforced via session capability tokens
- Internal `room.id` (UUID) is the authoritative database identifier
- Rate limit room creation (prevent abuse)
- Do NOT expose database row IDs as room codes

### Room States

**State Diagram**:
```
waiting → active → completed
   ↓                   ↓
expired             expired
```

**State Definitions**:
- **waiting**: Room created, <2 participants
- **active**: 2 participants joined, session in progress
- **completed**: Photo strip downloaded, session ended
- **expired**: Inactive >30 minutes or manually closed

**State Transitions**:
- `waiting → active`: 2nd participant joins
- `active → completed`: User downloads photo strip
- `* → expired`: 30 minutes of inactivity or explicit close

### Session Lifecycle

**1. Room Creation** (User A):
- User clicks "Create Room"
- API call creates room in `waiting` state
- User sees room code and "Waiting for participant" UI

**2. Room Joining** (User B):
- User B receives room code via share
- Enters code on landing page
- API validates room (exists, not full, not expired)
- User B joins, room transitions to `active`

**3. Camera Setup**:
- Both users request camera permission
- V1 Simplification: One primary capture device serves as the authoritative source for the four-photo strip
- The second participant joins the room and participates in the session
- V1 does NOT synchronize two independent cameras or combine two devices' photos into one strip
- True multi-device capture may be considered for a future version

**4. Photo Capture**:
- Countdown (3-2-1) × 4 photos
- Photos from primary capture device stored locally in browser memory
- V1: Photos remain client-side, not uploaded to our servers
- V1.5: Broadcast photo capture events for awareness

**5. Editor**:
- Both users can edit independently (V1)
- V1.5: Realtime synchronization (both see same state)
- Changes apply immediately (optimistic UI)

**6. Download**:
- Each user downloads independently
- Final composition rendered client-side
- Room remains active for 30 minutes (allow re-download)

**7. Expiration**:
- Room expires after 30 minutes of inactivity
- Expired rooms no longer joinable
- No cleanup needed (photos not stored server-side in V1)

### Collaboration Model (V1 vs V1.5)

**V1 (Simple)**:
- Both users share same room code
- One primary capture device is the authoritative source for all 4 photos
- Second participant participates in the session but does not independently contribute camera captures to the V1 photo strip
- Editor state NOT synchronized (each user can edit independently)
- Each user downloads their own version

**V1.5 (Realtime Collaboration)**:
- Editor state synchronized via Realtime
- User A applies filter → User B sees it immediately
- Presence indicators (who's online, who's editing)
- Session recovery (rejoin after disconnect)

### Privacy & Data Retention

**V1 Data Policy**:
- **Photos**: V1 capture/edit/download flow does not upload photos to our servers; photos remain in browser memory only
- **Room Metadata**: Stored temporarily, deleted after expiration (30 min)
- **Session Capabilities**: Authorization tokens stored in HttpOnly cookies, automatically expire with room
- **User Identity**: None (fully anonymous)
- **Download**: Happens entirely client-side (no server receives photo data)

**Privacy & Legal Obligations**:
- V1 minimizes personal data collection (anonymous sessions, temporary metadata only)
- Applicable privacy and legal obligations will be reviewed before public launch
- V2: Add privacy policy, data deletion flows, consent mechanisms as required

---

## 8. Security Architecture

### Threat Model

**Potential Threats**:
1. Room code enumeration (brute force join attempts)
2. Room capacity bypass (>2 participants)
3. Malicious photo uploads (if storage added)
4. XSS via user-generated content (stickers, text)
5. CSRF on room actions
6. Denial of service (excessive room creation)
7. Client-side code tampering (modified bundles)

### Security Measures

**1. Authorization via Session Capabilities**:
- Room code is a discovery mechanism, not an authorization credential
- Session capability tokens (high-entropy, cryptographically random) enforce authorization
- Capabilities stored in HttpOnly, Secure, SameSite=Lax cookies
- Server validates capability before allowing room operations
- Rate limit room join attempts (max 10 attempts per IP per minute)
- Monitor for brute force patterns (alert if sustained high join failure rate)

**2. Room Capacity Enforcement**:
- **Server-side validation only**: Check participant count in database before allowing join
- Never trust client-provided participant count
- Atomic increment operation to prevent race conditions:
  ```sql
  UPDATE rooms
  SET participant_count = participant_count + 1
  WHERE code = $1 AND participant_count < max_participants
  RETURNING id;
  ```
- Return error if no rows updated (room full or doesn't exist)

**3. Input Validation**:
- Room codes: Alphanumeric + hyphen only, max 20 chars
- Custom text (V1.5): Max 100 chars, sanitize HTML
- Photo uploads (future): Validate MIME type, file size, image dimensions

**4. XSS Prevention**:
- React escapes text by default (safe)
- Custom text rendered via `{text}`, not `dangerouslySetInnerHTML`
- If Markdown support added (V2), use sanitization library (DOMPurify)

**5. CSRF Protection**:
- Next.js API routes use `sameSite: lax` cookies by default
- V2 (authenticated): Add CSRF tokens for state-changing operations

**6. Rate Limiting**:
- Room creation: Max 5 rooms per IP per hour (prevent spam)
- Room join: Max 10 attempts per IP per minute (prevent enumeration)
- API routes: Use middleware to enforce limits (Vercel Rate Limiting or custom)

**7. Content Security Policy (CSP)**:
```http
Content-Security-Policy:
  default-src 'self';
  script-src 'self';
  style-src 'self' 'unsafe-inline'; /* Tailwind requires inline styles */
  img-src 'self' data: blob:; /* Allow canvas-generated images */
  media-src 'self' blob:; /* Allow camera MediaStream */
  connect-src 'self' wss://*.supabase.co; /* Supabase Realtime */
  frame-ancestors 'none';
```

**8. Environment Variable Security**:
- **Public** (exposed to browser):
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (limited access via RLS)
- **Private** (server-only):
  - `SUPABASE_SERVICE_ROLE_KEY` (full database access, server operations only)
  - `SESSION_CAPABILITY_SECRET` (signing/verifying session tokens)
  - `DATABASE_URL` (if direct connection needed)
- Never expose service role key or session secrets to client
- Use Vercel environment variables (encrypted at rest)

**9. Supabase Row-Level Security**:
- Enable RLS on all tables
- V1: Least privilege access (server-controlled mutations via service role)
- V2: User-scoped policies (only access own data)

### Authorization Boundaries

**V1 (No Authentication)**:
- Room access: Requires valid session capability token (issued on creation or join)
- Room discovery: Room code allows joining (subject to capacity and capability issuance)
- Editor access: Requires valid session capability for the room
- Download: Requires valid session capability for the room

**V2 (Authenticated Users)**:
- Room ownership: Creator can delete room
- Gallery access: Only owner can view/delete their photo strips
- Payment access: Only authenticated users can purchase premium content

### Secure Coding Practices

**SQL Injection Prevention**:
- Use parameterized queries (Supabase client handles this)
- Never concatenate user input into SQL strings

**Command Injection Prevention**:
- No shell commands executed with user input (not applicable in V1)

**Path Traversal Prevention**:
- No file system access with user-provided paths (not applicable in V1)

**Dependency Security**:
- Run `npm audit` regularly
- Update dependencies to patch known vulnerabilities
- Use Dependabot for automated security updates

---

## 9. Privacy Architecture

### Data Minimization

**V1 Principles**:
- Collect only what's necessary for functionality
- No user accounts → no email, password, name, or PII
- No analytics tracking in V1 (add in V1.5 with consent)
- No cookies except essential session cookies (Next.js)

**What We Store**:
- Room metadata (code, state, participant count, timestamps)
- Nothing else (no photos, no user identity, no IP addresses)

**What We Don't Store**:
- Captured photos (V1 capture/edit/download flow keeps photos client-side only)
- User identity (anonymous sessions)
- IP addresses (logs retained only for rate limiting, not persisted)
- Browser fingerprints (no tracking)

### Photo Handling

**V1 (No Server Storage)**:
- Photos captured via camera → stored as Blobs in browser memory
- Editor state (photos + edits) → React state, not uploaded to our servers
- Download → Canvas renders final image, downloads directly (no server intermediary)
- Session end → Photos discarded (garbage collected when component unmounts)
- **Privacy Boundary**: V1 capture/edit/download flow does not upload photos to our servers

**V1.5 (Optional Temporary Storage)**:
- Future feature: shareable links or session recovery would require explicit server storage
- This would introduce a different privacy model with explicit user consent
- If implemented: Photos stored in private bucket, deleted after 30 minutes
- Storage path tied to room UUID (unpredictable, not enumerable)

**V2 (Persistent Gallery)**:
- Users opt in to save photo strips to gallery (explicit consent)
- Gallery tied to authenticated user account
- User can delete photo strips anytime
- Provide data export (download all gallery photos)

### Data Deletion

**V1**:
- Room metadata expires after 30 minutes → Marked as expired
- Expired rooms deleted by cleanup job (run daily)
- No user action required (automatic deletion)

**V2**:
- User can delete their account → All associated data deleted (gallery, payment history)
- Provide "Delete My Data" button in account settings
- Cascade deletions (delete related records)

### Privacy & Legal Obligations

V1 minimizes personal data collection:
- Anonymous sessions (no user accounts, names, emails, or PII)
- Temporary room metadata only
- Photos remain client-side in V1

Applicable privacy and legal obligations (including but not limited to GDPR, CCPA, and children's privacy regulations) will be reviewed and addressed before public launch.

V2 will add appropriate privacy policies, consent mechanisms, data deletion flows, and compliance measures as required by applicable law.

### Third-Party Data Sharing

**V1**:
- No third-party analytics (Vercel logs only, not shared)
- No advertising networks
- No social media pixels

**V1.5+ (Future Candidates)**:
- May add privacy-respecting analytics (candidates: Plausible, Fathom)
- No user tracking across sessions

**V2+ (Future Candidates)**:
- Payment providers (candidates: Stripe, Razorpay) would receive minimal data (email, transaction amount)
- Print fulfillment partners (candidates: Printful, Gelato) would receive shipping address (explicit user consent)

---

## 10. Performance Architecture

### Client-Side Performance

**Image Optimization**:
- Capture photos at reasonable resolution (1920×1080, not 4K)
- Preview at lower resolution (800px width max)
- Final render at high resolution (2000px height) only on download
- Use `OffscreenCanvas` for rendering (if available, avoids blocking main thread)

**Canvas Performance**:
- Reuse canvas elements (don't recreate on every render)
- Debounce expensive operations (filter preview during slider drag)
- Avoid unnecessary redraws (memoize canvas operations)

**Asset Loading**:
- Lazy load sticker images (only load visible stickers)
- Preload critical assets (filter thumbnails, UI icons)
- Use `next/image` for static site images (logo, icons, marketing images) when appropriate
- Camera frames, captured blobs, canvas output, and editor-generated images use browser Blob/Canvas APIs directly

**Bundle Size**:
- Code splitting (route-based, load camera code only on camera route)
- Tree shaking (remove unused dependencies)
- Optional future candidate: `@next/bundle-analyzer` for bundle analysis
- Target: <200KB initial JS bundle, <500KB total

**React Performance**:
- React Compiler handles memoization automatically
- Avoid inline object/array creation in render (React Compiler optimizes this)
- Use `key` prop correctly in lists (stable IDs, not indexes)

**Memory Management**:
- Release media streams when leaving camera view (`track.stop()`)
- Release object URLs (`URL.revokeObjectURL()`)
- Clear large Blobs from state when no longer needed

### Network Performance

**Minimize API Calls**:
- Batch operations where possible
- Use Realtime subscriptions instead of polling (V1.5)
- Cache room state client-side (sessionStorage for non-sensitive UI state only, not authorization credentials)

**Optimize API Responses**:
- Return only necessary fields (exclude large payloads)
- Use HTTP/2 (enabled by default on Vercel)
- Enable compression (Vercel handles this)

**Supabase Performance**:
- Use connection pooling (Supabase default)
- Index frequently queried columns (`rooms.code`, `rooms.expires_at`)
- Avoid N+1 queries (fetch related data in single query)

### Loading States & Perceived Performance

**Skeleton Loaders**:
- Show skeleton UI immediately (matches final layout)
- Avoids layout shift (CLS metric)

**Optimistic UI**:
- Apply editor changes immediately (don't wait for server confirmation)
- Show photo thumbnail immediately after capture (before high-res processing)

**Progressive Enhancement**:
- Core functionality works without JavaScript (room landing page)
- Camera/editor requires JavaScript (show error if disabled)

**Perceived Speed**:
- Countdown feels intentional (not a loading delay)
- Transitions fast (<250ms)
- User always knows what's happening (loading indicators, progress bars)

### Mobile Performance

**Target Devices**:
- Modern smartphones (2020+, iOS 14+, Android 10+)
- Mid-range devices (not just flagship)

**Optimizations**:
- Reduce canvas resolution on low-end devices (detect via `navigator.deviceMemory`)
- Disable animations if `prefers-reduced-motion` or low-end device
- Compress images aggressively on mobile networks (detect via `navigator.connection.effectiveType`)

**Testing**:
- Test on real devices (not just Chrome DevTools emulation)
- Use Lighthouse mobile audits (target score >90)
- Monitor real-user performance (Core Web Vitals)

---

## 11. Extensibility & Future Architecture

### V1 Boundaries

**What V1 Does**:
- Anonymous room creation/joining
- Camera capture (4 photos)
- Client-side photo editing (filters, stickers, layouts)
- Client-side download (no server storage)
- Basic error handling

**What V1 Does NOT Do**:
- Authentication (no accounts, no login)
- Payment processing (fully free)
- AI features (no background removal, style transfer, etc.)
- Physical products (no print fulfillment)
- Persistent storage (no gallery, no saved sessions)
- Real-time collaboration (no synchronized editing)

### V1.5 Extensions

**Real-Time Collaboration**:
- Add Supabase Realtime channels for room state
- Broadcast editor changes (filter, stickers, layout)
- Presence indicators (online/offline participants)

**Session Recovery**:
- Upload photos to Supabase Storage temporarily
- Store editor state in database
- Allow rejoin after disconnect (restore photos + state)

**Enhanced Sharing**:
- Generate shareable view-only links
- Store final photo strip in Supabase Storage
- Add Open Graph metadata for link previews

### V2 Extensions (Authentication & Payments)

**Authentication**:
- Add Supabase Auth (email/password, OAuth providers)
- Require login for gallery, payments, premium features
- Keep anonymous room creation free (no auth required)

**Database Changes**:
```sql
-- Add users table
CREATE TABLE users (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  email TEXT UNIQUE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add gallery table
CREATE TABLE photo_strips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  room_id UUID REFERENCES rooms(id),
  storage_path TEXT NOT NULL,        -- Path in Supabase Storage
  metadata JSONB,                    -- Filter, layout, stickers used
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add payments table
CREATE TABLE purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,          -- Filter pack, subscription, etc.
  amount INTEGER NOT NULL,           -- Amount in cents
  currency TEXT NOT NULL,
  provider TEXT NOT NULL,            -- 'stripe' | 'razorpay'
  provider_transaction_id TEXT,
  status TEXT NOT NULL,              -- 'pending' | 'completed' | 'failed'
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Payment Integration**:
- Stripe for global payments (credit cards, Apple Pay, Google Pay)
- Razorpay for India (UPI, local cards, wallets)
- Webhook handlers for payment confirmation
- Never trust client-provided payment status (server-side verification only)

### V2 Extensions (AI Features)

**Potential AI Features**:
- Background removal (ML model, client-side or server-side)
- Style transfer (artistic filters powered by ML)
- Auto-enhancement (color correction, lighting adjustment)

**Architecture Considerations**:
- Run inference server-side (expensive, requires GPU)
- Future candidates: third-party APIs (Replicate, Hugging Face) or self-hosted models
- Limit to premium users (control costs)
- Queue-based processing (avoid blocking API responses)
- Provide progress updates (long-running operations)

**Cost Management**:
- AI inference is expensive (per-request cost)
- Implement usage quotas (e.g., 10 AI enhancements per month for premium users)
- Cache results (if same photo + same model, reuse output)

### V2 Extensions (Physical Products)

**Print Fulfillment** (Future Candidate):
- Integrate with print-on-demand API (candidates: Printful, Gelato)
- User places order → API sends to printer → printer ships directly
- No inventory management needed

**Database Changes**:
```sql
CREATE TABLE orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  photo_strip_id UUID REFERENCES photo_strips(id),
  product_type TEXT NOT NULL,        -- 'photo_strip' | 'poster' | 'stickers'
  quantity INTEGER DEFAULT 1,
  shipping_address JSONB NOT NULL,
  amount INTEGER NOT NULL,           -- Amount in cents
  status TEXT NOT NULL,              -- 'pending' | 'processing' | 'shipped' | 'delivered'
  fulfillment_provider TEXT,         -- 'printful' | 'gelato'
  tracking_number TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 12. Deployment & Infrastructure

### Hosting

**Vercel** (Recommended):
- Next.js optimized (automatic deployment, edge functions)
- Global CDN (fast asset delivery)
- Automatic HTTPS
- Preview deployments (test branches before merge)
- Environment variable management
- Web Analytics (privacy-friendly)

**Alternative**: Netlify, AWS Amplify (similar features)

### Database & Backend

**Supabase Cloud**:
- Managed PostgreSQL (automatic backups, scaling)
- Realtime infrastructure included
- Storage buckets (for V1.5+ photo storage)
- Edge Functions (if needed for serverless compute)

**Alternative**: Self-host Supabase (for control/cost optimization in V2+)

### Domain & DNS

- Custom domain (e.g., `photobooth.app`)
- DNS managed via Vercel or Cloudflare
- SSL/TLS certificates (automatic via Vercel/Cloudflare)

### Monitoring & Observability

**Error Tracking** (Future Candidate):
- Optional: Sentry or similar for exception monitoring, source maps
- Track client-side errors (camera failures, canvas errors)
- Track server-side errors (API route failures, database errors)

**Performance Monitoring**:
- Vercel Analytics (Core Web Vitals, real-user monitoring)
- Optional future candidate: Lighthouse CI for tracking performance regressions in PRs

**Logging**:
- Vercel logs (API route logs, build logs)
- Supabase logs (database queries, errors)
- No custom logging service needed in V1

**Uptime Monitoring** (Optional Future Candidate):
- Candidates: UptimeRobot, Checkly
- Monitor landing page, API routes, Supabase status

### Continuous Integration

**CI/CD** (Optional Future Candidate):

GitHub Actions or similar may be used for:
- Linting (`eslint`, `prettier`)
- Type checking (`tsc --noEmit`)
- Unit tests (if written)
- Build test (`next build`)
- Optional: Lighthouse CI for performance checks
- Auto-deploy to Vercel on merge to `main`

Not required for V1. Vercel provides automatic deployment on push.

---

## 13. Important Architectural Decisions

### Decision 1: Client-Side Photo Processing

**Decision**: All photo editing (filters, stickers, composition) happens in the browser using Canvas API. No server-side image processing in V1.

**Rationale**:
- **Privacy**: Photos never leave user's device
- **Performance**: No server round-trips for every edit (instant previews)
- **Cost**: Offloads compute to client devices (reduces server costs)
- **Simplicity**: No image processing infrastructure needed

**Trade-offs**:
- Client device performance matters (slow on low-end devices)
- Limited to browser capabilities (can't use server-side ML models in V1)
- Requires more client-side code (larger bundle size)

**Future**: V2 may add optional server-side processing for AI features (background removal, style transfer).

---

### Decision 2: No Authentication in V1

**Decision**: V1 is fully anonymous. No user accounts, login, or signup.

**Rationale**:
- **Reduce Friction**: Users can start immediately without signup
- **Faster MVP**: Authentication adds significant complexity (password reset, email verification, OAuth flows)
- **Validate Core Experience**: Prove product value before adding authentication overhead

**Trade-offs**:
- No persistent user data (no gallery, no saved rooms)
- No personalization (can't remember user preferences)
- Limits monetization (can't charge without accounts)

**Future**: V2 adds optional authentication (Supabase Auth). Anonymous usage remains free.

---

### Decision 3: Supabase as Backend Platform

**Decision**: Use Supabase (PostgreSQL + Realtime + Storage) instead of building custom backend or using Firebase.

**Rationale**:
- **PostgreSQL**: Industry-standard relational database (better than Firebase's NoSQL for our data model)
- **Realtime**: Built-in WebSocket infrastructure for V1.5 collaboration
- **Storage**: Object storage for V1.5+ photo persistence
- **Open Source**: Can self-host if needed (reduces vendor lock-in)
- **Developer Experience**: Excellent TypeScript SDK, auto-generated types

**Trade-offs**:
- Learning curve (PostgreSQL, RLS) vs Firebase's simpler API
- Cost (Supabase pricing vs alternatives)

**Alternatives Considered**:
- **Firebase**: Simpler but NoSQL model awkward for rooms/participants, vendor lock-in
- **Custom Backend**: More control but significantly more development time
- **PlanetScale**: Great for SQL but no Realtime or Storage (would need separate services)

---

### Decision 4: Native Browser APIs Over Libraries (Camera, Canvas)

**Decision**: Use native `getUserMedia`, Canvas API, and Web Storage instead of camera/image libraries.

**Rationale**:
- **Bundle Size**: Native APIs have zero bundle cost
- **Browser Support**: Modern browser APIs well-supported (>95% of users)
- **Control**: Full control over capture, rendering, export
- **Sufficient**: V1 features don't require advanced library capabilities

**Trade-offs**:
- More code to write (no abstraction layer)
- Browser inconsistencies (need to handle Safari quirks)

**When to Reconsider**: If V2 requires features like RAW photo processing, advanced video capture, or vector editing, evaluate libraries then.

---

### Decision 5: Temporary Room Expiration (30 Minutes)

**Decision**: Rooms expire after 30 minutes of inactivity. No indefinite room persistence.

**Rationale**:
- **Privacy**: Automatic cleanup prevents indefinite data retention
- **Cost**: Reduces database bloat (expired rooms deleted)
- **Product Model**: Photobooths are ephemeral experiences (like physical booths)

**Trade-offs**:
- Users can't return to old rooms (must create new ones)
- No room history or "favorites"

**Future**: V2 with authentication can allow persistent rooms/gallery.

---

### Decision 6: No Synchronized Editing in V1

**Decision**: V1 allows both participants to edit, but changes are not synchronized in real-time. Each user downloads their own version.

**Rationale**:
- **Simplicity**: Real-time sync adds significant complexity (conflict resolution, operational transforms)
- **Faster MVP**: Implement collaboration in V1.5 after core experience validated
- **Acceptable UX**: Users can coordinate via voice/video call (most use cases are in-person or one person leads editing)

**Trade-offs**:
- Less collaborative feel (not true "together" editing)
- Potential confusion (users may expect sync)

**Future**: V1.5 adds synchronized editing via Supabase Realtime.

---

### Decision 7: 4 Photos Fixed in V1

**Decision**: V1 captures exactly 4 photos. No customization (2, 6, 8 photos, etc.).

**Rationale**:
- **Classic Format**: 4 photos is the iconic photo strip format
- **Simplicity**: Fewer variables, easier to design layouts
- **Faster Development**: Don't need variable layout system in V1

**Trade-offs**:
- Less flexibility (some users may want more/fewer photos)
- Doesn't accommodate all use cases (solo portraits might prefer 1-2 photos)

**Future**: V1.5 or V2 could add photo count selection (but 4 remains default).

---

### Decision 8: Client-Side Download (No Server Storage in V1)

**Decision**: Final photo strip rendered in browser, downloaded directly. No upload to server.

**Rationale**:
- **Privacy**: Photos never leave user's device
- **Cost**: No storage costs
- **Simplicity**: No upload/download infrastructure needed

**Trade-offs**:
- No shareable links in V1 (users must share the downloaded image)
- No session recovery (if user closes tab, photos lost)

**Future**: V1.5 adds optional server storage for shareable links.

---

## 14. Summary

This architecture document defines:

1. **Technology Stack**: Next.js, React, TypeScript, Tailwind CSS, Supabase
2. **Frontend Architecture**: App Router structure, component patterns, state management
3. **Camera Architecture**: Native MediaDevices API, capture flow, resource management
4. **Photo Processing**: Client-side Canvas-based editing, filter/sticker/layout system
5. **Backend Architecture**: Next.js API routes, Supabase PostgreSQL + Realtime, minimal server logic
6. **Room Model**: Temporary anonymous rooms, expiration policy, state machine
7. **Security**: Input validation, rate limiting, RLS, environment variable handling
8. **Privacy**: Data minimization, no photo storage in V1, automatic cleanup
9. **Performance**: Client-side optimization, lazy loading, mobile-first approach
10. **Extensibility**: Clear boundaries for V1.5 (realtime, recovery) and V2 (auth, payments, AI)

**Key Architectural Principles**:
- Keep V1 simple (no authentication, no payments, no AI)
- Prefer client-side processing (privacy, performance, cost)
- Use native browser APIs (bundle size, control)
- Temporary data by default (privacy, simplicity)
- Secure by design (server-side validation, RLS, rate limiting)

**Next Steps**:
1. Initialize Next.js project with TypeScript, Tailwind, ESLint
2. Set up Supabase project and database schema
3. Implement landing page (create/join room)
4. Implement camera capture flow
5. Implement photo editor
6. Implement download flow
7. Deploy to Vercel
8. User testing and iteration

**This architecture is sufficient to build and ship V1.** V1.5 and V2 features can be added incrementally without major architectural changes.
