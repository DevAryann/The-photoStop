# Photobooth Visual Design Direction

**Product Identity**: Modern digital photobooth × nostalgic physical photo strip

**Target Feel**: Premium but playful, continuous session flow, Korean photobooth-inspired

---

## 1. Color Philosophy

### Foundation
- **Background**: Near-black atmospheric (`#0a0e14` / `hsl(210, 32%, 6%)`)
- **Surface**: Dark navy elevated surfaces (`#141b24` / `hsl(210, 28%, 11%)`)
- **Canvas**: Photo presentation area (`#1a2332` / `hsl(210, 28%, 15%)`)

### Accents
- **Primary (Blue)**: `#4a9eff` — actions, selected states, progress
- **Secondary (Pink/Red)**: `#ff4a7d` — highlights, CTAs, special moments
- **Tertiary (Soft Purple)**: `#9d7fff` — tertiary actions, badges

### Neutrals
- **Text Primary**: `#f5f7fa` (near-white, high contrast)
- **Text Secondary**: `#8a95a5` (muted, labels)
- **Text Tertiary**: `#4a5563` (disabled, placeholders)
- **Border**: `#2a3342` (subtle divisions)
- **Border Active**: `#3a4555` (hover, focus states)

### Semantic
- **Success**: `#4ade80` — capture success, upload complete
- **Warning**: `#fbbf24` — payment required, storage limit
- **Error**: `#f87171` — camera denied, upload failed
- **Info**: `#60a5fa` — tips, room codes

### Usage Rules
- Dark backgrounds create theatre-like focus on photos
- Thin borders (1px) in neutral tones for subtle structure
- Accent colors reserved for interactive elements and photos
- Never use accent colors for large background fills
- Photos are the primary visual element — UI recedes

---

## 2. Typography Direction

### Font Stack
```css
--font-body: system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-display: system-ui, -apple-system, 'Segoe UI', sans-serif;
--font-mono: 'SF Mono', Monaco, 'Cascadia Code', monospace;
```

### Type Scale
- **Display**: 48px / 56px (700) — hero moments only
- **H1**: 32px / 40px (700) — screen titles
- **H2**: 24px / 32px (600) — section headers
- **H3**: 18px / 28px (600) — subsections
- **Body**: 16px / 24px (400) — default text
- **Small**: 14px / 20px (400) — secondary labels
- **Caption**: 12px / 16px (500, uppercase, tracked) — tiny labels, room codes

### Styling Patterns
- **Labels**: 12px uppercase, 0.05em letter-spacing, 500 weight, secondary color
- **Room Codes**: monospace, slightly larger tracking
- **Countdown**: tabular-nums for alignment
- **Photo Metadata**: small, secondary color, subtle
- **Retro Details**: Use monospace sparingly for pixel-inspired elements (timers, counters)

### Rules
- Use font weight for hierarchy, not size jumps
- Small uppercase labels for UI chrome (filters, options)
- Body text rarely exceeds 60 characters width
- Generous line-height for readability (1.5–1.6)
- Avoid italic except for subtle emphasis

---

## 3. Spacing Philosophy

### Base Unit: 4px

### Scale
```
1 → 4px    (tight)
2 → 8px    (compact)
3 → 12px   (cozy)
4 → 16px   (comfortable, default inline)
6 → 24px   (roomy, default block)
8 → 32px   (spacious)
12 → 48px  (generous section)
16 → 64px  (large section)
24 → 96px  (screen padding)
```

### Application
- **Inline spacing**: 16px default (buttons, inputs)
- **Block spacing**: 24px default (stacked components)
- **Section spacing**: 48px (major sections)
- **Screen padding**: 24px mobile, 48px desktop
- **Photo grid gaps**: 8px (tight), 16px (comfortable)
- **Option selectors**: 12px between items

### Negative Space Philosophy
- Generous empty space emphasizes the photo as hero
- Center compositions with balanced margins
- Never cram — fewer elements with breathing room beats density

---

## 4. Border/Radius Philosophy

### Borders
- **Standard**: 1px solid `var(--border)`
- **Active/Hover**: 1px solid `var(--border-active)`
- **Accent**: 1px solid accent color (selected states)
- **None**: Photo containers (photos touch edges)

### Border Radius
- **Minimal**: 4px (small buttons, inputs, chips)
- **Standard**: 8px (cards, modals, panels)
- **Large**: 12px (photo containers, major surfaces)
- **Round**: 9999px (avatars, icon buttons, pills)

### Rules
- Subtle radius — avoid excessive rounding
- Photos get 12px radius for friendly feel
- UI controls get 4–8px for precision
- Thin borders, never thick outlines
- Use border sparingly — negative space preferred

---

## 5. Button Styles

### Primary
```
Background: Linear gradient (blue to pink, subtle)
Text: White (--text-primary)
Padding: 12px 24px
Border Radius: 8px
Font: 14px / 600 / uppercase / tracked
Hover: Brightness lift + subtle scale (1.02)
Active: Scale down (0.98)
```

### Secondary
```
Background: Transparent
Border: 1px solid --border-active
Text: --text-primary
Padding: 12px 24px
Hover: Border → accent color, subtle bg tint
```

### Ghost
```
Background: Transparent
Text: --text-secondary
Padding: 8px 16px
Hover: Text → --text-primary, subtle bg tint
```

### Icon Button
```
Size: 40×40px
Background: Transparent or subtle surface
Border Radius: 9999px (round)
Icon: 20×20px
Hover: Background tint + scale
```

### Capture Button (Special)
```
Size: 80×80px (large touch target)
Shape: Round
Background: Gradient or solid accent
Icon: Camera or countdown number
Pulse animation on idle
Press: Scale + haptic (if supported)
```

### Rules
- Touch targets minimum 44×44px
- Prominent CTAs use gradient or solid accent
- Disabled: 50% opacity + cursor not-allowed
- Loading: Spinner replaces text, button stays same size
- Avoid text-transform except small uppercase labels

---

## 6. Input Styles

### Text Input
```
Background: --surface (elevated)
Border: 1px solid --border
Padding: 12px 16px
Border Radius: 8px
Font: 16px (prevents iOS zoom)
Placeholder: --text-tertiary

Focus:
  Border → accent color
  Subtle glow (0 0 0 3px accent at 20% opacity)

Error:
  Border → error color
  Error message below (12px, error color)
```

### Select / Dropdown
```
Same as text input
Chevron icon right-aligned
Dropdown: Elevated surface, 8px radius, subtle shadow
Options: Hover background tint
```

### Checkbox / Radio
```
Size: 20×20px
Border: 2px solid --border-active
Border Radius: 4px (checkbox), 9999px (radio)
Checked: Accent fill + white checkmark/dot
Focus: Outline ring (accessibility)
```

### Slider / Range
```
Track: 4px height, --surface, rounded ends
Thumb: 20×20px circle, accent color, subtle shadow
Active: Scale thumb to 24×24px
```

### Rules
- Always pair label with input (accessibility)
- Error states immediately visible
- Focus states prominent for keyboard navigation
- Inputs stack vertically with 16px gap
- Group related inputs visually

---

## 7. Photo Presentation

### Photo Container
```
Aspect Ratio: Enforce (4:3 for capture, flexible for strips)
Border Radius: 12px
Background: --canvas (while loading)
Object Fit: Cover (no distortion)
Border: None (photo fills container edge-to-edge)
```

### Photo Grid
```
Gap: 8px (tight) or 16px (comfortable)
Layout: CSS Grid, responsive columns
Hover: Subtle lift (translateY(-2px)) + shadow
Selected: Accent border (2px) + slight scale
```

### Photo Strip Preview (Final Output)
```
Background: White (physical photo aesthetic)
Padding: 16px (photo border simulation)
Photos: Stacked vertically, equal height
Metadata Strip: Bottom, small uppercase text, centered
Shadow: Prominent drop shadow (physical object)
```

### Loading State
```
Skeleton: Animated gradient sweep (--surface to lighter)
Blur-up: Low-res preview → full quality fade-in
```

### Rules
- Photos are always the visual hero
- Maintain aspect ratio — never distort
- Use subtle shadows to lift photos off background
- Loading states feel fast (optimistic UI)
- Physical photo strip gets white borders + shadow for tactile feel

---

## 8. Selection Controls

### Horizontal Option Selector (Filters, Layouts, Themes)
```
Layout: Horizontal scroll, snap-aligned
Item: 80×80px (mobile) / 100×100px (desktop)
Gap: 12px
Border: 1px solid --border
Border Radius: 8px
Selected: Accent border (2px), subtle scale (1.05)
Hover: Border → --border-active
Label: Below item, 12px caption, centered
```

### Thumbnail Grid (Stickers, Backgrounds)
```
Layout: Responsive grid (3–4 columns mobile, 6–8 desktop)
Item: Square, flexible size
Selected: Accent border + checkmark badge
Hover: Lift + border change
```

### Toggle Group
```
Layout: Horizontal pills, connected
Item: Padding 8px 16px, transparent
Selected: Accent background, white text
Border: Shared 1px border between items
```

### Rules
- Touch-friendly sizing (minimum 44px targets)
- Visual feedback immediate (no delay)
- Selected state unmistakable (color + scale/border)
- Scroll indicators visible on overflow
- Labels always visible (not icon-only unless obvious)

---

## 9. Navigation

### Pattern: Fixed Bottom Bar (Mobile) / Sidebar (Desktop)

### Mobile Bottom Nav
```
Position: Fixed bottom
Background: --surface with backdrop blur
Height: 64px
Items: 3–5 icons + labels
Active: Accent color + slight scale
Shadow: Elevated above content
```

### Desktop Sidebar
```
Position: Fixed left
Width: 240px
Background: --background (darkest)
Padding: 24px
Items: Vertical stack, icon + label
Active: Accent border-left (3px) + background tint
```

### Progress Indicator (Multi-step Flow)
```
Position: Top, horizontal
Style: Thin line (2px) or dots
Active Step: Accent color
Completed: Success color
Upcoming: Muted
Animation: Smooth fill transition
```

### Rules
- Navigation never obscures photos
- Current step always visible
- Back action always accessible
- Progress indicator shows where user is in flow
- Mobile: bottom bar, desktop: sidebar or top minimal nav

---

## 10. Modal/Dialog Style

### Overlay
```
Background: rgba(10, 14, 20, 0.8) (dark scrim)
Backdrop Filter: blur(8px)
Animation: Fade in (200ms)
```

### Dialog
```
Background: --surface
Border Radius: 12px
Padding: 24px
Max Width: 480px (mobile: 90vw)
Shadow: Large elevated shadow
Animation: Fade + scale from 0.95
```

### Structure
```
Header: Title (H2) + close button (top-right icon)
Body: Content, comfortable line-height
Footer: Actions right-aligned, primary CTA right-most
Gap: 24px between sections
```

### Sheet (Mobile Alternative)
```
Position: Fixed bottom
Border Radius: 16px top corners only
Slide Up: Animation from bottom
Drag Handle: Centered pill (visual cue)
```

### Rules
- Click outside to dismiss (unless critical action)
- Escape key closes modal
- Focus trap within modal (accessibility)
- Mobile: prefer bottom sheets over center modals
- Always provide close button (explicit exit)

---

## 11. Loading States

### Skeleton Loader
```
Background: --surface
Overlay: Animated gradient sweep (--surface → lighter → --surface)
Border Radius: Match target component
Duration: 1.5s infinite
```

### Spinner
```
Size: 20px (inline), 40px (page-level)
Style: Circular, accent color, rotating arc
Animation: 0.8s linear infinite
```

### Progress Bar
```
Height: 4px
Background: --surface
Fill: Accent color gradient
Animation: Smooth width transition or indeterminate sweep
Position: Top of container or inline
```

### Photo Upload
```
Style: Circular progress ring around photo thumbnail
Percentage: Optional text overlay
Complete: Checkmark icon, success color flash
```

### Countdown (Photo Capture)
```
Size: Large (64px number)
Style: Tabular nums, bold, accent color
Animation: Scale pulse on each second
Sound: Optional beep/tick
```

### Rules
- Never block UI without showing progress
- Fast operations (<500ms): no spinner
- Optimistic UI: show success immediately, revert on error
- Skeleton matches final layout (prevents jarring shift)
- Countdowns prominent and clear (capture prep)

---

## 12. Empty States

### Pattern: Icon + Heading + Description + Action

### Visual Structure
```
Icon: 64×64px, secondary color, centered
Heading: H3, primary color, centered
Description: Body text, secondary color, centered, max 40ch
Action: Primary button, centered below
Spacing: 24px between elements
```

### Context-Specific Examples

**No Photos Captured Yet**
- Icon: Camera outline
- Text: "Ready to capture memories"
- Action: "Take your first photo"

**No Room Found**
- Icon: Search or room outline
- Text: "Room not found"
- Action: "Create a new room"

**No Stickers Selected**
- Icon: Sticker/star outline
- Text: "Make it fun"
- Action: Browse sticker library (horizontal scroll)

### Rules
- Friendly, encouraging tone
- Always provide clear next action
- Icon reflects context (not generic)
- Avoid long explanations
- Empty ≠ broken — make it inviting

---

## 13. Error States

### Toast Notification (Transient Errors)
```
Position: Top-center or bottom-center
Background: --surface with red accent border-left (4px)
Padding: 16px 20px
Border Radius: 8px
Shadow: Elevated
Duration: 4–6s (dismissible)
Icon: Error icon, error color
```

### Inline Error (Form Validation)
```
Position: Below input field
Text: 12px, error color
Icon: Small warning icon (optional)
Animation: Slide down + fade in
```

### Error Page (Critical Failures)
```
Layout: Centered content
Icon: 64×64px, error color
Heading: Clear error message (not "Error 500")
Description: What happened + what to do
Actions: Primary CTA (retry, go home)
Secondary: Contact support (if severe)
```

### Examples

**Camera Permission Denied**
- "Camera access is required"
- "Please enable camera permissions in your browser settings"
- Action: "Open settings guide" / "Try again"

**Upload Failed**
- "Photo upload failed"
- "Check your connection and try again"
- Action: "Retry upload"

**Room Full**
- "This room is full"
- "The maximum number of participants has been reached"
- Action: "Create a new room"

### Rules
- Explain what happened (not just "Error")
- Provide actionable next step
- Never blame the user
- Technical details in collapsed section (if needed)
- Toast for non-blocking, inline for forms, page for critical

---

## 14. Motion/Animation Principles

### Duration Scale
```
Instant: 0ms (no animation)
Fast: 150ms (hover, focus)
Standard: 250ms (transitions, reveals)
Slow: 400ms (page transitions, major state changes)
Very Slow: 600ms (capture countdown, special moments)
```

### Easing
```
Ease Out: Entering elements (ease-out, cubic-bezier(0, 0, 0.2, 1))
Ease In: Exiting elements (ease-in, cubic-bezier(0.4, 0, 1, 1))
Ease In-Out: State changes (ease-in-out, cubic-bezier(0.4, 0, 0.2, 1))
Spring: Playful interactions (consider for photo capture feedback)
```

### Animation Targets

**Hover/Focus**: Scale (1.02–1.05), brightness, border color
**Click/Press**: Scale down (0.98), then release
**Photo Capture**: Flash (white overlay fade), shutter sound, haptic
**Page Transition**: Fade + subtle slide (20px)
**Modal Open**: Fade overlay + scale dialog (0.95 → 1)
**Loading**: Skeleton sweep, spinner rotation, progress fill
**Success Moment**: Confetti (sparingly), checkmark scale + bounce
**Photo Strip Build**: Photos slide/stack in sequence

### Physical-Inspired Animations
- Photo slides into frame (like dropping into a slot)
- Photo strip prints down from top (sequential reveal)
- Stickers "stick" with slight bounce
- Countdown numbers flip/rotate (mechanical feel)

### Rules
- Respect `prefers-reduced-motion` (disable decorative animations)
- Animations enhance, never delay (fast defaults)
- Avoid animation on every element (creates chaos)
- Performance: GPU-accelerated properties only (transform, opacity)
- Special moments (capture, final preview) earn longer animations
- Never animate layout-shifting properties (width, height, top, left)

---

## 15. Responsive Behavior

### Breakpoints
```
Mobile: < 640px
Tablet: 640px – 1024px
Desktop: > 1024px
Large Desktop: > 1440px
```

### Layout Patterns

**Mobile (< 640px)**
- Single column
- Bottom navigation
- Full-width photos
- Horizontal scrolling option selectors
- Modals → bottom sheets
- Screen padding: 24px
- Camera: Full viewport (portrait)

**Tablet (640–1024px)**
- Two-column grids (where applicable)
- Side navigation (collapsible)
- Photo grid: 2–3 columns
- Increased spacing
- Screen padding: 48px
- Camera: Constrained to reasonable size

**Desktop (> 1024px)**
- Sidebar navigation
- Photo grid: 3–4 columns
- Horizontal tool palettes
- More generous spacing
- Screen padding: 64–96px
- Camera: Constrained center, tools on sides

### Responsive Rules
- Touch targets: 44×44px minimum (mobile)
- Font sizes: Fluid scale (clamp)
- Images: Responsive srcset for performance
- Navigation: Bottom bar (mobile) → sidebar (desktop)
- Modals: Bottom sheet (mobile) → centered dialog (desktop)
- Camera: Portrait (mobile) → landscape options (desktop)
- Never horizontal scroll for core content (only deliberate carousels)

### Container Queries (where supported)
- Use for component-level responsive (option selectors, photo grids)
- Allows components to adapt to their container, not just viewport

---

## 16. Accessibility Principles

### Keyboard Navigation
- All interactive elements focusable
- Focus indicator: 2px accent outline with 2px offset
- Tab order logical (top-to-bottom, left-to-right)
- Escape closes modals
- Enter/Space activates buttons
- Arrow keys navigate option selectors

### Screen Readers
- Semantic HTML (button, nav, main, section)
- Alt text on all photos (user-provided or "Photo {n}")
- ARIA labels on icon-only buttons
- ARIA live regions for dynamic content (countdown, upload progress)
- Skip links (skip to main content)

### Color & Contrast
- Text contrast: Minimum 4.5:1 (body), 3:1 (large text)
- Interactive elements: Minimum 3:1 against background
- Never rely on color alone (use icons, labels, patterns)
- Status colors paired with text/icons

### Motion & Animation
- Respect `prefers-reduced-motion`
- Disable decorative animations when set
- Keep essential transitions (instant instead of animated)

### Touch & Input
- Touch targets: 44×44px minimum
- Adequate spacing between interactive elements (8px+)
- Support for different input methods (mouse, touch, keyboard, stylus)

### Visual Affordances
- Buttons look clickable (not flat text)
- Links underlined or clearly distinguished
- Disabled states visually obvious (not just color)
- Interactive elements have hover/focus states

### Testing Checklist
- Tab through entire flow
- Test with screen reader (NVDA, JAWS, VoiceOver)
- Test at 200% zoom
- Test with high contrast mode
- Test keyboard-only navigation
- Test with reduced motion enabled

---

## 17. Component Visual Rules

### Cards
**Avoid unless necessary** — prefer borderless sections with spacing
- If used: Subtle border, 8–12px radius, minimal shadow
- No heavy shadows or excessive elevation
- Use sparingly (modals, elevated panels, photo containers)

### Lists
- Vertical stack, 16–24px gap
- Dividers: 1px border, optional (prefer spacing)
- Hover: Subtle background tint
- Active/selected: Accent border-left (3px) or background tint

### Badges/Pills
- Small (20–24px height), rounded (9999px)
- Background: Accent color or muted surface
- Text: 12px, 600 weight, white or primary text
- Use for counts, status, labels

### Avatars
- Round (9999px)
- Sizes: 32px (small), 40px (default), 64px (large)
- Fallback: Initials on accent background
- Border: Optional 2px white ring (on dark backgrounds)

### Dividers
- Use sparingly (spacing preferred)
- 1px, --border color
- Horizontal: full-width or inset 16px
- Vertical: Rare, use for tall side-by-side sections

### Tooltips
- Dark background (--surface + elevation), white text
- Small text (14px), comfortable padding (8px 12px)
- Border radius: 6px
- Arrow/pointer: Optional
- Delay: 500ms (not instant)
- Touch: Show on tap, dismiss on second tap or outside click

---

## 18. Things to Avoid

### Visual Antipatterns
❌ Generic SaaS dashboard aesthetic (big cards, lots of rounded corners)
❌ Excessive gradients (one accent gradient is enough)
❌ Rainbow colors (stick to defined palette)
❌ Heavy drop shadows everywhere (use subtly)
❌ Overly rounded corners (4–12px is plenty)
❌ Excessive borders (use spacing instead)
❌ Clutter (generous negative space always)
❌ Tiny touch targets on mobile (<44px)
❌ Long horizontal scrolls (except deliberate carousels)
❌ Automatic carousels (user-controlled only)

### Interaction Antipatterns
❌ Animations on every hover (distracting)
❌ Slow animations by default (respect user time)
❌ Hover-only controls on touch devices
❌ Modal on top of modal (flatten the flow)
❌ Disabled buttons with no explanation why
❌ Generic error messages ("Something went wrong")
❌ Blocking loading spinners with no progress indication
❌ Auto-play video/audio

### Layout Antipatterns
❌ Centered text for long paragraphs (hard to read)
❌ Justified text (creates awkward spacing)
❌ Tiny font sizes (<14px for body)
❌ All-caps for long text (labels only)
❌ Poor contrast (light gray on white)
❌ Overly wide text blocks (>80ch)
❌ Inconsistent spacing (use the scale)

### Component Antipatterns
❌ Icon-only buttons without tooltips
❌ Mystery meat navigation (unclear labels)
❌ Pagination when infinite scroll is better (or vice versa)
❌ Carousels for critical content (easy to miss)
❌ Too many font weights/sizes (stick to the scale)
❌ Mixing border styles (be consistent)
❌ Color-only status indicators (add icon/label)

### Content Antipatterns
❌ Lorem ipsum in production
❌ Technical jargon in user-facing errors
❌ Empty states with no action
❌ Vague button labels ("Click here", "Submit")
❌ No feedback after actions (silent failures)

---

## Summary

This design system prioritizes:

1. **Photos as hero** — UI recedes, photos take center stage
2. **Dark atmospheric aesthetic** — near-black backgrounds, subtle borders, accent pops
3. **Continuous flow** — smooth transitions, one session feel
4. **Playful premium** — tasteful motion, nostalgic details, polished states
5. **Accessible by default** — contrast, keyboard nav, screen readers, reduced motion
6. **Responsive everywhere** — mobile-first, touch-friendly, desktop-enhanced
7. **Performance-conscious** — optimistic UI, fast animations, efficient rendering
8. **Minimal but complete** — no unnecessary libraries, native browser features preferred

When designing new screens or components, return to this document to ensure consistency.

**Next Step**: Use this design system to build the photobooth interface incrementally, starting with the home/room creation flow.
