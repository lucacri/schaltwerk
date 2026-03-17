# Fix Settings UI Consistency

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix ugly/broken UI in Agent Configuration and AI Generation settings sections to match existing settings patterns.

**Architecture:** Pure CSS/className fixes — align all new settings sections with the established patterns used by terminal, appearance, and session settings sections.

**Tech Stack:** React, Tailwind CSS, CSS custom properties

---

### Task 1: Add standard wrapper to Agent Configuration page

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx:2842-2849`

**Step 1: Add the scrollable container wrapper**

Change the `agentConfiguration` case from:
```tsx
case 'agentConfiguration':
    return (
        <div className="space-y-8">
            <AgentVariantsSettings onNotification={showNotification} />
            <AgentPresetsSettings onNotification={showNotification} />
            <ContextualActionsSettings onNotification={showNotification} />
        </div>
    )
```

To:
```tsx
case 'agentConfiguration':
    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-8">
                    <AgentVariantsSettings onNotification={showNotification} />
                    <AgentPresetsSettings onNotification={showNotification} />
                    <ContextualActionsSettings onNotification={showNotification} />
                </div>
            </div>
        </div>
    )
```

**Step 2: Run `just test` and verify pass**

**Step 3: Commit**

```
fix: add standard scrollable wrapper to agent configuration settings
```

---

### Task 2: Fix typography in AgentVariantsSettings

**Files:**
- Modify: `src/components/settings/AgentVariantsSettings.tsx`

**Step 1: Replace section header**

Change:
```tsx
<h3 className="text-text-primary" style={{ fontSize: 'var(--font-heading)' }}>
```
To:
```tsx
<h3 className="text-body font-medium text-text-primary">
```

**Step 2: Replace description paragraph**

Change:
```tsx
<p className="text-text-muted" style={{ fontSize: 'var(--font-caption)' }}>
```
To:
```tsx
<p className="text-caption text-text-tertiary">
```

**Step 3: Replace all inline fontSize styles with appropriate Tailwind classes**

All `style={{ fontSize: 'var(--font-body)' }}` → remove style, use `text-body` class
All `style={{ fontSize: 'var(--font-caption)' }}` → remove style, use `text-caption` class

Replace compound styles like:
```tsx
style={{ fontSize: 'var(--font-body)', fontFamily: 'var(--font-family-mono)' }}
```
With:
```tsx
className="... text-body font-mono"
```
(remove the style prop)

**Step 4: Replace `text-text-muted` on labels with `text-text-secondary`**

Labels should use `text-text-secondary` to match terminal/appearance settings pattern.

**Step 5: Run `just test` and verify pass**

**Step 6: Commit**

```
fix: align AgentVariantsSettings typography with settings patterns
```

---

### Task 3: Fix typography in AgentPresetsSettings

**Files:**
- Modify: `src/components/settings/AgentPresetsSettings.tsx`

Same changes as Task 2 — replace all inline fontSize styles with Tailwind classes, align label colors.

**Step 1: Apply identical typography fixes as Task 2**

**Step 2: Run `just test` and verify pass**

**Step 3: Commit**

```
fix: align AgentPresetsSettings typography with settings patterns
```

---

### Task 4: Fix typography in ContextualActionsSettings

**Files:**
- Modify: `src/components/settings/ContextualActionsSettings.tsx`

Same changes as Task 2.

**Step 1: Apply identical typography fixes as Task 2**

**Step 2: Run `just test` and verify pass**

**Step 3: Commit**

```
fix: align ContextualActionsSettings typography with settings patterns
```

---

### Task 5: Add themed select styling via CSS

**Files:**
- Modify: `src/index.css` (after settings-btn section)

**Step 1: Add a themed select class**

Add after the `.settings-binary-item` block:

```css
/* Settings select styling */
.settings-select {
  appearance: none;
  -webkit-appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 0.75rem center;
  padding-right: 2.5rem;
}
```

**Step 2: Apply `.settings-select` class to all `<select>` elements in:**
- `AgentVariantsSettings.tsx`
- `AgentPresetsSettings.tsx`
- `ContextualActionsSettings.tsx`
- `SettingsModal.tsx` renderGenerationSettings (the agent select)

**Step 3: Run `just test` and verify pass**

**Step 4: Commit**

```
fix: add themed select styling to replace browser defaults
```

---

### Task 6: Fix hardcoded border colors in renderGenerationSettings

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx:2470-2626`

**Step 1: Replace all `border-white/10` with `border-border-subtle`**

Four occurrences in renderGenerationSettings:
- Line ~2520 (CLI args input)
- Line ~2577 (name prompt textarea)
- Line ~2616 (commit prompt textarea)

Also fix the generation select background from `bg-bg-elevated` to `bg-bg-tertiary` for consistency.

**Step 2: Run `just test` and verify pass**

**Step 3: Commit**

```
fix: replace hardcoded border colors with themed variables in generation settings
```

---

### Task 7: Fix hardcoded border colors in renderTerminalSettings

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx:2344-2468`

**Step 1: Replace all `border-white/10` with `border-border-subtle`**

Three occurrences in renderTerminalSettings:
- Line ~2359 (shell path input)
- Line ~2377 (shell args input)
- Line ~2437 (command prefix input)

**Step 2: Run `just test` and verify pass**

**Step 3: Commit**

```
fix: replace hardcoded border colors with themed variables in terminal settings
```

---

### Task 8: Fix hardcoded border colors in renderAppearanceSettings

**Files:**
- Modify: `src/components/modals/SettingsModal.tsx:2113-2343`

**Step 1: Replace all `border-white/10` with `border-border-subtle`**

Affects font family input and checkboxes.

**Step 2: Run `just test` and verify pass**

**Step 3: Commit**

```
fix: replace hardcoded border colors with themed variables in appearance settings
```

---

### Task 9: Final validation

**Step 1: Run `just test` — all must pass**

**Step 2: Verify visual consistency** — all settings sections should now use:
- `flex flex-col h-full` + `overflow-y-auto p-6` wrapper
- `text-body font-medium text-text-primary` for section headers
- `text-caption text-text-tertiary` for descriptions
- `text-body text-text-secondary` for labels
- `bg-bg-tertiary border-border-subtle` for all inputs/selects/textareas
- `settings-select` class on all select elements
