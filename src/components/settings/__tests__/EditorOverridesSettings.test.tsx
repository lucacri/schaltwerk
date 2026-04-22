import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { EditorOverridesSettings } from "../EditorOverridesSettings";
import { TauriCommands } from "../../../common/tauriCommands";

describe("EditorOverridesSettings", () => {
  const invokeMock = vi.mocked(invoke);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("labels the add-override fields for keyboard and screen-reader access", async () => {
    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.GetEditorOverrides:
          return Promise.resolve({}) as ReturnType<typeof invoke>;
        case TauriCommands.ListOpenAppCatalog:
          return Promise.resolve([
            {
              id: "zed",
              name: "Zed",
              kind: "editor",
              is_detected: true,
              is_enabled: true,
              is_default: false,
            },
            {
              id: "cursor",
              name: "Cursor",
              kind: "editor",
              is_detected: true,
              is_enabled: true,
              is_default: true,
            },
          ]) as ReturnType<typeof invoke>;
        default:
          return Promise.reject(
            new Error(`Unexpected command: ${String(command)}`),
          ) as ReturnType<typeof invoke>;
      }
    });

    render(<EditorOverridesSettings onNotification={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByLabelText("Extension")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("combobox", { name: "Editor" }),
    ).toBeInTheDocument();
  });

  test("does not render the shared open-app catalog controls inline", async () => {
    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.GetEditorOverrides:
          return Promise.resolve({ ".ts": "vscode" }) as ReturnType<
            typeof invoke
          >;
        case TauriCommands.ListOpenAppCatalog:
          return Promise.resolve([
            {
              id: "finder",
              name: "Finder",
              kind: "system",
              is_detected: true,
              is_enabled: true,
              is_default: true,
            },
            {
              id: "vscode",
              name: "VS Code",
              kind: "editor",
              is_detected: true,
              is_enabled: false,
              is_default: false,
            },
            {
              id: "phpstorm",
              name: "PhpStorm",
              kind: "editor",
              is_detected: false,
              is_enabled: false,
              is_default: false,
            },
          ]) as ReturnType<typeof invoke>;
        default:
          return Promise.reject(
            new Error(`Unexpected command: ${String(command)}`),
          ) as ReturnType<typeof invoke>;
      }
    });

    render(<EditorOverridesSettings onNotification={vi.fn()} />);

    await screen.findByText("File Editor Overrides");
    expect(screen.queryByText("Default app: Finder")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("checkbox", { name: "Finder" }),
    ).not.toBeInTheDocument();
  });

  test("keeps undetected catalog editors out of the add-override selector", async () => {
    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.GetEditorOverrides:
          return Promise.resolve({}) as ReturnType<typeof invoke>;
        case TauriCommands.ListOpenAppCatalog:
          return Promise.resolve([
            {
              id: "vscode",
              name: "VS Code",
              kind: "editor",
              is_detected: true,
              is_enabled: true,
              is_default: true,
            },
            {
              id: "phpstorm",
              name: "PhpStorm",
              kind: "editor",
              is_detected: false,
              is_enabled: false,
              is_default: false,
            },
          ]) as ReturnType<typeof invoke>;
        default:
          return Promise.reject(
            new Error(`Unexpected command: ${String(command)}`),
          ) as ReturnType<typeof invoke>;
      }
    });

    render(<EditorOverridesSettings onNotification={vi.fn()} />);

    const editorSelector = await screen.findByRole("combobox", {
      name: "Editor",
    });
    expect(editorSelector).toHaveTextContent("VS Code");
    expect(editorSelector).not.toHaveTextContent("PhpStorm");
  });

  test("keeps the saved editor label for an existing override even when that editor is not detected", async () => {
    invokeMock.mockImplementation((command) => {
      switch (command) {
        case TauriCommands.GetEditorOverrides:
          return Promise.resolve({ ".php": "phpstorm" }) as ReturnType<
            typeof invoke
          >;
        case TauriCommands.ListOpenAppCatalog:
          return Promise.resolve([
            {
              id: "vscode",
              name: "VS Code",
              kind: "editor",
              is_detected: true,
              is_enabled: true,
              is_default: true,
            },
            {
              id: "phpstorm",
              name: "PhpStorm",
              kind: "editor",
              is_detected: false,
              is_enabled: false,
              is_default: false,
            },
          ]) as ReturnType<typeof invoke>;
        default:
          return Promise.reject(
            new Error(`Unexpected command: ${String(command)}`),
          ) as ReturnType<typeof invoke>;
      }
    });

    render(<EditorOverridesSettings onNotification={vi.fn()} />);

    expect(
      await screen.findByRole("combobox", { name: "Editor for .php" }),
    ).toHaveTextContent("PhpStorm");
  });
});
