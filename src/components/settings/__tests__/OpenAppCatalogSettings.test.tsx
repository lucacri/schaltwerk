import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { OpenAppCatalogSettings } from "../OpenAppCatalogSettings";
import { TauriCommands } from "../../../common/tauriCommands";

interface TestCatalogedApp {
  id: string;
  name: string;
  kind: "editor" | "terminal" | "system";
  is_detected: boolean;
  is_enabled: boolean;
  is_default: boolean;
}

describe("OpenAppCatalogSettings", () => {
  const invokeMock = vi.mocked(invoke);

  let catalog: TestCatalogedApp[];

  beforeEach(() => {
    vi.clearAllMocks();
    catalog = [
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
        is_enabled: true,
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
    ];

    invokeMock.mockImplementation((command, args) => {
      switch (command) {
        case TauriCommands.ListOpenAppCatalog:
          return Promise.resolve(catalog) as ReturnType<typeof invoke>;
        case TauriCommands.SetEnabledOpenAppIds: {
          const { appIds } = args as { appIds: string[] };
          catalog = catalog.map((app) => ({
            ...app,
            is_enabled: appIds.includes(app.id),
          }));

          if (
            !catalog.some((app) => app.id === appIds[0] && app.is_default) &&
            !appIds.includes(catalog.find((app) => app.is_default)?.id ?? "")
          ) {
            const fallbackId = appIds[0];
            catalog = catalog.map((app) => ({
              ...app,
              is_default: app.id === fallbackId,
            }));
          }

          return Promise.resolve(undefined) as ReturnType<typeof invoke>;
        }
        case TauriCommands.SetDefaultOpenApp: {
          const { appId } = args as { appId: string };
          catalog = catalog.map((app) => ({
            ...app,
            is_enabled: app.is_enabled || app.id === appId,
            is_default: app.id === appId,
          }));
          return Promise.resolve(undefined) as ReturnType<typeof invoke>;
        }
        default:
          return Promise.reject(
            new Error(`Unexpected command: ${String(command)}`),
          ) as ReturnType<typeof invoke>;
      }
    });
  });

  test("renders canonical apps and default indicator", async () => {
    render(<OpenAppCatalogSettings onNotification={vi.fn()} />);

    expect(await screen.findByText("Finder")).toBeInTheDocument();
    expect(screen.getByText("VS Code")).toBeInTheDocument();
    expect(screen.getByText("PhpStorm")).toBeInTheDocument();
    expect(screen.getByText("Not detected")).toBeInTheDocument();

    const defaultCell = screen.getAllByText("Default")[1];
    expect(defaultCell.closest("tr")).toHaveTextContent("Finder");
  });

  test("guards the last enabled app and leaves other apps toggleable", async () => {
    catalog = [
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
    ];

    render(<OpenAppCatalogSettings onNotification={vi.fn()} />);

    const finderCheckbox = await screen.findByRole("checkbox", {
      name: /show finder in open menu/i,
    });
    const vscodeCheckbox = screen.getByRole("checkbox", {
      name: /show vs code in open menu/i,
    });

    expect(finderCheckbox).toBeChecked();
    expect(finderCheckbox).toBeDisabled();
    expect(vscodeCheckbox).not.toBeDisabled();
  });

  test("toggling an app calls set_enabled_open_app_ids with the updated list", async () => {
    render(<OpenAppCatalogSettings onNotification={vi.fn()} />);

    const vscodeCheckbox = await screen.findByRole("checkbox", {
      name: /show vs code in open menu/i,
    });
    fireEvent.click(vscodeCheckbox);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(
        TauriCommands.SetEnabledOpenAppIds,
        {
          appIds: ["finder"],
        },
      );
    });
  });

  test("set-as-default calls set_default_open_app", async () => {
    render(<OpenAppCatalogSettings onNotification={vi.fn()} />);

    const setDefaultButton = await screen.findByRole("button", {
      name: /set vs code as default/i,
    });
    fireEvent.click(setDefaultButton);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.SetDefaultOpenApp, {
        appId: "vscode",
      });
    });
  });

  test("disabling the current default reloads the backend fallback default", async () => {
    render(<OpenAppCatalogSettings onNotification={vi.fn()} />);

    const finderCheckbox = await screen.findByRole("checkbox", {
      name: /show finder in open menu/i,
    });
    fireEvent.click(finderCheckbox);

    await waitFor(() => {
      const defaultCell = screen.getAllByText("Default")[1];
      expect(defaultCell.closest("tr")).toHaveTextContent("VS Code");
    });
  });
});
