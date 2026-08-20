# Photobooth Product Specification

**Version**: 1.0  
**Last Updated**: 2026-08-20

---

## 1. Product Vision

### What It Is

A collaborative web photobooth that lets two people create personalized photo strips together in one continuous, playful session.

Users create or join a private room, capture a sequence of photos, customize them with filters and decorations in a unified editor, and download a polished photo strip—all without leaving the flow.

### What Makes It Different

**Continuous session experience**: The product feels like stepping into a physical photobooth booth, not navigating a multi-page web app. From landing to final download, the experience is a single cohesive flow.

**Unified customization**: Instead of separate pages for filters, stickers, backgrounds, themes, and layouts, users get one integrated photo editor that feels intuitive and playful.

**Collaborative by design**: Built from the ground up for two people to create memories together, whether they're in the same room or across the world.

**Modern meets nostalgic**: Inspired by Korean photobooth culture but with its own identity—premium digital interactions combined with the tactile charm of physical photo strips.

### Core Emotional Experience

- **Playful**: Fun, lighthearted, experimental—not serious or corporate
- **Intimate**: A shared creative moment between two people
- **Premium**: Polished, smooth, thoughtfully designed—not clunky or generic
- **Nostalgic**: Evokes the joy of physical photo strips and photobooth memories
- **Effortless**: The technology disappears; the experience flows naturally

---

## 2. Target Users

### Primary User

**Close relationships creating shared memories:**

- Couples (romantic partners, dating, engaged, married)
- Best friends
- Siblings
- Parent and child

**Characteristics:**
- Comfortable with web apps and mobile cameras
- Values personal, creative, shareable content
- Enjoys casual photo-taking but wants something more special than a selfie
- Appreciates thoughtful design and smooth experiences

**Context:**
- Celebrating moments (anniversaries, birthdays, reunions)
- Long-distance connections wanting to create something together
- In-person hangouts looking for a fun shared activity

### Secondary Use Cases

- Solo users experimenting with the product (capture alone, customize, share later)
- Small groups (future expansion—V1 limited to 2 participants)
- Content creators looking for unique photo strip aesthetics
- Event organizers embedding photobooths into gatherings (future B2B potential)

---

## 3. Core User Journey (V1)

### Step-by-Step Flow

**1. Landing Page**
- User arrives at the home page
- Clear value proposition: "Create photo strips together"
- Two primary actions: "Create Room" or "Join Room"

**2. Create Room**
- User clicks "Create Room"
- Room is instantly created with a unique shareable code
- User sees "Waiting for participant" state with room code displayed prominently
- Copy-to-clipboard and share options available

**3. Join Room**
- Second user either:
  - Clicks the shared link (direct entry)
  - Enters room code manually on landing page
- Joins the session instantly

**4. Camera Setup**
- Both participants request camera permissions (if not already granted)
- Camera preview appears for both users
- Brief onboarding prompt: "Ready to capture 4 photos?"
- Primary CTA: "Start Session"

**5. Photo Capture**
- Countdown (3-2-1) with clear visual and optional audio cues
- Shutter animation and haptic feedback (if supported)
- Photo captured and displayed as thumbnail
- Brief pause (1-2 seconds) before next countdown
- Repeat for 4 photos total
- Option to retake the entire sequence if participants aren't happy

**6. Review Photos**
- All 4 photos displayed in a grid
- Option to "Retake All" or "Continue to Editor"
- Quick, low-friction decision point

**7. Unified Photo Editor**
- Photos displayed in customizable layout preview
- Editing panel with tabs or sections:
  - **Filters**: Horizontal scrollable selector, real-time preview
  - **Stickers**: Grid of decorations to drag onto photos
  - **Backgrounds**: Color/pattern options for photo strip background
  - **Themes**: Pre-designed style packages (vintage, modern, playful)
  - **Layouts**: Arrangement of the 4 photos (vertical strip, grid, collage)
- Changes apply immediately with smooth transitions
- Users can iterate freely
- V1: Both participants share the same session (both can capture and edit)
- V1.5: Synchronized editing (both see live updates as the other person edits)

**8. Photo Strip Preview**
- Final preview of the completed photo strip
- Rendered with white border and metadata (date, optional custom text)
- Looks like a physical photo strip ready to download

**9. Download & Share**
- Primary CTA: "Download Photo Strip"
- High-quality image file (PNG or JPEG)
- Optional: Share link to view the result (no download required)
- Session complete confirmation
- Secondary CTA: "Create Another Room"

**10. Session End**
- User can create a new room or exit
- No account required (V1)
- No persistent gallery (V1)

---

## 4. V1 / MVP Features

### Core Features

**Landing Page**
- Clear hero section with product value
- "Create Room" button (primary action)
- "Join Room" input + button
- Simple navigation (optional: About, Help)

**Room Management**
- Generate unique room codes (short, memorable)
- Direct link sharing (URL includes room code)
- Room state: waiting / active / completed
- Maximum 2 participants per room
- Room expires after inactivity (e.g., 30 minutes idle)

**Camera Experience**
- Request camera permissions
- Live camera preview (front/back camera toggle on mobile)
- Countdown timer (3-2-1)
- Capture 4 photos in sequence
- Shutter animation and feedback
- Thumbnail preview of captured photos

**Photo Review**
- Display all 4 captured photos
- "Retake All" option (discards and restarts capture)
- "Continue to Editor" (proceeds to customization)

**Unified Photo Editor**
- Single integrated interface (not separate pages)
- Real-time preview of final photo strip
- Editing tools:
  - **Filters**: 8-12 curated filters (B&W, vintage, vibrant, etc.)
  - **Stickers**: 20-30 decorations (hearts, stars, text bubbles, doodles)
  - **Backgrounds**: 10-15 colors and patterns
  - **Themes**: 4-6 pre-designed style packages
  - **Layouts**: 4-6 arrangements (classic vertical strip, grid, collage variations)
- Drag-and-drop stickers onto photos
- Undo/redo support (nice-to-have for V1, essential for V1.5)

**Photo Strip Generation**
- Render final photo strip with:
  - Selected layout
  - Applied filters
  - Positioned stickers
  - Chosen background
  - White border (physical photo aesthetic)
  - Metadata strip: date, optional custom text
- High-quality output (2000px+ height for print quality)

**Download & Share**
- Download button (PNG or JPEG file)
- V1: Copy shareable link displays the room code for others to join
- V1.5: Shareable link to view completed photo strip (view-only, no editing, with Open Graph preview)

**Responsive Design**
- Mobile-first camera experience (portrait mode)
- Desktop-optimized editor (more screen space for tools)
- Touch-friendly controls on mobile
- Keyboard-navigable on desktop

**Loading, Empty, and Error States**
- Skeleton loaders for async content
- Empty state: "Waiting for participant"
- Error: Camera permission denied
- Error: Room not found
- Error: Room full (max participants reached)
- Error: Connection lost (graceful recovery)

**No Authentication Required (V1)**
- Anonymous sessions
- No sign-up, login, or account creation
- Rooms identified by code only

**No Payments (V1)**
- Fully free experience
- No premium features or paywalls

---

## 5. V1.5 Features

**Features to add immediately after MVP validation:**

### Real-Time Collaboration
- Live presence indicators (see when the other participant is online)
- Synchronized editor state (both users see filter/sticker changes in real-time)
- Participant cursors or activity indicators in editor

### Enhanced Sharing
- Generate shareable view-only links with Open Graph previews
- QR code for easy room joining (show on screen for in-person sharing)
- Optional: Download multiple formats (photo strip, individual photos, Instagram story format)

### Session Recovery
- Restore session if user refreshes or loses connection
- Save captured photos temporarily (browser storage or server-side)
- Re-join room after disconnect without losing progress

### Improved Editor UX
- Undo/redo stack (essential for collaborative editing)
- Sticker layering controls (bring forward, send back)
- Text tool (add custom text to photos or photo strip)
- Adjustable filter intensity (slider instead of on/off)

### Performance Optimizations
- Lazy-load sticker assets
- Optimize photo strip rendering (use canvas/WebGL)
- Compress uploaded photos (client-side before server upload if stored)

### Analytics
- Track basic usage: rooms created, photos captured, downloads completed
- Error tracking: camera failures, connection issues
- No user tracking or PII collection

---

## 6. V2 Features

**Features for future expansion (not MVP):**

### Authentication & Accounts
- Optional user accounts (email/password, OAuth)
- Login to access past sessions
- Persistent user profile

### User Gallery
- Personal gallery of past photo strips
- Organize by date, participants, or custom tags
- View, re-download, or re-edit past strips

### Premium Content
- Free tier: basic filters, stickers, layouts
- Premium tier:
  - Exclusive filters (film grain, advanced color grading)
  - Premium stickers (licensed illustrations, seasonal packs)
  - Premium layouts (magazine-style, artistic collages)
  - HD export (higher resolution)
  - Remove watermark (if we add one to free tier)

### Payments
- One-time purchases (unlock specific premium packs)
- Subscription model (monthly/yearly for full premium access)
- Regional pricing (adjust for local purchasing power)
- Payment providers: Stripe (global), Razorpay (India), Mercado Pago (LATAM)

### AI-Assisted Features
- AI background removal (replace photo backgrounds)
- AI style transfer (apply artistic styles to photos)
- AI sticker generation (generate custom stickers from text prompts)
- AI photo enhancement (automatic color correction, lighting adjustment)

### Physical Products
- Print and ship physical photo strips
- Print on demand: stickers, posters, photobooks
- Integration with print fulfillment services (Printful, Gelato)
- International shipping

### Advanced Features
- Multi-room support (users can manage multiple sessions)
- Room templates (pre-configured themes for events: weddings, birthdays)
- Animated photo strips (GIF or short video format)
- Music/audio overlay (add background music to animated strips)
- Group rooms (3+ participants, V2+ only)

### Social Features
- Public gallery (opt-in: users can publish strips to a public feed)
- Like, comment, share within the platform
- Follow favorite creators
- Trending photo strips

### Admin & Moderation
- Content moderation tools (flag inappropriate content)
- User reporting system
- Admin dashboard for monitoring platform health

### B2B / Events
- Embeddable photobooth widget for events
- Custom branding (white-label for corporate events)
- Event analytics (how many strips created, engagement metrics)
- Bulk pricing for event organizers

---

## 7. Features We Should NOT Build Yet

**Explicitly out of scope for MVP and early iterations:**

❌ **User accounts or authentication** (V1 is anonymous)  
❌ **Payments or monetization** (validate product-market fit first)  
❌ **AI features** (adds complexity, cost, and latency)  
❌ **Physical product fulfillment** (requires logistics, inventory, partnerships)  
❌ **Social feed or public gallery** (moderation burden, scope creep)  
❌ **Video capture** (focus on still photos first)  
❌ **Advanced photo editing** (crop, rotate, brightness/contrast sliders—keep it simple)  
❌ **Multi-language support** (start with English, expand later)  
❌ **Mobile native apps** (web-first, PWA if needed)  
❌ **Desktop app** (web is sufficient)  
❌ **Browser extensions** (unnecessary)  
❌ **API for third-party integrations** (no developer platform yet)  
❌ **Custom domains for users** (no hosted pages per user)  
❌ **Email notifications** (no emails in V1)  
❌ **SMS room invites** (too costly, use links instead)  
❌ **Blockchain/NFT features** (adds no value, distracts from core experience)  
❌ **Gamification** (points, badges, leaderboards—not the vibe)  
❌ **Chat or messaging** (users already have messaging apps)  

---

## 8. UX Principles

*Visual design is defined in `docs/DESIGN.md`. These are product-level UX principles.*

### Minimal Friction
- No sign-up or login required to use the product
- Room creation is instant (no forms, no configuration)
- Joining a room is one click or one code entry
- Camera permissions requested only when needed
- Every step has a clear primary action

### Photos Are the Hero
- UI recedes, photos take center stage
- Dark backgrounds emphasize the photos
- Editing tools enhance, never obscure
- Final photo strip is the star of the experience

### Continuous Flow
- Each step flows naturally to the next
- No jarring transitions or page reloads
- Progress is always visible
- User knows where they are and what's next
- Back actions are available but rarely needed

### Instant Feedback
- Every interaction has immediate visual response
- Filters preview in real-time
- Stickers drag smoothly
- Buttons respond on press (not after delay)
- Loading states are fast and optimistic

### Never Lose Captured Photos
- Photos persist through navigation and refreshes (V1.5)
- Clear confirmation before discarding photos
- "Retake All" is deliberate, not accidental
- Download is reliable and doesn't fail silently

### Clear Progress
- User always knows: current step, steps remaining, next action
- Progress indicator (dots, bar, or step labels)
- Completion celebrated (success moment, not just silent transition)

### Mobile-First Camera Experience
- Camera capture optimized for mobile (portrait orientation, large touch targets)
- Desktop camera works but mobile is the primary use case
- Touch-friendly controls throughout

### Graceful Recovery from Errors
- Errors explain what happened and what to do next
- Never blame the user
- Provide clear recovery actions (retry, skip, go back)
- No dead ends (always a way forward or back)

### Accessibility by Default
- Keyboard navigable
- Screen reader friendly
- High contrast text
- Respect `prefers-reduced-motion`
- Touch targets minimum 44×44px

### Performance Consciousness
- Fast load times (initial page <2s on 3G)
- Images optimized and lazy-loaded
- Editor interactions feel instant (<100ms feedback)
- No janky animations or sluggish UI

---

## 9. Room Model

### What Is a Room?

A room is a temporary collaborative session where up to 2 participants create a photo strip together.

### Room Properties (Product Perspective)

- **Unique identifier**: Short, memorable room code (e.g., "MOON-47", "STAR-92")
- **Capacity**: Maximum 2 participants
- **Lifecycle**: Active while participants are present, expires after 30 minutes of inactivity
- **Access**: Anyone with the room code or link can join (until capacity reached)
- **State**: Waiting → Active → Completed

### Creating a Room

- Any user can create a room (no account required)
- Room is created instantly (no form, no configuration)
- User receives:
  - Room code (displayed prominently)
  - Shareable link (includes room code in URL)
  - Copy-to-clipboard button
- User waits in "lobby" state until another participant joins

### Joining a Room

- User can join via:
  - Direct link (click shared URL)
  - Manual entry (type room code on landing page)
- If room is full (2 participants already), show "Room Full" error
- If room doesn't exist, show "Room Not Found" error
- If room is valid and has space, user joins immediately

### Room Lifecycle

1. **Created**: Room exists, waiting for participants
2. **Active**: 2 participants joined, session in progress (capturing photos, editing)
3. **Completed**: Photos downloaded, session ended
4. **Expired**: No activity for 30 minutes, room no longer joinable

### What Happens When Someone Disconnects?

**V1 (Simple behavior):**
- If a participant closes the tab or loses connection, they can rejoin using the same room code
- Captured photos are lost (no persistence in V1)
- The other participant sees "Participant disconnected" message
- Room remains active for 30 minutes, allowing reconnection

**V1.5 (Improved recovery):**
- Captured photos persist temporarily (server-side storage)
- Disconnected participant can rejoin and resume from where they left off
- Live presence indicators show connection status

### Participant Limits

**V1:** Exactly 2 participants per room (strict limit)

**Future:** Optionally support 3-4 participants (V2+), but 2 is the core experience

### Room Expiration

- Rooms expire after 30 minutes of inactivity
- Expired rooms are no longer joinable
- Captured photos and edits are deleted (no persistent storage in V1)
- Users are notified before expiration if still in the room (e.g., "5 minutes left")

---

## 10. Photo Session

### Number of Photos

**4 photos per session** (classic photo strip format)

V1 captures exactly 4 photos. The product model is conceptually extensible to support different photo counts (2-8 photos) in future versions, though 4 remains the classic format and likely default.

### Countdown

- **Duration**: 3 seconds (3-2-1)
- **Visual**: Large countdown number, centered, with scale animation
- **Audio**: Optional beep or tick sound (user can mute)
- **Preparation**: Brief "Get ready!" message before first countdown
- **Between photos**: 2-second pause before next countdown begins

### Capture Sequence

1. User clicks "Start Session" (after both participants are ready)
2. "Get ready!" prompt (2 seconds)
3. Countdown 3-2-1
4. Shutter animation (white flash overlay, camera shutter sound, haptic feedback)
5. Photo captured and displayed as thumbnail
6. Brief pause (2 seconds)
7. Repeat countdown for next photo
8. After 4 photos: "All done! Review your photos"

### Retake Behavior

**During capture:**
- No individual photo retake during the sequence (keeps flow simple)
- Users must complete all 4 photos before reviewing

**After capture:**
- "Retake All" button available during review step
- Discards all 4 photos and restarts capture from countdown 1
- Clear confirmation: "This will discard all photos. Are you sure?"

**In editor:**
- No retake option once editing begins (committed to these photos)
- V1.5: Consider allowing retake from editor with confirmation

### Review Behavior

**Review Screen:**
- All 4 photos displayed in grid
- Large, clear preview of each photo
- Two options:
  - "Retake All" (secondary action, confirmation required)
  - "Continue to Editor" (primary action)
- This is a quick decision point, not a lengthy review

### When Editing Becomes Available

- Editing becomes available immediately after user clicks "Continue to Editor"
- All 4 photos load into the editor
- Default layout, theme, and settings applied
- User can now iterate freely on filters, stickers, backgrounds, themes, layouts

### Photo Capture Technical Details (Product Perspective)

- Photos captured at reasonable resolution (1080p or higher)
- Aspect ratio: 4:3 (classic photo aspect ratio)
- Front camera default on mobile (selfie mode)
- Option to switch to back camera (icon button)
- Desktop: Uses webcam (front camera)

---

## 11. Photo Editor

**Core Principle:** The editor is a unified, continuous experience—not separate pages for each tool. All editing tools are accessible from a single view with the photo strip preview always visible.

### Editor Layout

- **Main Preview Area**: Live preview of the final photo strip (center or left side)
- **Editing Panel**: Tabbed or segmented controls (right side or bottom on mobile)
- **Quick Access**: Filters, Stickers, Backgrounds, Themes, Layouts accessible without leaving the view

### Filters

**What They Are:**
Pre-designed color grading and tonal adjustments applied to all 4 photos uniformly.

**Behavior:**
- Horizontal scrollable selector with thumbnail previews
- Hover/tap to see real-time preview on main photo strip
- Click/tap to apply
- Only one filter active at a time
- Option to remove filter (reset to original)

**V1 Filter List (8-12 options):**
- Original (no filter)
- B&W (classic black and white)
- Vintage (warm, faded, film-like)
- Cool Tone (blue/teal shift)
- Warm Tone (orange/yellow shift)
- High Contrast (punchy, vibrant)
- Soft (low contrast, dreamy)
- Sepia (brown-toned, nostalgic)
- Film Grain (add texture)
- Pastel (soft, desaturated colors)

**V1.5 Enhancement:**
- Adjustable filter intensity slider (0-100%)

### Stickers

**What They Are:**
Decorative graphics that can be placed, moved, resized, and rotated on individual photos or the overall photo strip.

**Behavior:**
- Grid of sticker thumbnails (scrollable, categorized)
- Click/tap to select a sticker
- Drag to place on photo strip
- Drag to reposition
- Pinch or drag corner to resize (mobile: pinch, desktop: drag handle)
- Rotate with two-finger twist (mobile) or rotate handle (desktop)
- Delete: Drag to trash icon or click delete button when selected
- Multiple stickers can be placed
- Stickers layer on top of photos

**V1 Sticker Categories (20-30 total):**
- Hearts (various styles)
- Stars
- Speech bubbles
- Doodles (hand-drawn style lines, shapes)
- Emojis (classic smiley, laugh, love, etc.)
- Frames (decorative borders around individual photos)
- Seasonal (generic, not holiday-specific in V1)

**V1.5 Enhancement:**
- Sticker layering controls (bring forward, send backward)
- Undo/redo for sticker placement

### Backgrounds

**What They Are:**
The background color or pattern behind the photo strip (the area surrounding the 4 photos).

**Behavior:**
- Horizontal scrollable selector with color/pattern swatches
- Click/tap to apply instantly
- Only one background active at a time

**V1 Background Options (10-15):**
- White (classic photo strip)
- Black
- Soft Gray
- Cream
- Light Blue
- Light Pink
- Pastel Yellow
- Subtle patterns: Dots, Stripes, Grid, Noise Texture

**V2 Enhancement:**
- Custom color picker
- Upload custom background image

### Themes

**What They Are:**
Pre-designed style packages that apply a coordinated set of filter, background, layout, and optional decorative elements.

**Behavior:**
- Horizontal scrollable selector with theme previews
- Click/tap to apply the entire theme
- Overrides current filter, background, and layout
- User can then tweak individual elements (filter, background, stickers) after applying theme

**V1 Theme Options (4-6):**
- Classic Strip (white background, no filter, vertical layout)
- Vintage Film (sepia filter, cream background, film grain texture)
- Modern Bold (high contrast filter, black background, grid layout)
- Soft Pastel (pastel filter, light pink background, soft layout)
- Retro Fun (vibrant filter, colorful pattern background, playful stickers pre-placed)
- Minimalist (B&W filter, white background, clean layout)

**V2 Enhancement:**
- Seasonal themes (holiday-specific)
- Premium themes (exclusive to paid users)

### Layouts

**What They Are:**
The spatial arrangement of the 4 photos within the photo strip.

**Behavior:**
- Horizontal scrollable selector with layout thumbnails
- Click/tap to apply instantly
- Only one layout active at a time

**V1 Layout Options (4-6):**
- Classic Vertical Strip (4 photos stacked vertically, equal size)
- Grid 2×2 (4 photos in a square grid)
- Horizontal Strip (4 photos side-by-side, equal size)
- Collage Offset (4 photos with varied sizes, overlapping slightly)
- Large + Small (1 large photo on top, 3 smaller below)
- Polaroid Style (photos tilted slightly, overlapping edges)

**V2 Enhancement:**
- Custom layout builder (drag photos to reposition)
- More complex collage options

### Editor Flow

1. User enters editor after photo review
2. Default state: Classic theme applied (white background, no filter, vertical layout)
3. User explores editing tools:
   - Switch between Filters, Stickers, Backgrounds, Themes, Layouts
   - Changes apply instantly with smooth transitions
4. User iterates freely (no save button, changes are live)
5. When satisfied, clicks "Preview" or "Done"
6. Moves to final preview step

### Real-Time Collaboration (V1.5)

- Both participants see the same photo strip preview
- One user applies a filter → other user sees it update live
- Sticker placement is synchronized
- Activity indicators show who is currently editing

### Performance

- Filter previews are fast (apply to preview-size images, not full-res)
- Final render happens only when user downloads (high-quality export)
- Sticker assets lazy-loaded
- Smooth 60fps interactions (drag, zoom, rotate)

---

## 12. Final Result

### Photo Strip

**What It Is:**
The final composed image containing all 4 photos, applied filters, placed stickers, chosen background, and layout—rendered as a single high-quality image file.

**Appearance:**
- Mimics a physical photo strip
- White border around the entire strip (16-24px padding)
- Photos arranged in selected layout
- Background visible behind/between photos (if layout allows)
- Stickers rendered on top of photos
- Metadata strip at bottom: date, optional custom text (e.g., "Summer 2026")

**Technical Specs (Product Perspective):**
- High resolution: 2000px+ height for print quality
- Format: PNG (lossless, supports transparency) or JPEG (smaller file size)
- Aspect ratio: Depends on layout (classic vertical strip ≈ 2:5 ratio)

### Preview

**Before Download:**
- Full-screen preview of the final photo strip
- Rendered exactly as it will be downloaded
- Option to go back to editor ("Edit More")
- Primary CTA: "Download Photo Strip"
- Secondary CTA: "Share Link" (V1.5)

**Preview Screen Elements:**
- Large preview (centered, scrollable if tall)
- Download button (prominent, primary action)
- Share button (secondary)
- "Create Another Room" button (tertiary)

### Download

**Behavior:**
1. User clicks "Download Photo Strip"
2. High-quality render happens (may take 1-2 seconds)
3. Progress indicator shown ("Generating your photo strip...")
4. File downloads automatically to user's device
5. Success message: "Photo strip downloaded!"
6. File naming: `photobooth-{date}-{room-code}.png`

**Technical Details (Product Perspective):**
- No watermark in V1 (fully free)
- Download initiates immediately (no account or email capture)
- Works on mobile and desktop (saves to Downloads folder or Photos app)

### Sharing

**V1 (Basic):**
- Copy shareable link button
- Link opens a view-only page showing the final photo strip
- No editing, no download from shared link (directs viewer to create their own room)

**V1.5 (Enhanced):**
- Shareable link includes Open Graph preview (shows photo strip in link preview)
- QR code for easy mobile sharing
- Download available from shared link
- Social media share buttons (Twitter, Instagram, Facebook)

**V2 (Advanced):**
- Share to public gallery (opt-in)
- Embed code for blogs/websites

### Session Completion

**After Download:**
- "Session complete!" confirmation
- Option to download again (re-downloads same file)
- "Create Another Room" button (start fresh session)
- "View Photo Strip" button (see downloaded file in preview)

**What Happens to the Room?**
- Room remains accessible for 30 minutes (allows re-downloading)
- After 30 minutes: room expires, photos deleted (V1 has no persistent storage)
- V2: If authenticated, session is saved to user's gallery

### No Account Required (V1)

- Download happens without sign-up
- No email capture or forced account creation
- Fully anonymous experience

---

## 13. Future Monetization Direction

*Payments and monetization are NOT part of V1. This section describes the future business model.*

### Free Experience (Forever)

**What Remains Free:**
- Create unlimited rooms
- Capture photos
- Basic filters (6-8 options)
- Basic stickers (15-20 options)
- Basic layouts (3-4 options)
- Download photo strips (standard resolution)
- Share links

### Premium Digital Features (V2+)

**One-Time Purchases:**
- Unlock specific premium filter packs ($0.99-$1.99)
- Unlock exclusive sticker collections ($0.99-$2.99)
- Unlock advanced layouts ($0.99)

**Subscription (Monthly/Annual):**
- **Price Range:** $2.99/month or $19.99/year (adjust based on market)
- **Includes:**
  - All premium filters, stickers, and layouts
  - HD/Ultra HD exports (higher resolution)
  - Remove watermark (if we add one to free tier in future)
  - Priority rendering (faster downloads)
  - Access to new features first (beta access)
  - Cloud gallery (save all photo strips, unlimited storage)
  - Advanced editing tools (text, drawing, AI features)

### Regional Pricing

- Adjust pricing based on local purchasing power
- Examples:
  - US: $2.99/month
  - India: ₹99/month (~$1.20)
  - Brazil: R$5.99/month (~$1.20)
  - Europe: €2.99/month
- Use payment providers that support regional pricing (Stripe, Paddle)

### Global Payment Providers

**Primary:** Stripe (global coverage, supports 135+ currencies)

**Regional Providers:**
- **India:** Razorpay (UPI, local cards, wallets)
- **Latin America:** Mercado Pago (local payment methods)
- **Southeast Asia:** Consider PayPal, Stripe local methods

**Payment Methods:**
- Credit/debit cards (Visa, Mastercard, Amex)
- Digital wallets (Apple Pay, Google Pay, PayPal)
- Regional methods (UPI, Alipay, local bank transfers)

### Potential Physical Products (V2+)

**Print & Ship Photo Strips:**
- User can order physical photo strips printed and mailed
- Price: $5-$10 per strip (depending on size, shipping)
- Fulfillment via print-on-demand services (Printful, Gelato)
- International shipping supported

**Other Physical Products:**
- Magnets (photo strip as fridge magnet)
- Stickers (photo strip as sticker sheet)
- Posters (large format prints)
- Photobooks (collections of photo strips)

**Logistics:**
- Partner with print-on-demand services (no inventory needed)
- User places order, we send to printer, printer ships directly
- Revenue share with fulfillment partner

### Monetization Principles

- Free tier is generous and fully functional (not a "trial")
- Premium features enhance the experience but aren't required
- No dark patterns (no hiding the download button, no forced upgrades)
- Transparent pricing (no hidden fees)
- Regional affordability (adjust pricing for local markets)
- Ethical monetization (no pay-to-unlock-your-own-photos schemes)

### Revenue Goals (Future)

**Target Conversion:**
- 2-5% of users convert to paid (industry standard for freemium)
- Higher conversion from returning users (authenticated accounts)

**Revenue Streams (Priority Order):**
1. Subscriptions (recurring revenue, highest priority)
2. One-time premium content purchases
3. Physical product orders (lower margin, but adds value)

---

## 14. Success Criteria

**How do we know V1 is successful?**

### User-Facing Success Metrics

1. **Users can complete the entire flow without getting stuck**
   - Create room → join room → capture photos → edit → download
   - No dead ends, no confusing states
   - Measured by: completion rate (% of users who download a photo strip)

2. **The experience feels smooth and playful**
   - Subjective but observable through user feedback
   - Smooth transitions, no jank, no confusing UI
   - Measured by: qualitative user testing, feedback surveys

3. **Captured photos look good in the final photo strip**
   - Filters, layouts, and stickers enhance (not distract)
   - Downloaded photo strips are shareable-quality
   - Measured by: user satisfaction, re-use rate

4. **Mobile camera experience works reliably**
   - Camera permissions granted without friction
   - Photos captured without quality issues
   - Works on iOS Safari, Android Chrome
   - Measured by: camera success rate, error logs

5. **Users want to create multiple photo strips**
   - If the experience is good, users will return or share with others
   - Measured by: returning users, multiple rooms per user, shares

### Technical Success Metrics

1. **Page load speed <2 seconds on mobile (3G)**
2. **Camera capture success rate >95%** (permission granted → photo captured)
3. **Download success rate >98%** (user clicks download → file received)
4. **No data loss during normal operation** (captured photos never lost due to bugs)
5. **Works on 90%+ of modern browsers** (Chrome, Safari, Firefox, Edge)

### Engagement Success Metrics (Hypotheses)

These are initial hypotheses to be validated, not established targets:

1. **50%+ of users complete the entire flow** (land → download)
2. **20%+ of users share the room link** (indicates collaborative usage)
3. **10%+ of users create a second room** (indicates repeat usage)
4. **Avg time in editor >2 minutes** (indicates users are customizing, not just downloading defaults)

### Qualitative Success

- Users describe the experience as "fun", "smooth", "easy", "playful"
- Users share their photo strips on social media organically
- Users recommend the product to friends
- Low confusion/support requests (product is self-explanatory)

### Validation for Next Phase (V1.5 / V2)

- Sustained usage over 2-4 weeks (not just launch spike)
- Evidence of organic sharing (users sharing room links, downloading strips)
- Positive user feedback (surveys, testimonials, social mentions)
- Technical stability (low error rates, fast performance)

If these criteria are met, proceed to V1.5 (real-time collaboration, session recovery) and then V2 (authentication, monetization).

---

## 15. Out of Scope

**Things that should NOT be implemented during MVP:**

### Not in V1

❌ User accounts, authentication, login/sign-up  
❌ Persistent user gallery or saved sessions  
❌ Payments, subscriptions, or premium features  
❌ Physical product ordering  
❌ AI features (background removal, style transfer, etc.)  
❌ Video capture or animated photo strips  
❌ Audio/music overlay  
❌ Advanced photo editing (crop, rotate, brightness/contrast sliders)  
❌ Text tool (custom text overlays—V1.5)  
❌ Undo/redo (V1.5)  
❌ Real-time collaboration (synchronized editing—V1.5)  
❌ Session recovery (rejoin after disconnect—V1.5)  
❌ Multi-language support  
❌ Email or SMS notifications  
❌ Social feed or public gallery  
❌ Content moderation or reporting tools  
❌ Analytics dashboard for users  
❌ Admin panel  

### Not in V1.5

❌ Payments or monetization  
❌ Physical products  
❌ AI features  
❌ Video capture  
❌ Social feed  
❌ Multi-language support  

### Not in V2 (Long-Term Out of Scope)

❌ Blockchain/NFT/Web3 features  
❌ In-app messaging or chat (users have messaging apps already)  
❌ Gamification (points, badges, leaderboards—not the vibe)  
❌ Live streaming or video calls (out of scope for photobooth product)  
❌ Desktop native app (web is sufficient)  
❌ Browser extensions  
❌ API for third-party developers (no developer platform planned)  
❌ White-label or self-hosted versions (unless B2B pivot)  

### Why These Are Out of Scope

**User accounts / authentication:**
- Adds friction to V1 (user must sign up before using)
- Not needed for core experience (rooms work anonymously)
- Add in V2 when monetization and gallery features justify it

**Payments / monetization:**
- V1 must validate product-market fit first
- Introducing payments too early adds complexity, legal requirements, support burden
- Free experience proves value before asking users to pay

**AI features:**
- Complex to implement, slow to run, expensive to host
- Not essential to core photobooth experience
- Add in V2 as premium features if demand exists

**Physical products:**
- Requires logistics, fulfillment partners, inventory management
- High support burden (shipping issues, print quality complaints)
- V2+ once digital product is successful

**Video capture:**
- Different product (not a photobooth anymore)
- More technically complex (large files, slower processing)
- Consider as separate feature in V3+ if demand exists

**Social feed / public gallery:**
- Requires content moderation (manual or automated)
- Risk of inappropriate content
- Legal and safety concerns
- V2+ once core product is stable and we have moderation systems

**Multi-language support:**
- Adds translation overhead, testing complexity
- V1 targets English-speaking users first
- Expand to additional languages in V2 based on user geography

---

## Summary

This product specification defines:

1. **Vision**: Collaborative web photobooth with continuous session flow
2. **Users**: Close relationships creating shared memories
3. **Journey**: Create room → join → capture 4 photos → unified editor → download photo strip
4. **V1 Features**: Core anonymous session flow, camera capture, unified editor, download/share
5. **V1.5 Features**: Real-time collaboration, session recovery, enhanced sharing
6. **V2 Features**: Authentication, gallery, payments, premium content, AI, physical products
7. **Out of Scope**: Features that add complexity without validating core experience first
8. **UX Principles**: Minimal friction, continuous flow, photos as hero, instant feedback
9. **Success Criteria**: Completion rate, user satisfaction, technical reliability, repeat usage

**Next Steps:**

1. Review this document with stakeholders
2. Create technical architecture plan (database, hosting, APIs)
3. Design high-fidelity mockups based on `DESIGN.md`
4. Implement V1 incrementally (room creation → camera → editor → download)
5. User testing and iteration
6. Launch V1, validate success criteria
7. Plan V1.5 and V2 based on learnings

---

*This is a living document. Update as product evolves.*
