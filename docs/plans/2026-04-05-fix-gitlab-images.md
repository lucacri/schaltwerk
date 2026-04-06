# Fix GitLab Images in Issue/Spec Display

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make images from private GitLab repos load in specs and issue details by proxying them through the backend with authentication.

**Architecture:** Add a `forge_proxy_image` Tauri command that fetches images using the GitLab token (obtained via `glab auth token`). The `MarkdownRenderer` gets optional forge context props and a custom `img` component that calls the proxy for GitLab URLs. Relative URLs (`/uploads/...`) get resolved to absolute URLs using the hostname and project identifier.

**Tech Stack:** Rust (Tauri command, shell `curl`), TypeScript/React (MarkdownRenderer, custom img component)

---

### Task 1: Add `get_auth_token` to `GitlabCli`

**Files:**
- Modify: `src-tauri/src/domains/git/gitlab_cli.rs`

**Step 1: Write the failing test**

Add to the test module in `gitlab_cli.rs`:

```rust
#[test]
fn get_auth_token_returns_token_on_success() {
    let runner = MockCommandRunner::new(vec![MockOutput {
        status: Some(0),
        stdout: "glpat-xxxxxxxxxxxxxxxxxxxx\n".to_string(),
        stderr: String::new(),
    }]);
    let cli = GitlabCli::with_runner(runner);
    let token = cli.get_auth_token(Some("gitlab.example.com")).unwrap();
    assert_eq!(token, "glpat-xxxxxxxxxxxxxxxxxxxx");
}

#[test]
fn get_auth_token_returns_error_on_failure() {
    let runner = MockCommandRunner::new(vec![MockOutput {
        status: Some(1),
        stdout: String::new(),
        stderr: "no token found".to_string(),
    }]);
    let cli = GitlabCli::with_runner(runner);
    let result = cli.get_auth_token(Some("gitlab.example.com"));
    assert!(result.is_err());
}
```

**Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo nextest run get_auth_token`
Expected: FAIL — method does not exist

**Step 3: Write minimal implementation**

Add to `impl<R: CommandRunner> GitlabCli<R>`:

```rust
pub fn get_auth_token(
    &self,
    hostname: Option<&str>,
) -> Result<String, GitlabCliError> {
    let mut args_vec = vec!["auth".to_string(), "token".to_string()];
    if let Some(host) = hostname {
        args_vec.push("--hostname".to_string());
        args_vec.push(host.to_string());
    }

    let env = [("GLAB_NO_PROMPT", "1"), ("NO_COLOR", "1")];
    let arg_refs: Vec<&str> = args_vec.iter().map(|s| s.as_str()).collect();
    let output = self
        .runner
        .run(&self.program, &arg_refs, None, &env)
        .map_err(map_runner_error)?;

    if !output.success() {
        return Err(command_failure(&self.program, &args_vec, output));
    }

    let token = output.stdout.trim().to_string();
    if token.is_empty() {
        return Err(GitlabCliError::InvalidOutput(
            "glab auth token returned empty output".to_string(),
        ));
    }
    Ok(token)
}
```

**Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo nextest run get_auth_token`
Expected: PASS

---

### Task 2: Add `forge_proxy_image` Tauri command

**Files:**
- Create: `src-tauri/src/commands/forge_image_proxy.rs`
- Modify: `src-tauri/src/commands/mod.rs` — add `pub mod forge_image_proxy;`
- Modify: `src-tauri/src/main.rs` — register command

**Step 1: Write the command**

Create `src-tauri/src/commands/forge_image_proxy.rs`:

```rust
use base64::Engine;
use log::{debug, error};

use crate::domains::git::gitlab_cli::GitlabCli;
use crate::domains::git::repository::ForgeType;

#[tauri::command]
pub async fn forge_proxy_image(
    image_url: String,
    forge_type: String,
    hostname: Option<String>,
) -> Result<String, String> {
    if forge_type != "gitlab" {
        return Err("Image proxy only supported for GitLab".into());
    }

    let cli = GitlabCli::new();
    let token = cli
        .get_auth_token(hostname.as_deref())
        .map_err(|e| format!("Failed to get GitLab token: {e}"))?;

    debug!("[forge_proxy_image] Fetching image: {image_url}");

    let output = std::process::Command::new("curl")
        .args([
            "-sS",
            "-L",
            "--max-time",
            "15",
            "-H",
            &format!("PRIVATE-TOKEN: {token}"),
            &image_url,
        ])
        .output()
        .map_err(|e| format!("Failed to run curl: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("[forge_proxy_image] curl failed: {stderr}");
        return Err(format!("Image fetch failed: {stderr}"));
    }

    let content_type = infer_content_type(&image_url);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&output.stdout);
    Ok(format!("data:{content_type};base64,{b64}"))
}

fn infer_content_type(url: &str) -> &str {
    let lower = url.to_lowercase();
    if lower.ends_with(".png") {
        "image/png"
    } else if lower.ends_with(".gif") {
        "image/gif"
    } else if lower.ends_with(".svg") {
        "image/svg+xml"
    } else if lower.ends_with(".webp") {
        "image/webp"
    } else {
        "image/jpeg"
    }
}
```

**Step 2: Check if `base64` crate is available**

Run: `grep base64 src-tauri/Cargo.toml`

If not present, add to `[dependencies]`: `base64 = "0.22"`

**Step 3: Register the command in `main.rs`**

Add `forge_proxy_image` to the `invoke_handler` list, near the other forge commands.

Add to `commands/mod.rs`: `pub mod forge_image_proxy;`

Add the use statement in `main.rs`.

**Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: PASS

---

### Task 3: Add `ForgeProxyImage` to `tauriCommands.ts`

**Files:**
- Modify: `src/common/tauriCommands.ts`

**Step 1: Add the command enum entry**

Add near other Forge commands:
```typescript
ForgeProxyImage: 'forge_proxy_image',
```

**Step 2: Verify lint passes**

Run: `bun run lint`
Expected: PASS

---

### Task 4: Add forge context props and custom `img` component to `MarkdownRenderer`

**Files:**
- Modify: `src/components/specs/MarkdownRenderer.tsx`
- Modify: `src/components/specs/MarkdownRenderer.test.tsx`

**Step 1: Write failing tests**

Add tests to `MarkdownRenderer.test.tsx`:

```typescript
it('renders images with default img tag when no forge context', () => {
  render(<MarkdownRenderer content="![alt text](https://example.com/image.png)" />)
  const img = screen.getByAltText('alt text')
  expect(img).toBeInTheDocument()
  expect(img).toHaveAttribute('src', 'https://example.com/image.png')
})

it('resolves relative GitLab image URLs to absolute URLs', async () => {
  const { invoke } = await import('@tauri-apps/api/core')
  vi.mocked(invoke).mockResolvedValue('data:image/png;base64,abc123')

  render(
    <MarkdownRenderer
      content="![screenshot](/uploads/abc123/image.png)"
      forgeContext={{ forgeType: 'gitlab', hostname: 'gitlab.example.com', projectIdentifier: 'group/project' }}
    />
  )

  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith('forge_proxy_image', {
      imageUrl: 'https://gitlab.example.com/group/project/uploads/abc123/image.png',
      forgeType: 'gitlab',
      hostname: 'gitlab.example.com',
    })
  })
})

it('does not proxy images for GitHub forge context', () => {
  render(
    <MarkdownRenderer
      content="![alt](https://github.com/image.png)"
      forgeContext={{ forgeType: 'github', hostname: 'github.com', projectIdentifier: 'org/repo' }}
    />
  )
  const img = screen.getByAltText('alt')
  expect(img).toHaveAttribute('src', 'https://github.com/image.png')
})
```

**Step 2: Run tests to verify they fail**

Run: `bun run vitest run src/components/specs/MarkdownRenderer.test.tsx`
Expected: FAIL — props don't exist yet

**Step 3: Implement**

Update `MarkdownRendererProps`:
```typescript
export interface ForgeContext {
  forgeType: ForgeType
  hostname?: string
  projectIdentifier?: string
}

interface MarkdownRendererProps {
  content: string
  className?: string
  forgeContext?: ForgeContext
}
```

Add a `GitLabImage` component that:
1. Takes `src`, `alt`, and `forgeContext`
2. Detects if the URL is relative (`/uploads/...`) and resolves it using `hostname` + `projectIdentifier`
3. Calls `forge_proxy_image` on mount
4. Shows a loading placeholder, then the loaded image, or a broken-image fallback on error

Update `MarkdownRenderer` to pass `forgeContext` into a custom `img` component factory.

**Step 4: Run tests to verify they pass**

Run: `bun run vitest run src/components/specs/MarkdownRenderer.test.tsx`
Expected: PASS

---

### Task 5: Pass forge context from `ForgeIssueDetail` to `MarkdownRenderer`

**Files:**
- Modify: `src/components/forge/ForgeIssueDetail.tsx`
- Modify: `src/components/forge/ForgeIssuesTab.tsx`
- Modify: `src/components/forge/ForgeIssueDetail.test.tsx`

**Step 1: Write failing test**

Add to `ForgeIssueDetail.test.tsx`:

```typescript
it('passes forge context to MarkdownRenderer', () => {
  // Render ForgeIssueDetail with forgeType='gitlab' and source config
  // Assert MarkdownRenderer receives forgeContext prop
})
```

**Step 2: Update `ForgeIssueDetailProps`**

Add `source?: ForgeSourceConfig` to props. Build `forgeContext` from `source` and `forgeType`, pass to both `MarkdownRenderer` instances (body and comments).

**Step 3: Update `ForgeIssuesTab.tsx`**

Pass `source={selectedSource}` when rendering `<ForgeIssueDetail>`.

**Step 4: Run tests to verify they pass**

Run: `bun run vitest run src/components/forge/ForgeIssueDetail.test.tsx`
Expected: PASS

---

### Task 6: Pass forge context from `ForgePrDetail` to `MarkdownRenderer`

**Files:**
- Modify: `src/components/forge/ForgePrDetail.tsx`

**Step 1: Check if `ForgePrDetail` also renders markdown with `MarkdownRenderer`**

Read `ForgePrDetail.tsx` and apply the same pattern as Task 5 if it uses `MarkdownRenderer`.

---

### Task 7: Full validation and commit

**Step 1: Run full test suite**

Run: `just test`
Expected: ALL PASS

**Step 2: Commit**

```bash
git add -A
git commit -m "fix: proxy GitLab images through backend for private repo access"
```
