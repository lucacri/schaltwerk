import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TauriCommands } from "../../common/tauriCommands";
import { logger } from "../../utils/logger";
import { Button, FormGroup, SectionHeader, Select, TextInput } from "../ui";
import type { OpenAppCatalogEntry } from "../../types/openApps";

interface EditorOverridesSettingsProps {
  onNotification: (message: string, type: "success" | "error") => void;
}

export function EditorOverridesSettings({
  onNotification,
}: EditorOverridesSettingsProps) {
  const [overrides, setOverrides] = useState<Record<string, string>>({});
  const [catalog, setCatalog] = useState<OpenAppCatalogEntry[]>([]);
  const [newExtension, setNewExtension] = useState("");
  const [newEditor, setNewEditor] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [loadedOverrides, apps] = await Promise.all([
        invoke<Record<string, string>>(TauriCommands.GetEditorOverrides),
        invoke<OpenAppCatalogEntry[]>(TauriCommands.ListOpenAppCatalog),
      ]);
      setOverrides(loadedOverrides);
      setCatalog(apps);
    } catch (error) {
      logger.error("Failed to load editor overrides settings", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editors = catalog.filter((app) => app.kind === "editor");
  const launchableEditors = editors.filter((app) => app.is_detected);

  useEffect(() => {
    if (launchableEditors.length > 0 && !newEditor) {
      setNewEditor(launchableEditors[0].id);
    }
  }, [launchableEditors, newEditor]);

  const save = useCallback(
    async (updated: Record<string, string>) => {
      try {
        await invoke(TauriCommands.SetEditorOverrides, { overrides: updated });
        setOverrides(updated);
        onNotification("Editor overrides saved", "success");
      } catch (error) {
        logger.error("Failed to save editor overrides", error);
        onNotification("Failed to save editor overrides", "error");
      }
    },
    [onNotification],
  );

  const handleAdd = useCallback(() => {
    const ext = newExtension.startsWith(".")
      ? newExtension
      : `.${newExtension}`;
    if (!ext || ext === "." || !newEditor) return;
    if (overrides[ext]) {
      onNotification(`Override for ${ext} already exists`, "error");
      return;
    }
    const updated = { ...overrides, [ext]: newEditor };
    void save(updated);
    setNewExtension("");
  }, [newExtension, newEditor, overrides, save, onNotification]);

  const handleRemove = useCallback(
    (ext: string) => {
      const updated = { ...overrides };
      delete updated[ext];
      void save(updated);
    },
    [overrides, save],
  );

  const handleEditorChange = useCallback(
    (ext: string, editorId: string) => {
      const updated = { ...overrides, [ext]: editorId };
      void save(updated);
    },
    [overrides, save],
  );

  if (loading) return null;

  const sortedEntries = Object.entries(overrides).sort(([a], [b]) =>
    a.localeCompare(b),
  );

  return (
    <div className="space-y-6">
      <SectionHeader
        title="File Editor Overrides"
        description="Configure which editor opens for specific file extensions. Files without an override use your system default application."
        className="border-b-0 pb-0"
      />

      {sortedEntries.length > 0 && (
        <div className="border border-border-subtle rounded-lg overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-bg-elevated">
                <th className="text-left text-caption font-medium text-text-secondary px-4 py-2">
                  Extension
                </th>
                <th className="text-left text-caption font-medium text-text-secondary px-4 py-2">
                  Editor
                </th>
                <th className="w-10 px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map(([ext, editorId]) => (
                <tr key={ext} className="border-t border-border-subtle">
                  <td className="px-4 py-2 text-body text-text-primary font-mono">
                    {ext}
                  </td>
                  <td className="px-4 py-2">
                    <Select
                      value={editorId}
                      onChange={(value) => handleEditorChange(ext, value)}
                      aria-label={`Editor for ${ext}`}
                      options={[
                        ...launchableEditors.map((editor) => ({
                          value: editor.id,
                          label: editor.name,
                        })),
                        ...(!launchableEditors.some((e) => e.id === editorId)
                          ? [
                              {
                                value: editorId,
                                label:
                                  editors.find(
                                    (editor) => editor.id === editorId,
                                  )?.name ?? editorId,
                              },
                            ]
                          : []),
                      ]}
                    />
                  </td>
                  <td className="px-4 py-2">
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => handleRemove(ext)}
                      title="Remove override"
                    >
                      <svg
                        className="h-4 w-4"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {launchableEditors.length > 0 && (
        <div className="flex items-end gap-2">
          <FormGroup label="Extension" className="w-24">
            <TextInput
              type="text"
              value={newExtension}
              onChange={(e) => setNewExtension(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAdd();
              }}
              placeholder=".rs"
              className="font-mono"
            />
          </FormGroup>
          <FormGroup label="Editor" className="flex-1">
            <Select
              value={newEditor}
              onChange={setNewEditor}
              options={launchableEditors.map((editor) => ({
                value: editor.id,
                label: editor.name,
              }))}
            />
          </FormGroup>
          <Button
            variant="primary"
            onClick={handleAdd}
            disabled={!newExtension || !newEditor}
          >
            Add
          </Button>
        </div>
      )}

      {launchableEditors.length === 0 && (
        <div className="text-body text-text-tertiary">
          No code editors detected on your system. Install VS Code, Cursor, Zed,
          IntelliJ, or PhpStorm to configure editor overrides.
        </div>
      )}
    </div>
  );
}
