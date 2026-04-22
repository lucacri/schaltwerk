import { useCallback, useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { TauriCommands } from "../../common/tauriCommands";
import { emitUiEvent, UiEvent } from "../../common/uiEvents";
import type { OpenAppCatalogEntry } from "../../types/openApps";
import { logger } from "../../utils/logger";
import { Button, Checkbox, SectionHeader } from "../ui";

interface OpenAppCatalogSettingsProps {
  onNotification: (message: string, type: "success" | "error") => void;
}

const KIND_ORDER: Record<OpenAppCatalogEntry["kind"], number> = {
  system: 0,
  terminal: 1,
  editor: 2,
};

export function OpenAppCatalogSettings({
  onNotification,
}: OpenAppCatalogSettingsProps) {
  const [catalog, setCatalog] = useState<OpenAppCatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const loadCatalog = useCallback(async () => {
    try {
      const apps = await invoke<OpenAppCatalogEntry[]>(
        TauriCommands.ListOpenAppCatalog,
      );
      setCatalog(apps);
    } catch (error) {
      logger.error("Failed to load open app catalog", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const enabledCount = useMemo(
    () => catalog.filter((app) => app.is_enabled).length,
    [catalog],
  );

  const sortedCatalog = useMemo(() => {
    return [...catalog].sort((a, b) => {
      const kindOrder = (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9);
      return kindOrder !== 0 ? kindOrder : a.name.localeCompare(b.name);
    });
  }, [catalog]);

  const handleToggle = useCallback(
    async (appId: string, enabled: boolean) => {
      const nextEnabledIds = enabled
        ? [
            ...catalog.filter((app) => app.is_enabled).map((app) => app.id),
            appId,
          ]
        : catalog
            .filter((app) => app.is_enabled && app.id !== appId)
            .map((app) => app.id);

      try {
        await invoke(TauriCommands.SetEnabledOpenAppIds, {
          appIds: nextEnabledIds,
        });
        await loadCatalog();
        emitUiEvent(UiEvent.OpenAppsUpdated);
        onNotification("Open app catalog updated", "success");
      } catch (error) {
        logger.error("Failed to update enabled open apps", error);
        onNotification("Failed to update open app catalog", "error");
      }
    },
    [catalog, loadCatalog, onNotification],
  );

  const handleSetDefault = useCallback(
    async (appId: string) => {
      try {
        await invoke(TauriCommands.SetDefaultOpenApp, { appId });
        await loadCatalog();
        emitUiEvent(UiEvent.OpenAppsUpdated);
        onNotification("Default open app updated", "success");
      } catch (error) {
        logger.error("Failed to update default open app", error);
        onNotification("Failed to update default open app", "error");
      }
    },
    [loadCatalog, onNotification],
  );

  if (loading) return null;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Open Menu Apps"
        description="Choose which supported apps appear in the shared Open menu. Disabling the current default falls back to the next enabled app automatically."
        className="border-b-0 pb-0"
      />

      <div className="border border-border-subtle rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="bg-bg-elevated">
              <th className="text-left text-caption font-medium text-text-secondary px-4 py-2">
                Show
              </th>
              <th className="text-left text-caption font-medium text-text-secondary px-4 py-2">
                App
              </th>
              <th className="text-left text-caption font-medium text-text-secondary px-4 py-2">
                Kind
              </th>
              <th className="text-left text-caption font-medium text-text-secondary px-4 py-2">
                Status
              </th>
              <th className="text-left text-caption font-medium text-text-secondary px-4 py-2">
                Default
              </th>
            </tr>
          </thead>
          <tbody>
            {sortedCatalog.map((app) => (
              <tr key={app.id} className="border-t border-border-subtle">
                <td className="px-4 py-2">
                  <Checkbox
                    checked={app.is_enabled}
                    disabled={app.is_enabled && enabledCount <= 1}
                    onChange={(checked) => {
                      void handleToggle(app.id, checked);
                    }}
                    label={
                      <span className="sr-only">{`Show ${app.name} in Open menu`}</span>
                    }
                  />
                </td>
                <td className="px-4 py-2 text-body text-text-primary">
                  {app.name}
                </td>
                <td className="px-4 py-2 text-body text-text-tertiary capitalize">
                  {app.kind}
                </td>
                <td className="px-4 py-2 text-body text-text-tertiary">
                  {app.is_detected ? "Detected" : "Not detected"}
                </td>
                <td className="px-4 py-2">
                  {app.is_default ? (
                    <span className="text-body text-accent-blue">Default</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void handleSetDefault(app.id);
                      }}
                      disabled={!app.is_enabled}
                      title={`Set ${app.name} as default`}
                      aria-label={`Set ${app.name} as default`}
                    >
                      Set as default
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
